// PT-09-003 execution proof: AG-27 (Board Meeting Packet Agent)
// registryAgentId ag-27-board-packet / src/lib/agents/board-packet-agent.ts
//
// Trigger method: direct class invocation, AutonomousAgent family --
// new BoardPacketAgent(orgId, supabase).run('manual', [meetingId]). Real
// code: resolveMeetings() only resolves an explicit meetingIds[] argument
// (or an event-trigger scope) -- a bare 'manual' call with no meetingIds
// resolves to [] by design, so this script seeds a real board_meetings row
// first and passes its id explicitly, exercising the same meetingIds path
// worker/autonomous-orchestrator.ts's 'AG-27 board packet daily pipeline'
// job and the POST /api/autonomous/board-packet-trigger route both use.
//
// Usage: node --import tsx scripts/audit/pt09-003-trigger/AG-27.mjs

import {
  setupLocalEnv,
  loadEnvironment,
  pgClient,
  countRows,
  writeAgentResult,
  makeLocalSupabaseClient,
} from "../pt09-003-lib.mjs";

setupLocalEnv();

const { BoardPacketAgent } = await import(
  "../../../src/lib/agents/board-packet-agent.ts"
);

const CANONICAL = "AG-27";
const WRITE_TABLES = ["agent_runs", "agent_decisions", "agent_queue", "board_meeting_packets"];

async function main() {
  const env = loadEnvironment();
  const orgId = env.org.orgId;

  const db = await pgClient();

  const seeded = await db.query(
    `insert into board_meetings (org_id, meeting_date, meeting_type, agenda, status)
     values ($1, (current_date + interval '10 days')::date, 'quarterly', 'PT-09-003 seeded agenda for board packet execution proof', 'scheduled')
     returning id`,
    [orgId],
  );
  const meetingId = seeded.rows[0].id;

  const before = {
    agent_runs: await countRows(db, "agent_runs", "agent_type", "ag-27-board-packet"),
    board_meeting_packets: await countRows(db, "board_meeting_packets", "org_id", orgId),
  };

  const supabase = makeLocalSupabaseClient();

  const log = [`Seeded board_meetings row ${meetingId} for a real meetingIds[] argument.`];
  let errorSurfaced = null;
  let result_ = null;

  try {
    const agent = new BoardPacketAgent(orgId, supabase);
    result_ = await agent.run("manual", [meetingId]);
    log.push(`agent.run("manual", ["${meetingId}"]) resolved: ${JSON.stringify(result_)}`);
  } catch (err) {
    errorSurfaced = err instanceof Error ? (err.stack ?? err.message) : String(err);
    log.push(`THREW: ${errorSurfaced}`);
  }

  const after = {
    agent_runs: await countRows(db, "agent_runs", "agent_type", "ag-27-board-packet"),
    board_meeting_packets: await countRows(db, "board_meeting_packets", "org_id", orgId),
  };

  const runRow = (
    await db.query(
      "select * from agent_runs where agent_type='ag-27-board-packet' and organization_id=$1 order by created_at desc limit 1",
      [orgId],
    )
  ).rows[0] ?? null;
  const packetRows = (
    await db.query("select * from board_meeting_packets where org_id=$1 order by generated_at desc limit 3", [orgId])
  ).rows;

  await db.end();

  const delta = {};
  for (const k of Object.keys(before)) delta[k] = after[k] - before[k];

  let verdict;
  let reasoning;
  if (errorSurfaced) {
    verdict = "ERROR-SWALLOWED";
    reasoning = `agent.run() threw past this harness: ${errorSurfaced}.`;
  } else if (delta.board_meeting_packets > 0 && packetRows[0]) {
    verdict = "WORKS";
    const p = packetRows[0];
    reasoning = `board_meeting_packets row written for the real seeded meeting ${meetingId}: packet_content keys=${JSON.stringify(Object.keys(p.packet_content ?? {}))}. itemsFound=${result_.itemsFound}, itemsProcessed=${result_.itemsProcessed}.`;
  } else if (delta.agent_runs > 0) {
    verdict = "WIRED-NO-OUTPUT";
    reasoning = `agent_runs completed cleanly (itemsFound=${result_?.itemsFound}, itemsProcessed=${result_?.itemsProcessed}, errors=${JSON.stringify(result_?.errors)}) but zero board_meeting_packets rows landed for the real seeded meeting ${meetingId}.`;
  } else {
    verdict = "TRIGGER-BROKEN";
    reasoning = `No agent_runs, agent_decisions, or board_meeting_packets activity for meeting ${meetingId}, and no error was surfaced.`;
  }

  const resultObj = {
    canonicalNumber: CANONICAL,
    registryAgentId: "ag-27-board-packet",
    implementingFile: "src/lib/agents/board-packet-agent.ts",
    writeTargetTables: WRITE_TABLES,
    triggerMethod:
      "Direct class invocation via tsx against the local pt05-local-stack: new BoardPacketAgent(orgId, supabase).run('manual', [meetingId]) against a real, freshly-seeded board_meetings row (resolveMeetings() only resolves an explicit meetingIds[] argument or an event-trigger scope -- a bare manual call with no meetingIds resolves to [] by design). Real trigger path: WIRED-SCHEDULED+QUEUE (worker/scheduler.ts daily job + POST /api/autonomous/board-packet-trigger + routeQueueItem() case 'ag-27-board-packet').",
    before,
    after,
    rowDelta: delta,
    sampleWrittenRow: {
      board_meeting_packets_rows: packetRows,
      agent_runs_row: runRow,
      seeded_board_meeting_id: meetingId,
    },
    triggerLog: log.join("\n"),
    errorSurfaced,
    verdict,
    verdictReasoning: reasoning,
    registryPriorStatus:
      "See test-evidence/pt-09/agent-inventory.json triggerWiredVerdict: WIRED-SCHEDULED+QUEUE.",
    falsePassCasualty: verdict === "WIRED-NO-OUTPUT" || verdict === "TRIGGER-BROKEN" || verdict === "ERROR-SWALLOWED",
  };

  writeAgentResult(CANONICAL, resultObj);
  console.log(`\nVerdict for ${CANONICAL}: ${verdict}`);
}

main().catch((err) => {
  console.error("FATAL (harness-level, not agent-level):", err);
  process.exit(1);
});
