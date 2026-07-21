// ============================================================================
// BENAVORA — Federal grant award intelligence import (multi-source)
//
// Imports real federal grant/award data into intelligence_funded_proposals
// (supabase/migrations/048_grant_intelligence.sql +
// supabase/migrations/106_intelligence_library_schema_upgrade.sql) from live
// federal sources, expands each into a persuasive grant narrative excerpt via
// Claude, and extracts structured persuasive_elements + winning_phrases for
// the Grant Intelligence Library.
//
// intelligence_funded_proposals has no title/abstract/organization/
// narrative_excerpt columns (confirmed against both migrations above and
// src/types/database.ts) — grant_program holds the title, full_text holds
// the narrative (raw or Claude-expanded), and the raw source description is
// kept in metadata. This follows the same convention already established in
// scripts/ingest-nih-reporter.ts, scripts/ingest-nsf-awards.ts, and
// scripts/ingest-federal-register.ts.
//
// SOURCE 4 DEVIATION FROM TASK SPEC: the task-given Grants.gov RSS endpoint
// (grants.gov/rss/GG_NewOppByAgency.xml) returns HTTP 200 but is a dead route
// on Grants.gov's current Nuxt SPA shell — its embedded __NUXT_DATA__ blob
// carries `"statusCode":15},"Not Found",404` for that exact path (verified
// live 2026-07-20). The classic REST search API this repo already has a
// client for (src/lib/sources/grantsgov-client.ts,
// api.grants.gov/grantsws/rest/opportunities/search/v2) also fails live with
// API-Gateway "Missing Authentication Token" on both /search/v2 and /search/
// (verified live, same session) — that gateway route has been decommissioned
// since Grants.gov migrated to simpler.grants.gov, which has no equivalent
// public unauthenticated search endpoint at time of writing. Source 4 is
// therefore attempted at runtime, logged, and skipped rather than fabricated
// — Sources 1-3 targets are raised so the 400+ total still holds even at 0
// from Source 4.
//
// SOURCE 1 (USASpending) DEVIATION: `recipient_type_names: ["nonprofit"]` and
// the full field list below (including "CFDA Number"/"CFDA Title"/"Place of
// Performance State Code") were verified live against
// api.usaspending.gov/api/v2/search/spending_by_award/ this session — the
// existing repo client (src/lib/agents/usaspending.ts) uses a narrower field
// list and no recipient-type filter, so this script does not reuse it.
// "Period of Performance Start Date" (task spec) does not exist as a
// requestable field; the real field is "Start Date" (verified) and is used
// instead for award_year.
//
// SOURCE 2 (NIH) and SOURCE 3 (NSF) reuse the request shapes already proven
// live in scripts/ingest-nih-reporter.ts and scripts/ingest-nsf-awards.ts,
// adapted to this task's specific criteria (org_types/award_amount_range for
// NIH, awardeeStateCode sweep for NSF).
//
// RATE LIMITING: 1 second delay between each external data-source API call
// (not between Claude calls — those already take several seconds of network
// latency each and the Anthropic SDK handles its own rate limiting).
// Processing and inserts happen in batches of 25 records per source page.
//
// Idempotent + resumable: every row's source_url is checked against a
// table-wide existing-URL set (loaded once at start) before insert. A
// checkpoint file (scripts/.checkpoints/federal-awards-checkpoint.json)
// records per-source pagination progress after every batch, so an
// interrupted run resumes near where it left off — dedup on source_url is
// the correctness backstop either way, matching the pattern already used in
// scripts/seed-intelligence-library.ts and scripts/enrich-foundations-990.ts.
//
//   pnpm import:federal
// ============================================================================

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";

import { createAdminClient } from "../src/lib/supabase/admin";

// ---- Config -----------------------------------------------------------------

const USASPENDING_URL = "https://api.usaspending.gov/api/v2/search/spending_by_award/";
const NIH_REPORTER_API = "https://api.reporter.nih.gov/v2/projects/search";
const NSF_AWARDS_API = "https://api.nsf.gov/services/v1/awards.json";
const GRANTS_GOV_SEARCH_URL = "https://api.grants.gov/grantsws/rest/opportunities/search/v2";

const USASPENDING_TARGET = 260;
const USASPENDING_PAGE_SIZE = 100;
const USASPENDING_MAX_PAGES = 15;

const NIH_TARGET = 100;
const NIH_PAGE_SIZE = 50;
const NIH_MAX_PAGES = 12;

const NSF_TARGET = 90;
const NSF_PAGE_SIZE = 25; // NSF Award Search API max rpp
const NSF_STATES = ["CA", "TX", "NY", "FL", "IL", "PA", "OH", "GA", "NC", "MI"];
const NSF_MAX_PAGES_PER_STATE = 4;

