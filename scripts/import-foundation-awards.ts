// ============================================================================
// BENAVORA — Foundation and corporate grant award intelligence import
//
// Imports foundation/corporate giving intelligence into
// intelligence_funded_proposals (supabase/migrations/048_grant_intelligence.sql
// + supabase/migrations/106_intelligence_library_schema_upgrade.sql) — same
// table and column conventions already established in
// scripts/import-federal-awards.ts: grant_program holds the title, full_text
// holds the narrative, category is a text[] tag list, ntee_major/source_type/
// is_verified/persuasive_elements/winning_phrases come from migration 106.
// This script additionally populates migration 106's success_factors column
// (unused by import-federal-awards.ts), per this task's explicit request.
//
// SOURCE 1 — ProPublica Nonprofit Explorer (13 major foundations):
// Fetches https://projects.propublica.org/nonprofits/api/v2/organizations/
// {ein}.json (+ best-effort /full.json) for each foundation and reads its
// filings_with_data array. DEVIATION FROM TASK SPEC: ProPublica's JSON API
// exposes 990/990-PF AGGREGATE filing totals (revenue, expenses, assets, and
// whatever grants-paid total field a given filing happens to carry) — it does
// NOT itemize individual grantees (that level of detail lives only in the raw
// IRS e-file Schedule I XML, which this API does not flatten). The task's
// "grants_to_preselected_grantees"/"cash_grants_paid" field names could not be
// verified live this session (WebFetch access was not granted), so numeric
// fields are matched defensively against a list of candidate ProPublica key
// names (see pickNumber()) and the complete raw filing object is preserved in
// metadata.raw_filing for audit — never silently dropped. Each row represents
// one (foundation, filing-year) pair: real foundation identity + real
// aggregate 990 figures for that year, with a Claude-written representative
// narrative grounded in those real figures and the foundation's publicly known
// program priorities (hardcoded per foundation below). is_verified: true per
// task spec, reflecting the verified foundation/aggregate data — consistent
// with import-federal-awards.ts's convention that is_verified describes the
// award's provenance, not that every word of full_text is a literal quote.
//
// SOURCE 2 — Candid grants API: attempted exactly as given in the task
// (unauthenticated GET against api.candid.org/grants/v1/grants). Candid's
// grants API requires a subscription key (not present in BLUEPRINT_v2.md
// §11's API key registry), so this is expected to fail closed. Attempted
// once, logged, and skipped without fabricating a response shape — same
// best-effort pattern as SOURCE 4 (Grants.gov) in import-federal-awards.ts.
//
// SOURCE 3 — 150 hardcoded foundation records, 20 named foundations from the
// task. DEDUP NOTE: "Helmsley Charitable Trust" and "The Leona M. and Harry
// B. Helmsley Charitable Trust" in the task list are the same real
// organization (The Leona M. and Harry B. Helmsley Charitable Trust) — merged
// into one entry (19 unique funders) rather than inserted twice under two
// names for the same EIN-less identity.
//
// DEVIATION: the task's "2-4 records across different program areas" (per
// foundation) and its "target: 150 records" (for the source as a whole) are
// arithmetically incompatible — 19 foundations × 2-4 areas each yields ~51
// records, not 150. Per the same precedence import-federal-awards.ts applies
// when a per-item instruction conflicts with a stated numeric target (see its
// SOURCE 4 note), the explicit 150-record target governs: each foundation's
// program areas are cycled with 3+ record variants (different simulated
// award year/amount) to reach 150 total via distributeCount().
//
// SOURCE 4 — 50 hardcoded corporate foundation records, 10 named corporate
// giving programs from the task, 5 records each (distributeCount(50, 10)).
//
// Sources 3 and 4 are constructed exemplar narratives for a grant-writing
// intelligence corpus (the funder identities and their publicly known giving
// focus areas are real; the specific narrative text, dollar amount, and
// program year are Claude-generated illustrative compositions, not a claim
// about one verified named grantee). is_verified: false for both, and
// source_url uses an explicit internal:// scheme rather than a real-looking
// external URL, so provenance is never misrepresented — same honesty
// convention as the Grants.gov posted-opportunity rows in
// import-federal-awards.ts (is_verified: false there for the same reason).
//
// RATE LIMITING: 1 second delay between external HTTP calls (ProPublica /
// Candid), not between Claude calls, matching import-federal-awards.ts.
// Idempotent + resumable: source_url is deduped against a table-wide existing
// set loaded once at start; a checkpoint file
// (scripts/.checkpoints/foundation-awards-checkpoint.json) tracks per-source
// progress so an interrupted run resumes near where it left off.
//
//   pnpm import:foundations
// ============================================================================

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";

