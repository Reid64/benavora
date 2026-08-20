// Shared helpers for PT-09-003 per-agent execution-proof scripts (batch 2,
// AG-22..AG-43 real numbering per pt09-001, plus the suspect deep-dive).
// Every trigger-*.mjs script under scripts/audit/pt09-003-trigger/ imports this.
//
// Re-exports the same generic, batch-agnostic helpers pt09-002-lib.mjs already
// proved out for batch 1 (env setup against the LOCAL pt05-local-stack only, a
// direct `pg` connection for before/after row counting independent of whatever
// client the agent code itself uses, environment.json loading, a local-only
// service-role Supabase client) -- only writeAgentResult() is batch-2-specific,
// since it needs to land in batch2-results/ instead of batch1-results/ so the two
// batches' per-agent evidence files never collide.
//
// IMPORTANT: this module points the real app's createAdminClient()-style env
// vars at the LOCAL pt05-local-stack, never production. Call
// assertLocalTargetSafe() before doing anything else in every script (already
// called internally by setupLocalEnv()).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  REPO_ROOT,
  PRODUCTION_REF,
  LOCAL_DB_URL,
  LOCAL_API_URL,
  LOCAL_SERVICE_ROLE_KEY,
  setupLocalEnv,
  assertLocalTargetSafe,
  loadEnvironment,
  pgClient,
  countRows,
  latestRow,
  makeLocalSupabaseClient,
} from "./pt09-002-lib.mjs";

export {
  REPO_ROOT,
  PRODUCTION_REF,
  LOCAL_DB_URL,
  LOCAL_API_URL,
  LOCAL_SERVICE_ROLE_KEY,
  setupLocalEnv,
  assertLocalTargetSafe,
  loadEnvironment,
  pgClient,
  countRows,
  latestRow,
  makeLocalSupabaseClient,
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Writes one agent's result object into its own JSON file so parallel
 * group scripts never race on a shared output file. Merged later by
 * pt09-003-merge-results.mjs into execution-batch2.json. */
export function writeAgentResult(canonicalNumber, result) {
  const dir = path.join(REPO_ROOT, "test-evidence", "pt-09", "batch2-results");
  fs.mkdirSync(dir, { recursive: true });
  const safe = canonicalNumber.replace(/[^A-Za-z0-9_-]/g, "_");
  const file = path.join(dir, `${safe}.json`);
  fs.writeFileSync(file, JSON.stringify(result, null, 2), "utf8");
  console.log(`Wrote ${file}`);
  return file;
}
