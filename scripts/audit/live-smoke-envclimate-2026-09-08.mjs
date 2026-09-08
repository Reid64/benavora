import { searchEnvironmentalClimateGrants } from "../../src/lib/agents/environmental-climate-grants.ts";
console.log("START", new Date().toISOString());
try {
  const results = await searchEnvironmentalClimateGrants();
  console.log("total deduped opportunities:", results.length);
  console.log(JSON.stringify(results.slice(0, 3), null, 2));
} catch (e) {
  console.error("FAILED:", e);
  process.exitCode = 1;
}
console.log("END", new Date().toISOString());