const GRANTS_GOV_TARGET = 40;
const GRANTS_GOV_KEYWORDS = ["nonprofit housing", "community services", "youth development"];

const BATCH_SIZE = 25;
const INTER_REQUEST_DELAY_MS = 1000;
const CLAUDE_MODEL = "claude-sonnet-4-6";

const CHECKPOINT_DIR = path.join(process.cwd(), "scripts", ".checkpoints");
const CHECKPOINT_FILE = path.join(CHECKPOINT_DIR, "federal-awards-checkpoint.json");

// ---- Shared helpers -----------------------------------------------------------

function ok(step: string, detail: string) {
  console.log(`  ✓ ${step}: ${detail}`);
}
function fail(step: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`  ✗ ${step}: ${message}`);
}
function fatal(message: string): never {
  console.error(`\nFATAL: ${message}`);
  process.exit(1);
}
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function toStr(val: unknown): string | null {
  if (typeof val === "string") return val.trim() || null;
  if (val === null || val === undefined) return null;
  return String(val).trim() || null;
}
function toNum(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}
function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** CFDA prefix -> NTEE major letter, per task-provided mapping. */
const CFDA_PREFIX_TO_NTEE: Record<string, string> = {
  "14": "L", // housing
  "93": "E", // health
  "84": "B", // education
  "16": "P", // human services
  "66": "C", // environment
};
function cfdaPrefixToNtee(cfdaNumber: string | null): string | null {
  if (!cfdaNumber) return null;
  const prefix = cfdaNumber.split(".")[0];
  return (prefix && CFDA_PREFIX_TO_NTEE[prefix]) || null;
}

// ---- Checkpoint ---------------------------------------------------------------

interface Checkpoint {
  usaspending: { nextPage: number; inserted: number; done: boolean };
  nih: { nextOffset: number; inserted: number; done: boolean };
  nsf: { stateIndex: number; nextPage: number; inserted: number; done: boolean };
  grantsgov: { attempted: boolean; available: boolean; inserted: number };
  totalInserted: number;
  updatedAt: string;
}

function defaultCheckpoint(): Checkpoint {
  return {
    usaspending: { nextPage: 1, inserted: 0, done: false },
    nih: { nextOffset: 0, inserted: 0, done: false },
    nsf: { stateIndex: 0, nextPage: 1, inserted: 0, done: false },
    grantsgov: { attempted: false, available: false, inserted: 0 },
    totalInserted: 0,
    updatedAt: new Date().toISOString(),
  };
}

function loadCheckpoint(): Checkpoint {
  try {
    if (fs.existsSync(CHECKPOINT_FILE)) {
      const raw = fs.readFileSync(CHECKPOINT_FILE, "utf-8");
      const parsed = JSON.parse(raw) as Partial<Checkpoint>;
      return { ...defaultCheckpoint(), ...parsed };
    }
  } catch (error) {
    console.warn(`  Failed to read checkpoint (starting fresh): ${error instanceof Error ? error.message : error}`);
  }
  return defaultCheckpoint();
}

function saveCheckpoint(cp: Checkpoint): void {
  cp.updatedAt = new Date().toISOString();
  fs.mkdirSync(CHECKPOINT_DIR, { recursive: true });
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp, null, 2));
}

// ---- Claude enrichment ----------------------------------------------------------

let anthropicClient: Anthropic | null = null;
function getClaude(): Anthropic {
  if (anthropicClient === null) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("Missing required env var: ANTHROPIC_API_KEY");
    anthropicClient = new Anthropic({ apiKey });
  }
  return anthropicClient;
}

function extractText(response: Anthropic.Messages.Message): string {
  const block = response.content[0];
  if (!block || block.type !== "text") throw new Error("No text response from Claude");
  return block.text.trim();
}

function stripJsonFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
}

interface EnrichmentContext {
  funderName: string;
  grantProgram: string | null;
}

/** SOURCE 1 always generates an expanded narrative from the raw award description. */
async function expandAwardDescription(description: string, context: EnrichmentContext): Promise<string> {
  const userPrompt =
    "Expand this federal grant award description into a 400-word grant narrative excerpt showing how a " +
    "nonprofit would describe this program in a grant application. Write in first person plural, include " +
    "problem statement, program description, and measurable outcomes.\n\n" +
    `Funder: ${context.funderName}\nProgram: ${context.grantProgram ?? "Federal grant program"}\n` +
    `Award description: ${description}`;

  const response = await getClaude().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 600,
    messages: [{ role: "user", content: userPrompt }],
  });
  return extractText(response);
}

