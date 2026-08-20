// PT-09-002 execution proof: AG-11 (canonical)
// (cold_outreach / src/lib/agents/cold-outreach.ts)
//
// Confirmed SAFE to run for real (per task instructions): this file only
// fetches a company's own public website server-side and calls Claude to
// extract contact info -- no outbound email/SMS is sent by this file. Grepped
// for resend./sendgrid/twilio/nodemailer/smtp./submitViaEmail -- none present.
//
// Real trigger: manual, user-initiated from the Sales Outreach / Donor
// Discovery UI (registry description, not independently re-verified live).
//
// Uses a real, publicly reachable website (a real Central-Texas chamber of
// commerce site, thematically consistent with the seeded test org) rather
// than the seeded corporateProspects' *.example placeholder domains, so the
// fetch+extract path is genuinely exercised end-to-end, not just its
// graceful-degradation stub-row fallback.
//
// Usage: npx tsx scripts/audit/pt09-002-trigger/AG-11.mjs

import {
  setupLocalEnv,
  loadEnvironment,
  pgClient,
  countRows,
  latestRow,
  writeAgentResult,
  makeLocalSupabaseClient,
} from "../pt09-002-lib.mjs";

setupLocalEnv();

const { ColdOutreachAgent } = await import("../../../src/lib/agents/cold-outreach.ts");

const CANONICAL = "AG-11";
const WRITE_TABLES = ["outreach_contacts", "agent_runs"];

async function main() {
  const env = loadEnvironment();
  const orgId = env.org.orgId;

  const db = await pgClient();
  const before = {};
  for (const t of WRITE_TABLES) before[t] = await countRows(db, t, "organization_id", orgId);

  const supabase = makeLocalSupabaseClient();
  const log = [];
  let errorSurfaced = null;
  let runOutcome = null;

  try {
    const agent = new ColdOutreachAgent({ client: supabase, organizationId: orgId });
    runOutcome = await agent.run({
      companyName: "Georgetown Chamber of Commerce",
      websiteUrl: "https://www.georgetownchamber.org",
    });
    log.push(`agent.run() resolved: runId=${runOutcome.runId} tokensUsed=${runOutcome.tokensUsed} durationMs=${runOutcome.durationMs}`);
    log.push(`data: ${JSON.stringify(runOutcome.data)}`);
  } catch (err) {
    errorSurfaced = err instanceof Error ? (err.stack ?? err.message) : String(err);
    log.push(`THREW: ${errorSurfaced}`);
  }

  const after = {};
  for (const t of WRITE_TABLES) after[t] = await countRows(db, t, "organization_id", orgId);

  const contactRows = (
    await db.query(
      "select * from outreach_contacts where organization_id = $1 and company_name = $2 order by created_at desc",
      [orgId, "Georgetown Chamber of Commerce"],
    )
  ).rows;
  const runRow = runOutcome?.runId
    ? (await db.query("select * from agent_runs where id = $1", [runOutcome.runId])).rows[0]
    : null;

  await db.end();

  const delta = {};
  for (const t of WRITE_TABLES) delta[t] = after[t] - before[t];

  const hasRealChannel = contactRows.some(
    (c) => c.email || c.phone || c.contact_form_url || c.contact_name,
  );

  let verdict;
  let reasoning;
  if (errorSurfaced) {
    verdict = "ERROR-SWALLOWED";
    reasoning = "agent.run() threw; caught by this harness (not silently swallowed by the app), but no successful write occurred.";
  } else if (delta.outreach_contacts > 0 && contactRows.length > 0) {
    verdict = "WORKS";
    reasoning = hasRealChannel
      ? `${contactRows.length} outreach_contacts row(s) written with real extracted channel data (email/phone/contact form/name) from ` +
        "a live fetch of the company's real website -- matches AG-11's documented intent exactly."
      : `${contactRows.length} outreach_contacts row(s) written, but the website fetch/extraction found no usable contact channel, so this ` +
        "landed in the agent's own documented graceful-degradation path (a single company-level stub lead, giving_likelihood='low'). " +
        "Still a real row with a genuine company_name/source_url, not a crash -- counted as WORKS since this is the agent's own " +
        "documented fallback behavior, not a broken write.";
  } else if (delta.agent_runs > 0) {
    verdict = "WIRED-NO-OUTPUT";
    reasoning = "agent_runs row was written (the run executed) but zero outreach_contacts rows landed -- the insert itself must have failed silently or been skipped.";
  } else {
    verdict = "TRIGGER-BROKEN";
    reasoning = "Neither agent_runs nor outreach_contacts changed, and no error was surfaced.";
  }

  const result = {
    canonicalNumber: CANONICAL,
    registryAgentId: "cold_outreach",
    implementingFile: "src/lib/agents/cold-outreach.ts",
    writeTargetTables: WRITE_TABLES,
    triggerMethod:
      "Direct class invocation via tsx against the local pt05-local-stack: new ColdOutreachAgent({ client, organizationId }).run({ companyName, websiteUrl }) " +
      "against a real, publicly reachable company website. Matches AG-11's real (manual, user-initiated) trigger path.",
    before,
    after,
    rowDelta: delta,
    sampleWrittenRow: {
      outreach_contacts_rows: contactRows,
      agent_runs_row: runRow ?? null,
    },
    triggerLog: log.join("\n"),
    errorSurfaced,
    verdict,
    verdictReasoning: reasoning,
    registryPriorStatus:
      "FEATURE_REGISTRY_v2.md row #15: 'Cold Outreach | Extract contacts from companies without giving pages. Outreach contact table. " +
      "Convert to funder. | BUILT'.",
    falsePassCasualty: verdict === "WIRED-NO-OUTPUT",
  };

  writeAgentResult(CANONICAL, result);
  console.log(`\nVerdict for ${CANONICAL}: ${verdict}`);
}

main().catch((err) => {
  console.error("FATAL (harness-level, not agent-level):", err);
  process.exit(1);
});
