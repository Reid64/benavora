// FORGE shell-gate assertion for AR-2.1: the nonexistent `knowledge_base_entries`
// table must no longer be queried anywhere in production code.
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
const roots = ["src/lib", "src/app", "worker"];
const bad = [];
function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (e === "node_modules" || e === "dist" || e === ".next") continue;
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.tsx?$/.test(p)) {
      const s = readFileSync(p, "utf8");
      if (/\.from\(\s*['"`]knowledge_base_entries['"`]\s*\)/.test(s)) bad.push(p);
    }
  }
}
for (const r of roots) { try { walk(r); } catch {} }
if (bad.length) {
  console.error("FAIL: still querying the nonexistent knowledge_base_entries table in:\n  " + bad.join("\n  "));
  process.exit(1);
}
console.log("OK: no production code queries knowledge_base_entries");
