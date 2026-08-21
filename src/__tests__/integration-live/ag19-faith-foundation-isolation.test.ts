import { describe, it, expect } from "vitest";
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
 * WGR-157: moved out of
 * src/__tests__/integration/ag19-relationship-builder-flag.test.ts
 * (excluded from the default `npx vitest run` via vitest.config.ts's
 * `exclude: [..., "src/__tests__/integration-live/**"]`) — this check reads
 * Faith Foundation's real, shared production org row (a hardcoded id, not a
 * value this suite creates or controls), which failed once already because
 * an earlier live investigation/demo session had manually set
 * feature.relationship_builder_v2 = 'true' for it and never unset it. That
 * makes this test's pass/fail outcome depend on whatever unrelated live
 * production activity has touched this specific org since — a genuine
 * external-system dependency, not a defect in the flag-routing code itself
 * (which is what the rest of that file's tests, kept in place, verify
 * against a disposable org this suite fully owns). Run explicitly via
 * `pnpm run test:integration`.
 *
 * A deterministic, mock-based replacement for the underlying invariant
 * ("this suite's own actions never touch Faith Foundation's real org") lives
 * at src/__tests__/unit/ag19-org-scoping.test.ts — it asserts, via a fully
 * mocked Supabase client, that every write worker/autonomous-orchestrator.ts's
 * routeQueueItem() makes is scoped to the org id it was called with, never a
 * hardcoded one.
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

const FAITH_FOUNDATION_ORG_ID = "b1ab7402-dfc2-4712-869f-70ea3566cc1d";
const FEATURE_FLAG_KEY = "feature.relationship_builder_v2";

(CREDS_AVAILABLE ? describe : describe.skip)(
  "AG-19 feature.relationship_builder_v2 flag routing — Faith Foundation isolation (live production state)",
  () => {
    it("Faith Foundation's real org has no feature.relationship_builder_v2 row", async () => {
      const service = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const { data: ffFlag, error: ffFlagError } = await service
        .from("platform_config")
        .select("value")
        .eq("organization_id", FAITH_FOUNDATION_ORG_ID)
        .eq("key", FEATURE_FLAG_KEY)
        .maybeSingle();
      expect(ffFlagError, ffFlagError?.message).toBeNull();
      expect(
        ffFlag,
        ffFlag
          ? "Faith Foundation's real org has a leftover feature.relationship_builder_v2 row " +
            "from a prior live investigation/demo session — unset it directly " +
            "(DELETE FROM platform_config WHERE organization_id = " +
            `'${FAITH_FOUNDATION_ORG_ID}' AND key = '${FEATURE_FLAG_KEY}') before treating this as a code defect.`
          : undefined,
      ).toBeNull();
    });
  },
);

if (!CREDS_AVAILABLE) {
  // eslint-disable-next-line no-console
  console.warn(
    "[ag19-faith-foundation-isolation.test] skipped entirely — .env.local is missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY",
  );
}
