import ws from "ws";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { FormAnalyzerAgent } from "./src/lib/agents/form-analyzer";

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

const agent = new FormAnalyzerAgent({
  client,
  organizationId: "b1ab7402-dfc2-4712-869f-70ea3566cc1d",
});

async function main() {
  console.log("Running FormAnalyzerAgent against Meade Tractor...");
  const result = await agent.run({ funderId: "2521840b-9048-4c77-bd9c-f9f8492529d7" });
  console.log("\n=== RESULT ===");
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

main();