/** SOURCES 2-4: only expand via Claude when the raw title+abstract text is under 200 words. */
async function expandIfShort(fullText: string, context: EnrichmentContext): Promise<string> {
  if (wordCount(fullText) >= 200) return fullText;

  const systemPrompt =
    "You are a grant writer. Expand this award description into a compelling 400-word grant narrative " +
    "excerpt. Use specific program details, measurable outcomes, and persuasive language. Write as if this " +
    "is from the winning application.";
  const userPrompt = `Funder: ${context.funderName}\nProgram: ${context.grantProgram ?? "Federal grant program"}\n\nSource text:\n${fullText}`;

  const response = await getClaude().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 700,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });
  return extractText(response);
}

interface PersuasiveElement {
  element_type: string;
  text: string;
  why_it_works: string;
}
function isPersuasiveElement(val: unknown): val is PersuasiveElement {
  if (val === null || typeof val !== "object") return false;
  const v = val as Record<string, unknown>;
  return typeof v.element_type === "string" && typeof v.text === "string" && typeof v.why_it_works === "string";
}

async function extractPersuasiveElements(fullText: string): Promise<PersuasiveElement[]> {
  try {
    const response = await getClaude().messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content:
            "Extract the 5 most persuasive elements from this grant narrative. Return JSON array: " +
            '[{ "element_type": string, "text": string, "why_it_works": string }]. Element types: ' +
            "compelling_statistic, clear_outcome, emotional_appeal, credibility_marker, urgency_statement. " +
            `Return ONLY the JSON array, no other text.\n\nNarrative:\n${fullText.slice(0, 4000)}`,
        },
      ],
    });
    const parsed: unknown = JSON.parse(stripJsonFences(extractText(response)));
    return Array.isArray(parsed) ? parsed.filter(isPersuasiveElement) : [];
  } catch (error) {
    console.warn(`    persuasive_elements extraction failed (non-fatal): ${error instanceof Error ? error.message : error}`);
    return [];
  }
}

async function extractWinningPhrases(fullText: string): Promise<string[]> {
  try {
    const response = await getClaude().messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 200,
      messages: [
        {
          role: "user",
          content:
            "Extract 8 grant-winning phrases from this narrative. These should be phrases grant reviewers " +
            `find compelling. Return ONLY a JSON array of strings, no other text.\n\nNarrative:\n${fullText.slice(0, 4000)}`,
        },
      ],
    });
    const parsed: unknown = JSON.parse(stripJsonFences(extractText(response)));
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
  } catch (error) {
    console.warn(`    winning_phrases extraction failed (non-fatal): ${error instanceof Error ? error.message : error}`);
    return [];
  }
}

// ---- Row shape + insert ---------------------------------------------------------

interface ProposalRow {
  source: string;
  source_url: string;
  funder_name: string;
  funder_type: string | null;
  grant_program: string | null;
  award_amount: number | null;
  award_year: number | null;
  category: string[];
  full_text: string;
  ntee_major: string | null;
  source_type: string;
  is_verified: boolean;
  persuasive_elements: PersuasiveElement[];
  winning_phrases: string[];
  metadata: Record<string, unknown>;
}

interface DraftRow {
  source: string;
  source_url: string;
  funder_name: string;
  funder_type: string | null;
  grant_program: string | null;
  award_amount: number | null;
  award_year: number | null;
  category: string[];
  full_text: string;
  ntee_major: string | null;
  source_type: string;
  is_verified: boolean;
  metadata: Record<string, unknown>;
}

/** Runs the shared narrative-quality pipeline (expand-if-short already applied by caller) + enrichment. */
async function finalizeRow(draft: DraftRow): Promise<ProposalRow> {
  const persuasiveElements = await extractPersuasiveElements(draft.full_text);
  const winningPhrases = await extractWinningPhrases(draft.full_text);
  return { ...draft, persuasive_elements: persuasiveElements, winning_phrases: winningPhrases };
}

async function insertBatch(
  supabase: ReturnType<typeof createAdminClient>,
  rows: ProposalRow[],
  existingUrls: Set<string>,
  label: string,
): Promise<number> {
  const toInsert = rows.filter((r) => !existingUrls.has(r.source_url));
  if (toInsert.length === 0) return 0;

  const { error } = await supabase.from("intelligence_funded_proposals").insert(toInsert as never);
  if (error) {
    fail(`${label} insert batch`, error);
    return 0;
  }
  for (const r of toInsert) existingUrls.add(r.source_url);
  return toInsert.length;
}

