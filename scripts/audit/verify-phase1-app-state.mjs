import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";

const env = Object.fromEntries(
  fs.readFileSync(new URL("../../.env.local", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const idx = l.indexOf("="); return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()]; }),
);
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  realtime: { transport: ws },
});

const { data } = await admin
  .from("applications")
  .select("id, organization_id, stage, submitted_at, awarded_amount")
  .eq("id", "581f6778-5984-4226-ba8a-2b792042319d");
console.log(JSON.stringify(data, null, 2));
