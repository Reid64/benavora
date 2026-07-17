// Reputation Intelligence Agent — PLATFORM_VISION_ARCHITECTURE.md Pillar 15
// (Reputation Intelligence), AGENTS_v2.md AG-18.
//
// Searches DuckDuckGo's free Instant Answer API for an entity's name paired
// with risk keywords, has Claude classify each relevant result as a
// reputation risk (or a positive signal), and persists the classified ones
// to reputation_signals (migration 076). That table has no organization_id —
// a funder's reputation is the same fact for every org tracking it — so
// writes here are entity-scoped, not tenant-scoped. A plain function like
// runOpportunityDiscovery/sendMorningDigest: no agent_type enum value yet,
// nothing to log to agent_runs.

import { callClaude, DEFAULT_MODEL } from "@/lib/ai/claude";

const DUCKDUCKGO_URL = "https://api.duckduckgo.com/";
const SEARCH_SUFFIX = "lawsuit fraud scandal leadership change";

// Claude classification is the expensive step — cap how many DuckDuckGo
// results get sent to it per run so one entity can't blow the route budget.
const MAX_RESULTS_TO_ANALYZE = 6;

// Skip DuckDuckGo "related topic" stubs too short to carry real signal.
const MIN_RESULT_TEXT_LENGTH = 20;

export type ReputationSeverity =
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "positive";

const VALID_SEVERITIES: ReputationSeverity[] = [
  "critical",
  "high",
  "medium",
  "low",
  "positive",
];

export interface ReputationSignalRow {
  id: string;
  entity_id: string;
  entity_type: string;
  signal_type: string;
  severity: ReputationSeverity;
  headline: string;
  summary: string | null;
  source_url: string | null;
  signal_date: string | null;
  verified: boolean;
  created_at: string;
}

interface DuckDuckGoTopic {
  Text?: unknown;
  FirstURL?: unknown;
  Topics?: DuckDuckGoTopic[];
}

interface DuckDuckGoResponse {
  RelatedTopics?: DuckDuckGoTopic[];
}

interface SearchResult {
  text: string;
  url: string | null;
}

function toStr(val: unknown): string {
  if (typeof val === "string") return val.trim();
  if (val === null || val === undefined) return "";
  return String(val).trim();
}

/** DuckDuckGo nests related topics under category groups via `Topics`. */
function flattenTopics(topics: DuckDuckGoTopic[]): DuckDuckGoTopic[] {
  const flat: DuckDuckGoTopic[] = [];
  for (const topic of topics) {
    if (Array.isArray(topic.Topics) && topic.Topics.length > 0) {
      flat.push(...flattenTopics(topic.Topics));
    } else {
      flat.push(topic);
    }
  }
  return flat;
}

/**
 * Queries DuckDuckGo's free Instant Answer API for `entityName` plus risk
 * keywords. Returns [] on any HTTP/parse/network failure — a dead search
 * source should never abort the caller's run.
 */
