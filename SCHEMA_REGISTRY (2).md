# FORGE 2.0 — Schema Registry

**Database:** SQLite (forge_memory.db)
**Location:** ~/.forge/forge_memory.db (per machine)
**Master Copy:** 18TB external drive (synced between runs)
**Last Updated:** June 22, 2026

---

## Table: forge_meta

Purpose: Schema version tracking and machine identity.

```sql
CREATE TABLE IF NOT EXISTS forge_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

INSERT OR IGNORE INTO forge_meta (key, value) VALUES
    ('schema_version', '1.0.0'),
    ('created_at', datetime('now')),
    ('machine_id', '');
```

---

## Table: prompt_scores

Purpose: Track prompt effectiveness for Loop 1 (Prompt Effectiveness Scoring). The Composer queries this to select optimal templates.

```sql
CREATE TABLE IF NOT EXISTS prompt_scores (
    id                   TEXT PRIMARY KEY,
    prompt_template_hash TEXT NOT NULL,
    task_type            TEXT NOT NULL CHECK(
        task_type IN ('SCAFFOLD','CRUD','INTEGRATION','AI_PIPELINE','CONFIG','TEST','FIX')
    ),
    tech_stack_tags      TEXT NOT NULL DEFAULT '[]',
    first_pass_success   INTEGER NOT NULL CHECK(first_pass_success IN (0, 1)),
    retry_count          INTEGER NOT NULL DEFAULT 0,
    tokens_consumed      INTEGER NOT NULL DEFAULT 0,
    gate_pass_rate       REAL NOT NULL DEFAULT 0.0 CHECK(gate_pass_rate >= 0.0 AND gate_pass_rate <= 1.0),
    drift_score          REAL NOT NULL DEFAULT 0.0 CHECK(drift_score >= 0.0 AND drift_score <= 1.0),
    project_name         TEXT NOT NULL,
    build_id             TEXT NOT NULL,
    machine_id           TEXT NOT NULL,
    created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_prompt_scores_task_type ON prompt_scores(task_type);
CREATE INDEX idx_prompt_scores_template_hash ON prompt_scores(prompt_template_hash);
CREATE INDEX idx_prompt_scores_project ON prompt_scores(project_name);
CREATE INDEX idx_prompt_scores_created ON prompt_scores(created_at);
```

---

## Table: fix_patterns

Purpose: Store error-fix pairs for Loop 2 (Fix Pattern Indexing). When a fingerprint recurs, FORGE proposes the exact fix.

```sql
CREATE TABLE IF NOT EXISTS fix_patterns (
    id                    TEXT PRIMARY KEY,
    error_fingerprint     TEXT NOT NULL,
    error_message         TEXT NOT NULL,
    error_category        TEXT NOT NULL CHECK(
        error_category IN ('COMPILE','RUNTIME','TEST','LINT','SECURITY','SCHEMA','DEPLOY')
    ),
    file_path_pattern     TEXT NOT NULL,
    fix_diff              TEXT,
    fix_description       TEXT,
    fix_files_modified    TEXT DEFAULT '[]',
    tech_stack_tags       TEXT NOT NULL DEFAULT '[]',
    occurrence_count      INTEGER NOT NULL DEFAULT 1,
    success_rate          REAL NOT NULL DEFAULT 0.0,
    times_fix_applied     INTEGER NOT NULL DEFAULT 0,
    times_fix_succeeded   INTEGER NOT NULL DEFAULT 0,
    auto_governance_rule  TEXT,
    governance_rule_id    TEXT,
    last_seen             TEXT NOT NULL DEFAULT (datetime('now')),
    machine_id            TEXT NOT NULL,
    created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_fix_patterns_fingerprint ON fix_patterns(error_fingerprint);
CREATE INDEX idx_fix_patterns_category ON fix_patterns(error_category);
CREATE INDEX idx_fix_patterns_stack ON fix_patterns(tech_stack_tags);
CREATE INDEX idx_fix_patterns_count ON fix_patterns(occurrence_count DESC);
```

---

## Table: decision_weights

Purpose: Track architectural decision outcomes for Loop 3 (Architecture Decision Weighting). The Architect queries this before recommending tech stack choices.

```sql
CREATE TABLE IF NOT EXISTS decision_weights (
    id                    TEXT PRIMARY KEY,
    decision_type         TEXT NOT NULL,
    option_chosen         TEXT NOT NULL,
    downstream_error_rate REAL NOT NULL DEFAULT 0.0,
    downstream_retry_rate REAL NOT NULL DEFAULT 0.0,
    downstream_prompts    INTEGER NOT NULL DEFAULT 0,
    downstream_errors     INTEGER NOT NULL DEFAULT 0,
    downstream_retries    INTEGER NOT NULL DEFAULT 0,
    sample_size           INTEGER NOT NULL DEFAULT 1,
    project_name          TEXT NOT NULL,
    build_id              TEXT NOT NULL,
    machine_id            TEXT NOT NULL,
    created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_decision_weights_type ON decision_weights(decision_type, option_chosen);
CREATE INDEX idx_decision_weights_error_rate ON decision_weights(downstream_error_rate ASC);
```

