// PT-09-002 -- generates the schema extension needed on top of the existing
// pt05-local-stack (pt05-schema.sql + pt05-002/004-schema-extension.sql) so
// that AG-01..AG-21 batch-1 agent code can actually run against a local,
// non-production target and write real rows.
//
// Source of truth for every column: test-evidence/pt-06/live-schema.json
// (a real, read-only production schema snapshot captured in PT-06). This
// script does not invent columns -- it emits exactly what production has,
// with two deliberate, documented simplifications:
//   1. USER-DEFINED (enum) columns become plain `text` (no Postgres enum
//      type recreated). Rationale: the goal of PT-09-002 is to prove agent
//      code executes its real write path and inserts a real row, not to
//      re-verify enum-constraint fidelity (that's PT-06 territory). Forcing
//      real enum types here would mean hand-reconstructing 10+ enum
//      definitions from migration files for no benefit to this phase's
//      actual question, and risks a false TRIGGER-BROKEN/ERROR-SWALLOWED
//      verdict caused by local scaffolding gaps rather than a real bug.
//   2. Every column except the primary key `id` is made NULLABLE, and NOT
//      NULL constraints are dropped. Same rationale: a local schema that is
//      stricter than what this phase needs would risk misattributing a
//      constraint-shape gap in the local double as an agent code defect.
// Both simplifications are stated here and in the resulting SQL file's own
// header so a reader never mistakes this for a full-fidelity schema clone.
//
// Usage: node scripts/audit/pt09-002-gen-schema-extension.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCHEMA_JSON = path.join(REPO_ROOT, "test-evidence", "pt-06", "live-schema.json");
const OUT_SQL = path.join(__dirname, "pt09-002-schema-extension.sql");

// Tables already created by pt05-schema.sql / pt05-002-schema-extension.sql /
// pt05-004-schema-extension.sql on the shared local stack -- skip these so we
// don't collide with pt05's own (RLS-enabled, faithfully-typed) versions.
const ALREADY_PRESENT = new Set([
  "organizations",
  "profiles",
  "funders",
  "opportunities",
  "applications",
  "draft_versions",
  "contacts",
  "donor_discovery_prospects",
  "deadlines",
  "knowledge_base",
  "organizational_digital_twins",
]);

const NEEDED_TABLES = [
  "agent_decisions",
  "agent_queue",
  "agent_runs",
  "agent_registry",
  "agent_configurations",
  "alerts",
  "application_documents",
  "autoapply_submissions",
  "automation_sessions",
  "board_members",
  "community_need_signals",
  "corporate_intent_signals",
  "corporate_prospects",
  "documents",
  "donor_discovery_directory",
  "donor_discovery_requests",
  "email_activity",
  "form_templates",
  "foundation_directory",
  "fundability_scores",
  "funder_dna_profiles",
  "funder_relationship_scores",
  "opportunity_probability_scores",
  "outcomes",
  "outreach_contacts",
  "pig_edges",
  "pig_nodes",
  "platform_learning_patterns",
  "proven_narratives",
  "relationship_memory",
  "relationship_recommendations",
  "reputation_signals",
  "reputation_alerts",
  "roi_insights",
  "search_profiles",
  "submission_queue",
  // Cross-cutting tables every BaseAgent/AutonomousAgent subclass implicitly
  // touches via shared infra (usage-tracker.ts's trackUsage() has no
  // try/catch around its usage_metrics writes -- a missing table here would
  // break every batch-1 agent's run, not just the one under test).
  "usage_metrics",
  "org_autonomous_config",
];

function pgType(col) {
  switch (col.data_type) {
    case "uuid":
      return "uuid";
    case "text":
      return "text";
    case "boolean":
      return "boolean";
    case "integer":
      return "integer";
    case "bigint":
      return "bigint";
    case "numeric":
      return "numeric";
    case "jsonb":
      return "jsonb";
    case "date":
      return "date";
    case "timestamp with time zone":
      return "timestamptz";
    case "point":
      return "point";
    case "ARRAY":
      return "text[]";
    case "USER-DEFINED":
      // Special-case pgvector embedding columns -- store as text locally,
      // nobody in batch 1 needs real vector similarity search.
      return "text";
    default:
      return "text";
  }
}

