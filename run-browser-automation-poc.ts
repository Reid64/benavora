import ws from "ws";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { BrowserAutomationAgent } from "./src/lib/agents/browser-automation";

readFileSync(".env.local", "utf8").split("\n").forEach((l) => {
  const [k, ...v] = l.split("=");
  if (k && !k.startsWith("#") && k.trim()) {
    process.env[k.trim()] = v.join("=").trim();
  }
});

const client = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { realtime: { transport: ws } }
);

// Real production org: FAITH Foundation (enterprise tier), login info@faithfoundationsf.org
const ORG_ID = "b1ab7402-dfc2-4712-869f-70ea3566cc1d";
const TRIGGERED_BY = "b3ef4d39-fdc2-4d3a-9e93-1e1888b576b4"; // Reid Whitesides, owner

// Real application row: "Announcement of Stand Down Grants" (VPL-01-23, grants.gov),
// 72% match, deadline 2026-09-30 (still open as of 2026-09-08).
const APPLICATION_ID = "7151fd25-2cce-41aa-9654-2a14c7df8f1c";

const agent = new BrowserAutomationAgent({
  client,
  organizationId: ORG_ID,
  triggeredBy: TRIGGERED_BY,
  headless: true,
});

// Deliberately NOT passing automationLevel — defaults to "supervised" inside
// browser-automation.ts, which structurally cannot reach shouldAutoSubmit.
// This is a real, live run: real Playwright browser, real navigation to the
// real opportunity URL, real DB writes to automation_sessions. It will stop
// at awaiting_approval/failed and never call clickSubmit().
async function main() {
  console.log("Running BrowserAutomationAgent (REAL, live) against application", APPLICATION_ID);
  const result = await agent.run({ applicationId: APPLICATION_ID });
  console.log("\n=== RESULT ===");
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error("\n=== FAILED ===");
  console.error(err);
  process.exit(1);
});
