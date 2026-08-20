// Branch/local-stack verification of the WGR-130/WGR-131 fix (migration
// 141_application_stage_transition_trigger.sql). Reproduces the EXACT
// bypass shape the original findings used — a raw
// supabase.from('applications').update({stage}) call, no executeTransition()
// involved — against a real (local-stack) database with the trigger applied,
// and proves:
//   1. A legal transition (the real next stage) SUCCEEDS.
//   2. An illegal skip (discovered -> awarded, WGR-131's exact repro shape)
//      is REJECTED at the DB layer, with the trigger's own error surfaced
//      through PostgREST — not silently swallowed, not app-code-dependent.
//
// Run against a local Supabase stack (`.pt05-local-stack`) or a real cloud
// branch — pass the REST URL / service key via env, defaults match the
// already-running `.pt05-local-stack` used by this session.
//
// Run: node scripts/audit/statemachine-fix-branch-verify.mjs

import fs from "node:fs";
import path from "node:path";

const REST_URL = process.env.STACK_URL ?? "http://127.0.0.1:56321";
const SERVICE_KEY =
  process.env.STACK_SERVICE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const OUT_DIR = path.join(process.cwd(), "test-evidence", "remediation", "statemachine-fix");
fs.mkdirSync(OUT_DIR, { recursive: true });

// Raw PostgREST calls (not supabase-js) — this is exactly the shape
// WGR-130/131's own findings used ("a raw supabase.from('applications')
// .update({stage:...}) call" is itself a PostgREST PATCH under the hood),
// and sidesteps supabase-js's realtime module, which requires a native
// WebSocket global this Node 20 environment doesn't provide.
async function restFetch(pathAndQuery, init = {}) {
  const res = await fetch(`${REST_URL}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, ok: res.ok, json, text };
}

async function main() {
  const results = { capturedAt: new Date().toISOString(), stack: REST_URL };

  const found = await restFetch("applications?select=id,organization_id,stage&stage=eq.discovered&limit=2");
  const discoveredRows = found.json;

  if (!found.ok || !Array.isArray(discoveredRows) || discoveredRows.length < 2) {
    console.error("Could not find 2 real 'discovered' rows to test against:", found.status, found.text);
    process.exit(1);
  }

  const [legalRow, illegalRow] = discoveredRows;

  // --- 1. Legal transition: discovered -> eligibility_review (the real next
  //        stage per pipeline.ts's FORWARD const) — raw PATCH, no
  //        executeTransition() call, exactly like WGR-130/131's own repro.
  const legalRes = await restFetch(`applications?id=eq.${legalRow.id}`, {
    method: "PATCH",
    body: JSON.stringify({ stage: "eligibility_review" }),
  });
  const legalAfter = Array.isArray(legalRes.json) ? legalRes.json[0] : null;

  results.legalTransition = {
    applicationId: legalRow.id,
    from: "discovered",
    to: "eligibility_review",
    expected: "SUCCEED",
    http_status: legalRes.status,
    write_error: legalRes.ok ? null : legalRes.json ?? legalRes.text,
    stage_after: legalAfter?.stage ?? null,
    outcome: legalRes.ok && legalAfter?.stage === "eligibility_review" ? "PERSISTED (correct)" : "UNEXPECTED",
  };

  // --- 2. Illegal skip: discovered -> awarded (WGR-131's exact repro:
  //        skips 10 of 12 stages in one raw write, no executeTransition()).
  const illegalRes = await restFetch(`applications?id=eq.${illegalRow.id}`, {
    method: "PATCH",
    body: JSON.stringify({ stage: "awarded" }),
  });

  // Re-read independently to confirm the write really didn't land (don't
  // trust the PATCH response alone).
  const rereadRes = await restFetch(`applications?select=id,stage&id=eq.${illegalRow.id}`);
  const reread = Array.isArray(rereadRes.json) ? rereadRes.json[0] : null;

  results.illegalTransition = {
    applicationId: illegalRow.id,
    from: "discovered",
    to: "awarded",
    expected: "REJECTED",
    http_status: illegalRes.status,
    write_error: illegalRes.ok ? null : illegalRes.json ?? illegalRes.text,
    stage_after_independent_reread: reread?.stage ?? null,
    outcome:
      !illegalRes.ok && reread?.stage === "discovered"
        ? "REJECTED (correct — trigger blocked it, stage unchanged)"
        : "UNEXPECTED — illegal write was NOT blocked",
  };

  results.summary = {
    legalTransitionPassed: results.legalTransition.outcome === "PERSISTED (correct)",
    illegalTransitionBlocked: results.illegalTransition.outcome.startsWith("REJECTED"),
  };
  results.summary.allPassed =
    results.summary.legalTransitionPassed && results.summary.illegalTransitionBlocked;

  const outFile = path.join(OUT_DIR, "statemachine-branch-verify.json");
  fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));

  if (!results.summary.allPassed) process.exit(1);
}

main();