import { createAdminClient } from "../src/lib/supabase/admin";

// ---- Config -----------------------------------------------------------------

const PROPUBLICA_ORG_API = "https://projects.propublica.org/nonprofits/api/v2/organizations";
const CANDID_GRANTS_API = "https://api.candid.org/grants/v1/grants";

const PROPUBLICA_TARGET = 90;
const PROPUBLICA_MAX_FILINGS_PER_ORG = 8;

const SOURCE3_TARGET = 150; // hardcoded foundation awards
const SOURCE4_TARGET = 50; // hardcoded corporate foundation awards
const HARDCODED_YEARS = [2021, 2022, 2023, 2024];

const BATCH_SIZE = 25;
const INTER_REQUEST_DELAY_MS = 1000;
const CLAUDE_MODEL = "claude-sonnet-4-6";

const CHECKPOINT_DIR = path.join(process.cwd(), "scripts", ".checkpoints");
const CHECKPOINT_FILE = path.join(CHECKPOINT_DIR, "foundation-awards-checkpoint.json");

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
function pickNumber(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const val = obj[key];
    if (val === null || val === undefined || val === "") continue;
    const n = Number(val);
    if (Number.isFinite(n)) return n;
  }
  return null;
}
function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === "string" && val.trim()) return val.trim();
  }
  return null;
}
function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
function titleCase(text: string): string {
  return text.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1));
}
function randomInRange(min: number, max: number): number {
  return Math.round((min + Math.random() * (max - min)) / 1000) * 1000;
}
function distributeCount(total: number, buckets: number): number[] {
  const base = Math.floor(total / buckets);
  const remainder = total - base * buckets;
  return Array.from({ length: buckets }, (_, i) => base + (i < remainder ? 1 : 0));
}
function stripJsonFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
}

/** Foundation-priority-area keyword to NTEE major letter, keyword-substring matched (order matters). */
const AREA_NTEE_RULES: Array<[string[], string]> = [
  [["health access", "substance use", "health"], "E"],
  [["education"], "B"],
  [["housing", "homelessness"], "L"],
  [["environment", "sustainab", "water", "energy"], "C"],
  [["arts", "journalism", "culture"], "A"],
  [["community", "social services", "strong local economies"], "S"],
  [["civic life", "democracy", "human rights", "governance", "equality", "diversity"], "R"],
  [["employment", "workforce", "economic opportunity", "economic inclusion"], "J"],
  [["food", "hunger", "nutrition"], "K"],
  [["science", "technology", "internet health", "open source", "digital"], "U"],
  [["safe roads", "public safety"], "M"],
  [["sports"], "N"],
  [["youth", "mentor"], "O"],
  [["aging", "disabled", "poverty"], "P"],
  [["disaster", "humanitarian", "conflict"], "P"],
  [["gun violence"], "I"],
  [["social entrepreneurship"], "W"],
  [["accessibility"], "P"],
];
function areaToNtee(area: string): string {
  const normalized = area.toLowerCase();
  for (const [keywords, letter] of AREA_NTEE_RULES) {
    if (keywords.some((k) => normalized.includes(k))) return letter;
  }
  return "W"; // Public/societal benefit — generic fallback
}

// ---- Checkpoint ---------------------------------------------------------------

interface HardcodedCheckpointSlot {
  nextIndex: number;
  inserted: number;
  done: boolean;
}
interface Checkpoint {
  propublica: { orgIndex: number; inserted: number; done: boolean };
  candid: { attempted: boolean; available: boolean; inserted: number };
  hardcodedFoundations: HardcodedCheckpointSlot;
  hardcodedCorporate: HardcodedCheckpointSlot;
  totalInserted: number;
  updatedAt: string;
}

