import { searchHealthGrants, HHS_FAMILY_AGENCY_CODES, HEALTH_FUNDING_CATEGORIES } from "../../src/lib/agents/health-grants.ts";

console.log("START", new Date().toISOString());

try {
  const results = await searchHealthGrants();
  console.log("agencies used:", HHS_FAMILY_AGENCY_CODES.length, "codes");
  console.log("categories used:", HEALTH_FUNDING_CATEGORIES);
  console.log("total deduped opportunities:", results.length);
  console.log(JSON.stringify(results.slice(0, 5), null, 2));
} catch (e) {
  console.error("SMOKE TEST FAILED:", e);
  process.exitCode = 1;
}

console.log("END", new Date().toISOString());
