// Land bank opportunity source — county/city land bank authorities and their
// grant/donation programs for affordable-housing nonprofits, plus a SAM.gov
// sweep for federal (HUD) land-bank-adjacent funding notices.
//
// Deviations from the task-given spec, checked against real state per this
// project's established practice (see opportunity-discovery-agent.ts's
// header for the same pattern):
//   - `opportunities` (supabase/migrations/001_initial_schema.sql) requires
//     `organization_id uuid NOT NULL` and has no funder_type/ntee_codes/
//     geographic_area/contact_email columns. discoverLandBankOpportunities()
//     therefore takes an explicit `orgId` param (the task's signature omits
//     one, but there is no way to INSERT into this table without it), and
//     the LandBankOpportunity fields with no real column (funder_type,
//     ntee_codes, contact_email, geographic_area) are folded into
//     `description` on insert rather than dropped silently.
//   - `category` is the real `funder_category` enum (migration 001), not
//     free text — 'housing_grant' for land-bank-authority-sourced
//     opportunities, 'government_grant' for the SAM.gov sweep (both are
//     real enum values; there is no 'land_bank' value).
//   - `searchSamGovOpportunities()` (src/lib/sources/samgov-client.ts) is a
//     fixed, unparameterized fetch (no `q=` support) — reused elsewhere by
//     opportunity-discovery-agent.ts for its own general federal sweep. A
//     land-bank-specific keyword query needs its own request rather than
//     changing that shared client's signature (which would change every
//     other caller's result set), so this file makes its own SAM.gov v2
//     call with `q`/`postedFrom`/`postedTo`.
//   - The seed list below is a starter set of land bank authorities I could
//     verify are real, live organizations (fetched and confirmed each
//     domain before including it) rather than the task's full literal list
//     — several of the task's named entities ("Texas Land Bank Coalition",
//     "Dallas Land Bank", "Miami-Dade Land Bank") did not resolve to a
//     verifiable real site and were left out rather than guessed. Reid
//     should expand this list with verified local land bank URLs over time;
//     Center for Community Progress (communityprogress.org) is the National
//     entry the task asked for and is the best long-term source for
//     discovering the rest (it maintains the definitive national land bank
//     directory).
//   - "Parse for application deadlines, funding amounts, eligibility
//     criteria" from an arbitrary organization's website has no generic
//     CSS-selector solution (every site's markup differs) — implemented via
//     a Claude HTML-extraction pass, the same pattern already established
//     by src/lib/autoapply/portal-adapters.ts's GenericAdapter and
//     src/lib/autoapply/registration-agent.ts for exactly this kind of
//     unstructured-HTML-to-structured-JSON problem.

