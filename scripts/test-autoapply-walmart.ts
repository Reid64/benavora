// Test AutoApply against the Walmart Spark Good portal for Faith Foundation.
//
// Redirected from the task's original ask (a standalone processAutoApplySession()
// engine) to the REAL AutoApply pipeline: worker/queue-processor.ts already
// implements everything that would have been duplicated here (StealthBrowser
// anti-detection, CaptchaSolver via 2Captcha, RegistrationAgent account
// creation, FormFillerAgent, risk engine, velocity/dedup/domain-throttle
// controls, and an audited automation_sessions approval gate) — see this
// session's discussion. `autoapply_sessions` does not exist anywhere in this
// schema; the real tables are `funders` + `submission_queue` +
// `autoapply_submissions`.
//
// This script only creates the funder record and queues the submission — it
// does NOT drive a browser itself. Actually processing the queued item means
// starting the real worker (worker/index.ts), which will perform a genuine,
// live automation run against walmart.com under Faith Foundation's identity.
// That's a real external action with real consequences (an actual account-
// creation attempt, a real form submission), so it's left as an explicit,
// separate step for a human to trigger rather than something this script
// kicks off on its own.
//
//   pnpm test:autoapply

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import ws from "ws";

const FAITH_FOUNDATION_ORG_ID = "b1ab7402-dfc2-4712-869f-70ea3566cc1d";
const WALMART_PORTAL_URL = "https://www.walmart.com/nonprofits";

function fatal(message: string): never {
  console.error(`\nFATAL: ${message}`);
  process.exit(1);
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    fatal("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    realtime: { transport: ws as any },
  });

  console.log(`Verifying org ${FAITH_FOUNDATION_ORG_ID}...`);
  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select("id, name, subscription_tier")
    .eq("id", FAITH_FOUNDATION_ORG_ID)
    .maybeSingle();
  if (orgError) fatal(`Org lookup failed: ${orgError.message}`);
  if (!org) fatal(`No organization found with id ${FAITH_FOUNDATION_ORG_ID}`);
  console.log(`  Found: ${org.name} (tier: ${org.subscription_tier ?? "unknown"})`);

  console.log("Finding or creating the Walmart funder record...");
  const { data: existingFunder, error: findError } = await supabase
    .from("funders")
    .select("id, giving_portal_url")
    .eq("organization_id", FAITH_FOUNDATION_ORG_ID)
    .eq("name", "Walmart")
    .maybeSingle();
  if (findError) fatal(`Funder lookup failed: ${findError.message}`);

  let funderId: string;
  if (existingFunder) {
    funderId = existingFunder.id as string;
    console.log(`  Using existing funder row ${funderId} (portal: ${existingFunder.giving_portal_url})`);
  } else {
    const { data: newFunder, error: insertError } = await supabase
      .from("funders")
      .insert({
        organization_id: FAITH_FOUNDATION_ORG_ID,
        name: "Walmart",
        category: "corporate_foundation",
        description: "Walmart's Spark Good local community grants program.",
        website: "https://www.walmart.com",
        giving_portal_url: WALMART_PORTAL_URL,
        type: "corporate",
        has_giving_page: true,
        notes: "Spark Good local grants portal — created by scripts/test-autoapply-walmart.ts.",
      })
      .select("id")
      .single();
    if (insertError || !newFunder) {
      fatal(`Failed to create Walmart funder row: ${insertError?.message ?? "no row returned"}`);
    }
    funderId = newFunder.id as string;
    console.log(`  Created funder row ${funderId}`);
  }

  console.log("Queueing a submission_queue item (manual test, high priority)...");
  const { data: queueItem, error: queueError } = await supabase
    .from("submission_queue")
    .insert({
      organization_id: FAITH_FOUNDATION_ORG_ID,
      funder_id: funderId,
      priority: 1,
      status: "pending",
      automation_mode: "manual",
    })
    .select("id, status, priority, created_at")
    .single();
  if (queueError || !queueItem) {
    fatal(`Failed to queue submission: ${queueError?.message ?? "no row returned"}`);
  }

  console.log("\n--- Queued ---");
  console.log(JSON.stringify(queueItem, null, 2));
  console.log(
    "\nThis item is now 'pending' in submission_queue. The real AutoApply worker " +
      "(worker/index.ts's QueueProcessor) will pick it up on its next poll cycle " +
      "(~15s) once it is running, and will drive a live browser session against " +
      `${WALMART_PORTAL_URL} — including a real account-creation attempt if the ` +
      "portal requires one, real CAPTCHA handling via CaptchaSolver (requires " +
      "TWOCAPTCHA_API_KEY to actually solve; otherwise the item resolves to " +
      "captcha_blocked), and a real form submission if it gets that far.\n" +
      "The worker is a separate long-running process — start it explicitly " +
      "when you're ready to actually execute this against production Walmart.\n",
  );
  console.log("Monitor progress with:");
  console.log(`  select * from submission_queue where id = '${queueItem.id}';`);
  console.log(
    `  select * from autoapply_submissions where funder_id = '${funderId}' order by created_at desc limit 1;`,
  );
}

main().catch((error) => {
  fatal(error instanceof Error ? (error.stack ?? error.message) : String(error));
});
