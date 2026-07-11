// @ts-nocheck
// ============================================================================
// BENAVORA — Donor Discovery taxonomy alias seed script
//
// Seeds donor_discovery_taxonomy_aliases (migration 075,
// DONOR_DISCOVERY_ARCHITECTURE.md §1A-1C): plain-language trade names a
// nonprofit staffer would actually type ("septic installer", "well driller")
// mapped onto the 6-digit NAICS leaves of donor_discovery_taxonomy, which are
// seeded from official Census labels ("Septic Tank and Related Services")
// that rarely match how a human searches.
//
// For every 6-digit NAICS node, Claude (claude-sonnet-4-6) generates 3-8
// aliases in a single structured-JSON response per batch of 50 codes. Results
// are inserted into donor_discovery_taxonomy_aliases.
//
// donor_discovery_taxonomy_aliases has no unique constraint on (taxonomy_id,
// alias) — the migration only indexes taxonomy_id and a trigram index on
// alias, deliberately, since aliases are free text and a real PostgREST
// upsert would need an exact-match unique index that doesn't fit free-text
// dedup. Idempotency instead comes from this script: before inserting a
// batch's rows, it fetches the aliases already on file for those taxonomy
// nodes and skips any exact (case-insensitive) duplicate. Re-running is safe;
// it will not double up existing aliases, but it also won't catch
// near-duplicate phrasing across separate runs (e.g. "septic installer" vs
// "septic tank installer") — that's an acceptable amount of redundancy for a
// search-matching table, not a correctness bug.
//
// Requires migration 075 applied and donor_discovery_taxonomy already seeded
// (pnpm seed:dd-taxonomy).
//
// Non-fatal on a single batch failure: logs it and moves to the next batch,
// since batches are independent (no parent/child linkage like the taxonomy
// seed has). Re-run the script to pick up any codes a failed batch skipped —
// idempotency means already-seeded codes are cheap no-ops.
//
//   pnpm seed:dd-aliases
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";
import ws from "ws";

dotenv.config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
if (!anthropicApiKey) {
  console.error("Missing ANTHROPIC_API_KEY");
  process.exit(1);
}

const admin = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  realtime: { transport: ws as unknown as typeof WebSocket },
});

const anthropic = new Anthropic({ apiKey: anthropicApiKey });

function ok(step: string, detail: string) {
  console.log(`  ✓ ${step}: ${detail}`);
}

function fail(step: string, error: unknown) {
  const message = error instanceof Error ? error.message : JSON.stringify(error);
  console.error(`  ✗ ${step}: ${message}`);
}

function fatal(message: string): never {
  console.error(`\nFATAL: ${message}`);
  process.exit(1);
}

// ----------------------------------------------------------------------------
// Config
// ----------------------------------------------------------------------------
const CLAUDE_MODEL = "claude-sonnet-4-6";
const CLAUDE_MAX_TOKENS = 8192;
const BATCH_SIZE = 50;
const MIN_ALIASES = 3;
const MAX_ALIASES = 8;
const ALIAS_TYPES = ["trade_name", "keyword", "common_name", "material"] as const;
type AliasType = (typeof ALIAS_TYPES)[number];

const EXAMPLE_MAPPINGS = [
  ["238110", "concrete pourer"],
  ["562991", "septic installer"],
  ["237110", "well driller"],
  ["238210", "electrician"],
  ["238220", "plumber"],
  ["238160", "roofer"],
  ["238220", "HVAC installer"],
  ["238310", "drywall installer"],
  ["238320", "painter"],
  ["238330", "flooring installer"],
  ["561730", "landscaper"],
  ["561730", "tree service"],
  ["238910", "demolition contractor"],
  ["238910", "excavator"],
  ["237310", "paving contractor"],
  ["238990", "fence installer"],
  ["561740", "carpet cleaner"],
  ["238150", "window installer"],
  ["238310", "insulation installer"],
  ["238140", "masonry contractor"],
] as const;

// ----------------------------------------------------------------------------
// Load 6-digit NAICS taxonomy nodes needing aliases
// ----------------------------------------------------------------------------
interface TaxonomyNode {
  id: string;
  code: string;
  label: string;
}