/** Enriches a page of draft rows in batches of BATCH_SIZE and inserts each batch. */
async function processAndInsert(
  supabase: ReturnType<typeof createAdminClient>,
  drafts: DraftRow[],
  existingUrls: Set<string>,
  label: string,
): Promise<number> {
  const fresh = drafts.filter((d) => !existingUrls.has(d.source_url));
  let inserted = 0;

  for (let i = 0; i < fresh.length; i += BATCH_SIZE) {
    const chunk = fresh.slice(i, i + BATCH_SIZE);
    const finalized: ProposalRow[] = [];
    for (const draft of chunk) {
      try {
        finalized.push(await finalizeRow(draft));
      } catch (error) {
        fail(`${label} enrichment for ${draft.source_url}`, error);
      }
    }
    inserted += await insertBatch(supabase, finalized, existingUrls, label);
  }
  return inserted;
}

// ---- SOURCE 1: USASpending.gov ---------------------------------------------------

interface UsaSpendingHit {
  "Award ID"?: string;
  "Recipient Name"?: string;
  "Award Amount"?: number;
  "Awarding Agency"?: string;
  Description?: string;
  "Start Date"?: string;
  "CFDA Number"?: string | null;
  "CFDA Title"?: string | null;
  "Place of Performance State Code"?: string | null;
  generated_internal_id?: string;
  internal_id?: number;
}
interface UsaSpendingResponse {
  results?: UsaSpendingHit[];
  page_metadata?: { page?: number; hasNext?: boolean };
}

function parseYearFromDate(date: string | null | undefined): number | null {
  if (!date) return null;
  const year = parseInt(date.slice(0, 4), 10);
  return Number.isFinite(year) ? year : null;
}

async function fetchUsaSpendingPage(page: number): Promise<UsaSpendingResponse> {
  const response = await fetch(USASPENDING_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filters: {
        award_type_codes: ["02", "03", "04", "05"],
        time_period: [{ start_date: "2022-01-01", end_date: "2024-12-31" }],
        award_amounts: [{ lower_bound: 25000, upper_bound: 2000000 }],
        recipient_type_names: ["nonprofit"],
      },
      fields: [
        "Award ID",
        "Recipient Name",
        "Award Amount",
        "Awarding Agency",
        "Description",
        "Start Date",
        "CFDA Number",
        "CFDA Title",
        "Place of Performance State Code",
      ],
      limit: USASPENDING_PAGE_SIZE,
      page,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`USASpending API returned HTTP ${response.status} on page ${page}`);
  return (await response.json()) as UsaSpendingResponse;
}

async function draftFromUsaSpendingHit(hit: UsaSpendingHit): Promise<DraftRow | null> {
  const awardId = hit.generated_internal_id || hit["Award ID"];
  const description = hit.Description?.trim();
  if (!awardId || !description) return null; // nothing worth ingesting / no stable identifier

  const funderName = hit["Awarding Agency"]?.trim() || "Federal Awarding Agency";
  const cfdaNumber = hit["CFDA Number"] ?? null;
  const grantProgram = hit["CFDA Title"]?.trim() || (cfdaNumber ? `${funderName} — CFDA ${cfdaNumber}` : null);
  const nteeMajor = cfdaPrefixToNtee(cfdaNumber);

  const fullText = await expandAwardDescription(description, { funderName, grantProgram });

  return {
    source: "USASPENDING",
    source_url: `https://www.usaspending.gov/award/${encodeURIComponent(awardId)}`,
    funder_name: funderName,
    funder_type: "federal",
    grant_program: grantProgram,
    award_amount: toNum(hit["Award Amount"]),
    award_year: parseYearFromDate(hit["Start Date"]),
    category: [nteeMajor, "federal", "usaspending"].filter((v): v is string => !!v),
    full_text: fullText.slice(0, 100_000),
    ntee_major: nteeMajor,
    source_type: "usaspending",
    is_verified: true,
    metadata: {
      raw_award_description: description,
      recipient_name: hit["Recipient Name"] ?? null,
      cfda_number: cfdaNumber,
      cfda_title: hit["CFDA Title"] ?? null,
      place_of_performance_state: hit["Place of Performance State Code"] ?? null,
      start_date: hit["Start Date"] ?? null,
    },
  };
}