---

## Table: governance_rules

Purpose: Rules enforced during execution via PreToolUse hooks. Sourced from manual creation, auto-elevation (3+ error occurrences), or instinct extraction.

```sql
CREATE TABLE IF NOT EXISTS governance_rules (
    id                       TEXT PRIMARY KEY,
    rule_text                TEXT NOT NULL,
    rule_short_name          TEXT NOT NULL,
    source                   TEXT NOT NULL CHECK(
        source IN ('MANUAL','AUTO_ELEVATED','INSTINCT','RETROFIT')
    ),
    source_error_fingerprint TEXT,
    tech_stack_tags          TEXT NOT NULL DEFAULT '[]',
    scope                    TEXT NOT NULL CHECK(scope IN ('GLOBAL','PROJECT_SPECIFIC')),
    project_name             TEXT,
    active                   INTEGER NOT NULL DEFAULT 1,
    enforcement_count        INTEGER NOT NULL DEFAULT 0,
    last_enforced            TEXT,
    machine_id               TEXT NOT NULL,
    created_at               TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_governance_rules_active ON governance_rules(active, scope);
CREATE INDEX idx_governance_rules_stack ON governance_rules(tech_stack_tags);
```

---

## Table: pending_evolutions

Purpose: Self-modification proposals from Loop 5. Presented at SessionStart for Reid's approval.

```sql
CREATE TABLE IF NOT EXISTS pending_evolutions (
    id                TEXT PRIMARY KEY,
    evolution_type    TEXT NOT NULL CHECK(
        evolution_type IN ('HOOK','TEMPLATE','RULE','THRESHOLD','CONFIG','GATE')
    ),
    proposed_change   TEXT NOT NULL,
    change_detail     TEXT NOT NULL,
    evidence          TEXT NOT NULL,
    estimated_impact  TEXT NOT NULL,
    confidence        REAL NOT NULL CHECK(confidence >= 0.0 AND confidence <= 1.0),
    status            TEXT NOT NULL DEFAULT 'PENDING' CHECK(
        status IN ('PENDING','APPROVED','REJECTED','SUPERSEDED')
    ),
    reviewed_at       TEXT,
    review_note       TEXT,
    machine_id        TEXT NOT NULL,
    created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_pending_evolutions_status ON pending_evolutions(status);
```

---

## Table: build_outcomes

Purpose: Summary of every build run. Feeds decision weight calculations and prompt score aggregation.

```sql
CREATE TABLE IF NOT EXISTS build_outcomes (
    id                     TEXT PRIMARY KEY,
    project_name           TEXT NOT NULL,
    mode                   TEXT NOT NULL CHECK(mode IN ('GREENFIELD','RETROFIT')),
    start_time             TEXT NOT NULL,
    end_time               TEXT,
    end_reason             TEXT CHECK(
        end_reason IN ('COMPLETED','PAUSED','FAILED','INTERRUPTED') OR end_reason IS NULL
    ),
    total_prompts_planned  INTEGER NOT NULL DEFAULT 0,
    total_prompts_executed INTEGER NOT NULL DEFAULT 0,
    prompts_passed         INTEGER NOT NULL DEFAULT 0,
    prompts_retried        INTEGER NOT NULL DEFAULT 0,
    prompts_failed         INTEGER NOT NULL DEFAULT 0,
    total_tokens           INTEGER NOT NULL DEFAULT 0,
    architecture_decisions TEXT DEFAULT '[]',
    maturity_stage         TEXT CHECK(
        maturity_stage IN ('FOUNDATION','GROWTH','ENTERPRISE') OR maturity_stage IS NULL
    ),
    first_pass_rate        REAL,
    machine_id             TEXT NOT NULL,
    created_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_build_outcomes_project ON build_outcomes(project_name);
CREATE INDEX idx_build_outcomes_created ON build_outcomes(created_at DESC);
```

---

## Table: skill_library

Purpose: Auto-generated SKILL.md entries from debugging sessions. Injected into future builds via SessionStart.

```sql
CREATE TABLE IF NOT EXISTS skill_library (
    id                       TEXT PRIMARY KEY,
    skill_name               TEXT NOT NULL,
    content                  TEXT NOT NULL,
    tech_stack_tags          TEXT NOT NULL DEFAULT '[]',
    source_error_fingerprint TEXT,
    source_build_id          TEXT,
    trigger_context          TEXT,
    usage_count              INTEGER NOT NULL DEFAULT 0,
    effectiveness_rate       REAL NOT NULL DEFAULT 0.0,
    times_injected           INTEGER NOT NULL DEFAULT 0,
    times_prevented_error    INTEGER NOT NULL DEFAULT 0,
    machine_id               TEXT NOT NULL,
    created_at               TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_skill_library_stack ON skill_library(tech_stack_tags);
CREATE INDEX idx_skill_library_fingerprint ON skill_library(source_error_fingerprint);
```

