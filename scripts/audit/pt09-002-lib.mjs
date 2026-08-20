// Shared helpers for PT-09-002 per-agent execution-proof scripts.
// Every trigger-*.mjs script for batch 1 (AG-01..AG-21) imports this.
//
// IMPORTANT: this module points the real app's createAdminClient()-style env
// vars at the LOCAL pt05-local-stack, never production. Call
// assertLocalTargetSafe() before doing anything else in every script.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import dotenv from "dotenv";
import ws from "ws";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..", "..");

export const PRODUCTION_REF = "vbjplpquqxxfbpazyalt";
export const LOCAL_DB_URL = "postgresql://postgres:postgres@127.0.0.1:56322/postgres";
export const LOCAL_API_URL = "http://127.0.0.1:56321";
export const LOCAL_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

/**
 * Loads real secrets (ANTHROPIC_API_KEY, GOOGLE_PLACES_API_KEY, etc.) from
 * .env.local, then FORCIBLY overrides the Supabase target env vars to point
 * at the local pt05-local-stack. Must be called before importing any agent
 * source file that calls createAdminClient() / createClient().
 */
export function setupLocalEnv() {
  dotenv.config({ path: path.join(REPO_ROOT, ".env.local") });
  process.env.NEXT_PUBLIC_SUPABASE_URL = LOCAL_API_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = LOCAL_SERVICE_ROLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = LOCAL_SERVICE_ROLE_KEY;
  assertLocalTargetSafe();
}

export function assertLocalTargetSafe() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (url.includes(PRODUCTION_REF) || url.includes("supabase.co")) {
    throw new Error(
      `REFUSING: NEXT_PUBLIC_SUPABASE_URL ("${url}") looks like production/cloud, not the local stack.`,
    );
  }
  if (!url.includes("127.0.0.1") && !url.includes("localhost")) {
    throw new Error(`REFUSING: NEXT_PUBLIC_SUPABASE_URL ("${url}") is not a local target.`);
  }
}

/** Loads test-evidence/pt-09/environment.json (org id, funders, opportunities, etc). */
export function loadEnvironment() {
  const p = path.join(REPO_ROOT, "test-evidence", "pt-09", "environment.json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/** Direct pg connection to the local stack, for before/after row counting
 * independent of whatever client the agent code itself uses. */
export async function pgClient() {
  assertLocalTargetSafe();
  const client = new Client({ connectionString: LOCAL_DB_URL });
  await client.connect();
  return client;
}

/** Row count for a table, optionally filtered by a simple WHERE column=value. */
export async function countRows(client, table, whereCol, whereVal) {
  let q = `select count(*)::int as n from ${table}`;
  const params = [];
  if (whereCol) {
    params.push(whereVal);
    q += ` where ${whereCol} = $1`;
  }
  const r = await client.query(q, params);
  return r.rows[0].n;
}

/** Most recently created row in a table (by created_at desc, falling back to id). */
export async function latestRow(client, table, whereCol, whereVal, orderCol = "created_at") {
  let q = `select * from ${table}`;
  const params = [];
  if (whereCol) {
    params.push(whereVal);
    q += ` where ${whereCol} = $1`;
  }
  q += ` order by ${orderCol} desc nulls last limit 1`;
  const r = await client.query(q, params);
  return r.rows[0] ?? null;
}

/** Service-role Supabase client pointed at the local stack. Node 20 has no
 * native WebSocket, so the realtime transport is supplied explicitly --
 * same workaround src/lib/supabase/admin.ts uses in the real app. */
export function makeLocalSupabaseClient() {
  assertLocalTargetSafe();
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws },
  });
}

/** Writes one agent's result object into its own JSON file so parallel
 * group scripts never race on a shared output file. Merged later by
 * pt09-002-merge-results.mjs into execution-batch1.json. */
export function writeAgentResult(canonicalNumber, result) {
  const dir = path.join(REPO_ROOT, "test-evidence", "pt-09", "batch1-results");
  fs.mkdirSync(dir, { recursive: true });
  const safe = canonicalNumber.replace(/[^A-Za-z0-9_-]/g, "_");
  const file = path.join(dir, `${safe}.json`);
  fs.writeFileSync(file, JSON.stringify(result, null, 2), "utf8");
  console.log(`Wrote ${file}`);
  return file;
}
