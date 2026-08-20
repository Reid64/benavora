// One-off: for a curated set of high-priority ON-DISK-NOT-APPLIED migrations,
// grep the SPECIFIC missing column name (not just the table name) within the
// files consumer-check.json already found reference the table, to confirm
// the exact missing piece -- not just the table generally -- is actually
// read/written by live code. Prints results for manual finding-writing; not
// committed as a permanent evidence artifact (its findings are folded into
// the WIRING_GAP_REGISTER.md rows this produces).

import fs from "node:fs";
import { execSync } from "node:child_process";

const drift = JSON.parse(fs.readFileSync("test-evidence/pt-06/migration-drift.json", "utf8"));
const consumer = JSON.parse(fs.readFileSync("test-evidence/pt-06/consumer-check.json", "utf8"));

const CANDIDATES = [
  "033_integration_keys.sql",
  "035_automation_queue.sql",
  "036_automation_notifications.sql",
  "037_giving_history.sql",
  "038_intelligence_tables.sql",
  "052_governance_layer.sql",
  "052_webhook_configs.sql",
  "060_grantmaker_profiles.sql",
  "100_prospects_contact_fields.sql",
  "101_twin_auto_populate_log.sql",
  "102_twin_auto_populate_log.sql",
  "105_applications_metadata_column.sql",
  "106_intelligence_library_schema_upgrade.sql",
  "054_email_calendar_integration.sql",
  "078_forecast_board.sql",
  "097_deadline_prediction_agent.sql",
];

for (const filename of CANDIDATES) {
  const driftEntry = drift.onDiskNotApplied.find((r) => r.filename === filename);
  const consumerEntry = consumer.results.find((r) => r.filename === filename);
  if (!driftEntry) {
    console.log(`\n=== ${filename} === NOT FOUND in drift`);
    continue;
  }
  console.log(`\n=== ${filename} (${driftEntry.directory}) ===`);
  for (const miss of driftEntry.missing) {
    const colOrTable = miss.column || miss.table || miss.value;
    const table = miss.table || miss.enumType;
    const tableInfo = consumerEntry?.perTable.find((t) => t.table === table);
    const candidateFiles = tableInfo?.referencingFiles || [];
    let hits = [];
    if (miss.kind === "column" && candidateFiles.length > 0) {
      for (const f of candidateFiles.slice(0, 6)) {
        try {
          const out = execSync(
            `powershell -NoProfile -Command "(Select-String -Path '${f}' -SimpleMatch -Pattern '${miss.column}').Count"`,
            { encoding: "utf8" },
          ).trim();
          const n = parseInt(out, 10) || 0;
          if (n > 0) hits.push(`${f}:${n}`);
        } catch {}
      }
    }
    console.log(`  ${miss.kind} ${table}${miss.column ? "." + miss.column : ""} -- column-specific refs: ${hits.length ? hits.join(", ") : "(none found in table-referencing files)"}`);
  }
}
