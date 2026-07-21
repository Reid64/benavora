import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string);
const orgId = "b1ab7402-dfc2-4712-869f-70ea3566cc1d";

async function main() {
  const [cp, signals, ddprospects, ddrequests, queue, org] = await Promise.all([
    s.from("corporate_prospects").select("id,legal_name,industry_category", { count: "exact" }).limit(10),
    s.from("corporate_intent_signals").select("company_name,intent_score,signal_type,recommended_action").eq("org_id", orgId).order("intent_score", { ascending: false }).limit(10),
    s.from("donor_discovery_prospects").select("id,pipeline_stage,score", { count: "exact" }).eq("organization_id", orgId),
    s.from("donor_discovery_requests").select("id,status", { count: "exact" }).eq("organization_id", orgId),
    s.from("submission_queue").select("id,status", { count: "exact" }).eq("organization_id", orgId),
    s.from("organizations").select("id,name,address_line1,city,state,zip").eq("id", orgId).maybeSingle(),
  ]);

  console.log("ORG:", JSON.stringify(org.data), org.error?.message ?? "");
  console.log("CORPORATE_PROSPECTS count:", cp.count, "error:", cp.error?.message ?? "");
  console.log("CORPORATE_PROSPECTS sample:", JSON.stringify(cp.data?.slice(0, 5)));
  console.log("SIGNALS count:", signals.data?.length, "error:", signals.error?.message ?? "", JSON.stringify(signals.data));
  console.log("DD_PROSPECTS count:", ddprospects.count, "error:", ddprospects.error?.message ?? "");
  console.log("DD_REQUESTS count:", ddrequests.count, "error:", ddrequests.error?.message ?? "", JSON.stringify(ddrequests.data));
  console.log("SUBMISSION_QUEUE count:", queue.count, "error:", queue.error?.message ?? "");
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
