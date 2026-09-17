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
 * (TESTING_v2.md §2.1 original intent; the AG-22 propensity `scores` jsonb
 * structure).
 *
 * INVERTED 2026-09-17 (AR-2.2). This file previously asserted the table's
 * *absence*, current as of 2026-07-30 (PGRST205, "Could not find the table
 * 'public.corporate_prospects' in the schema cache"). A new task session
 * arrived citing the same class of live error as still-current (4 recent
 * ag-32-relationship-graph failures, 2 ag22_propensity_scoring "permission
 * denied" failures) and asked for a migration to create the table. Direct
 * live verification this session (Postgres query via the Supabase project,
 * not the old PGRST205 probe) found the table has existed in production for
 * some time: `to_regclass('public.corporate_prospects')` resolves, all
 * columns/constraints match supabase/migrations/107_corporate_prospects.sql
 * exactly (including the (legal_name, address_city, address_state) unique
 * constraint), RLS is enabled with the authenticated SELECT/UPDATE policies
 * from supabase/migrations/179_corporate_prospects_authenticated_grant.sql,
 * and service_role has full grants. Cross-checking `agent_runs` directly:
 * every "table not found" / "permission denied" error on this table is
 * dated 2026-08-03 through 2026-09-11 06:32 UTC; both agent types have run
 * to `completed` repeatedly since 2026-09-11 16:17 UTC, with zero failures
 * after that point. The task's cited failures were real when they happened,
 * just already fixed before this session started — see project memory
 * `benavora-ag22-propensity-batch-route-built-2026-09-10`.
 *
 * This test now asserts the table's presence and shape instead of its
 * absence, per this repo's testing convention (see organizations.test.ts,
 * foundation-directory.test.ts, agent-runs.test.ts — "Never fabricate test
 * results," which cuts both ways: don't assert a false absence either).
 * The unique-constraint and scores-jsonb tests below were already written
 * (dynamically gated on a live `tableExists` probe) and now actually run.
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

  it("exists in production with the SCHEMA_REGISTRY_v2.md §36 shape (migrations 107/108/109/111/179)", async () => {
    const { data, error } = await service.from("corporate_prospects").select("id").limit(1);

    if (!tableExists) {
      // Regression: the table existed when this test was inverted
      // (2026-09-17, AR-2.2) but has since disappeared or become
      // unreachable for the authenticated/service-role path. Fail loudly
      // rather than silently skip — this table's absence has broken real
      // agents (ag-32-relationship-graph, ag22_propensity_scoring) before.
      // eslint-disable-next-line no-console
      console.error(
        "[corporate-prospects.test] REGRESSION: corporate_prospects was live-verified present " +
          "2026-09-17 (AR-2.2) but this run cannot reach it: " +
          `${error?.code ?? "unknown error"} — ${error?.message ?? "no message"}`,
      );
    }

    expect(error).toBeNull();
    expect(data).not.toBeNull();
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
