// PT-09-002 -- merges every per-agent result JSON under
// test-evidence/pt-09/batch1-results/*.json into the single, authoritative
// test-evidence/pt-09/execution-batch1.json the task requires.
//
// Usage: node scripts/audit/pt09-002-merge-results.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const RESULTS_DIR = path.join(REPO_ROOT, "test-evidence", "pt-09", "batch1-results");
const OUT_FILE = path.join(REPO_ROOT, "test-evidence", "pt-09", "execution-batch1.json");
const ENV_FILE = path.join(REPO_ROOT, "test-evidence", "pt-09", "environment.json");

function main() {
  if (!fs.existsSync(RESULTS_DIR)) {
    throw new Error(`Results directory does not exist: ${RESULTS_DIR}`);
  }
  const files = fs
    .readdirSync(RESULTS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();

  const results = [];
  for (const f of files) {
    const p = path.join(RESULTS_DIR, f);
    let data;
    try {
      data = JSON.parse(fs.readFileSync(p, "utf8"));
    } catch (err) {
      throw new Error(`Failed to parse ${p}: ${err.message}`);
    }
    results.push(data);
  }

  results.sort((a, b) => String(a.canonicalNumber).localeCompare(String(b.canonicalNumber)));

  const env = fs.existsSync(ENV_FILE) ? JSON.parse(fs.readFileSync(ENV_FILE, "utf8")) : null;

  const verdictCounts = {};
  const falsePassCasualties = [];
  for (const r of results) {
    verdictCounts[r.verdict] = (verdictCounts[r.verdict] ?? 0) + 1;
    if (r.falsePassCasualty === true) {
      falsePassCasualties.push({ canonicalNumber: r.canonicalNumber, registryPriorStatus: r.registryPriorStatus });
    }
  }

  const out = {
    auditPhase: "PT-09",
    step: "PT-09-002",
    title: "Per-agent execution proof, batch 1 (AG-01..AG-21 real numbering per pt09-001, 27 agent code entries + 1 PENDING-SCOPE)",
    generatedAt: new Date().toISOString(),
    method: {
      description:
        "Every entry was triggered against a real, live, local, non-production Supabase stack " +
        "(pt05-local-stack, Docker, 127.0.0.1) via its real source code -- direct class " +
        "instantiation / real exported function call / real private-method invocation, matching " +
        "each agent's documented real invocation contract, not a mock or a stub. A schema " +
        "extension (scripts/audit/pt09-002-schema-extension.sql, auto-generated from the real " +
        "production schema snapshot at test-evidence/pt-06/live-schema.json) and a dedicated, " +
        "non-Faith test organization (test-evidence/pt-09/environment.json) were provisioned " +
        "first. Before/after row counts were captured via a raw `pg` connection independent of " +
        "whatever client the agent code itself used, so a count discrepancy cannot be an " +
        "artifact of the counting method. Agents confirmed to send real outbound communications " +
        "to third parties (real email delivery, real browser-driven third-party form submission) " +
        "with no dry-run mode available in the codebase were marked PENDING-SCOPE and not fired, " +
        "per this phase's explicit scope rule -- see the AG-12 entry for the one batch-1 agent " +
        "this applied to.",
      localStackIsProduction: false,
      productionRefForComparison: "vbjplpquqxxfbpazyalt",
      schemaExtensionFile: "scripts/audit/pt09-002-schema-extension.sql",
      environmentFile: "test-evidence/pt-09/environment.json",
    },
    environmentSummary: env
      ? {
          orgId: env.org?.orgId,
          userId: env.org?.userId,
          fundersSeeded: env.funders?.length ?? 0,
          opportunitiesSeeded: env.opportunities?.length ?? 0,
          applicationsSeeded: env.applications?.length ?? 0,
        }
      : null,
    results,
    summary: {
      totalAgentEntries: results.length,
      verdictCounts,
      falsePassCasualtyCount: falsePassCasualties.length,
      falsePassCasualties,
    },
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUT_FILE}`);
  console.log(`Total agent entries: ${results.length}`);
  console.log(`Verdict counts: ${JSON.stringify(verdictCounts, null, 2)}`);
  console.log(`False-pass casualties: ${falsePassCasualties.length}`);
  if (falsePassCasualties.length > 0) {
    for (const c of falsePassCasualties) console.log(`  - ${c.canonicalNumber}`);
  }
}

main();
