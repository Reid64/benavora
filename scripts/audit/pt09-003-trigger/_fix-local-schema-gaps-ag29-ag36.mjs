// ONE-TIME LOCAL SCHEMA PATCH for PT-09-003 batch 2's AG-29/AG-30/AG-35/AG-36
// slice, documented per the same "SAFETY RULE 5" precedent batch 1's AG-15
// script established (scripts/audit/pt09-002-trigger/AG-15.mjs's header
// comment): the local pt05-local-stack is a widen-only subset of production
// (project memory `benavora-migration-audit-28-not-applied`: 28 of 108
// migrations never applied here) -- these are genuine local scaffolding
// gaps relative to already-real, already-documented production migrations,
// not application bugs, and not fabricated schema. Every statement below is
// copied verbatim (or near-verbatim) from a real migration file already on
// disk, applied idempotently (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
//
// Gaps found via direct pg introspection against 127.0.0.1:56322 before
// writing any AG-29/AG-30/AG-35/AG-36 trigger script:
//   1. `vector` extension not installed locally (available, version 0.8.2,
//      per pg_available_extensions) -- outcomes.embedding and
//      foundation_directory.embedding exist locally but as plain `text`
//      columns, not `extensions.vector(1536)` as migration 107 specifies.
//      Both columns are 100% NULL in every row locally (verified), so a
//      type change is safe (USING NULL::extensions.vector(1536)).
//   2. `knowledge_patterns` table (migration 096_knowledge_engine.sql)
//      does not exist locally at all -- AG-29's pattern-aggregation half
//      (KnowledgeIndexerAgent.runPatternAggregation) writes here.
//   3. `org_learning_contributions` table (migration
//      083_global_learning_network.sql, hardened by 099) does not exist
//      locally at all -- AG-36's per-outcome contribution audit trail
//      (LearningNetworkAggregatorAgent.recordContribution) writes here, and
//      also GATES idempotency (hasOutcomeAlreadyContributed) -- without
//      this table AG-36 cannot run at all (every insert throws).
//   4. `platform_learning_patterns` exists locally but is missing the
//      `confidence` and `weight` columns migration 099 adds -- AG-36's
//      upsertPattern() writes both on every insert/update.
//   5. `intelligence_proposal_sections` (migration 048) also doesn't exist
//      locally, but is NOT patched here: it FKs to
//      `intelligence_funded_proposals`, which also doesn't exist locally,
//      and AG-29's own loadPendingBatch() already degrades gracefully (a
//      failed .from() select is swallowed by supabase-js into
//      `{data: null}`, treated as zero rows from that source) -- so this
//      gap does not block AG-29's run, it only means 0 rows are sourced
//      from that specific table this session (outcomes/foundation_directory
//      supply real content instead, see the seed statement below).
//
// Also seeds real, substantive text content into the one
// foundation_directory row environment.json provides (programs was NULL,
// enrichment was `{}`) so AG-29 has more than one real source table to
// embed from this run, per the task's explicit "seed additional content
// via direct pg INSERT if needed" instruction.

import { pgClient, setupLocalEnv } from "../pt09-003-lib.mjs";

setupLocalEnv();

async function main() {
  const db = await pgClient();

  // 1. pgvector extension + real vector(1536) columns (migration 107 shape).
  await db.query(`CREATE EXTENSION IF NOT EXISTS vector SCHEMA extensions;`);
  await db.query(
    `ALTER TABLE outcomes ALTER COLUMN embedding TYPE extensions.vector(1536) USING NULL::extensions.vector(1536);`,
  );
  await db.query(
    `ALTER TABLE foundation_directory ALTER COLUMN embedding TYPE extensions.vector(1536) USING NULL::extensions.vector(1536);`,
  );

  // 2. knowledge_patterns (migration 096_knowledge_engine.sql, verbatim).
  await db.query(`
    CREATE TABLE IF NOT EXISTS knowledge_patterns (
      id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
      pattern_type         text        NOT NULL,
      category             text,
      funder_name          text,
      pattern_description  text        NOT NULL,
      success_rate         numeric,
      sample_count         integer,
      confidence           text        NOT NULL DEFAULT 'low',
      created_at           timestamptz NOT NULL DEFAULT now(),
      updated_at           timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_knowledge_patterns_type ON knowledge_patterns(pattern_type);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_knowledge_patterns_category ON knowledge_patterns(category);`);

  // 3. org_learning_contributions (migration 083, + 099's anonymized/source_hash).
  await db.query(`
    CREATE TABLE IF NOT EXISTS org_learning_contributions (
      id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      outcome_id        uuid REFERENCES outcomes(id),
      contribution_type text NOT NULL,
      pattern_id        uuid REFERENCES platform_learning_patterns(id),
      anonymized_at     timestamptz NOT NULL DEFAULT now(),
      anonymized        boolean NOT NULL DEFAULT true,
      source_hash       text
    );
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_org_learning_contrib_org ON org_learning_contributions(org_id);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_org_learning_contrib_pattern ON org_learning_contributions(pattern_id);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_org_learning_contrib_outcome ON org_learning_contributions(outcome_id);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_org_learning_contrib_hash ON org_learning_contributions(source_hash);`);

  // 4. platform_learning_patterns confidence/weight columns (migration 099).
  await db.query(`
    ALTER TABLE platform_learning_patterns
      ADD COLUMN IF NOT EXISTS confidence text NOT NULL DEFAULT 'low'
        CHECK (confidence IN ('low', 'medium', 'high')),
      ADD COLUMN IF NOT EXISTS weight numeric NOT NULL DEFAULT 1.0;
  `);

  // 5. Seed real foundation_directory content (environment.json's one row
  // had programs=NULL, enrichment={}) so AG-29 has genuine text to embed
  // from a second source table beyond outcomes.
  await db.query(
    `UPDATE foundation_directory
     SET programs = $1::text[],
         enrichment = $2::jsonb
     WHERE id = '6540e5b0-965e-43f5-8a77-0ac98a732e6d' AND programs IS NULL;`,
    [
      [
        "Transitional housing case management for displaced working families",
        "Emergency rental assistance paired with job-readiness training",
      ],
      JSON.stringify({
        mission:
          "PT-09 Regional Foundation Directory test entry: funds housing stability and workforce development programs across Central Texas.",
      }),
    ],
  );

  console.log("Local schema patch applied (idempotent). Verifying...");

  const checks = await Promise.all([
    db.query(`select to_regclass('public.knowledge_patterns') as t`),
    db.query(`select to_regclass('public.org_learning_contributions') as t`),
    db.query(
      `select column_name from information_schema.columns where table_name='platform_learning_patterns' and column_name in ('confidence','weight')`,
    ),
    db.query(`select udt_name from information_schema.columns where table_name='outcomes' and column_name='embedding'`),
    db.query(`select udt_name from information_schema.columns where table_name='foundation_directory' and column_name='embedding'`),
    db.query(`select programs, enrichment from foundation_directory where id='6540e5b0-965e-43f5-8a77-0ac98a732e6d'`),
  ]);
  console.log("knowledge_patterns:", checks[0].rows[0].t);
  console.log("org_learning_contributions:", checks[1].rows[0].t);
  console.log("platform_learning_patterns new cols:", checks[2].rows.map((r) => r.column_name));
  console.log("outcomes.embedding udt:", checks[3].rows[0].udt_name);
  console.log("foundation_directory.embedding udt:", checks[4].rows[0].udt_name);
  console.log("foundation_directory seeded content:", JSON.stringify(checks[5].rows[0]));

  await db.end();
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
