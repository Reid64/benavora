// FORGE shell-gate assertion for AR-2.2: canonical migration history must
// account for corporate_prospects and applications.knowledge_patterns_applied.
import { readFileSync, readdirSync } from "fs";
const all = readdirSync("supabase/migrations")
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync("supabase/migrations/" + f, "utf8"))
  .join("\n");
const hasTable = /corporate_prospects/i.test(all);
const hasColumn = /knowledge_patterns_applied/i.test(all);
if (!hasTable || !hasColumn) {
  console.error(`FAIL: corporate_prospects=${hasTable} knowledge_patterns_applied=${hasColumn}`);
  process.exit(1);
}
console.log("OK: both present in canonical migrations");
