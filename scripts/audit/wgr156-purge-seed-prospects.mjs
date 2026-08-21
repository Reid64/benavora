// WGR-156 remediation: delete SEED donor_discovery_prospects rows for the
// target org in batches of 5000, one transaction per batch. SEED = no
// engagement signal at all: pipeline_stage still 'new' AND score,
// score_rationale, notes, assigned_to all null. (dd_prospect_requests was
// investigated and excluded as a KEEP signal: every single prospect for
// this org has exactly one row there, all pointing at the same bulk-seed
// request id, so "has a row" is non-discriminating here -- see
// test-evidence/remediation/wgr-156/ for the full investigation.)
// ON DELETE CASCADE on dd_prospect_requests.prospect_id means no separate
// cleanup of that table is needed.
import { Client } from "pg";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const ORG_ID = "b1ab7402-dfc2-4712-869f-70ea3566cc1d";
const BATCH_SIZE = 5000;

const SEED_WHERE = `
  organization_id = $1
  AND pipeline_stage = 'new'
  AND score IS NULL
  AND score_rationale IS NULL
  AND notes IS NULL
  AND assigned_to IS NULL
`;

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  let totalDeleted = 0;
  let batchNum = 0;

  for (;;) {
    batchNum++;
    await client.query("BEGIN");
    try {
      const idsRes = await client.query(
        `SELECT id FROM donor_discovery_prospects WHERE ${SEED_WHERE} ORDER BY id LIMIT ${BATCH_SIZE}`,
        [ORG_ID],
      );
      const ids = idsRes.rows.map((r) => r.id);
      if (ids.length === 0) {
        await client.query("COMMIT");
        break;
      }
      const delRes = await client.query(
        `DELETE FROM donor_discovery_prospects WHERE id = ANY($1::uuid[])`,
        [ids],
      );
      await client.query("COMMIT");
      totalDeleted += delRes.rowCount;
      console.log(`batch ${batchNum}: deleted ${delRes.rowCount} (running total ${totalDeleted})`);
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`batch ${batchNum} FAILED, rolled back:`, err.message);
      throw err;
    }
  }

  const remainingRes = await client.query(
    "SELECT count(*) FROM donor_discovery_prospects WHERE organization_id = $1",
    [ORG_ID],
  );
  const stageRes = await client.query(
    "SELECT pipeline_stage, count(*) FROM donor_discovery_prospects WHERE organization_id = $1 GROUP BY pipeline_stage ORDER BY pipeline_stage",
    [ORG_ID],
  );

  console.log(JSON.stringify({
    totalDeleted,
    remainingForOrg: Number(remainingRes.rows[0].count),
    perStage: stageRes.rows.map((r) => ({ stage: r.pipeline_stage, count: Number(r.count) })),
  }, null, 2));

  await client.end();
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