async function runUsaSpending(
  supabase: ReturnType<typeof createAdminClient>,
  existingUrls: Set<string>,
  cp: Checkpoint,
): Promise<void> {
  if (cp.usaspending.done) {
    ok("SOURCE 1 (USASpending)", `already complete from checkpoint (${cp.usaspending.inserted} inserted)`);
    return;
  }
  console.log(`\nSOURCE 1 — USASpending.gov (target ${USASPENDING_TARGET}, starting page ${cp.usaspending.nextPage}) ...`);

  let page = cp.usaspending.nextPage;
  while (page <= USASPENDING_MAX_PAGES && cp.usaspending.inserted < USASPENDING_TARGET) {
    let body: UsaSpendingResponse;
    try {
      body = await fetchUsaSpendingPage(page);
    } catch (error) {
      fail(`USASpending page ${page}`, error);
      break;
    }
    await sleep(INTER_REQUEST_DELAY_MS);

    const hits = body.results ?? [];
    if (hits.length === 0) {
      ok(`USASpending page ${page}`, "no more results — ending sweep");
      cp.usaspending.done = true;
      break;
    }

    const drafts: DraftRow[] = [];
    for (const hit of hits) {
      const draft = await draftFromUsaSpendingHit(hit);
      if (draft) drafts.push(draft);
    }

    const inserted = await processAndInsert(supabase, drafts, existingUrls, "USASpending");
    cp.usaspending.inserted += inserted;
    cp.totalInserted += inserted;
    ok(`USASpending page ${page}`, `${inserted} inserted (running total ${cp.usaspending.inserted}/${USASPENDING_TARGET})`);

    page++;
    cp.usaspending.nextPage = page;
    saveCheckpoint(cp);

    if (!body.page_metadata?.hasNext) {
      ok("USASpending", "final page reached (hasNext=false)");
      cp.usaspending.done = true;
      break;
    }
  }
  if (cp.usaspending.inserted >= USASPENDING_TARGET) cp.usaspending.done = true;
  saveCheckpoint(cp);
}

// ---- SOURCE 2: NIH RePORTER -------------------------------------------------------

interface NihAgencyIcAdmin {
  code?: string;
  abbreviation?: string;
  name?: string;
}
interface NihProject {
  appl_id?: number;
  fiscal_year?: number;
  agency_ic_admin?: NihAgencyIcAdmin | null;
  project_title?: string;
  abstract_text?: string | null;
  award_amount?: number | null;
  organization?: { org_name?: string | null } | null;
}
interface NihSearchResponse {
  results?: NihProject[];
}

async function fetchNihPage(offset: number): Promise<NihProject[]> {
  const response = await fetch(NIH_REPORTER_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      criteria: {
        org_types: ["NONPROFIT"],
        award_notice_date: { from_date: "2022-01-01", to_date: "2024-12-31" },
        award_amount_range: { min_amount: 25000, max_amount: 5_000_000 },
      },
      offset,
      limit: NIH_PAGE_SIZE,
      sort_field: "award_amount",
      sort_order: "desc",
      include_fields: ["ProjectTitle", "AbstractText", "AwardAmount", "ApplId", "FiscalYear", "AgencyIcAdmin", "Organization"],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`NIH RePORTER API returned HTTP ${response.status} at offset ${offset}`);
  const body = (await response.json()) as NihSearchResponse;
  return body.results ?? [];
}

async function draftFromNihProject(project: NihProject): Promise<DraftRow | null> {
  if (!project.appl_id) return null; // no stable identifier to dedup/link on — skip rather than guess

  const title = project.project_title?.trim() || null;
  const abstract = project.abstract_text?.trim() || null;
  const rawText = [title, abstract].filter(Boolean).join("\n\n");
  if (!rawText) return null; // nothing worth ingesting

  const funderName = "National Institutes of Health";
  const fullText = await expandIfShort(rawText, { funderName, grantProgram: title });

  return {
    source: "NIH_REPORTER",
    source_url: `https://reporter.nih.gov/project-details/${project.appl_id}`,
    funder_name: funderName,
    funder_type: "federal",
    grant_program: title,
    award_amount: toNum(project.award_amount),
    award_year: project.fiscal_year ?? null,
    category: ["E", "federal", "health"],
    full_text: fullText.slice(0, 100_000),
    ntee_major: "E",
    source_type: "nih_reporter",
    is_verified: true,
    metadata: {
      appl_id: project.appl_id,
      agency_ic: project.agency_ic_admin?.name ?? project.agency_ic_admin?.abbreviation ?? null,
      organization: project.organization?.org_name ?? null,
      raw_abstract: abstract,
    },
  };
}

