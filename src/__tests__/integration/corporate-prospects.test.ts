import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

// Node 20 has no native WebSocket; mirrors the workaround in
// src/lib/supabase/admin.ts and the other suites in this directory — without
// it, supabase-js's realtime client (constructed eagerly by createClient
// regardless of whether it's used) throws immediately.
function createClient(url: string, key: string, opts: Record<string, unknown> = {}): SupabaseClient {
  return createSupabaseClient(url, key, {
    ...opts,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    realtime: { transport: ws as any },
  }) as unknown as SupabaseClient;
}

/**
 * corporate_prospects unique constraint + scores jsonb structure
 * (TESTING_v2.md §2.1 original intent; this task's prompt asked for the
 * unique constraint on (legal_name, city, state) and the AG-22 propensity
 * `scores` jsonb structure "built tonight").
 *
 * VERIFIED LIVE STATE (2026-07-30, PostgREST OpenAPI introspection + a
 * direct `GET /rest/v1/corporate_prospects` probe): the `corporate_prospects`
 * table described in SCHEMA_REGISTRY_v2.md §36 does not exist in production.
 * The request returns PostgREST error PGRST205
 * ("Could not find the table 'public.corporate_prospects' in the schema
 * cache", hint: "Perhaps you meant... 'corporate_relationships'"). This
 * matches project memory `benavora-corporate-prospects-confirmed-missing-
 * breaks-outreach` (confirmed missing 2026-07-20) — this session
 * re-confirms the gap is still live, not newly discovered.
 *
 * There is also no `agent_runs` activity from "tonight" (2026-07-30) in the
 * live database as of this session — the most recent row is 2026-07-28 — so
 * there is no evidence an AG-22 propensity-scoring run wrote anything,
 * anywhere, tonight. The two live tables that come closest to "corporate
 * propensity scoring" are `donor_discovery_prospects` (integer `score` +
 * `score_rationale` text, not jsonb) and `corporate_intent_signals`
 * (numeric `intent_score`, not a `scores` jsonb blob) — neither matches the
 * `scores` jsonb column this file was scoped to test, because that column
 * belongs to a table that was never created.
 *
 * Per this repo's testing convention (see organizations.test.ts,
 * foundation-directory.test.ts, agent-runs.test.ts in this directory —
 * "Never fabricate test results"), this file does not synthesize tests
 * against a schema that doesn't exist. It instead runs a single test that
 * verifies — and will keep failing loudly if this ever silently changes in
 * the wrong direction — that the table is actually absent, and documents
 * exactly what still needs to happen (a real migration for
 * `corporate_prospects`, per SCHEMA_REGISTRY_v2.md §36) before the unique-
 * constraint and scores-jsonb tests this file was asked to build can be
 * written for real. If a future migration creates the table, the guarded
 * block below is where those tests belong — written now, but only run once
 * `TABLE_EXISTS` flips to true.
 */

function loadLocalEnv(): Record<string, string> {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return {};
  return dotenv.parse(fs.readFileSync(envPath));
}

const localEnv = loadLocalEnv();
const SUPABASE_URL = localEnv.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = localEnv.SUPABASE_SERVICE_ROLE_KEY;
const CREDS_AVAILABLE = Boolean(SUPABASE_URL && SERVICE_ROLE_KEY);

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

(CREDS_AVAILABLE ? describe : describe.skip)("corporate_prospects unique constraint and scores jsonb", () => {
  let service: SupabaseClient;
  let tableExists = false;
  const createdIds: string[] = [];

  beforeAll(async () => {
    service = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error } = await service.from("corporate_prospects").select("id").limit(1);
    // PGRST205 = "table not found in schema cache" — any other error means
    // the table exists but something else is wrong (e.g. RLS), which should
    // still route into the guarded tests below rather than the gap report.
    tableExists = !(error && error.code === "PGRST205");
  }, 30000);

  afterAll(async () => {
    if (!service || createdIds.length === 0) return;
    // supabase-js's PostgrestFilterBuilder in the pinned version here is
    // thenable but does not implement .catch() — chaining .catch() throws
    // synchronously rather than suppressing a rejection, so this best-effort
    // cleanup uses try/catch instead (see agent-runs.test.ts).
    try {
      await service.from("corporate_prospects").delete().in("id", createdIds);
    } catch {
      // best-effort cleanup
    }
  });

  it("documents that corporate_prospects does not exist in production (SCHEMA_REGISTRY_v2.md §36 was never migrated live)", async () => {
    const { data, error } = await service.from("corporate_prospects").select("id").limit(1);

    if (tableExists) {
      // Table has been created since this file was written — nothing to
      // document, the guarded suite below covers the real behavior instead.
      expect(error).toBeNull();
      return;
    }

    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error!.code).toBe("PGRST205");
    expect(error!.message).toContain("corporate_prospects");

    // eslint-disable-next-line no-console
    console.warn(
      "[corporate-prospects.test] corporate_prospects table does not exist in production — " +
        "unique-constraint and scores-jsonb tests cannot run against real data. " +
        "See project memory benavora-corporate-prospects-confirmed-missing-breaks-outreach. " +
        "Closest live analogues: donor_discovery_prospects.score (integer) and " +
        "corporate_intent_signals.intent_score (numeric) — neither is the AG-22 `scores` jsonb blob.",
    );
  });

  // These two are NOT gated with describe.skip(tableExists) — vitest
  // collects all describe/it blocks before any beforeAll runs, so a
  // describe-level conditional on a beforeAll-computed flag would evaluate
  // against its initial (pre-fetch) value and always skip, regardless of
  // live state. Each test instead calls the vitest per-test dynamic
  // ctx.skip() once tableExists is actually known.
  it("enforces the unique constraint on (legal_name, address_city, address_state)", async (ctx) => {
    if (!tableExists) {
      ctx.skip();
      return;
    }
    const tag = randomSuffix();
    const row = {
      legal_name: `CORP_TEST_${tag}`,
      address_city: "Waco",
      address_state: "TX",
    };
    const { data: first, error: firstErr } = await service.from("corporate_prospects").insert(row).select().single();
    expect(firstErr, firstErr?.message).toBeNull();
    createdIds.push(first!.id as string);

    const { data: dup, error: dupErr } = await service.from("corporate_prospects").insert(row);
    expect(dup).toBeNull();
    expect(dupErr).not.toBeNull();
    expect(dupErr!.code).toBe("23505");
  });

  it("persists a scores jsonb object with PS-01..PS-10 propensity keys", async (ctx) => {
    if (!tableExists) {
      ctx.skip();
      return;
    }
    const tag = randomSuffix();
    const scores = { ps_01_capacity: 72, ps_02_alignment: 61, ps_10_composite: 68 };
    const { data, error } = await service
      .from("corporate_prospects")
      .insert({
        legal_name: `CORP_TEST_SCORES_${tag}`,
        address_city: "Austin",
        address_state: "TX",
        scores,
        scores_computed_at: new Date().toISOString(),
      })
      .select()
      .single();
    expect(error, error?.message).toBeNull();
    createdIds.push(data!.id as string);
    expect(data!.scores).toEqual(scores);
    expect(data!.scores_computed_at).toBeTruthy();
  });
});

if (!CREDS_AVAILABLE) {
  // eslint-disable-next-line no-console
  console.warn(
    "[corporate-prospects.test] skipped entirely — .env.local is missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY",
  );
}
