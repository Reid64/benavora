// Polls both real Donor Discovery requests every 30s for up to 20 minutes,
// recording every status transition with a real timestamp. Queries
// production directly via DATABASE_URL (not the API) so polling itself
// never counts against any rate limit and reflects the exact DB state the
// worker writes.
import dotenv from "dotenv";
import { Client } from "pg";
import { writeFileSync } from "node:fs";

dotenv.config({ path: ".env.local" });

const REQUEST_IDS = {
  A_states: "ea476cf3-a310-4e82-976a-a6950c493cc7",
  B_radius: "9b3b3b51-0dd8-40d1-9e20-c52e1424d6a7",
};

const POLL_INTERVAL_MS = 30_000;
const MAX_DURATION_MS = 20 * 60_000;
const TERMINAL_STATUSES = new Set(["complete", "failed"]);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const lastStatus = { A_states: null, B_radius: null };
  const transitions = { A_states: [], B_radius: [] };
  const start = Date.now();

  for (;;) {
    const now = new Date().toISOString();
    const elapsedMs = Date.now() - start;

    for (const [key, id] of Object.entries(REQUEST_IDS)) {
      const res = await client.query(
        "SELECT status, counts, completed_at FROM donor_discovery_requests WHERE id = $1",
        [id],
      );
      const row = res.rows[0];
      if (!row) continue;
      if (row.status !== lastStatus[key]) {
        const entry = { at: now, elapsedMs, status: row.status, counts: row.counts };
        transitions[key].push(entry);
        lastStatus[key] = row.status;
        console.log(`[${now}] ${key} (${id}) -> ${row.status} :: ${JSON.stringify(row.counts)}`);
      }
    }

    const allTerminal = Object.entries(REQUEST_IDS).every(([key]) =>
      TERMINAL_STATUSES.has(lastStatus[key]),
    );

    writeFileSync(
      "test-evidence/remediation/dd-real-run/poll-transitions.json",
      JSON.stringify({ requestIds: REQUEST_IDS, transitions, lastStatus, elapsedMs }, null, 2),
    );

    if (allTerminal) {
      console.log("Both requests reached a terminal status.");
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
