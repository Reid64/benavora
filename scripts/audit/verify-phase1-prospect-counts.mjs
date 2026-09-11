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

const { count: total } = await admin.from("corporate_prospects").select("*", { count: "exact", head: true });
const { count: enriched } = await admin
  .from("corporate_prospects")
  .select("*", { count: "exact", head: true })
  .not("enrichment_completed_at", "is", null);
const { count: scored } = await admin
  .from("corporate_prospects")
  .select("*", { count: "exact", head: true })
  .not("scores_computed_at", "is", null);
console.log({ total, enriched, scored });