import type { SupabaseClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";

export interface LandBankOpportunity {
  title: string;
  funder_name: string;
  funder_type: "land_bank";
  description: string;
  geographic_area: string;
  state: string;
  deadline?: Date;
  amount_min?: number;
  amount_max?: number;
  eligibility_requirements: string[];
  source_url: string;
  contact_email?: string;
  /** Primarily "L" (Housing & Shelter) — see file header. */
  ntee_codes: string[];
}

interface LandBankAuthority {
  name: string;
  /** Two-letter state code, or "NATIONAL". */
  state: string;
  url: string;
}

// Verified live 2026-07-20 (each domain fetched and confirmed before
// inclusion) — see file header for entities that couldn't be verified.
const KNOWN_LAND_BANKS: LandBankAuthority[] = [
  { name: "Center for Community Progress", state: "NATIONAL", url: "https://communityprogress.org" },
  { name: "Oakland Community Land Trust", state: "CA", url: "https://www.oakclt.org" },
  { name: "San Francisco Community Land Trust", state: "CA", url: "https://www.sfclt.org" },
  { name: "California Community Land Trust Network", state: "CA", url: "https://cacltnetwork.org" },
  { name: "Houston Land Bank", state: "TX", url: "https://www.houstonlandbank.org" },
  { name: "New York Land Bank Association", state: "NY", url: "https://www.nylandbanks.org" },
  { name: "NYC Department of Housing Preservation and Development", state: "NY", url: "https://www.nyc.gov/hpd" },
  { name: "Florida Housing Finance Corporation", state: "FL", url: "https://www.floridahousing.org" },
];

const SAM_GOV_SEARCH_URL = "https://api.sam.gov/opportunities/v2/search";
const SAM_GOV_LOOKBACK_DAYS = 30;
const SAM_GOV_LIMIT = 10;
const WEBSITE_FETCH_TIMEOUT_MS = 20_000;
const MAX_HTML_CHARS = 60_000;

let anthropicClient: Anthropic | null = null;
function getClaude(): Anthropic | null {
  if (anthropicClient) return anthropicClient;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  anthropicClient = new Anthropic({ apiKey });
  return anthropicClient;
}

function samGovDateFormat(date: Date): string {
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${date.getFullYear()}`;
}

function toStr(val: unknown): string {
  if (typeof val === "string") return val.trim();
  if (val === null || val === undefined) return "";
  return String(val).trim();
}

function toAmount(val: unknown): number | undefined {
  if (val === null || val === undefined || val === "") return undefined;
  const n = Number(val);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

// --- SAM.gov sweep -----------------------------------------------------------

interface RawSamGovHit {
  noticeId?: unknown;
  title?: unknown;
  description?: unknown;
  responseDeadLine?: unknown;
  awardAmount?: unknown;
  uiLink?: unknown;
}
interface SamGovSearchResponse {
  opportunitiesData?: RawSamGovHit[];
}

async function searchSamGovLandBankOpportunities(state: string): Promise<LandBankOpportunity[]> {
  const apiKey = process.env.SAM_GOV_API_KEY;
  if (!apiKey) return [];

  const now = new Date();
  const from = new Date(now.getTime() - SAM_GOV_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const params = new URLSearchParams({
    api_key: apiKey,
    q: "land bank affordable housing",
    postedFrom: samGovDateFormat(from),
    postedTo: samGovDateFormat(now),
    limit: String(SAM_GOV_LIMIT),
    ptype: "o",
  });

  let response: Response;
  try {
    response = await fetch(`${SAM_GOV_SEARCH_URL}?${params.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return [];
  }
  if (!response.ok) return [];

  let body: SamGovSearchResponse;
  try {
    body = (await response.json()) as SamGovSearchResponse;
  } catch {
    return [];
  }

  const hits = Array.isArray(body.opportunitiesData) ? body.opportunitiesData : [];
  const results: LandBankOpportunity[] = [];
  for (const hit of hits) {
    const title = toStr(hit.title);
    const noticeId = toStr(hit.noticeId);
    if (!title || !noticeId) continue;

    const deadlineRaw = toStr(hit.responseDeadLine);
    const deadline = deadlineRaw ? new Date(deadlineRaw) : undefined;

    results.push({
      title,
      funder_name: "HUD / Federal (SAM.gov)",
      funder_type: "land_bank",
      description: toStr(hit.description) || "Federal funding notice referencing land bank / affordable housing redevelopment.",
      geographic_area: state,
      state,
      deadline: deadline && !Number.isNaN(deadline.getTime()) ? deadline : undefined,
      amount_max: toAmount(hit.awardAmount),
      eligibility_requirements: ["See full SAM.gov notice for eligibility."],
      source_url: toStr(hit.uiLink) || `https://sam.gov/opp/${noticeId}/view`,
      ntee_codes: ["L"],
    });
  }
  return results;
}

// --- Land bank authority website extraction ----------------------------------

const EXTRACTION_SYSTEM = `You analyze a land bank / housing authority's webpage HTML and extract any currently-listed grant, donation, or nonprofit-partnership programs for affordable housing organizations. Return ONLY valid JSON — no prose, no markdown fences.

Schema: {"programs": [{"title": "string", "description": "string (2-4 sentences)", "deadline": "YYYY-MM-DD or null", "amount_min": number or null, "amount_max": number or null, "eligibility_requirements": ["string", ...], "contact_email": "string or null"}]}

Rules:
- Only include programs that are actually described on the page — never invent a program that isn't mentioned.
- If the page lists no grant/donation/partnership program for nonprofits, return {"programs": []}.
- amount_min/amount_max are numbers only (no currency symbols), or null when not stated.`;

async function extractProgramsFromHtml(html: string): Promise<
  {
    title: string;
    description: string;
    deadline: string | null;
    amount_min: number | null;
    amount_max: number | null;
    eligibility_requirements: string[];
    contact_email: string | null;
  }[]
> {
  const claude = getClaude();
  if (!claude) return [];

  const message = await claude.messages
    .create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: EXTRACTION_SYSTEM,
      messages: [{ role: "user", content: html.slice(0, MAX_HTML_CHARS) }],
    })
    .catch(() => null);
  if (!message) return [];

  const block = message.content[0];
  const text = block?.type === "text" ? block.text : "";
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return [];

  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as {
      programs?: unknown[];
    };
    if (!Array.isArray(parsed.programs)) return [];
    return parsed.programs
      .map((p) => {
        const program = (p ?? {}) as Record<string, unknown>;
        return {
          title: toStr(program.title),
          description: toStr(program.description),
          deadline: typeof program.deadline === "string" ? program.deadline : null,
          amount_min: typeof program.amount_min === "number" ? program.amount_min : null,
          amount_max: typeof program.amount_max === "number" ? program.amount_max : null,
          eligibility_requirements: Array.isArray(program.eligibility_requirements)
            ? program.eligibility_requirements.filter((e): e is string => typeof e === "string")
            : [],
          contact_email: typeof program.contact_email === "string" ? program.contact_email : null,
        };
      })
      .filter((p) => p.title.length > 0);
  } catch {
    return [];
  }
}