async function runNih(supabase: ReturnType<typeof createAdminClient>, existingUrls: Set<string>, cp: Checkpoint): Promise<void> {
  if (cp.nih.done) {
    ok("SOURCE 2 (NIH RePORTER)", `already complete from checkpoint (${cp.nih.inserted} inserted)`);
    return;
  }
  console.log(`\nSOURCE 2 — NIH RePORTER (target ${NIH_TARGET}, starting offset ${cp.nih.nextOffset}) ...`);

  let offset = cp.nih.nextOffset;
  let pagesRun = 0;
  while (pagesRun < NIH_MAX_PAGES && cp.nih.inserted < NIH_TARGET) {
    let projects: NihProject[];
    try {
      projects = await fetchNihPage(offset);
    } catch (error) {
      fail(`NIH page at offset ${offset}`, error);
      break;
    }
    await sleep(INTER_REQUEST_DELAY_MS);
    pagesRun++;

    if (projects.length === 0) {
      ok("NIH RePORTER", "no more results — ending sweep");
      cp.nih.done = true;
      break;
    }

    const drafts: DraftRow[] = [];
    for (const project of projects) {
      const draft = await draftFromNihProject(project);
      if (draft) drafts.push(draft);
    }

    const inserted = await processAndInsert(supabase, drafts, existingUrls, "NIH RePORTER");
    cp.nih.inserted += inserted;
    cp.totalInserted += inserted;
    ok(`NIH RePORTER offset ${offset}`, `${inserted} inserted (running total ${cp.nih.inserted}/${NIH_TARGET})`);

    offset += NIH_PAGE_SIZE;
    cp.nih.nextOffset = offset;
    saveCheckpoint(cp);

    if (projects.length < NIH_PAGE_SIZE) {
      ok("NIH RePORTER", "final page reached (partial page returned)");
      cp.nih.done = true;
      break;
    }
  }
  if (cp.nih.inserted >= NIH_TARGET) cp.nih.done = true;
  saveCheckpoint(cp);
}

// ---- SOURCE 3: NSF Award Search -----------------------------------------------------

interface NsfAward {
  id?: string;
  title?: string;
  abstractText?: string;
  startDate?: string;
  awardeeName?: string;
  fundsObligatedAmt?: string;
}
interface NsfSearchResponse {
  response?: { award?: NsfAward[] };
}

function parseNsfYear(startDate: string | undefined): number | null {
  if (!startDate) return null;
  const parts = startDate.split("/");
  if (parts.length !== 3) return null;
  const year = parseInt(parts[2] ?? "", 10);
  return Number.isFinite(year) ? year : null;
}

