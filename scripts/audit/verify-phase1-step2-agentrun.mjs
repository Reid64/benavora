import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";

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
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  realtime: { transport: ws },
});

const { data: runs } = await admin
  .from("agent_runs")
  .select("id, agent_type, status, created_at, items_processed")
  .in("agent_type", ["success_probability"])
  .order("created_at", { ascending: false })
  .limit(3);
console.log("recent success-probability agent_runs:", JSON.stringify(runs, null, 2));

const { data: scores } = await admin
  .from("success_probability_scores")
  .select("application_id, probability_score, created_at, updated_at")
  .eq("application_id", "581f6778-5984-4226-ba8a-2b792042319d");
console.log("success_probability_scores row:", JSON.stringify(scores, null, 2));
