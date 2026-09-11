import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { RelationshipGraphBuilderAgent } from "../../src/lib/agents/relationship-graph-builder-agent";

const env = Object.fromEntries(
  fs
    .readFileSync(new URL("../../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const idx = l.indexOf("=");
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    }),
);

const ORG_ID = "b1ab7402-dfc2-4712-869f-70ea3566cc1d";
const FUNDER_ID = "2521840b-9048-4c77-bd9c-f9f8492529d7";

async function main() {
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws as unknown as never },
  });

  const agent = new RelationshipGraphBuilderAgent(ORG_ID, admin as never);
  const result = await agent.run("manual");
  console.log("RelationshipGraphBuilderAgent result:", JSON.stringify(result, null, 2));

  // Confirm it never touched funder_relationship_scores (no comparable score).
  const { data: score } = await admin
    .from("funder_relationship_scores")
    .select("score, relationship_score, updated_at")
    .eq("organization_id", ORG_ID)
    .eq("funder_id", FUNDER_ID)
    .maybeSingle();
  console.log("funder_relationship_scores row (should be unchanged by AG-32):", JSON.stringify(score, null, 2));

  const { data: nodeForFunder } = await admin
    .from("pig_nodes")
    .select("id, node_type, label")
    .eq("entity_table", "funders")
    .eq("entity_id", FUNDER_ID)
    .maybeSingle();
  console.log("pig_nodes row for this funder (AG-32 output):", JSON.stringify(nodeForFunder, null, 2));
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
