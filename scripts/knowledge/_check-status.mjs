import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: ".env.local" });

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const byStatus = await pool.query(`
  SELECT s.rights, d.status, count(*) AS n
  FROM knowledge.documents d JOIN knowledge.sources s ON s.id = d.source_id
  GROUP BY 1, 2 ORDER BY 1, 2
`);
console.log("documents by rights/status:");
console.table(byStatus.rows);

const chunkCount = await pool.query(`SELECT count(*) FROM knowledge.chunks WHERE embedding IS NOT NULL`);
console.log("chunks with embedding:", chunkCount.rows[0].count);

const totalSources = await pool.query(`SELECT count(*) FROM knowledge.sources`);
console.log("total sources:", totalSources.rows[0].count);

await pool.end();
