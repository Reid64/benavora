import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';

const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  await client.connect();

  const colsRes = await client.query(`
    SELECT table_name, column_name, data_type, is_nullable, column_default, ordinal_position
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position;
  `);

  const tablesRes = await client.query(`
    SELECT table_name, table_type
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name;
  `);

  const tableTypeMap = {};
  for (const row of tablesRes.rows) {
    tableTypeMap[row.table_name] = row.table_type;
  }

  const schema = {};
  for (const row of colsRes.rows) {
    if (!schema[row.table_name]) {
      schema[row.table_name] = {
        table_type: tableTypeMap[row.table_name] || 'UNKNOWN',
        columns: [],
      };
    }
    schema[row.table_name].columns.push({
      column_name: row.column_name,
      data_type: row.data_type,
      is_nullable: row.is_nullable,
      column_default: row.column_default,
      ordinal_position: row.ordinal_position,
    });
  }

  const output = {
    generated_at: new Date().toISOString(),
    database: 'postgres (production, vbjplpquqxxfbpazyalt)',
    method: 'direct psql/pg query via DATABASE_URL against information_schema.columns/tables, public schema',
    table_count: Object.keys(schema).length,
    total_column_count: colsRes.rows.length,
    tables: schema,
  };

  const outPath = path.join('test-evidence', 'pt-06', 'live-schema.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`Wrote ${outPath}: ${output.table_count} tables, ${output.total_column_count} columns`);

  await client.end();
}

main().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
