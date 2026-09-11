import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(__dirname, "../../.env.local"), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const idx = l.indexOf("=");
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    }),
);
const sql = fs.readFileSync(
  path.join(__dirname, "../../supabase/migrations/149_success_probability_scores_unique_constraint.sql"),
  "utf8",
);

const client = new pg.Client({ connectionString: env.DATABASE_URL });
await client.connect();
console.log("connected as", (await client.query("select current_user, current_database()")).rows[0]);
await client.query(sql);
console.log("migration 149 applied");
const check = await client.query(
  `SELECT conname FROM pg_constraint WHERE conrelid = 'success_probability_scores'::regclass AND contype='u'`,
);
console.log("unique constraints now:", check.rows);
await client.end();
