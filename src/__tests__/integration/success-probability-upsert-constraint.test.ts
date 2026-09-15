import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

/**
 * Regression test for WGR-170 (p5a-004, 2026-09-15).
 *
 * success-probability.ts's execute() upserts into success_probability_scores
 * with `{ onConflict: "application_id" }`. WGR-170 was an earlier report that
 * this target didn't match any real unique constraint (Postgres 42P10). Live
 * data confirms the failure was real: 100 failed runs between 2026-08-19 and
 * 2026-09-11 (78% failure rate), then 29/29 successful runs from
 * 2026-09-11T16:17Z onward — the constraint below was added live sometime in
 * that window (no matching migration file exists in this repo; same
 * never-committed-DDL pattern found for the agent_type enum values p5a-002
 * wired up). This test guards against the constraint ever being dropped or
 * changed without the code being updated to match, which would silently
 * reintroduce WGR-170.
 *
 * Reproduced directly against the live DB (rolled back, zero rows written)
 * rather than through the full SuccessProbabilityAgent, since the concern is
 * specifically the upsert's conflict target, not the factor-scoring logic
 * upstream of it.
 */

function loadLocalEnv(): Record<string, string> {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return {};
  return dotenv.parse(fs.readFileSync(envPath));
}

const localEnv = loadLocalEnv();
const DATABASE_URL = localEnv.DATABASE_URL;
const CREDS_AVAILABLE = Boolean(DATABASE_URL);

(CREDS_AVAILABLE ? describe : describe.skip)(
  "success_probability_scores upsert — WGR-170 regression guard",
  () => {
    let client: Client;

    beforeAll(async () => {
      client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
      await client.connect();
    });

    afterAll(async () => {
      await client.end();
    });

    it("has a UNIQUE constraint on exactly (application_id) — matches the code's onConflict target", async () => {
      const res = await client.query(
        `SELECT pg_get_constraintdef(con.oid) AS def
         FROM pg_constraint con
         JOIN pg_class rel ON rel.oid = con.conrelid
         WHERE rel.relname = 'success_probability_scores' AND con.contype = 'u'`,
      );
      const defs = res.rows.map((r: { def: string }) => r.def);
      expect(defs).toContain("UNIQUE (application_id)");
    });

    it("a real INSERT ... ON CONFLICT (application_id) DO UPDATE against an existing row succeeds (rolled back)", async () => {
      const existing = await client.query(
        "SELECT organization_id, application_id FROM success_probability_scores WHERE application_id IS NOT NULL LIMIT 1",
      );
      if (existing.rows.length === 0) {
        // No fixture data to exercise the conflict path against in this
        // environment — the constraint-shape assertion above still runs.
        return;
      }
      const { organization_id, application_id } = existing.rows[0] as {
        organization_id: string;
        application_id: string;
      };

      await client.query("BEGIN");
      try {
        await expect(
          client.query(
            `INSERT INTO success_probability_scores
               (organization_id, application_id, probability_score, factors, data_quality, calculated_at, updated_at)
             VALUES ($1, $2, $3, $4::jsonb, $5, now(), now())
             ON CONFLICT (application_id) DO UPDATE SET
               probability_score = EXCLUDED.probability_score,
               factors = EXCLUDED.factors,
               data_quality = EXCLUDED.data_quality,
               calculated_at = EXCLUDED.calculated_at,
               updated_at = EXCLUDED.updated_at`,
            [organization_id, application_id, 42, JSON.stringify({ regressionTest: true }), "full"],
          ),
        ).resolves.toBeDefined();
      } finally {
        await client.query("ROLLBACK");
      }
    });
  },
);