async function fetchSixDigitNaicsNodes(): Promise<TaxonomyNode[]> {
  const nodes: TaxonomyNode[] = [];
  const PAGE = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await admin
      .from("donor_discovery_taxonomy")
      .select("id, code, label")
      .eq("kind", "naics")
      .range(from, from + PAGE - 1);
    if (error) {
      fail("fetch donor_discovery_taxonomy", error);
      fatal("could not load NAICS taxonomy nodes — has migration 067 + pnpm seed:dd-taxonomy run?");
    }
    if (!data || data.length === 0) break;
    for (const row of data) {
      if (typeof row.code === "string" && row.code.length === 6) {
        nodes.push({ id: row.id as string, code: row.code, label: row.label as string });
      }
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return nodes;
}

async function fetchExistingAliasesLower(taxonomyIds: string[]): Promise<Map<string, Set<string>>> {
  const map = new Map<string, Set<string>>();
  const PAGE = 1000;
  const ID_CHUNK = 100;

  for (let c = 0; c < taxonomyIds.length; c += ID_CHUNK) {
    const idChunk = taxonomyIds.slice(c, c + ID_CHUNK);
    let from = 0;
    for (;;) {
      const { data, error } = await admin
        .from("donor_discovery_taxonomy_aliases")
        .select("taxonomy_id, alias")
        .in("taxonomy_id", idChunk)
        .range(from, from + PAGE - 1);
      if (error) {
        fail("fetch existing aliases", error);
        fatal("could not check for existing aliases — refusing to insert and risk duplicates.");
      }
      if (!data || data.length === 0) break;
      for (const row of data) {
        const taxonomyId = row.taxonomy_id as string;
        const set = map.get(taxonomyId) ?? new Set<string>();
        set.add(String(row.alias).trim().toLowerCase());
        map.set(taxonomyId, set);
      }
      if (data.length < PAGE) break;
      from += PAGE;
    }
  }
  return map;
}

// ----------------------------------------------------------------------------
// Claude batch generation — structured JSON output only
// ----------------------------------------------------------------------------
interface GeneratedAlias {
  alias: string;
  alias_type: AliasType;
}

interface GeneratedCodeAliases {
  code: string;
  aliases: GeneratedAlias[];
}

function buildPrompt(batch: TaxonomyNode[]): string {
  const codeList = batch.map((n) => `${n.code} | ${n.label}`).join("\n");
  const exampleList = EXAMPLE_MAPPINGS.map(([code, alias]) => `${code} -> "${alias}"`).join("\n");

  return `You generate plain-language search aliases for NAICS industry codes, for a nonprofit staffer prospecting for in-kind donors (site-development contractors, material suppliers, service providers). Staffers search using everyday trade names, not the official Census title.

For EACH of the following NAICS codes, generate 3 to 8 aliases: the common trade names, job titles, and keywords a nonprofit staffer would actually type to find a business of that type. Reference examples of the kind of everyday phrasing expected (not an exhaustive list, and some codes below may not appear in this batch):
${exampleList}

NAICS codes to alias (code | official title):
${codeList}

Return ONLY a single JSON array, no prose, no markdown code fences, no explanation, matching this exact shape:
[
  { "code": "123456", "aliases": [ { "alias": "string", "alias_type": "trade_name" | "keyword" | "common_name" | "material" } ] }
]

Rules:
- Include EVERY code listed above exactly once, in any order.
- Each code must have between 3 and 8 aliases.
- alias: lowercase, short (1-4 words), no trailing punctuation, no duplicates within the same code.
- alias_type: "trade_name" for a job/business title (e.g. "plumber"), "keyword" for a general search term (e.g. "site prep"), "common_name" for a colloquial name for the business type, "material" only when the alias names a material/product the business supplies (e.g. "gravel supplier" -> keyword, "asphalt" -> material). Default to "trade_name" when unsure.
- Do not invent aliases for codes not in the list, and do not skip any listed code.`;
}

function stripCodeFences(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced?.[1] ?? text).trim();
}

function extractJsonArray(text: string): string {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return text;
  return text.slice(start, end + 1);
}

function normalizeAliasType(v: unknown): AliasType {
  return typeof v === "string" && (ALIAS_TYPES as readonly string[]).includes(v) ? (v as AliasType) : "trade_name";
}