---

## Table: reconcile_decisions

Purpose: Persist RETROFIT RECONCILE decisions for future re-RETROFIT of the same project.

```sql
CREATE TABLE IF NOT EXISTS reconcile_decisions (
    id            TEXT PRIMARY KEY,
    project_name  TEXT NOT NULL,
    feature_id    TEXT NOT NULL,
    feature_name  TEXT NOT NULL,
    decision      TEXT NOT NULL CHECK(
        decision IN ('BUILD','DEFER','ABANDON','APPROVED','SKIPPED','FIX','IGNORE','INJECT','SKIP')
    ),
    category      TEXT NOT NULL,
    severity      TEXT,
    rationale     TEXT,
    machine_id    TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_reconcile_project ON reconcile_decisions(project_name, created_at DESC);
```

---

## Table: scan_reports

Purpose: Persist SCAN results for historical comparison across RETROFITs.

```sql
CREATE TABLE IF NOT EXISTS scan_reports (
    id              TEXT PRIMARY KEY,
    project_name    TEXT NOT NULL,
    scan_scope      TEXT NOT NULL CHECK(scan_scope IN ('A','B','C')),
    critical_count  INTEGER NOT NULL DEFAULT 0,
    warn_count      INTEGER NOT NULL DEFAULT 0,
    info_count      INTEGER NOT NULL DEFAULT 0,
    broken_imports  INTEGER NOT NULL DEFAULT 0,
    dead_files      INTEGER NOT NULL DEFAULT 0,
    schema_drift    INTEGER NOT NULL DEFAULT 0,
    tsc_errors      INTEGER NOT NULL DEFAULT 0,
    test_pass_rate  REAL,
    report_json     TEXT NOT NULL,
    machine_id      TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_scan_reports_project ON scan_reports(project_name, created_at DESC);
```

---

## Table: hook_execution_log

Purpose: Log every hook execution for performance analysis and evolution proposals.

```sql
CREATE TABLE IF NOT EXISTS hook_execution_log (
    id              TEXT PRIMARY KEY,
    hook_name       TEXT NOT NULL,
    event           TEXT NOT NULL,
    status          TEXT NOT NULL CHECK(status IN ('PASS','FAIL','TIMEOUT','SKIP')),
    duration_ms     INTEGER NOT NULL,
    output          TEXT,
    build_id        TEXT NOT NULL,
    prompt_number   INTEGER,
    machine_id      TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_hook_log_build ON hook_execution_log(build_id);
CREATE INDEX idx_hook_log_name ON hook_execution_log(hook_name, status);
CREATE INDEX idx_hook_log_duration ON hook_execution_log(duration_ms DESC);
```

---

## Table: compact_snapshots

Purpose: PreCompact hook saves critical context here before Claude's context compaction.

```sql
CREATE TABLE IF NOT EXISTS compact_snapshots (
    id              TEXT PRIMARY KEY,
    build_id        TEXT NOT NULL,
    prompt_index    INTEGER NOT NULL,
    state_json      TEXT NOT NULL,
    machine_id      TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_compact_build ON compact_snapshots(build_id, prompt_index DESC);
```

---

## Table: build_fingerprints

Purpose: Track project state hashes for integrity verification between runs.

```sql
CREATE TABLE IF NOT EXISTS build_fingerprints (
    id              TEXT PRIMARY KEY,
    build_id        TEXT NOT NULL,
    prompt_number   INTEGER NOT NULL,
    fingerprint     TEXT NOT NULL,
    file_count      INTEGER NOT NULL,
    total_size_kb   INTEGER NOT NULL,
    machine_id      TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_fingerprints_build ON build_fingerprints(build_id, prompt_number);
```

---

## Table: adversary_findings

Purpose: Track adversarial review findings for resolution and accuracy measurement.

```sql
CREATE TABLE IF NOT EXISTS adversary_findings (
    id          TEXT PRIMARY KEY,
    build_id    TEXT NOT NULL,
    phase       TEXT NOT NULL,
    severity    TEXT NOT NULL CHECK(severity IN ('BLOCKER','SIGNIFICANT','MINOR','DISMISSED')),
    vector      TEXT,
    issue       TEXT NOT NULL,
    fix         TEXT,
    resolution  TEXT DEFAULT 'PENDING' CHECK(
        resolution IN ('PENDING','FIXED','DISMISSED','DEFERRED')
    ),
    resolved_at TEXT,
    machine_id  TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_adversary_build ON adversary_findings(build_id);
CREATE INDEX idx_adversary_severity ON adversary_findings(severity);
```