async function fetchAuthorityOpportunities(
  authority: LandBankAuthority,
  serviceAreaState: string,
): Promise<LandBankOpportunity[]> {
  let html: string;
  try {
    const response = await fetch(authority.url, {
      headers: { Accept: "text/html", "User-Agent": "Mozilla/5.0 (compatible; BenavoraLandBankBot/1.0)" },
      signal: AbortSignal.timeout(WEBSITE_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return [];
    html = await response.text();
  } catch {
    return [];
  }

  const programs = await extractProgramsFromHtml(html);
  return programs.map((p) => {
    const deadline = p.deadline ? new Date(p.deadline) : undefined;
    return {
      title: p.title,
      funder_name: authority.name,
      funder_type: "land_bank" as const,
      description: p.description || `Program listed by ${authority.name}.`,
      geographic_area: authority.state === "NATIONAL" ? serviceAreaState : authority.state,
      state: authority.state === "NATIONAL" ? serviceAreaState : authority.state,
      deadline: deadline && !Number.isNaN(deadline.getTime()) ? deadline : undefined,
      amount_min: p.amount_min ?? undefined,
      amount_max: p.amount_max ?? undefined,
      eligibility_requirements:
        p.eligibility_requirements.length > 0
          ? p.eligibility_requirements
          : ["See funder website for eligibility details."],
      source_url: authority.url,
      contact_email: p.contact_email ?? undefined,
      ntee_codes: ["L"],
    };
  });
}

// --- persistence ---------------------------------------------------------------

async function alreadyExists(
  supabase: SupabaseClient,
  orgId: string,
  name: string,
  url: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("opportunities")
    .select("id")
    .eq("organization_id", orgId)
    .eq("url", url)
    .eq("name", name)
    .maybeSingle();
  return Boolean(data);
}

function buildDescription(opp: LandBankOpportunity): string {
  const lines = [
    opp.description,
    `Funder: ${opp.funder_name} (${opp.funder_type}).`,
    `Geographic area: ${opp.geographic_area}.`,
    opp.eligibility_requirements.length > 0
      ? `Eligibility: ${opp.eligibility_requirements.join("; ")}.`
      : "",
    opp.contact_email ? `Contact: ${opp.contact_email}.` : "",
    opp.ntee_codes.length > 0 ? `NTEE focus: ${opp.ntee_codes.join(", ")}.` : "",
  ];
  return lines.filter(Boolean).join(" ");
}

/**
 * Discovers land bank grant/donation opportunities for a housing-focused
 * nonprofit's service area (known land bank authorities matching the state
 * plus the National entry, each Claude-extracted for currently-listed
 * programs) and a SAM.gov sweep for federal land-bank-adjacent notices.
 * Inserts new (non-duplicate) opportunities for `orgId` with
 * source='land_bank', and returns every discovered opportunity (including
 * ones already on file) so callers can see the full candidate set.
 */
export async function discoverLandBankOpportunities(
  serviceArea: { city: string; state: string },
  orgId: string,
  supabase: SupabaseClient,
): Promise<LandBankOpportunity[]> {
  const stateUpper = serviceArea.state.toUpperCase();
  const matchingAuthorities = KNOWN_LAND_BANKS.filter(
    (a) => a.state === stateUpper || a.state === "NATIONAL",
  );

  const [authorityResults, samGovResults] = await Promise.all([
    Promise.all(matchingAuthorities.map((a) => fetchAuthorityOpportunities(a, stateUpper))),
    searchSamGovLandBankOpportunities(stateUpper),
  ]);

  const allOpportunities = [...authorityResults.flat(), ...samGovResults];

  for (const opp of allOpportunities) {
    const exists = await alreadyExists(supabase, orgId, opp.title, opp.source_url);
    if (exists) continue;

    await supabase.from("opportunities").insert({
      organization_id: orgId,
      name: opp.title,
      category: opp.funder_name.includes("HUD") || opp.funder_name.includes("Federal")
        ? "government_grant"
        : "housing_grant",
      description: buildDescription(opp),
      amount_min: opp.amount_min ?? null,
      amount_max: opp.amount_max ?? null,
      deadline: opp.deadline ? opp.deadline.toISOString() : null,
      url: opp.source_url,
      source: "land_bank",
      status: "open",
    });
  }

  return allOpportunities;
}