async function fetchNsfPage(state: string, offset: number): Promise<NsfAward[]> {
  const params = new URLSearchParams({
    agency: "NSF",
    dateStart: "01/01/2022",
    dateEnd: "12/31/2024",
    awardeeStateCode: state,
    printFields: "id,title,abstractText,awardeeName,fundsObligatedAmt,date",
    rpp: String(NSF_PAGE_SIZE),
    offset: String(offset),
  });
  const response = await fetch(`${NSF_AWARDS_API}?${params.toString()}`, {
    method: "GET",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`NSF Award Search API returned HTTP ${response.status} for ${state} at offset ${offset}`);
  const body = (await response.json()) as NsfSearchResponse;
  return body.response?.award ?? [];
}

async function draftFromNsfAward(award: NsfAward): Promise<DraftRow | null> {
  if (!award.id) return null; // no stable identifier to dedup/link on — skip rather than guess

  const title = award.title?.trim() || null;
  const abstract = award.abstractText?.trim() || null;
  const rawText = [title, abstract].filter(Boolean).join("\n\n");
  if (!rawText) return null; // nothing worth ingesting

  const funderName = "National Science Foundation";
  const fullText = await expandIfShort(rawText, { funderName, grantProgram: title });
  const amount = award.fundsObligatedAmt ? Number(award.fundsObligatedAmt) : null;

  return {
    source: "NSF_AWARDS",
    source_url: `https://www.nsf.gov/awardsearch/showAward?AWD_ID=${award.id}`,
    funder_name: funderName,
    funder_type: "federal",
    grant_program: title,
    award_amount: amount !== null && Number.isFinite(amount) ? amount : null,
    award_year: parseNsfYear(award.startDate),
    category: ["B", "federal", "education"],
    full_text: fullText.slice(0, 100_000),
    ntee_major: "B",
    source_type: "nsf_awards",
    is_verified: true,
    metadata: {
      nsf_award_id: award.id,
      awardee_name: award.awardeeName ?? null,
      start_date: award.startDate ?? null,
      raw_abstract: abstract,
    },
  };
}

async function runNsf(supabase: ReturnType<typeof createAdminClient>, existingUrls: Set<string>, cp: Checkpoint): Promise<void> {
  if (cp.nsf.done) {
    ok("SOURCE 3 (NSF Award Search)", `already complete from checkpoint (${cp.nsf.inserted} inserted)`);
    return;
  }
  console.log(`\nSOURCE 3 — NSF Award Search (target ${NSF_TARGET}, states: ${NSF_STATES.join(", ")}) ...`);

  let stateIndex = cp.nsf.stateIndex;
  let page = cp.nsf.nextPage;

  while (stateIndex < NSF_STATES.length && cp.nsf.inserted < NSF_TARGET) {
    const state = NSF_STATES[stateIndex];
    if (!state) break;

    if (page > NSF_MAX_PAGES_PER_STATE) {
      stateIndex++;
      page = 1;
      continue;
    }

    const offset = (page - 1) * NSF_PAGE_SIZE + 1;
    let awards: NsfAward[];
    try {
      awards = await fetchNsfPage(state, offset);
    } catch (error) {
      fail(`NSF ${state} page ${page}`, error);
      stateIndex++;
      page = 1;
      continue;
    }
    await sleep(INTER_REQUEST_DELAY_MS);

    if (awards.length === 0) {
      ok(`NSF ${state}`, "no more results for this state — moving to next state");
      stateIndex++;
      page = 1;
      cp.nsf.stateIndex = stateIndex;
      cp.nsf.nextPage = page;
      saveCheckpoint(cp);
      continue;
    }

    const drafts: DraftRow[] = [];
    for (const award of awards) {
      const draft = await draftFromNsfAward(award);
      if (draft) drafts.push(draft);
    }

    const inserted = await processAndInsert(supabase, drafts, existingUrls, "NSF Award Search");
    cp.nsf.inserted += inserted;
    cp.totalInserted += inserted;
    ok(`NSF ${state} page ${page}`, `${inserted} inserted (running total ${cp.nsf.inserted}/${NSF_TARGET})`);

    page++;
    cp.nsf.nextPage = page;
    cp.nsf.stateIndex = stateIndex;
    saveCheckpoint(cp);

    if (awards.length < NSF_PAGE_SIZE) {
      stateIndex++;
      page = 1;
      cp.nsf.stateIndex = stateIndex;
      cp.nsf.nextPage = page;
      saveCheckpoint(cp);
    }
  }
  if (cp.nsf.inserted >= NSF_TARGET || stateIndex >= NSF_STATES.length) cp.nsf.done = true;
  saveCheckpoint(cp);
}

// ---- SOURCE 4: Grants.gov (best-effort; see header deviation note) ------------------

interface GrantsGovOppHit {
  id?: unknown;
  oppTitle?: unknown;
  synopsis?: unknown;
  awardCeiling?: unknown;
  agencyName?: unknown;
}
interface GrantsGovSearchResponse {
  oppHits?: GrantsGovOppHit[];
}

async function draftFromGrantsGovHit(hit: GrantsGovOppHit): Promise<DraftRow | null> {
  const id = toStr(hit.id);
  const title = toStr(hit.oppTitle);
  const synopsis = toStr(hit.synopsis);
  if (!id || !title || !synopsis) return null;

  const funderName = toStr(hit.agencyName) || "Federal Awarding Agency";
  const fullText = await expandIfShort(synopsis, { funderName, grantProgram: title });

  return {
    source: "GRANTS_GOV",
    source_url: `https://www.grants.gov/search-results-detail/${id}`,
    funder_name: funderName,
    funder_type: "federal",
    grant_program: title,
    award_amount: toNum(hit.awardCeiling),
    award_year: null,
    category: ["federal", "grants_gov", "posted_opportunity"],
    full_text: fullText.slice(0, 100_000),
    ntee_major: null,
    source_type: "grants_gov",
    is_verified: false, // posted opportunity template, not a verified awarded grant
    metadata: { opportunity_id: id, raw_synopsis: synopsis, record_kind: "posted_opportunity_template" },
  };
}

async function runGrantsGov(supabase: ReturnType<typeof createAdminClient>, existingUrls: Set<string>, cp: Checkpoint): Promise<void> {
  if (cp.grantsgov.attempted) {
    ok(
      "SOURCE 4 (Grants.gov)",
      cp.grantsgov.available
        ? `already complete from checkpoint (${cp.grantsgov.inserted} inserted)`
        : "already confirmed unavailable from checkpoint — skipping",
    );
    return;
  }

  console.log(`\nSOURCE 4 — Grants.gov (target ${GRANTS_GOV_TARGET}, best-effort — see script header for known live-endpoint issues) ...`);
  cp.grantsgov.attempted = true;

  let totalInserted = 0;
  let anyRequestSucceeded = false;

  for (const keyword of GRANTS_GOV_KEYWORDS) {
    if (totalInserted >= GRANTS_GOV_TARGET) break;

    let response: Response;
    try {
      response = await fetch(GRANTS_GOV_SEARCH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword, oppStatuses: "posted", rows: 25, startRecordNum: 0 }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      fail(`Grants.gov search "${keyword}"`, error);
      await sleep(INTER_REQUEST_DELAY_MS);
      continue;
    }
    await sleep(INTER_REQUEST_DELAY_MS);

    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.includes("application/json")) {
      fail(`Grants.gov search "${keyword}"`, `HTTP ${response.status}, content-type "${contentType}" — endpoint unavailable`);
      continue;
    }

    let body: GrantsGovSearchResponse;
    try {
      body = (await response.json()) as GrantsGovSearchResponse;
    } catch (error) {
      fail(`Grants.gov search "${keyword}" (parse)`, error);
      continue;
    }

    anyRequestSucceeded = true;
    const hits = body.oppHits ?? [];
    const drafts: DraftRow[] = [];
    for (const hit of hits) {
      const draft = await draftFromGrantsGovHit(hit);
      if (draft) drafts.push(draft);
    }
    const inserted = await processAndInsert(supabase, drafts, existingUrls, "Grants.gov");
    totalInserted += inserted;
    ok(`Grants.gov "${keyword}"`, `${inserted} inserted (running total ${totalInserted}/${GRANTS_GOV_TARGET})`);
  }

  cp.grantsgov.available = anyRequestSucceeded;
  cp.grantsgov.inserted = totalInserted;
  cp.totalInserted += totalInserted;

  if (!anyRequestSucceeded) {
    console.warn(
      "  Grants.gov: all requests failed (non-JSON response or non-200) — this endpoint is confirmed dead as of " +
        "this script's last verification (see header). Skipping Source 4; Sources 1-3 targets were raised to " +
        "compensate. Re-verify GRANTS_GOV_SEARCH_URL against current Grants.gov API docs before re-enabling.",
    );
  }
  saveCheckpoint(cp);
}