function simplifyDefault(col, targetType) {
  if (col.column_default === null || col.column_default === undefined) return null;
  const raw = String(col.column_default);
  if (col.column_name === "id" && targetType === "uuid") {
    return "gen_random_uuid()";
  }
  if (raw === "now()" || raw === "gen_random_uuid()") return raw;
  if (targetType === "text[]") return "'{}'::text[]";
  // Strip a trailing ::type_name cast (e.g. 'pending'::agent_run_status -> 'pending')
  const stripped = raw.replace(/::[\w."\[\]]+$/, "");
  if (/^'/.test(stripped) || /^\d/.test(stripped) || stripped === "true" || stripped === "false") {
    return stripped;
  }
  return null; // unrecognized default shape -- omit rather than emit invalid SQL
}

function main() {
  const schema = JSON.parse(fs.readFileSync(SCHEMA_JSON, "utf8"));
  const lines = [];
  lines.push("-- ============================================================================");
  lines.push("-- PT-09-002 schema extension -- applied on top of pt05-schema.sql +");
  lines.push("-- pt05-002-schema-extension.sql + pt05-004-schema-extension.sql, against the");
  lines.push("-- SAME local pt05-local-stack (never production).");
  lines.push("--");
  lines.push("-- Auto-generated by scripts/audit/pt09-002-gen-schema-extension.mjs from");
  lines.push("-- test-evidence/pt-06/live-schema.json (a real, read-only production schema");
  lines.push("-- snapshot). Two deliberate simplifications vs. the real production DDL:");
  lines.push("--   1. USER-DEFINED (enum) columns -> plain text (no enum type recreated).");
  lines.push("--   2. Every non-id column is nullable, NOT NULL dropped.");
  lines.push("-- Both are so that a scaffolding gap can never masquerade as a real agent");
  lines.push("-- code defect in this phase's WIRED-NO-OUTPUT / ERROR-SWALLOWED verdicts.");
  lines.push("-- See the generator script's header comment for the full rationale.");
  lines.push("-- ============================================================================");
  lines.push("");

  // For tables pt05 already created (with a hand-picked, narrower column
  // set than production), widen them with ADD COLUMN IF NOT EXISTS for
  // every real production column they're missing. Idempotent -- columns
  // pt05 already defined are silently skipped by IF NOT EXISTS. This
  // matters because batch-1 agent code reads/writes real columns
  // (funders.has_giving_page, opportunities.eligibility_requirements,
  // applications.draft_content, etc.) that pt05's original minimal seed
  // schema never needed.
  lines.push("-- Widen tables pt05 already created with every real production column");
  lines.push("-- they're missing (ADD COLUMN IF NOT EXISTS, idempotent).");
  for (const t of ALREADY_PRESENT) {
    const tbl = schema.tables[t];
    if (!tbl) continue;
    lines.push(`-- widen ${t}`);
    for (const col of tbl.columns) {
      const type = pgType(col);
      lines.push(`alter table ${t} add column if not exists ${col.column_name} ${type};`);
    }
  }
  lines.push("");

  const missing = [];
  for (const t of NEEDED_TABLES) {
    if (ALREADY_PRESENT.has(t)) continue;
    const tbl = schema.tables[t];
    if (!tbl) {
      missing.push(t);
      continue;
    }
    lines.push(`-- ${t} (${tbl.columns.length} columns, from production live-schema.json)`);
    lines.push(`create table if not exists ${t} (`);
    const colLines = tbl.columns
      .sort((a, b) => a.ordinal_position - b.ordinal_position)
      .map((col) => {
        const type = pgType(col);
        const def = simplifyDefault(col, type);
        const notNull = col.column_name === "id" ? " not null" : "";
        const defSql = def ? ` default ${def}` : "";
        return `  ${col.column_name} ${type}${defSql}${notNull}`;
      });
    // Ensure a primary key exists even if 'id' wasn't flagged not-null above
    lines.push(colLines.join(",\n"));
    lines.push(`);`);
    // Add a primary key on id if the column exists (idempotent-safe via DO block)
    const hasId = tbl.columns.some((c) => c.column_name === "id");
    if (hasId) {
      lines.push(
        `do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = '${t}_pkey'
  ) then
    alter table ${t} add constraint ${t}_pkey primary key (id);
  end if;
exception when others then null;
end $$;`,
      );
    }
    lines.push("");
  }

  fs.writeFileSync(OUT_SQL, lines.join("\n"), "utf8");
  console.log(`Wrote ${OUT_SQL}`);
  console.log(`Tables emitted: ${NEEDED_TABLES.filter((t) => !ALREADY_PRESENT.has(t) && !missing.includes(t)).length}`);
  console.log(`Already present (skipped): ${NEEDED_TABLES.filter((t) => ALREADY_PRESENT.has(t)).length}`);
  if (missing.length > 0) {
    console.error(`MISSING from live-schema.json (not emitted, needs manual attention): ${missing.join(", ")}`);
    process.exitCode = 1;
  }
}

main();