async function searchDuckDuckGo(entityName: string): Promise<SearchResult[]> {
  const params = new URLSearchParams({
    q: `${entityName} ${SEARCH_SUFFIX}`,
    format: "json",
    no_html: "1",
    skip_disambig: "1",
  });

  let response: Response;
  try {
    response = await fetch(`${DUCKDUCKGO_URL}?${params.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return [];
  }

  if (!response.ok) return [];

  let body: DuckDuckGoResponse;
  try {
    body = (await response.json()) as DuckDuckGoResponse;
  } catch {
    return [];
  }

  const topics = Array.isArray(body.RelatedTopics) ? body.RelatedTopics : [];
  const flat = flattenTopics(topics);

  const results: SearchResult[] = [];
  for (const topic of flat) {
    const text = toStr(topic.Text);
    if (text.length < MIN_RESULT_TEXT_LENGTH) continue;
    results.push({ text, url: toStr(topic.FirstURL) || null });
  }
  return results.slice(0, MAX_RESULTS_TO_ANALYZE);
}

interface ClassifiedSignal {
  isRisk: boolean;
  signalType: string;
  severity: ReputationSeverity;
  headline: string;
  summary: string;
}

/**
 * Extracts and validates the model's JSON reply. Returns null on any
 * unreadable/malformed response or a missing headline — that result is
 * skipped rather than risking a garbage signal (mirrors the tolerant-parse
 * pattern in eligibility-scorer.ts).
 */
function parseClassification(text: string): ClassifiedSignal | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }

  const obj = (raw ?? {}) as {
    is_risk?: unknown;
    signal_type?: unknown;
    severity?: unknown;
    headline?: unknown;
    summary?: unknown;
  };

  const headline = toStr(obj.headline).slice(0, 100);
  if (!headline) return null;

  const severityRaw = toStr(obj.severity).toLowerCase() as ReputationSeverity;
  const severity = VALID_SEVERITIES.includes(severityRaw)
    ? severityRaw
    : "medium";

  return {
    isRisk: obj.is_risk === true,
    signalType: toStr(obj.signal_type) || "general",
    severity,
    headline,
    summary: toStr(obj.summary).slice(0, 200),
  };
}

function buildClassificationPrompt(
  entityName: string,
  entityType: string,
  result: SearchResult,
): { system: string; prompt: string } {
  const system = [
    "You are a nonprofit funding-intelligence analyst screening search results for reputational risk to a funder or corporate donor.",
    "",
    "RULES:",
    "1. Judge ONLY from the search result text provided. Never invent facts.",
    "2. A reputation risk is: an active lawsuit, fraud, scandal, regulatory action, financial distress, or an abrupt/controversial leadership change.",
    '3. A positive signal (severity "positive", is_risk false) is: an announced giving expansion, a new initiative, or other clearly favorable news.',
    "4. If the result is irrelevant, ambiguous, or too vague to judge, return is_risk false and severity \"low\".",
    "5. Respond with ONLY a single JSON object, no prose, no code fences, in exactly this shape:",
    '{"is_risk": <boolean>, "signal_type": "<short category, e.g. lawsuit|fraud|leadership_change|financial_distress|positive_giving>", "severity": "critical" | "high" | "medium" | "low" | "positive", "headline": "<max 100 chars>", "summary": "<max 200 chars>"}',
  ].join("\n");

  const prompt = [
    "## Entity",
    `- Name: ${entityName}`,
    `- Type: ${entityType}`,
    "",
    "## Search Result",
    `- Text: ${result.text}`,
    result.url ? `- URL: ${result.url}` : "",
    "",
    "Classify this result now. Return ONLY the JSON object described above.",
  ]
    .filter(Boolean)
    .join("\n");

  return { system, prompt };
}

/**
 * Searches DuckDuckGo for `entityName` plus risk keywords, has Claude
 * classify each relevant result, and inserts a reputation_signals row for
 * every result flagged as a risk (`is_risk: true`) or a positive signal
 * (`severity: "positive"`). Returns the newly inserted rows. `supabase` may
 * be a session client or the admin client — reputation_signals carries no
 * organization_id, so no tenant scoping applies to the write itself.
 */
export async function checkEntityReputation(
  entityId: string,
  entityType: string,
  entityName: string,
  supabase: any,
): Promise<object[]> {
  const results = await searchDuckDuckGo(entityName);
  if (results.length === 0) return [];

  const today = new Date().toISOString().slice(0, 10);
  const inserted: ReputationSignalRow[] = [];

  for (const result of results) {
    const { system, prompt } = buildClassificationPrompt(
      entityName,
      entityType,
      result,
    );

    let classified: ClassifiedSignal | null;
    try {
      const response = await callClaude({
        system,
        prompt,
        model: DEFAULT_MODEL,
      });
      classified = parseClassification(response.text);
    } catch {
      classified = null;
    }

    if (!classified) continue;
    if (!classified.isRisk && classified.severity !== "positive") continue;

    const { data, error } = await supabase
      .from("reputation_signals")
      .insert({
        entity_id: entityId,
        entity_type: entityType,
        signal_type: classified.signalType,
        severity: classified.severity,
        headline: classified.headline,
        summary: classified.summary || null,
        source_url: result.url,
        signal_date: today,
      })
      .select()
      .single();

    if (!error && data) inserted.push(data as ReputationSignalRow);
  }

  return inserted;
}
