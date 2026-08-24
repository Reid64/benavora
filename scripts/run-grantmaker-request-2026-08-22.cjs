// One-off driver: creates the real grantmaker-mode Donor Discovery request
// (states TX, cause P/X/L, assets>=$1M, limit 200), then claims and
// processes it IN-PROCESS via the just-rebuilt worker/dist code (the fixed
// bmf-directory.ts + scoring.ts from this session), instead of waiting on a
// poller. This avoids a real race against the already-deployed production
// Railway worker (old, unfixed code) also polling donor_discovery_requests
// every 15s — claiming happens atomically (FOR UPDATE SKIP LOCKED) within
// this same script, immediately after insert, so production has essentially
// no window to grab it first.
const path = require("path");
const dotenv = require("dotenv");
dotenv.config({ path: path.join(__dirname, "..", ".env.local") });

const { createClient } = require("@supabase/supabase-js");
const ws = require("ws");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  realtime: { transport: ws },
});

const ORG_ID = "b1ab7402-dfc2-4712-869f-70ea3566cc1d";
const CREATED_BY = "b3ef4d39-fdc2-4d3a-9e93-1e1888b576b4";
const TAXONOMY_IDS = [
  "ce438d8e-80fd-4989-9f5d-2e012572dcbb", // L - Housing, Shelter
  "544eff35-8e7e-45b8-adfb-da23ad1c45af", // P - Human Services
  "35775d98-0bfc-4828-a3dc-519c7dabd637", // X - Religion-Related
];

async function main() {
  console.log("Creating request...");
  const { data: created, error: createError } = await supabase
    .from("donor_discovery_requests")
    .insert({
      organization_id: ORG_ID,
      name: "TX grantmaker-mode foundations (P/X/L, assets>=$1M) - post-fix run",
      taxonomy_ids: TAXONOMY_IDS,
      geography: { states: ["TX"], min_assets: 1_000_000, limit: 200 }, // operating_nonprofits omitted -> grantmaker mode (default)
      status: "queued",
      counts: {},
      created_by: CREATED_BY,
    })
    .select()
    .single();

  if (createError || !created) {
    console.error("Create failed:", createError?.message);
    process.exit(1);
  }
  console.log("Created request:", created.id);

  console.log("Claiming immediately (racing the live worker)...");
  const { data: claimed, error: claimError } = await supabase.rpc("donor_discovery_claim_request");
  if (claimError) {
    console.error("Claim RPC failed:", claimError.message);
    process.exit(1);
  }
  if (!claimed || !claimed.id) {
    console.error("Claim returned empty -- the live production worker likely claimed it first. Check request status directly.");
    process.exit(1);
  }
  if (claimed.id !== created.id) {
    console.warn(`WARNING: claimed a different request (${claimed.id}) than the one just created (${created.id}) -- an older queued request existed. Processing it anyway; re-run to reach the intended request.`);
  } else {
    console.log("Claimed our own request -- no race lost.");
  }

  const { DdRequestProcessor } = require("../worker/dist/worker/dd-request-processor.js");
  const processor = new DdRequestProcessor(supabase);

  console.log(`Processing request ${claimed.id} in-process with the fixed adapter/scorer...`);
  const start = Date.now();
  await processor.processItem(claimed);
  console.log(`Done in ${((Date.now() - start) / 1000).toFixed(1)}s`);

  const { data: finalRequest } = await supabase
    .from("donor_discovery_requests")
    .select("*")
    .eq("id", claimed.id)
    .single();
  console.log("Final request state:", JSON.stringify(finalRequest, null, 2));
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