function defaultCheckpoint(): Checkpoint {
  return {
    propublica: { orgIndex: 0, inserted: 0, done: false },
    candid: { attempted: false, available: false, inserted: 0 },
    hardcodedFoundations: { nextIndex: 0, inserted: 0, done: false },
    hardcodedCorporate: { nextIndex: 0, inserted: 0, done: false },
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

/** SOURCE 1: narrative grounded in real ProPublica-verified aggregate 990 figures. */
async function generateVerifiedFoundationNarrative(params: {
  funderName: string;
  publicPriorities: string;
  taxYear: number | null;
  totalRevenue: number | null;
  totalExpenses: number | null;
  totalAssets: number | null;
  grantsPaidRaw: number | null;
}): Promise<string> {
  const financialContext = [
    params.taxYear ? `Tax year: ${params.taxYear}` : null,
    params.totalRevenue !== null ? `Total revenue: $${params.totalRevenue.toLocaleString()}` : null,
    params.totalExpenses !== null ? `Total expenses: $${params.totalExpenses.toLocaleString()}` : null,
    params.totalAssets !== null ? `Total assets: $${params.totalAssets.toLocaleString()}` : null,
    params.grantsPaidRaw !== null ? `Reported grants/giving-related figure: $${params.grantsPaidRaw.toLocaleString()}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const userPrompt =
    `Write a 400-word grant narrative excerpt representing a typical successful grant application to ` +
    `${params.funderName}, whose real, publicly known funding priorities include: ${params.publicPriorities}. ` +
    `This foundation's most recent IRS Form 990 filing on file with ProPublica's Nonprofit Explorer shows:\n` +
    `${financialContext || "(detailed financial figures not available in this filing)"}\n\n` +
    `Write in first person plural ("our organization"/"we"), with a specific problem statement, program ` +
    `description, and measurable outcomes consistent with a program this foundation would realistically fund. ` +
    `This is a training exemplar for a grant-writing intelligence library — do not claim this describes one ` +
    `specific named, verified grant recipient.`;

  const response = await getClaude().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 700,
    messages: [{ role: "user", content: userPrompt }],
  });
  return extractText(response);
}

/** SOURCES 3-4: narrative for a constructed exemplar record (no real specific award backing it). */
async function generateExemplarNarrative(params: {
  funderName: string;
  area: string;
  grantProgram: string;
  amount: number;
  year: number;
}): Promise<string> {
  const userPrompt =
    `Write a 400-word grant narrative excerpt as it would appear in a nonprofit's successful grant application ` +
    `to ${params.funderName}'s ${params.area} program area (${params.grantProgram}), which historically funds ` +
    `work in this space at levels around $${params.amount.toLocaleString()}. Write in first person plural ` +
    `("our organization"/"we"), covering: a specific, concrete problem statement grounded in real community need, ` +
    `program description, and measurable outcomes with concrete metrics. This is a ${params.year}-cycle training ` +
    `exemplar for a grant-writing intelligence library representing ${params.funderName}'s well-known public ` +
    `priorities in ${params.area} — do not claim this describes one specific named, verified grantee.`;

  const response = await getClaude().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 700,
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

async function extractSuccessFactors(fullText: string): Promise<string[]> {
  try {
    const response = await getClaude().messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 220,
      messages: [
        {
          role: "user",
          content:
            "Extract 4-6 success factors from this grant narrative — the specific structural or strategic " +
            "reasons this application would be competitive (e.g. strong evidence base, clear evaluation plan, " +
            "funder-mission alignment, sustainability plan). Return ONLY a JSON array of strings, no other text." +
            `\n\nNarrative:\n${fullText.slice(0, 4000)}`,
        },
      ],
    });
    const parsed: unknown = JSON.parse(stripJsonFences(extractText(response)));
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
  } catch (error) {
    console.warn(`    success_factors extraction failed (non-fatal): ${error instanceof Error ? error.message : error}`);
    return [];
  }
}

// ---- Row shape + insert ---------------------------------------------------------

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
interface ProposalRow extends DraftRow {
  persuasive_elements: PersuasiveElement[];
  winning_phrases: string[];
  success_factors: string[];
}

async function finalizeRow(draft: DraftRow): Promise<ProposalRow> {
  const [persuasiveElements, winningPhrases, successFactors] = await Promise.all([
    extractPersuasiveElements(draft.full_text),
    extractWinningPhrases(draft.full_text),
    extractSuccessFactors(draft.full_text),
  ]);
  return {
    ...draft,
    persuasive_elements: persuasiveElements,
    winning_phrases: winningPhrases,
    success_factors: successFactors,
  };
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

// ---- SOURCE 1: ProPublica Nonprofit Explorer -------------------------------------

interface FoundationDef {
  name: string;
  ein: string;
  funderType: "foundation" | "corporate";
  ntee: string;
  publicPriorities: string;
}

/** EINs and identities per task spec. Public priority summaries are well-established public
 * knowledge about each foundation's giving focus, used only as Claude narrative context —
 * never inserted as a claimed verified per-grant fact. */
const PROPUBLICA_FOUNDATIONS: FoundationDef[] = [
  { name: "Robert Wood Johnson Foundation", ein: "22-1859624", funderType: "foundation", ntee: "E", publicPriorities: "health equity, access to care, and healthy communities" },
  { name: "Bill & Melinda Gates Foundation", ein: "56-2618866", funderType: "foundation", ntee: "E", publicPriorities: "global health, global development, and U.S. education/poverty reduction" },
  { name: "Ford Foundation", ein: "13-1684331", funderType: "foundation", ntee: "R", publicPriorities: "reducing inequality and advancing social justice" },
  { name: "W.K. Kellogg Foundation", ein: "38-1360401", funderType: "foundation", ntee: "P", publicPriorities: "children, families, and communities, with a focus on racial equity" },
  { name: "MacArthur Foundation", ein: "23-7093598", funderType: "foundation", ntee: "R", publicPriorities: "criminal justice reform, journalism, and climate solutions" },
  { name: "Annie E. Casey Foundation", ein: "52-6051576", funderType: "foundation", ntee: "P", publicPriorities: "child welfare and family economic success" },
  { name: "Bloomberg Philanthropies", ein: "20-4109861", funderType: "corporate", ntee: "E", publicPriorities: "public health, climate/environment, arts, and government innovation" },
  { name: "Lumina Foundation", ein: "35-2037902", funderType: "foundation", ntee: "B", publicPriorities: "postsecondary education attainment and credentialing" },
  { name: "Charles and Lynn Schusterman Family Foundation", ein: "73-1340563", funderType: "foundation", ntee: "B", publicPriorities: "Jewish community, education, and leadership development" },
  { name: "JPMorgan Chase Foundation", ein: "13-6183850", funderType: "corporate", ntee: "J", publicPriorities: "workforce development, small business growth, and financial health" },
  { name: "Bank of America Charitable Foundation", ein: "56-2028460", funderType: "corporate", ntee: "S", publicPriorities: "economic mobility, workforce development, and community development" },
  { name: "Wells Fargo Foundation", ein: "41-1398224", funderType: "corporate", ntee: "L", publicPriorities: "housing affordability, small business growth, and financial health" },
  { name: "Google.org", ein: "20-5951171", funderType: "corporate", ntee: "U", publicPriorities: "digital skills, AI for social good, and economic opportunity" },
];

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return await response.json();
}

interface ProPublicaOrgResponse {
  organization?: Record<string, unknown>;
  filings_with_data?: Array<Record<string, unknown>>;
}

async function runProPublica(
  supabase: ReturnType<typeof createAdminClient>,
  existingUrls: Set<string>,
  cp: Checkpoint,
): Promise<void> {
  if (cp.propublica.done) {
    ok("SOURCE 1 (ProPublica)", `already complete from checkpoint (${cp.propublica.inserted} inserted)`);
    return;
  }
  console.log(`\nSOURCE 1 — ProPublica Nonprofit Explorer (target ${PROPUBLICA_TARGET}, ${PROPUBLICA_FOUNDATIONS.length} foundations) ...`);

  for (let i = cp.propublica.orgIndex; i < PROPUBLICA_FOUNDATIONS.length; i++) {
    if (cp.propublica.inserted >= PROPUBLICA_TARGET) break;
    const foundation = PROPUBLICA_FOUNDATIONS[i];
    if (!foundation) continue;
    const einDigits = foundation.ein.replace(/\D/g, "");

    let orgData: ProPublicaOrgResponse;
    try {
      orgData = (await fetchJson(`${PROPUBLICA_ORG_API}/${einDigits}.json`)) as ProPublicaOrgResponse;
    } catch (error) {
      fail(`ProPublica organization.json for ${foundation.name} (EIN ${foundation.ein})`, error);
      cp.propublica.orgIndex = i + 1;
      saveCheckpoint(cp);
      await sleep(INTER_REQUEST_DELAY_MS);
      continue;
    }
    await sleep(INTER_REQUEST_DELAY_MS);

    // Best-effort richer snapshot — non-fatal if unavailable (see header deviation note).
    let fullSnapshotExcerpt: string | null = null;
    try {
      const full = await fetchJson(`${PROPUBLICA_ORG_API}/${einDigits}/full.json`);
      fullSnapshotExcerpt = JSON.stringify(full).slice(0, 2000);
    } catch (error) {
      fail(`ProPublica full.json for ${foundation.name} (non-fatal, continuing with organization.json only)`, error);
    }
    await sleep(INTER_REQUEST_DELAY_MS);

    const filings = (orgData.filings_with_data ?? []).slice(0, PROPUBLICA_MAX_FILINGS_PER_ORG);
    if (filings.length === 0) {
      ok(`ProPublica ${foundation.name}`, "no filings_with_data returned — skipping");
      cp.propublica.orgIndex = i + 1;
      saveCheckpoint(cp);
      continue;
    }

    const drafts: DraftRow[] = [];
    for (const filing of filings) {
      const taxYear = pickNumber(filing, ["tax_prd_yr", "taxprdyr", "tax_year"]);
      const totalRevenue = pickNumber(filing, ["totrevenue", "tot_revenue", "totrevnue"]);
      const totalExpenses = pickNumber(filing, ["totfuncexpns", "totfuncexpenses", "total_expenses"]);
      const totalAssets = pickNumber(filing, ["totassetsend", "totassetend", "total_assets"]);
      const grantsPaidRaw = pickNumber(filing, [
        "grntsandsimilaramntpaid",
        "grants_paid",
        "totgrntspd",
        "contriptamt",
        "grantstoindiv",
      ]);
      const pdfUrl = pickString(filing, ["pdf_url", "pdfurl"]);

      let fullText: string;
      try {
        fullText = await generateVerifiedFoundationNarrative({
          funderName: foundation.name,
          publicPriorities: foundation.publicPriorities,
          taxYear,
          totalRevenue,
          totalExpenses,
          totalAssets,
          grantsPaidRaw,
        });
      } catch (error) {
        fail(`ProPublica narrative generation for ${foundation.name} (${taxYear ?? "unknown year"})`, error);
        continue;
      }

      drafts.push({
        source: "PROPUBLICA_990",
        source_url: `https://projects.propublica.org/nonprofits/organizations/${einDigits}${taxYear ? `#filing-${taxYear}` : ""}`,
        funder_name: foundation.name,
        funder_type: foundation.funderType,
        grant_program: `${foundation.name} — ${taxYear ?? "Recent"} Grantmaking`,
        award_amount: grantsPaidRaw ?? totalExpenses,
        award_year: taxYear,
        category: [foundation.ntee, foundation.funderType, "propublica_990"],
        full_text: fullText.slice(0, 100_000),
        ntee_major: foundation.ntee,
        source_type: "foundation_990_propublica",
        is_verified: true,
        metadata: {
          ein: foundation.ein,
          tax_year: taxYear,
          total_revenue: totalRevenue,
          total_expenses: totalExpenses,
          total_assets: totalAssets,
          reported_grants_figure: grantsPaidRaw,
          filing_pdf_url: pdfUrl,
          raw_filing: filing,
          full_json_snapshot_excerpt: fullSnapshotExcerpt,
          field_extraction_note:
            "Numeric fields matched defensively against multiple candidate ProPublica API key names " +
            "(live schema not independently re-verified this session — see script header); raw_filing " +
            "preserves the complete original record for audit.",
        },
      });
    }

    const inserted = await processAndInsert(supabase, drafts, existingUrls, `ProPublica ${foundation.name}`);
    cp.propublica.inserted += inserted;
    cp.totalInserted += inserted;
    ok(
      `ProPublica ${foundation.name}`,
      `${inserted} inserted from ${filings.length} filing(s) (running total ${cp.propublica.inserted}/${PROPUBLICA_TARGET})`,
    );

    cp.propublica.orgIndex = i + 1;
    saveCheckpoint(cp);
  }

  if (cp.propublica.orgIndex >= PROPUBLICA_FOUNDATIONS.length || cp.propublica.inserted >= PROPUBLICA_TARGET) {
    cp.propublica.done = true;
  }
  saveCheckpoint(cp);
}

// ---- SOURCE 2: Candid / Foundation Directory Online (best-effort) ---------------

async function runCandid(cp: Checkpoint): Promise<void> {
  if (cp.candid.attempted) {
    ok(
      "SOURCE 2 (Candid)",
      cp.candid.available
        ? `already complete from checkpoint (${cp.candid.inserted} inserted)`
        : "already confirmed unavailable from checkpoint — skipping",
    );
    return;
  }

  console.log(
    `\nSOURCE 2 — Candid/Foundation Directory Online grants API (best-effort — requires a subscription key ` +
      `not present in BLUEPRINT_v2.md §11's API key registry; see script header) ...`,
  );
  cp.candid.attempted = true;

  const params = new URLSearchParams({
    funder_type: "foundation",
    recipient_type: "nonprofit",
    year: "2023",
    limit: "100",
  });

  try {
    const response = await fetch(`${CANDID_GRANTS_API}?${params.toString()}`, {
      signal: AbortSignal.timeout(20_000),
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.includes("application/json")) {
      fail(
        "Candid grants API",
        `HTTP ${response.status}, content-type "${contentType}" — endpoint requires authentication we do not have`,
      );
      cp.candid.available = false;
    } else {
      const body = (await response.json()) as { grants?: unknown[] };
      const hits = Array.isArray(body.grants) ? body.grants : [];
      // Deliberately not parsed into rows: without a confirmed real (authenticated) response shape
      // this session, mapping unverified field names would be guessing, which this repo's governance
      // forbids (BLUEPRINT_v2.md §9.3: "Never guess — fabrication wastes significant time").
      ok("Candid grants API", `responded with ${hits.length} record(s) — see header note on why parsing is deferred`);
      cp.candid.available = hits.length > 0;
    }
  } catch (error) {
    fail("Candid grants API", error);
    cp.candid.available = false;
  }
  await sleep(INTER_REQUEST_DELAY_MS);
  saveCheckpoint(cp);
}

// ---- SOURCES 3 & 4: hardcoded foundation + corporate awards ---------------------

interface HardcodedFunderDef {
  name: string;
  funderType: "foundation" | "corporate";
  areas: string[];
  amountRange: [number, number];
}

/** 19 unique foundations — see header dedup note re: the two Helmsley Trust task entries. */
const HARDCODED_FOUNDATIONS: HardcodedFunderDef[] = [
  { name: "The Leona M. and Harry B. Helmsley Charitable Trust", funderType: "foundation", areas: ["health", "education"], amountRange: [100_000, 2_000_000] },
  { name: "Ralph C. Wilson Jr. Foundation", funderType: "foundation", areas: ["sports", "youth"], amountRange: [50_000, 500_000] },
  { name: "Doris Duke Charitable Foundation", funderType: "foundation", areas: ["arts", "environment", "health"], amountRange: [75_000, 1_000_000] },
  { name: "Surdna Foundation", funderType: "foundation", areas: ["sustainable environments", "strong local economies"], amountRange: [75_000, 750_000] },
  { name: "Pew Charitable Trusts", funderType: "foundation", areas: ["environment", "health", "civic life"], amountRange: [150_000, 2_500_000] },
  { name: "Joyce Foundation", funderType: "foundation", areas: ["employment", "education", "environment", "gun violence"], amountRange: [75_000, 600_000] },
  { name: "Walton Family Foundation", funderType: "foundation", areas: ["education", "environment"], amountRange: [100_000, 1_500_000] },
  { name: "Simons Foundation", funderType: "foundation", areas: ["science", "education"], amountRange: [100_000, 2_000_000] },
  { name: "Knight Foundation", funderType: "foundation", areas: ["journalism", "arts", "community"], amountRange: [50_000, 750_000] },
  { name: "Rockefeller Foundation", funderType: "foundation", areas: ["food", "health", "energy", "economic opportunity"], amountRange: [150_000, 3_000_000] },
  { name: "Conrad N. Hilton Foundation", funderType: "foundation", areas: ["housing", "homelessness", "catholic education"], amountRange: [100_000, 2_000_000] },
  { name: "Harry and Jeanette Weinberg Foundation", funderType: "foundation", areas: ["poverty", "aging", "disabled"], amountRange: [50_000, 500_000] },
  { name: "Howard G. Buffett Foundation", funderType: "foundation", areas: ["food security", "water", "conflict"], amountRange: [100_000, 2_000_000] },
  { name: "Oak Foundation", funderType: "foundation", areas: ["environment", "housing", "education"], amountRange: [75_000, 1_000_000] },
  { name: "Open Society Foundations", funderType: "foundation", areas: ["democracy", "human rights", "education"], amountRange: [100_000, 1_500_000] },
  { name: "Skoll Foundation", funderType: "foundation", areas: ["social entrepreneurship"], amountRange: [100_000, 1_000_000] },
  { name: "Omidyar Network", funderType: "foundation", areas: ["economic inclusion", "education", "governance"], amountRange: [100_000, 1_500_000] },
  { name: "Mozilla Foundation", funderType: "foundation", areas: ["internet health", "open source"], amountRange: [50_000, 500_000] },
  { name: "Schmidt Futures", funderType: "foundation", areas: ["science", "technology", "education"], amountRange: [100_000, 2_000_000] },
];

const HARDCODED_CORPORATE: HardcodedFunderDef[] = [
  { name: "Walmart Foundation", funderType: "corporate", areas: ["community", "hunger", "sustainability"], amountRange: [25_000, 500_000] },
  { name: "Target Foundation", funderType: "corporate", areas: ["education", "arts", "social services"], amountRange: [25_000, 250_000] },
  { name: "Home Depot Foundation", funderType: "corporate", areas: ["veteran housing", "disaster relief"], amountRange: [25_000, 300_000] },
  { name: "CVS Health Foundation", funderType: "corporate", areas: ["health access", "substance use"], amountRange: [25_000, 250_000] },
  { name: "UPS Foundation", funderType: "corporate", areas: ["humanitarian relief", "diversity"], amountRange: [25_000, 250_000] },
  { name: "FedEx Foundation", funderType: "corporate", areas: ["safe roads", "disaster relief"], amountRange: [10_000, 200_000] },
  { name: "Verizon Foundation", funderType: "corporate", areas: ["digital inclusion", "education"], amountRange: [10_000, 200_000] },
  { name: "AT&T Foundation", funderType: "corporate", areas: ["education", "workforce development"], amountRange: [10_000, 200_000] },
  { name: "Microsoft Philanthropies", funderType: "corporate", areas: ["digital skills", "accessibility"], amountRange: [25_000, 500_000] },
  { name: "Salesforce.org", funderType: "corporate", areas: ["education", "workforce", "equality"], amountRange: [25_000, 400_000] },
];

interface HardcodedJob {
  funder: HardcodedFunderDef;
  area: string;
  seq: number;
  year: number;
}

function buildHardcodedJobs(funders: HardcodedFunderDef[], target: number): HardcodedJob[] {
  const counts = distributeCount(target, funders.length);
  const jobs: HardcodedJob[] = [];
  funders.forEach((funder, fi) => {
    const count = counts[fi] ?? 0;
    for (let seq = 0; seq < count; seq++) {
      const area = funder.areas[seq % funder.areas.length];
      const year = HARDCODED_YEARS[seq % HARDCODED_YEARS.length];
      if (!area || !year) continue;
      jobs.push({ funder, area, seq, year });
    }
  });
  return jobs;
}

async function runHardcodedSource(
  supabase: ReturnType<typeof createAdminClient>,
  existingUrls: Set<string>,
  cp: Checkpoint,
  kind: "foundation" | "corporate",
  jobs: HardcodedJob[],
  slot: HardcodedCheckpointSlot,
  sourceLabel: string,
  urlNamespace: string,
): Promise<void> {
  if (slot.done) {
    ok(sourceLabel, `already complete from checkpoint (${slot.inserted} inserted)`);
    return;
  }
  console.log(`\n${sourceLabel} (target ${jobs.length} records, ${jobs.length === 0 ? 0 : new Set(jobs.map((j) => j.funder.name)).size} funders) ...`);

  const remaining = jobs.slice(slot.nextIndex);
  for (let i = 0; i < remaining.length; i += BATCH_SIZE) {
    const chunk = remaining.slice(i, i + BATCH_SIZE);
    const drafts: DraftRow[] = [];

    for (const job of chunk) {
      const amount = randomInRange(job.funder.amountRange[0], job.funder.amountRange[1]);
      const grantProgram = `${titleCase(job.area)} Grantmaking Program`;
      const ntee = areaToNtee(job.area);

      let fullText: string;
      try {
        fullText = await generateExemplarNarrative({
          funderName: job.funder.name,
          area: job.area,
          grantProgram,
          amount,
          year: job.year,
        });
      } catch (error) {
        fail(`${sourceLabel} narrative generation for ${job.funder.name} / ${job.area}`, error);
        continue;
      }

      drafts.push({
        source: kind === "foundation" ? "FOUNDATION_HARDCODED" : "CORPORATE_HARDCODED",
        source_url: `internal://benavora-intelligence-library/${urlNamespace}/${slug(job.funder.name)}/${slug(job.area)}/${job.seq}`,
        funder_name: job.funder.name,
        funder_type: job.funder.funderType,
        grant_program: grantProgram,
        award_amount: amount,
        award_year: job.year,
        category: [ntee, kind, urlNamespace],
        full_text: fullText.slice(0, 100_000),
        ntee_major: ntee,
        source_type: kind === "foundation" ? "foundation_hardcoded" : "corporate_hardcoded",
        is_verified: false,
        metadata: {
          record_kind: "constructed_exemplar",
          program_area: job.area,
          funder_kind: kind,
          seq: job.seq,
        },
      });
    }

    const inserted = await processAndInsert(supabase, drafts, existingUrls, sourceLabel);
    slot.inserted += inserted;
    cp.totalInserted += inserted;
    slot.nextIndex += chunk.length;
    ok(sourceLabel, `${inserted} inserted this batch (running total ${slot.inserted}, index ${slot.nextIndex}/${jobs.length})`);
    saveCheckpoint(cp);
  }

  slot.done = true;
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
  console.log(
    `Foundation awards import starting. Checkpoint last updated: ${
      cp.updatedAt === defaultCheckpoint().updatedAt ? "(none — fresh run)" : cp.updatedAt
    }\n`,
  );

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

  await runProPublica(supabase, existingUrls, cp);
  await runCandid(cp);

  const foundationJobs = buildHardcodedJobs(HARDCODED_FOUNDATIONS, SOURCE3_TARGET);
  await runHardcodedSource(
    supabase,
    existingUrls,
    cp,
    "foundation",
    foundationJobs,
    cp.hardcodedFoundations,
    "SOURCE 3 — Hardcoded Foundation Awards",
    "foundation-awards",
  );

  const corporateJobs = buildHardcodedJobs(HARDCODED_CORPORATE, SOURCE4_TARGET);
  await runHardcodedSource(
    supabase,
    existingUrls,
    cp,
    "corporate",
    corporateJobs,
    cp.hardcodedCorporate,
    "SOURCE 4 — Corporate Foundation Awards",
    "corporate-awards",
  );

  console.log("\n" + "=".repeat(72));
  console.log("FOUNDATION AWARDS IMPORT — FINAL REPORT");
  console.log("=".repeat(72));
  console.log(`  Source 1 (ProPublica 990):        ${cp.propublica.inserted} inserted`);
  console.log(
    `  Source 2 (Candid grants API):     ${cp.candid.inserted} inserted` +
      (cp.candid.available ? "" : " (endpoint unavailable/unauthenticated — see warning above)"),
  );
  console.log(`  Source 3 (Foundation hardcoded):  ${cp.hardcodedFoundations.inserted} inserted`);
  console.log(`  Source 4 (Corporate hardcoded):   ${cp.hardcodedCorporate.inserted} inserted`);
  console.log(`  ${"-".repeat(40)}`);
  console.log(`  TOTAL this run + prior checkpoint runs: ${cp.totalInserted}`);

  const { count: totalCount } = await supabase
    .from("intelligence_funded_proposals")
    .select("id", { count: "exact", head: true });
  console.log(`\n  intelligence_funded_proposals total row count: ${totalCount}`);

  if (cp.totalInserted < 300) {
    console.warn(`\n  Below the 300-record target this run — re-run to continue (dedup + checkpoint make this resumable).`);
  }
}

main().catch((error) => {
  fatal(error instanceof Error ? (error.stack ?? error.message) : String(error));
});
