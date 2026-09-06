// Live smoke test (run once, manually, via `pnpm exec tsx` — not part of the
// test suite): exercises the newly-extended StatePortalResearchAgent's
// profile-driven mode against REAL production data — the real Faith
// Foundation org, its real active search_profile (real
// geographic_scope = "Texas", confirmed via faith-geo-scope-lookup.mjs this
// session), a REAL fetch of the live egrants.gov.texas.gov portal, and a REAL
// Claude extraction call. This is a genuine write against that org's real
// `opportunities`/`agent_runs` tables (org-scoped, and idempotent on re-run
// via the agent's own name+source dedup).
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";

const env = Object.fromEntries(
  fs
    .readFileSync(new URL("../../../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const idx = l.indexOf("=");
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    }),
);
for (const [k, v] of Object.entries(env)) {
  if (!process.env[k]) process.env[k] = v;
}

const FAITH_ORG_ID = "b1ab7402-dfc2-4712-869f-70ea3566cc1d";
const FAITH_PROFILE_ID = "f0b59ea6-5b52-4e1c-9ab8-7c5e1b6f2eba";

async function main() {
  const { StatePortalResearchAgent } = await import("../../../src/lib/agents/state-portal");

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false }, realtime: { transport: ws as never } },
  );

  // Confirm the real, live geographic_scope value immediately before the run
  // (not trusting the earlier read-only lookup to still be current).
  const { data: profileRow } = await admin
    .from("search_profiles")
    .select("id,name,geographic_scope,geographic_scopes,is_active,categories")
    .eq("id", FAITH_PROFILE_ID)
    .single();
  console.log("=== Real live search_profiles row (immediately pre-run) ===");
  console.log(JSON.stringify(profileRow, null, 2));

  const agent = new StatePortalResearchAgent({
    client: admin as never,
    organizationId: FAITH_ORG_ID,
    triggeredBy: null,
  });

  console.log("\n=== Running StatePortalResearchAgent.run({ profileIds: [FAITH_PROFILE_ID] }) live ===");
  const outcome = await agent.run({ profileIds: [FAITH_PROFILE_ID] });
  console.log("\n=== REAL observed outcome ===");
  console.log(JSON.stringify(outcome, null, 2));
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
