// Live smoke test for the state-portal.ts profile-driven extension (this
// task). Runs the REAL, locally-modified StatePortalResearchAgent in
// profile-driven mode against Faith Foundation's REAL search_profiles row
// (geographic_scope = "Texas"), exactly as /api/cron/research's sweep would
// invoke it. Real network fetch to egrants.gov.texas.gov, real Claude call,
// real insert attempt against production `opportunities` — this IS the smoke
// test the task asked for, not a dry run.
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { StatePortalResearchAgent } from "../../src/lib/agents/state-portal";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(url, serviceKey, { realtime: { transport: ws as never } });

const ORG_ID = "b1ab7402-dfc2-4712-869f-70ea3566cc1d"; // real Faith Foundation org
const PROFILE_ID = "f0b59ea6-5b52-4e1c-9ab8-7c5e1b6f2eba"; // its real search_profile (geographic_scope: Texas)

async function main() {
  const agent = new StatePortalResearchAgent({
    client: admin,
    organizationId: ORG_ID,
    triggeredBy: null,
  });

  const result = await agent.run({ profileIds: [PROFILE_ID] });
  console.log("=== LIVE SMOKE TEST RESULT ===");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("=== LIVE SMOKE TEST ERROR ===", err);
  process.exit(1);
});
