import ws from "ws";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { FormFillerAgent } from "./src/lib/agents/form-filler";

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

const agent = new FormFillerAgent({
  client,
  organizationId: "b1ab7402-dfc2-4712-869f-70ea3566cc1d",
});

async function main() {
  console.log("Running FormFillerAgent against Meade Tractor...");
  console.log("Watch your screen - browser will open and fill the form live.");
  const result = await agent.run({
    funderId: "2521840b-9048-4c77-bd9c-f9f8492529d7",
    requestDescription: "Faith Foundation SF is a 501(c)(3) nonprofit providing emergency housing and community services in the San Francisco Bay Area. We are requesting support for our upcoming community outreach program serving families in transitional housing.",
  });
  console.log("\n=== RESULT ===");
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

main();
