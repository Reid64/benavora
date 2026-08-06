import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { createAdminClient } from "./src/lib/supabase/admin.ts";

const supabase = createAdminClient();

async function count(table, filters) {
  let q = supabase.from(table).select("*", { count: "exact", head: true });
  for (const [col, val] of Object.entries(filters)) {
    q = q.eq(col, val);
  }
  const { count: c, error } = await q;
  if (error) return { error: error.message };
  return { count: c };
}

const fd = await count("foundation_directory", { enrichment_source: "irs_990_xml_local" });
const np = await count("nonprofits", { enrichment_source: "irs_990_xml_local" });

console.log(JSON.stringify({ foundation_directory: fd, nonprofits: np }, null, 2));
