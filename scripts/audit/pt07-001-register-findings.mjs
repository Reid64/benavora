// ============================================================================
// PT-07-001 — register the real finding from
// test-evidence/pt-07/supabase-state.json into the WIRING_GAP_REGISTER.
//
// One finding registered: the Realtime publication-membership gap
// (db/auth/storage all PASS'd cleanly and have no defect to register).
//
// This closes a gap in the register itself, not just in the app: the
// underlying bug (supabase_realtime publication has zero member tables) was
// already documented once before, in STATE_OF_THE_BUILD.md's 2026-08-07
// "Command Center Realtime" session entry -- but that entry was never
// promoted into WIRING_GAP_REGISTER.md, and a fresh, independent live query
// this session (2026-08-20, ~2 weeks later) confirms the same root cause
// still holds today, now against the full, current set of tables the app
// subscribes to (7, not the 3 checked in that August 7 session).
//
// Usage: node scripts/audit/pt07-001-register-findings.mjs
// ============================================================================

import { appendFindingRow } from "./evidence-lib.mjs";

const EVIDENCE = "test-evidence/pt-07/supabase-state.json";
const REPRO =
  "node scripts/audit/pt07-001-supabase-state-probe.mjs (re-runs the real live checks); " +
  "node scripts/audit/verify-pt07-001.mjs (validates the captured evidence); or directly: " +
  "SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' against " +
  "DATABASE_URL (real response captured this session: zero rows) compared against a grep of " +
  "src/components/autoapply/*.tsx, src/components/command-center/CommandCenterLive.tsx, and " +
  "src/app/api/admin/command-center/route.ts for .channel(...).on(\"postgres_changes\", ...) " +
  "table names.";

const findings = [
  {
    id: "WGR-148",
    layer: "Data/Realtime",
    severity: "P1",
    description:
      "The `supabase_realtime` Postgres publication has ZERO member tables in production -- " +
      "confirmed live via a direct query of pg_publication_tables (the publication itself exists, " +
      "it just has no tables attached to it). Cross-referenced against every table this app's own " +
      "source code subscribes to via `.channel(...).on(\"postgres_changes\", ...)` " +
      "(src/components/autoapply/{ManualQueue,WorkerStatus,QueueMetrics,ReviewQueue,QueuePanel}.tsx " +
      "and src/components/command-center/CommandCenterLive.tsx, whose backing snapshot is " +
      "src/app/api/admin/command-center/route.ts): submission_queue, autoapply_submissions, " +
      "autoapply_review_queue, worker_status, agent_runs, agent_decisions, applications -- all 7 of " +
      "7 subscribed tables are absent from the publication, so Realtime silently never emits a " +
      "change event for any of them; no error is raised anywhere, the subscribing component simply " +
      "never receives a push update. This is not a new bug: STATE_OF_THE_BUILD.md's own 2026-08-07 " +
      "'Command Center Realtime' session entry already documented the identical root cause " +
      "(publication has zero member tables) for a 3-table subset (agent_runs, agent_decisions, " +
      "applications) and proposed the one-line fix (`ALTER PUBLICATION supabase_realtime ADD TABLE " +
      "...`) -- that fix was never applied; this session's independent, fresh live query (2026-08-20, " +
      "~2 weeks later) confirms the same gap still holds today, now covering the full, current set " +
      "of 7 subscribed tables across both the Command Center and every AutoApply live-status " +
      "component, none of which were previously registered. Graded P1, not P0: every one of these " +
      "components was built with a documented 60-second polling safety-net fallback specifically " +
      "because Realtime's reliability was already known to be uncertain (per that same 2026-08-07 " +
      "entry's own header comment on QueueMetrics.tsx's precedent), so no page silently shows stale " +
      "data forever -- it just never updates faster than that fallback interval, which is a real, " +
      "confirmed, live UX degradation (no instant push anywhere in the app), not a data-loss or " +
      "blocked-workflow bug. This audit did not independently re-verify that every one of the 7 " +
      "consumers actually has a working fallback poll (only CommandCenterLive.tsx's was directly " +
      "cited in the prior session's own text) -- worth confirming before treating the P1 grading as " +
      "certain for all 7.",
    evidencePath: `${EVIDENCE}#probes.realtime`,
    reproduction: REPRO,
    scopeTag: "CONFIRMED-BROKEN",
  },
];

for (const finding of findings) {
  const row = appendFindingRow(finding);
  console.log(`Appended ${finding.id}: ${row.slice(0, 100)}...`);
}

console.log(`\n${findings.length} finding(s) registered in WIRING_GAP_REGISTER.md.`);
