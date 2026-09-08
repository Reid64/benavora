import { searchEducationTrainingGrants } from "../../src/lib/agents/education-training-grants.ts";
console.log("START", new Date().toISOString());
try {
  const results = await searchEducationTrainingGrants();
  console.log("total deduped opportunities:", results.length);
  console.log(JSON.stringify(results.slice(0, 3), null, 2));
} catch (e) {
  console.error("FAILED:", e);
  process.exitCode = 1;
}
console.log("END", new Date().toISOString());
