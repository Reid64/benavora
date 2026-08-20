import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import pg from 'pg';

const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const OPP_ID = '8851652c-2def-4bc3-8428-308c4f23fd0b';
const ORG_ID = 'b1ab7402-dfc2-4712-869f-70ea3566cc1d';

async function main() {
  await client.connect();

  const opp = await client.query(
    `SELECT id, name, category, deadline, eligibility_score, created_at, updated_at
     FROM opportunities WHERE id = $1 AND organization_id = $2`,
    [OPP_ID, ORG_ID]
  );
  console.log('opportunities row:', JSON.stringify(opp.rows[0], null, 2));

  const twin = await client.query(
    `SELECT organization_id, twin_completeness_score, updated_at
     FROM organizational_digital_twins WHERE organization_id = $1`,
    [ORG_ID]
  );
  console.log('twin row:', JSON.stringify(twin.rows[0], null, 2));

  const outcomes = await client.query(
    `SELECT id, result, funder_category, created_at
     FROM outcomes WHERE organization_id = $1 AND funder_category = $2`,
    [ORG_ID, opp.rows[0].category]
  );
  console.log(`outcomes rows for category=${opp.rows[0].category}:`, JSON.stringify(outcomes.rows, null, 2));

  const ops = await client.query(
    `SELECT * FROM opportunity_probability_scores WHERE opportunity_id = $1 AND organization_id = $2`,
    [OPP_ID, ORG_ID]
  );
  console.log('opportunity_probability_scores row:', JSON.stringify(ops.rows[0], null, 2));

  await client.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
