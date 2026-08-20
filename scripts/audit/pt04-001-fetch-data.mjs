import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';

const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  await client.connect();

  // Find a real, already-scored opportunity_probability_scores row with a
  // full complement of underlying real data (non-null eligibility_score,
  // non-null deadline, non-null twin_completeness_score, and at least one
  // outcome in the same funder_category) so every factor branch is
  // exercised by real data, not a neutral-fallback default.
  const candidatesRes = await client.query(`
    SELECT
      ops.opportunity_id,
      ops.organization_id,
      ops.overall_score,
      ops.confidence,
      ops.factors,
      ops.recommendation,
      ops.key_risks,
      ops.key_strengths,
      ops.estimated_roi,
      ops.time_to_complete,
      ops.computed_at,
      o.category,
      o.deadline,
      o.eligibility_score,
      o.name AS opportunity_name,
      t.twin_completeness_score,
      (
        SELECT count(*) FROM outcomes out
        WHERE out.organization_id = ops.organization_id
          AND out.funder_category = o.category
      ) AS outcome_count
    FROM opportunity_probability_scores ops
    JOIN opportunities o ON o.id = ops.opportunity_id
    LEFT JOIN organizational_digital_twins t ON t.organization_id = ops.organization_id
    WHERE o.eligibility_score IS NOT NULL
      AND o.deadline IS NOT NULL
      AND t.twin_completeness_score IS NOT NULL
    ORDER BY ops.computed_at DESC
    LIMIT 25;
  `);

  console.log(`Found ${candidatesRes.rows.length} candidate rows with full real underlying data.`);
  for (const row of candidatesRes.rows) {
    console.log(
      `  opp=${row.opportunity_id} org=${row.organization_id} score=${row.overall_score} ` +
      `elig=${row.eligibility_score} deadline=${row.deadline} twin=${row.twin_completeness_score} ` +
      `outcomes(same category)=${row.outcome_count} category=${row.category}`
    );
  }

  const outPath = path.join(process.cwd(), 'test-evidence', 'pt-04', 'candidates-raw.json');
  fs.writeFileSync(outPath, JSON.stringify(candidatesRes.rows, (k, v) => typeof v === 'bigint' ? v.toString() : v, 2));
  console.log(`Wrote ${outPath}`);

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
