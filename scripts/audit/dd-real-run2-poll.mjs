// Polls the real Donor Discovery request every 30s for up to 20 minutes,
// recording every status transition with a real timestamp.
import dotenv from "dotenv";
import { Client } from "pg";
import { writeFileSync } from "node:fs";

dotenv.config({ path: ".env.local" });

const REQUEST_ID = "f4870e28-5acd-4b92-a1d2-3e326b98d704";
const POLL_INTERVAL_MS = 30_000;
const MAX_DURATION_MS = 20 * 60_000;
const TERMINAL_STATUSES = new Set(["complete", "failed"]);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  let lastStatus = null;
  const transitions = [];
  const start = Date.now();

  for (;;) {
    const now = new Date().toISOString();
    const elapsedMs = Date.now() - start;

    const res = await client.query(
      "SELECT status, counts, completed_at FROM donor_discovery_requests WHERE id = $1",
      [REQUEST_ID],
    );
    const row = res.rows[0];
    if (row && row.status !== lastStatus) {
      const entry = { at: now, elapsedMs, status: row.status, counts: row.counts };
      transitions.push(entry);
      lastStatus = row.status;
      console.log(`[${now}] ${REQUEST_ID} -> ${row.status} :: ${JSON.stringify(row.counts)}`);
    }

    writeFileSync(
      "test-evidence/remediation/dd-real-run-2/poll-transitions.json",
      JSON.stringify({ requestId: REQUEST_ID, transitions, lastStatus, elapsedMs }, null, 2),
    );

    if (row && TERMINAL_STATUSES.has(row.status)) {
      console.log("Request reached a terminal status.");
      break;
    }
    if (elapsedMs >= MAX_DURATION_MS) {
      console.log("20 minute poll window elapsed; stopping.");
      break;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  await client.end();
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