function parseGeneratedBatch(raw: string, expectedCodes: Set<string>): GeneratedCodeAliases[] {
  const candidate = extractJsonArray(stripCodeFences(raw));
  let value: unknown;
  try {
    value = JSON.parse(candidate);
  } catch (err) {
    throw new Error(`could not parse JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!Array.isArray(value)) throw new Error("response was not a JSON array");

  const out: GeneratedCodeAliases[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const code = typeof rec.code === "string" ? rec.code.trim() : "";
    if (!code || !expectedCodes.has(code)) continue;
    if (!Array.isArray(rec.aliases)) continue;

    const seen = new Set<string>();
    const aliases: GeneratedAlias[] = [];
    for (const a of rec.aliases) {
      if (!a || typeof a !== "object") continue;
      const aliasRec = a as Record<string, unknown>;
      const alias = typeof aliasRec.alias === "string" ? aliasRec.alias.trim().toLowerCase() : "";
      if (!alias || seen.has(alias)) continue;
      seen.add(alias);
      aliases.push({ alias, alias_type: normalizeAliasType(aliasRec.alias_type) });
      if (aliases.length >= MAX_ALIASES) break;
    }
    if (aliases.length >= MIN_ALIASES) out.push({ code, aliases });
  }
  return out;
}

async function generateBatchAliases(batch: TaxonomyNode[]): Promise<GeneratedCodeAliases[]> {
  const expectedCodes = new Set(batch.map((n) => n.code));
  const message = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: CLAUDE_MAX_TOKENS,
    temperature: 0,
    messages: [{ role: "user", content: buildPrompt(batch) }],
  });

  const rawText = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  return parseGeneratedBatch(rawText, expectedCodes);
}

// ----------------------------------------------------------------------------
// Insert — new aliases only (see idempotency note at top of file)
// ----------------------------------------------------------------------------
async function insertNewAliases(
  batch: TaxonomyNode[],
  generated: GeneratedCodeAliases[],
  existingByTaxonomyId: Map<string, Set<string>>,
): Promise<number> {
  const byCode = new Map(batch.map((n) => [n.code, n]));
  const rows: { taxonomy_id: string; alias: string; alias_type: AliasType }[] = [];

  for (const g of generated) {
    const node = byCode.get(g.code);
    if (!node) continue;
    const existing = existingByTaxonomyId.get(node.id) ?? new Set<string>();
    for (const a of g.aliases) {
      if (existing.has(a.alias)) continue;
      rows.push({ taxonomy_id: node.id, alias: a.alias, alias_type: a.alias_type });
      existing.add(a.alias);
    }
    existingByTaxonomyId.set(node.id, existing);
  }

  if (rows.length === 0) return 0;

  const { error } = await admin.from("donor_discovery_taxonomy_aliases").insert(rows);
  if (error) {
    fail("insert aliases batch", error);
    throw new Error(`insert failed: ${error.message}`);
  }
  return rows.length;
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------
async function main() {
  console.log("Loading 6-digit NAICS taxonomy nodes ...");
  const nodes = await fetchSixDigitNaicsNodes();
  if (nodes.length === 0) {
    fatal("no 6-digit NAICS taxonomy nodes found — run `pnpm seed:dd-taxonomy` first.");
  }
  ok("load taxonomy nodes", `${nodes.length} six-digit NAICS codes`);

  console.log("Loading existing aliases (for idempotent skip) ...");
  const existingByTaxonomyId = await fetchExistingAliasesLower(nodes.map((n) => n.id));
  ok("load existing aliases", `${existingByTaxonomyId.size} taxonomy node(s) already have aliases`);

  let inserted = 0;
  let failedBatches = 0;
  const totalBatches = Math.ceil(nodes.length / BATCH_SIZE);

  for (let i = 0; i < nodes.length; i += BATCH_SIZE) {
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const batch = nodes.slice(i, i + BATCH_SIZE);

    try {
      const generated = await generateBatchAliases(batch);
      const missing = batch.length - generated.length;
      const count = await insertNewAliases(batch, generated, existingByTaxonomyId);
      inserted += count;
      ok(
        `batch ${batchNum}/${totalBatches}`,
        `${count} alias(es) inserted for ${generated.length}/${batch.length} codes` +
          (missing > 0 ? ` (${missing} code(s) missing/invalid from Claude response, will retry on next run)` : ""),
      );
    } catch (error) {
      failedBatches++;
      fail(`batch ${batchNum}/${totalBatches}`, error);
      console.error("  … skipping to next batch; re-run this script to retry (idempotent).");
    }
  }

  console.log("\nDone.");
  console.log(`  NAICS codes processed: ${nodes.length}`);
  console.log(`  Aliases inserted:      ${inserted}`);
  console.log(`  Failed batches:        ${failedBatches}${failedBatches > 0 ? " (re-run to retry)" : ""}`);
}

main();