// ---- Main -----------------------------------------------------------------------

async function main() {
  let supabase: ReturnType<typeof createAdminClient>;
  try {
    supabase = createAdminClient();
  } catch (error) {
    fatal(error instanceof Error ? error.message : String(error));
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    fatal("Missing required env var: ANTHROPIC_API_KEY");
  }

  const cp = loadCheckpoint();
  console.log(`Federal awards import starting. Checkpoint last updated: ${cp.updatedAt === defaultCheckpoint().updatedAt ? "(none — fresh run)" : cp.updatedAt}\n`);

  console.log("Loading existing source_url set for idempotency check...");
  const { data: existingRows, error: existingErr } = await supabase
    .from("intelligence_funded_proposals")
    .select("source_url")
    .not("source_url", "is", null);
  if (existingErr) fatal(`Failed to load existing rows: ${existingErr.message}`);
  const existingUrls = new Set(
    (existingRows ?? []).map((r) => (r as { source_url: string }).source_url).filter(Boolean),
  );
  console.log(`  ${existingUrls.size} existing source_url(s) on file.`);

  await runUsaSpending(supabase, existingUrls, cp);
  await runNih(supabase, existingUrls, cp);
  await runNsf(supabase, existingUrls, cp);
  await runGrantsGov(supabase, existingUrls, cp);

  console.log("\n" + "=".repeat(72));
  console.log("FEDERAL AWARDS IMPORT — FINAL REPORT");
  console.log("=".repeat(72));
  console.log(`  Source 1 (USASpending.gov):    ${cp.usaspending.inserted} inserted`);
  console.log(`  Source 2 (NIH RePORTER):       ${cp.nih.inserted} inserted`);
  console.log(`  Source 3 (NSF Award Search):   ${cp.nsf.inserted} inserted`);
  console.log(
    `  Source 4 (Grants.gov):         ${cp.grantsgov.inserted} inserted` +
      (cp.grantsgov.available ? "" : " (endpoint unavailable — see warning above)"),
  );
  console.log(`  ${"-".repeat(40)}`);
  console.log(`  TOTAL this run + prior checkpoint runs: ${cp.totalInserted}`);

  const { count: totalCount } = await supabase
    .from("intelligence_funded_proposals")
    .select("id", { count: "exact", head: true });
  console.log(`\n  intelligence_funded_proposals total row count: ${totalCount}`);

  if (cp.totalInserted < 400) {
    console.warn(
      `\n  Below the 400-record target this run — re-run to continue (dedup + checkpoint make this resumable).`,
    );
  }
}

main().catch((error) => {
  fatal(error instanceof Error ? (error.stack ?? error.message) : String(error));
});
