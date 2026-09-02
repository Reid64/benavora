# FORGE 2.0 — Run 1 Prompt Queue

**Build ID:** forge-forge20-greenfield-run1
**Total Prompts:** 45
**Estimated Total Tokens:** ~1,050,000
**Modules Covered:** Learning Engine, Cross-Machine Sync, Core Pipeline Controller, Hook Lifecycle, RETROFIT SCAN, Session Orchestration, RETROFIT DIAGNOSE
**Authoritative Governance Documents:** BLUEPRINT.md, SCHEMA_REGISTRY.md, AGENTS.md, BEHAVIORAL_CONTRACTS.md, STATE_OF_THE_BUILD.md

---

## R1-001 — Project Scaffold & Directory Structure

**Estimated Tokens:** 15,000

### 1. Context

FORGE 2.0 is a PowerShell-only autonomous build orchestration framework. The project lives at `C:\Users\manag\Documents\FORGE 2.0\`. All source code is `.ps1` (scripts) and `.psm1` (modules) stored in a flat `modules\` directory per BLUEPRINT.md. Runtime state lives in `.forge\`. Configuration files (`forge_config.json`, `hooks.json`) live at the project root. The learning database lives at `~/.forge/forge_memory.db`. Governance documents live at the project root.

### 2. Task

Create the complete directory structure and stub files for FORGE 2.0. Every module gets its own `.psm1` file in the `modules\` directory. The main entry point is `forge.ps1` at the project root. Create all five governance documents with initial content. Create configuration templates in `templates\`. Create `.forge\` runtime directory. Create `tests\` directory with placeholder test files. Create `lib\` directory for SQLite binaries.

### 3. Acceptance Criteria

- Flat `modules\` directory with all 10 `.psm1` stub files per BLUEPRINT.md
- `forge.ps1` exists at project root with a placeholder `param()` block and module import stubs
- Each `.psm1` module file exists with a comment header and empty function stubs listed in AGENTS.md
- `forge_config.json` exists at project root with default configuration template
- `hooks.json` exists at project root with `schema_version: "1.0"` and empty hooks array
- `templates\` directory with `hooks_default.json`, `forge_config_default.json`, `prompt_template.md`
- `.forge\` directory created (empty — runtime state directory)
- `lib\` directory created (for sqlite3.exe and System.Data.SQLite.dll)
- `tests\` directory with placeholder Pester test files per BLUEPRINT.md
- All five governance documents exist: `STATE_OF_THE_BUILD.md`, `BLUEPRINT.md`, `SCHEMA_REGISTRY.md`, `AGENTS.md`, `BEHAVIORAL_CONTRACTS.md`
- Every `.psm1` stub includes `Export-ModuleMember` listing its public functions from AGENTS.md
- All `.ps1`/`.psm1` files pass `[System.Management.Automation.Language.Parser]::ParseFile()` with zero errors

### 4. File Manifest — CREATE

```
C:\Users\manag\Documents\FORGE 2.0\forge.ps1
C:\Users\manag\Documents\FORGE 2.0\forge_config.json
C:\Users\manag\Documents\FORGE 2.0\hooks.json
C:\Users\manag\Documents\FORGE 2.0\modules\ForgeCore.psm1
C:\Users\manag\Documents\FORGE 2.0\modules\ForgeLearning.psm1
C:\Users\manag\Documents\FORGE 2.0\modules\ForgeSync.psm1
C:\Users\manag\Documents\FORGE 2.0\modules\ForgeHooks.psm1
C:\Users\manag\Documents\FORGE 2.0\modules\ForgeRetrofit.psm1
C:\Users\manag\Documents\FORGE 2.0\modules\ForgeSession.psm1
C:\Users\manag\Documents\FORGE 2.0\modules\ForgeSentinel.psm1
C:\Users\manag\Documents\FORGE 2.0\modules\ForgeComposer.psm1
C:\Users\manag\Documents\FORGE 2.0\modules\ForgeArchitect.psm1
C:\Users\manag\Documents\FORGE 2.0\modules\ForgeDeploy.psm1
C:\Users\manag\Documents\FORGE 2.0\templates\hooks_default.json
C:\Users\manag\Documents\FORGE 2.0\templates\forge_config_default.json
C:\Users\manag\Documents\FORGE 2.0\templates\prompt_template.md
C:\Users\manag\Documents\FORGE 2.0\lib\                              (directory only)
C:\Users\manag\Documents\FORGE 2.0\.forge\                           (directory only)
C:\Users\manag\Documents\FORGE 2.0\tests\ForgeCore.Tests.ps1
C:\Users\manag\Documents\FORGE 2.0\tests\ForgeLearning.Tests.ps1
C:\Users\manag\Documents\FORGE 2.0\tests\ForgeSync.Tests.ps1
C:\Users\manag\Documents\FORGE 2.0\tests\ForgeHooks.Tests.ps1
C:\Users\manag\Documents\FORGE 2.0\tests\ForgeRetrofit.Tests.ps1
C:\Users\manag\Documents\FORGE 2.0\STATE_OF_THE_BUILD.md
C:\Users\manag\Documents\FORGE 2.0\BLUEPRINT.md
C:\Users\manag\Documents\FORGE 2.0\SCHEMA_REGISTRY.md
C:\Users\manag\Documents\FORGE 2.0\AGENTS.md
C:\Users\manag\Documents\FORGE 2.0\BEHAVIORAL_CONTRACTS.md
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$files = @(
    'forge.ps1','forge_config.json','hooks.json',
    'modules\ForgeCore.psm1','modules\ForgeLearning.psm1',
    'modules\ForgeSync.psm1','modules\ForgeHooks.psm1',
    'modules\ForgeRetrofit.psm1','modules\ForgeSession.psm1',
    'modules\ForgeSentinel.psm1','modules\ForgeComposer.psm1',
    'modules\ForgeArchitect.psm1','modules\ForgeDeploy.psm1',
    'templates\hooks_default.json','templates\forge_config_default.json',
    'templates\prompt_template.md',
    'tests\ForgeCore.Tests.ps1','tests\ForgeLearning.Tests.ps1',
    'tests\ForgeSync.Tests.ps1','tests\ForgeHooks.Tests.ps1',
    'tests\ForgeRetrofit.Tests.ps1',
    'STATE_OF_THE_BUILD.md','BLUEPRINT.md','SCHEMA_REGISTRY.md',
    'AGENTS.md','BEHAVIORAL_CONTRACTS.md'
)
$missing = $files | Where-Object { -not (Test-Path (Join-Path $root $_)) }
if ($missing) { Write-Error "Missing: $($missing -join ', ')"; exit 1 }

# Verify directories exist
@('.forge','lib','templates','tests','modules') | ForEach-Object {
    if (-not (Test-Path (Join-Path $root $_))) { Write-Error "Missing directory: $_"; exit 1 }
}

# Syntax check all PS1/PSM1 files
Get-ChildItem -Path $root -Recurse -Include *.ps1,*.psm1 | ForEach-Object {
    $errors = $null
    [System.Management.Automation.Language.Parser]::ParseFile($_.FullName, [ref]$null, [ref]$errors)
    if ($errors.Count -gt 0) { Write-Error "Parse errors in $($_.Name): $($errors[0].Message)"; exit 1 }
}
Write-Host 'R1-001 PASS' -ForegroundColor Green
```

### 6. Governance

**BEHAVIORAL_CONTRACTS enforcement (Global):**
- All `.psm1` stubs must include typed `param()` blocks and `Export-ModuleMember` listing public functions from AGENTS.md
- All code must be PowerShell only — no Python, JavaScript, Bash, or batch files
- Never hardcode file paths — all paths relative to `$ProjectPath` or derived from configuration

Update `STATE_OF_THE_BUILD.md`: Set "Project Scaffold" to COMPLETED with timestamp.

### 7. Rollback

On failure: `git checkout -- .` to revert all changes from this prompt. FORGE restores to snapshot `FORGE-SNAPSHOT-R1-001`.

---

## R1-002 — SQLite Core Wrapper (Invoke-Sqlite)

**Estimated Tokens:** 25,000

### 1. Context

From Learning Engine spec Section 2: "Core SQLite wrapper using sqlite3 CLI with JSON output, fallback to .NET assembly. All modules use high-level functions, never raw SQL."

The wrapper must handle: parameterized queries, JSON output parsing, error handling, and fallback from CLI to .NET. Database path: `~/.forge/forge_memory.db`.

### 2. Task

Implement `Invoke-Sqlite` in `modules\ForgeLearning.psm1`. This is the lowest-level data access function. Every other learning engine function depends on it. It must support SELECT (returns PSCustomObject array), INSERT/UPDATE/DELETE (returns affected row count), and raw DDL (CREATE TABLE, CREATE INDEX). Implement `Get-ForgeDbPath` helper that resolves `~/.forge/forge_memory.db` cross-platform.

### 3. Acceptance Criteria

- `Invoke-Sqlite` function exported from `ForgeLearning.psm1`
- Accepts `-Database` (path), `-Query` (SQL string), `-Parameters` (hashtable, optional)
- Attempts sqlite3 CLI first with `-json` flag; if sqlite3 not found, falls back to `System.Data.SQLite` .NET assembly from `lib\`
- Returns `[PSCustomObject[]]` for SELECT queries
- Returns `[int]` affected row count for INSERT/UPDATE/DELETE
- Handles single quotes in values (escaping)
- Throws terminating error on SQL syntax errors with the original error message preserved
- `Get-ForgeDbPath` returns the expanded path `~/.forge/forge_memory.db`
- Supports parameterized queries — never string-interpolate user data into SQL
- All functions include typed `param()` blocks
- Module ends with `Export-ModuleMember -Function Invoke-Sqlite, Get-ForgeDbPath`
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\modules\ForgeLearning.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\modules\ForgeLearning.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\modules\ForgeLearning.psm1" -Force
$dbPath = Get-ForgeDbPath
if (-not $dbPath) { Write-Error 'Get-ForgeDbPath returned null'; exit 1 }

# Test with in-memory database
$testDb = ':memory:'
Invoke-Sqlite -Database $testDb -Query 'CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)'
Invoke-Sqlite -Database $testDb -Query "INSERT INTO test (id, name) VALUES (1, 'hello')"
$result = Invoke-Sqlite -Database $testDb -Query 'SELECT * FROM test'
if ($result.Count -ne 1 -or $result[0].name -ne 'hello') { Write-Error 'SELECT test failed'; exit 1 }
Write-Host 'R1-002 PASS' -ForegroundColor Green
```

### 6. Governance

**BEHAVIORAL_CONTRACTS enforcement (Global + ForgeLearning):**
- All functions: typed `param()` blocks, `Export-ModuleMember` at module end
- Console: `Write-Host` only (never `Write-Output`) with colors — Green=PASS, Red=FAIL, Yellow=WARN, Cyan=INFO, Gray=DEBUG
- Errors: every `catch` must re-throw, log via `Register-Error`, or write visible message — never silent catch
- ForgeLearning contract: `Invoke-Sqlite` must support parameterized queries — never string-interpolate user data into SQL

Update `STATE_OF_THE_BUILD.md`: Set "Learning Engine — SQLite Wrapper" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-002`.

---

## R1-003 — Machine Identity & Database Initialization

**Estimated Tokens:** 35,000

### 1. Context

From Learning Engine spec Section 1: "Database lives at `~/.forge/forge_memory.db`. Created on first FORGE invocation. Schema version tracked in metadata table."

From Master Design Record Section 2.3.3: "Machine identity generated from `COMPUTERNAME + MAC address`. Stored in forge_meta. Unique per physical machine."

Complete schema from SCHEMA_REGISTRY.md — **14 tables** with exact DDL:

1. `forge_meta` — Schema version, machine ID, creation timestamp
2. `prompt_scores` — Template hash, task type, first_pass_success, retry_count, tokens_consumed, gate_pass_rate, drift_score, project_name, build_id, machine_id, created_at. Indexes: task_type, template_hash, project, created_at
3. `fix_patterns` — error_fingerprint (UNIQUE INDEX), error_message, error_category (CHECK constraint), file_path_pattern, fix_diff, fix_description, fix_files_modified (JSON), tech_stack_tags (JSON), occurrence_count, success_rate, times_fix_applied, times_fix_succeeded, auto_governance_rule, governance_rule_id, last_seen, machine_id, created_at. Indexes: fingerprint (UNIQUE), category, stack, count
4. `decision_weights` — decision_type, option_chosen, downstream_error_rate, downstream_retry_rate, downstream_prompts, downstream_errors, downstream_retries, sample_size, project_name, build_id, machine_id, created_at. Indexes: type+option, error_rate
5. `governance_rules` — rule_text, rule_short_name, source (CHECK: MANUAL/AUTO_ELEVATED/INSTINCT/RETROFIT), source_error_fingerprint, tech_stack_tags (JSON), scope (CHECK: GLOBAL/PROJECT_SPECIFIC), project_name, active, enforcement_count, last_enforced, machine_id, created_at. Indexes: active+scope, stack
6. `pending_evolutions` — evolution_type (CHECK), proposed_change, change_detail, evidence, estimated_impact, confidence (CHECK 0.0-1.0), status (CHECK: PENDING/APPROVED/REJECTED/SUPERSEDED), reviewed_at, review_note, machine_id, created_at. Index: status
7. `build_outcomes` — project_name, mode (CHECK: GREENFIELD/RETROFIT), start_time, end_time, end_reason (CHECK), total_prompts_planned, total_prompts_executed, prompts_passed, prompts_retried, prompts_failed, total_tokens, architecture_decisions (JSON), maturity_stage (CHECK), first_pass_rate, machine_id, created_at. Indexes: project, created_at
8. `skill_library` — skill_name, content, tech_stack_tags (JSON), source_error_fingerprint, source_build_id, trigger_context, usage_count, effectiveness_rate, times_injected, times_prevented_error, machine_id, created_at. Indexes: stack, fingerprint
9. `reconcile_decisions` — project_name, feature_id, feature_name, decision (CHECK), category, severity, rationale, machine_id, created_at. Index: project+created_at
10. `scan_reports` — project_name, scan_scope (CHECK: A/B/C), critical_count, warn_count, info_count, broken_imports, dead_files, schema_drift, tsc_errors, test_pass_rate, report_json, machine_id, created_at. Index: project+created_at
11. `hook_execution_log` — hook_name, event, status (CHECK: PASS/FAIL/TIMEOUT/SKIP), duration_ms, output, build_id, prompt_number, machine_id, created_at. Indexes: build_id, name+status, duration
12. `compact_snapshots` — build_id, prompt_index, state_json, machine_id, created_at. Index: build_id+prompt_index
13. `build_fingerprints` — build_id, prompt_number, fingerprint, file_count, total_size_kb, machine_id, created_at. Index: build_id+prompt_number
14. `adversary_findings` — build_id, phase, severity (CHECK), vector, issue, fix, resolution (CHECK), resolved_at, machine_id, created_at. Indexes: build_id, severity

**Use exact CREATE TABLE statements from SCHEMA_REGISTRY.md. Do not improvise column definitions.**

### 2. Task

Implement `Get-MachineId` and `Initialize-ForgeMemory` in `ForgeLearning.psm1`. `Get-MachineId` generates a deterministic ID from COMPUTERNAME + MAC address using SHA-256 hash. `Initialize-ForgeMemory` creates the `~/.forge/` directory if missing, creates all 14 tables with indexes using the exact DDL from SCHEMA_REGISTRY.md, inserts the initial `forge_meta` row. Must be idempotent — running twice must not error or duplicate data. Use `CREATE TABLE IF NOT EXISTS` and `INSERT OR IGNORE` for the meta row.

### 3. Acceptance Criteria

- `Get-MachineId` returns a consistent string on repeated calls on the same machine
- `Initialize-ForgeMemory` creates `~/.forge/` directory if it doesn't exist
- All **14 tables** created with correct column definitions, CHECK constraints, and DEFAULT values matching SCHEMA_REGISTRY.md exactly
- All indexes from SCHEMA_REGISTRY.md created
- `forge_meta` row inserted with schema_version='1.0.0', machine_id from `Get-MachineId`, created_at
- Running `Initialize-ForgeMemory` twice produces zero errors and does not duplicate data
- All functions include typed `param()` blocks
- `Export-ModuleMember` updated to include new functions
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\modules\ForgeLearning.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\modules\ForgeLearning.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\modules\ForgeLearning.psm1" -Force

# Test machine ID stability
$id1 = Get-MachineId
$id2 = Get-MachineId
if ($id1 -ne $id2) { Write-Error 'MachineId not stable'; exit 1 }

# Test initialization (use temp DB for testing)
$testDb = Join-Path $env:TEMP 'forge_test_init.db'
if (Test-Path $testDb) { Remove-Item $testDb -Force }
Initialize-ForgeMemory -DatabasePath $testDb

# Verify all 14 tables exist
$tables = Invoke-Sqlite -Database $testDb -Query "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
$expected = @('adversary_findings','build_fingerprints','build_outcomes','compact_snapshots','decision_weights','fix_patterns','forge_meta','governance_rules','hook_execution_log','pending_evolutions','prompt_scores','reconcile_decisions','scan_reports','skill_library')
$tableNames = $tables | ForEach-Object { $_.name } | Sort-Object
$diff = Compare-Object $expected $tableNames
if ($diff) { Write-Error "Table mismatch: expected=$($expected -join ',') got=$($tableNames -join ',')"; exit 1 }

# Verify idempotency
Initialize-ForgeMemory -DatabasePath $testDb
$tables2 = Invoke-Sqlite -Database $testDb -Query "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
$diff2 = Compare-Object $expected ($tables2 | ForEach-Object { $_.name } | Sort-Object)
if ($diff2) { Write-Error 'Idempotency failed'; exit 1 }

# Verify meta row
$meta = Invoke-Sqlite -Database $testDb -Query "SELECT * FROM forge_meta WHERE key = 'schema_version'"
if (-not $meta -or $meta[0].value -ne '1.0.0') { Write-Error 'schema_version meta row incorrect'; exit 1 }

Remove-Item $testDb -Force
Write-Host 'R1-003 PASS' -ForegroundColor Green
```

### 6. Governance

**BEHAVIORAL_CONTRACTS enforcement (Global + ForgeLearning):**
- `Initialize-ForgeMemory` must be idempotent — running on existing database must not drop or modify existing data
- All database operations via `Invoke-Sqlite` — never raw SQLite calls
- Never `DROP TABLE` or `DELETE FROM` without WHERE clause
- All functions: typed `param()` blocks, `Export-ModuleMember` at module end

Update `STATE_OF_THE_BUILD.md`: Set "Learning Engine — Schema & Initialization" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-003`.

---

## R1-004 — Learning Engine Read Functions (Part 1)

**Estimated Tokens:** 28,000

### 1. Context

From Learning Engine spec Section 2, Key Read Functions:
- `Get-ForgeMemory` — Generic table query with WHERE, ORDER BY, LIMIT. This is the general-purpose read. All other read functions can use this internally but provide type-safe, domain-specific interfaces.
- `Get-FixPattern` — Lookup by error fingerprint. Returns the matching fix_patterns row or $null. Used by PostToolUse hook to check if an error has a known fix.
- `Get-GovernanceRules` — Active rules matching tech stack + project. Returns GLOBAL rules plus PROJECT_SPECIFIC rules for the given project. Filtered by tech_stack_tags JSON array intersection. Used by PreToolUse hook to inject prevention rules.

### 2. Task

Implement `Get-ForgeMemory`, `Get-FixPattern`, and `Get-GovernanceRules` in `ForgeLearning.psm1`. `Get-ForgeMemory` is the generic query function accepting table name, WHERE clause, ORDER BY, and LIMIT. `Get-FixPattern` wraps it for fingerprint lookup. `Get-GovernanceRules` queries for active rules matching a tech stack and project, returning both GLOBAL and PROJECT_SPECIFIC scoped rules.

### 3. Acceptance Criteria

- `Get-ForgeMemory -Table <name> -Where <clause> -OrderBy <column> -Limit <n>` returns `[PSCustomObject[]]`
- `Get-ForgeMemory` with no WHERE returns all rows (up to LIMIT)
- `Get-FixPattern -Fingerprint <hash>` returns single match or $null
- `Get-GovernanceRules -TechStack @('nextjs','supabase') -ProjectName 'hail-intel'` returns rules where: `active = 1 AND (scope = 'GLOBAL' OR (scope = 'PROJECT_SPECIFIC' AND project_name = 'hail-intel'))` AND tech_stack_tags JSON contains at least one matching tag
- All functions return empty arrays (not $null) when no results match
- All functions include typed `param()` blocks
- `Export-ModuleMember` updated to include new functions
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\modules\ForgeLearning.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\modules\ForgeLearning.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\modules\ForgeLearning.psm1" -Force
$testDb = Join-Path $env:TEMP 'forge_test_read.db'
if (Test-Path $testDb) { Remove-Item $testDb -Force }
Initialize-ForgeMemory -DatabasePath $testDb

$machineId = Get-MachineId
Invoke-Sqlite -Database $testDb -Query "INSERT INTO governance_rules (id, rule_text, rule_short_name, source, tech_stack_tags, scope, project_name, active, enforcement_count, machine_id, created_at) VALUES ('r1', 'Always use RLS', 'rls-required', 'MANUAL', '[""supabase""]', 'GLOBAL', NULL, 1, 0, '$machineId', datetime('now'))"
Invoke-Sqlite -Database $testDb -Query "INSERT INTO governance_rules (id, rule_text, rule_short_name, source, tech_stack_tags, scope, project_name, active, enforcement_count, machine_id, created_at) VALUES ('r2', 'Use server actions', 'server-actions', 'MANUAL', '[""nextjs""]', 'PROJECT_SPECIFIC', 'hail-intel', 1, 0, '$machineId', datetime('now'))"

$all = Get-ForgeMemory -Table 'governance_rules' -DatabasePath $testDb
if ($all.Count -ne 2) { Write-Error "Expected 2 rules, got $($all.Count)"; exit 1 }

$rules = Get-GovernanceRules -TechStack @('supabase') -ProjectName 'hail-intel' -DatabasePath $testDb
if ($rules.Count -lt 1) { Write-Error "Expected at least 1 rule for supabase stack"; exit 1 }

$empty = Get-ForgeMemory -Table 'fix_patterns' -DatabasePath $testDb
if ($null -eq $empty) { Write-Error 'Should return empty array, not null'; exit 1 }
if ($empty.Count -ne 0) { Write-Error "Expected 0 fix patterns"; exit 1 }

Remove-Item $testDb -Force
Write-Host 'R1-004 PASS' -ForegroundColor Green
```

### 6. Governance

**BEHAVIORAL_CONTRACTS enforcement (Global + ForgeLearning):**
- All `Get-*` functions must return empty arrays (not $null) when no results match
- All database operations via `Invoke-Sqlite` — never raw SQLite calls
- All functions: typed `param()` blocks, `Export-ModuleMember` at module end
- Console: `Write-Host` only with colors — Green=PASS, Red=FAIL, Yellow=WARN, Cyan=INFO, Gray=DEBUG

Update `STATE_OF_THE_BUILD.md`: Set "Learning Engine — Read Functions Part 1" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-004`.

---

## R1-005 — Learning Engine Read Functions (Part 2)

**Estimated Tokens:** 28,000

### 1. Context

From Learning Engine spec Section 2, Key Read Functions (continued):
- `Get-BestPromptTemplates` — Aggregate prompt_scores by template hash, ordered by first-pass rate, minimum 3 samples. Used by Composer to select proven templates.
- `Get-DecisionWeights` — Aggregate by decision_type, weighted error rate, minimum 2 builds. Used by Architect/SCOUT to recommend stack choices.
- `Get-RelevantSkills` — Skills matching tech stack tags, ordered by effectiveness. Used by SessionStart to load applicable skills.
- `Get-PendingEvolutions` — All PENDING status, ordered by confidence descending. Used by SessionStart to present self-modification proposals.

### 2. Task

Implement `Get-BestPromptTemplates`, `Get-DecisionWeights`, `Get-RelevantSkills`, and `Get-PendingEvolutions` in `ForgeLearning.psm1`. These are aggregate/filtered queries that support the learning loops. Each must handle the minimum sample size requirement where specified.

### 3. Acceptance Criteria

- `Get-BestPromptTemplates -TaskType 'CRUD' -MinSamples 3` returns templates with AVG(first_pass_success) descending, only templates with COUNT >= MinSamples
- `Get-DecisionWeights -DecisionType 'auth_strategy' -MinBuilds 2` returns options with weighted downstream_error_rate, only options with sample_size >= MinBuilds
- `Get-RelevantSkills -TechStack @('nextjs','supabase')` returns skills where tech_stack_tags JSON intersects with provided tags, ordered by effectiveness_rate DESC
- `Get-PendingEvolutions` returns all rows where `status = 'PENDING'` ordered by confidence DESC
- All functions return empty arrays (not $null) when no data matches
- All functions include typed `param()` blocks
- `Export-ModuleMember` updated to include new functions
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\modules\ForgeLearning.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\modules\ForgeLearning.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\modules\ForgeLearning.psm1" -Force
$testDb = Join-Path $env:TEMP 'forge_test_read2.db'
if (Test-Path $testDb) { Remove-Item $testDb -Force }
Initialize-ForgeMemory -DatabasePath $testDb

$machineId = Get-MachineId
1..4 | ForEach-Object {
    Invoke-Sqlite -Database $testDb -Query "INSERT INTO prompt_scores (id, prompt_template_hash, task_type, tech_stack_tags, first_pass_success, retry_count, tokens_consumed, gate_pass_rate, drift_score, project_name, build_id, machine_id, created_at) VALUES ('ps$_', 'tmpl_abc', 'CRUD', '[""nextjs""]', $(if($_ -le 3){1}else{0}), 0, 25000, 1.0, 0.0, 'test', 'b1', '$machineId', datetime('now'))"
}

$best = Get-BestPromptTemplates -TaskType 'CRUD' -MinSamples 3 -DatabasePath $testDb
if ($best.Count -lt 1) { Write-Error "Expected at least 1 template result"; exit 1 }

$evos = Get-PendingEvolutions -DatabasePath $testDb
if ($null -eq $evos) { Write-Error 'Should return empty array, not null'; exit 1 }

Remove-Item $testDb -Force
Write-Host 'R1-005 PASS' -ForegroundColor Green
```

### 6. Governance

**BEHAVIORAL_CONTRACTS enforcement (Global + ForgeLearning):**
- All `Get-*` functions must return empty arrays (not $null) when no results match
- All database operations via `Invoke-Sqlite` — never raw SQLite calls
- All functions: typed `param()` blocks, `Export-ModuleMember` at module end

Update `STATE_OF_THE_BUILD.md`: Set "Learning Engine — Read Functions Part 2" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-005`.

---

## R1-006 — Learning Engine Write Functions

**Estimated Tokens:** 35,000

### 1. Context

From Learning Engine spec Section 2, Key Write Functions:
- `Save-ToForgeMemory` — Generic insert with auto-generated UUID and machine_id. Used by every module that writes to the learning database.
- `Update-FixPattern` — Update fix_diff, fix_description, increment occurrence_count. Used during Loop 2 Stage 2 CORRELATE when a known error recurs.
- `Increment-GovernanceEnforcement` — Increment enforcement_count, update last_enforced. Used by PreToolUse hook when a governance rule fires.
- `Save-PromptScore` — Write prompt execution score with all four dimensions (first_pass_success, token efficiency, gate_pass_rate, drift_score). Used by PostToolUse hook Loop 1.

From AGENTS.md additional functions:
- `Score-PromptExecution` — Compute the 4-dimensional prompt score from raw execution data, then call `Save-PromptScore`. Wrapper that calculates gate_pass_rate and drift_score from gate results and diff analysis.
- `Invoke-AutoElevation` — Check if a fix_patterns entry has `occurrence_count >= 3`. If so, auto-create a governance_rules entry with `source = 'AUTO_ELEVATED'` and link back via governance_rule_id. This drives Loop 2 Stage 3.

### 2. Task

Implement all six write functions in `ForgeLearning.psm1`. `Save-ToForgeMemory` generates a UUID via `[guid]::NewGuid().ToString()`, auto-populates `machine_id` via `Get-MachineId`, and auto-populates `created_at` with ISO 8601 timestamp `(Get-Date -Format 'o')`. It accepts a table name and a hashtable of column-value pairs. `Update-FixPattern` takes a fingerprint and updates the matching row. `Increment-GovernanceEnforcement` takes a rule ID. `Save-PromptScore` takes all four dimensions plus metadata. `Score-PromptExecution` computes scores from raw data. `Invoke-AutoElevation` checks and auto-elevates 3+ occurrence patterns.

### 3. Acceptance Criteria

- `Save-ToForgeMemory -Table 'fix_patterns' -Data @{...}` inserts a row with auto-generated id, machine_id, and created_at (ISO 8601)
- `Save-ToForgeMemory` handles JSON array values (tech_stack_tags) by serializing them via `ConvertTo-Json -Depth 10`
- `Update-FixPattern -Fingerprint <hash> -FixDiff <diff> -FixDescription <desc>` updates the matching row and increments occurrence_count
- `Increment-GovernanceEnforcement -RuleId <id>` increments enforcement_count and sets last_enforced to current ISO 8601 timestamp
- `Save-PromptScore` writes a complete prompt_scores row with all required fields from SCHEMA_REGISTRY.md
- `Score-PromptExecution` accepts raw execution data (gate results array, file diff stats, execution metadata) and computes gate_pass_rate, drift_score, then calls `Save-PromptScore`
- `Invoke-AutoElevation -Fingerprint <hash>` checks occurrence_count >= 3 on matching fix_pattern. If threshold met and no existing governance rule linked, creates a new governance_rules row with source='AUTO_ELEVATED' and updates the fix_patterns row with the governance_rule_id
- All writes verified by reading back the data
- All functions include typed `param()` blocks
- `Export-ModuleMember` updated to include all six new functions
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\modules\ForgeLearning.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\modules\ForgeLearning.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\modules\ForgeLearning.psm1" -Force
$testDb = Join-Path $env:TEMP 'forge_test_write.db'
if (Test-Path $testDb) { Remove-Item $testDb -Force }
Initialize-ForgeMemory -DatabasePath $testDb

# Test Save-ToForgeMemory
Save-ToForgeMemory -Table 'fix_patterns' -Data @{
    error_fingerprint = 'abc123'
    error_message = 'Module not found'
    error_category = 'COMPILE'
    file_path_pattern = 'app/api/*/route.ts'
    fix_diff = '--- a\n+++ b'
    fix_description = 'Add missing import'
    tech_stack_tags = '["nextjs","typescript"]'
    occurrence_count = 1
    success_rate = 1.0
} -DatabasePath $testDb

$row = Get-FixPattern -Fingerprint 'abc123' -DatabasePath $testDb
if (-not $row) { Write-Error 'Fix pattern not found after insert'; exit 1 }
if ($row.error_category -ne 'COMPILE') { Write-Error 'Wrong category'; exit 1 }

# Verify ISO 8601 timestamp format
if ($row.created_at -notmatch '^\d{4}-\d{2}-\d{2}') { Write-Error 'Timestamp not ISO 8601'; exit 1 }

# Test Update-FixPattern
Update-FixPattern -Fingerprint 'abc123' -FixDiff 'new diff' -FixDescription 'Updated fix' -DatabasePath $testDb
$updated = Get-FixPattern -Fingerprint 'abc123' -DatabasePath $testDb
if ($updated.occurrence_count -ne 2) { Write-Error "Expected occurrence_count=2, got $($updated.occurrence_count)"; exit 1 }

# Test Save-PromptScore
Save-PromptScore -TemplateHash 'tmpl1' -TaskType 'CRUD' -TechStack @('nextjs') -FirstPassSuccess 1 -RetryCount 0 -TokensConsumed 25000 -GatePassRate 1.0 -DriftScore 0.0 -ProjectName 'test' -BuildId 'b1' -DatabasePath $testDb
$score = Get-ForgeMemory -Table 'prompt_scores' -Where "prompt_template_hash = 'tmpl1'" -DatabasePath $testDb
if ($score.Count -ne 1) { Write-Error 'Prompt score not saved'; exit 1 }

# Test Invoke-AutoElevation (below threshold — should not elevate)
$rule = Get-ForgeMemory -Table 'governance_rules' -Where "source = 'AUTO_ELEVATED'" -DatabasePath $testDb
if ($rule.Count -ne 0) { Write-Error 'Should not auto-elevate at occurrence_count=2'; exit 1 }

# Bump to 3 occurrences and test auto-elevation
Update-FixPattern -Fingerprint 'abc123' -FixDiff 'diff3' -FixDescription 'Third occurrence' -DatabasePath $testDb
Invoke-AutoElevation -Fingerprint 'abc123' -DatabasePath $testDb
$elevated = Get-ForgeMemory -Table 'governance_rules' -Where "source = 'AUTO_ELEVATED'" -DatabasePath $testDb
if ($elevated.Count -ne 1) { Write-Error 'Auto-elevation failed at occurrence_count=3'; exit 1 }

Remove-Item $testDb -Force
Write-Host 'R1-006 PASS' -ForegroundColor Green
```

### 6. Governance

**BEHAVIORAL_CONTRACTS enforcement (Global + ForgeLearning):**
- All functions: typed `param()` blocks, `Export-ModuleMember` at module end
- Data: `ConvertTo-Json -Depth 10` for all JSON serialization. UUIDs via `[guid]::NewGuid().ToString()`. ISO 8601 timestamps via `(Get-Date -Format 'o')`. `machine_id` on every DB write via `Get-MachineId`
- DB: append-only — never `DELETE FROM` without WHERE, never `DROP TABLE`. All operations via `Invoke-Sqlite`
- Errors: every `catch` must re-throw, log via `Register-Error`, or write visible message — never silent catch

Update `STATE_OF_THE_BUILD.md`: Set "Learning Engine — Write Functions" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-006`.

---

## R1-007 — Error Fingerprinting & Fix Registration

**Estimated Tokens:** 22,000

### 1. Context

From Learning Engine spec Section 3: "SHA-256 hash of four concatenated components:
1. Error code — Machine-readable identifier (TS2307, no-unused-vars, TypeError, etc.)
2. Generalized file path — Dynamic segments wildcarded (`app/api/storms/route.ts` → `app/api/*/route.ts`)
3. Error message template — Specific identifiers replaced with `*` (`Module './StormMap' not found` → `Module '*' not found`)
4. Tech stack context — Sorted, comma-separated tags

Result: 64-character hex fingerprint. Two identical errors in different files = same fingerprint. Two different errors in same file = different fingerprints."

From AGENTS.md: `Register-Fix` — Record a successful fix for an error fingerprint. Updates fix_diff, fix_description, increments times_fix_applied and times_fix_succeeded, recalculates success_rate.

### 2. Task

Implement `Get-ErrorFingerprint`, `ConvertTo-GeneralizedPath`, `Register-Error`, and `Register-Fix` in `ForgeLearning.psm1`. The fingerprint function takes an error code, file path, error message, and tech stack array. It generalizes the file path, templatizes the error message, sorts the tech stack, concatenates all four components, and returns the SHA-256 hex hash. `Register-Error` creates or updates a fix_patterns row. `Register-Fix` records a successful fix and updates success tracking.

### 3. Acceptance Criteria

- `Get-ErrorFingerprint -ErrorCode 'TS2307' -FilePath 'app/api/storms/route.ts' -ErrorMessage "Module './StormMap' not found" -TechStack @('typescript','nextjs')` returns a 64-character hex string
- Same inputs produce same fingerprint on repeated calls
- Different error codes produce different fingerprints even with same file/message
- `app/api/storms/route.ts` generalizes to `app/api/*/route.ts`
- `app/[id]/page.tsx` generalizes to `app/*/page.tsx` (Next.js dynamic segments)
- `Module './StormMap' not found` templatizes to `Module '*' not found`
- `Register-Error` creates new fix_patterns row on first occurrence, increments occurrence_count on subsequent
- `Register-Fix -Fingerprint <hash> -FixDiff <diff> -FixDescription <desc>` updates fix_diff, fix_description, increments times_fix_applied and times_fix_succeeded, recalculates success_rate as `times_fix_succeeded / times_fix_applied`
- All functions include typed `param()` blocks
- `Export-ModuleMember` updated to include all new functions
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\modules\ForgeLearning.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\modules\ForgeLearning.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\modules\ForgeLearning.psm1" -Force

# Test fingerprint consistency
$fp1 = Get-ErrorFingerprint -ErrorCode 'TS2307' -FilePath 'app/api/storms/route.ts' -ErrorMessage "Module './StormMap' not found" -TechStack @('typescript','nextjs')
$fp2 = Get-ErrorFingerprint -ErrorCode 'TS2307' -FilePath 'app/api/storms/route.ts' -ErrorMessage "Module './StormMap' not found" -TechStack @('nextjs','typescript')
if ($fp1 -ne $fp2) { Write-Error 'Fingerprint not stable across tech stack ordering'; exit 1 }
if ($fp1.Length -ne 64) { Write-Error "Expected 64-char hex, got $($fp1.Length) chars"; exit 1 }

$fp3 = Get-ErrorFingerprint -ErrorCode 'TS2304' -FilePath 'app/api/storms/route.ts' -ErrorMessage "Module './StormMap' not found" -TechStack @('typescript','nextjs')
if ($fp1 -eq $fp3) { Write-Error 'Different error codes should produce different fingerprints'; exit 1 }

$fp4 = Get-ErrorFingerprint -ErrorCode 'TS2307' -FilePath 'app/api/users/route.ts' -ErrorMessage "Module './UserMap' not found" -TechStack @('typescript','nextjs')
if ($fp1 -ne $fp4) { Write-Error 'Same error pattern in different files should match'; exit 1 }

# Test Register-Error and Register-Fix
$testDb = Join-Path $env:TEMP 'forge_test_fix.db'
if (Test-Path $testDb) { Remove-Item $testDb -Force }
Initialize-ForgeMemory -DatabasePath $testDb

Register-Error -ErrorCode 'TS2307' -FilePath 'app/api/storms/route.ts' -ErrorMessage "Module './StormMap' not found" -TechStack @('typescript','nextjs') -DatabasePath $testDb
$pattern = Get-FixPattern -Fingerprint $fp1 -DatabasePath $testDb
if (-not $pattern) { Write-Error 'Register-Error did not create fix_patterns row'; exit 1 }

Register-Fix -Fingerprint $fp1 -FixDiff '--- a\n+++ b' -FixDescription 'Added import' -DatabasePath $testDb
$fixed = Get-FixPattern -Fingerprint $fp1 -DatabasePath $testDb
if ($fixed.times_fix_applied -ne 1) { Write-Error 'Register-Fix did not increment times_fix_applied'; exit 1 }
if ($fixed.success_rate -ne 1.0) { Write-Error 'success_rate should be 1.0'; exit 1 }

Remove-Item $testDb -Force
Write-Host 'R1-007 PASS' -ForegroundColor Green
```

### 6. Governance

**BEHAVIORAL_CONTRACTS enforcement (Global + ForgeLearning):**
- `Get-ErrorFingerprint` must produce identical fingerprints for the same error pattern across different files (generalized path, templated message)
- All functions: typed `param()` blocks, `Export-ModuleMember` at module end
- All database operations via `Invoke-Sqlite`
- Errors: every `catch` must re-throw, log, or write visible message — never silent catch

Update `STATE_OF_THE_BUILD.md`: Set "Learning Engine — Error Fingerprinting" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-007`.

---

## R1-008 — Cross-Machine Sync: Config & Lock Management

**Estimated Tokens:** 22,000

### 1. Context

From Learning Engine spec Section 5:
"Configuration: `~/.forge/sync_config.json` — master_path (18TB drive), lock_file path, max wait, retry interval."

"Lock Management: Create `forge_sync.lock` file before writing to master. Contains machine ID for debugging. If lock exists, wait 5 seconds, retry (max 30 seconds). Stale locks (>2 minutes old) auto-removed (crashed machine). Lock released in `finally` block (always runs)."

From AGENTS.md: ForgeSync also provides `Get-LastSyncTimestamp` and `Set-LastSyncTimestamp` for tracking sync state.

### 2. Task

Implement `ForgeSync.psm1` with: `Get-SyncConfig` (reads/creates `~/.forge/sync_config.json`), `Acquire-SyncLock` (creates lock file with retry logic and stale lock detection), `Release-SyncLock` (removes lock file), `Test-SyncAvailable` (checks if master path is accessible), `Get-LastSyncTimestamp` (reads last sync time from forge_meta), and `Set-LastSyncTimestamp` (writes last sync time to forge_meta).

### 3. Acceptance Criteria

- `Get-SyncConfig` returns a config object with master_path, lock_file, max_wait_seconds (30), retry_interval_seconds (5), stale_lock_minutes (2)
- `Get-SyncConfig` creates `~/.forge/sync_config.json` with defaults if file doesn't exist
- `Acquire-SyncLock` creates lock file at configured path containing machine_id and timestamp (ISO 8601)
- `Acquire-SyncLock` waits and retries if lock exists (up to max_wait_seconds)
- `Acquire-SyncLock` removes stale locks older than stale_lock_minutes
- `Acquire-SyncLock` returns `$true` on success, `$false` on timeout
- `Release-SyncLock` removes the lock file; no error if file already gone. Must be safe to call in `finally` blocks
- `Test-SyncAvailable` returns `$true` if master_path exists, `$false` otherwise
- `Get-LastSyncTimestamp -DatabasePath <path>` reads `last_sync_timestamp` from forge_meta
- `Set-LastSyncTimestamp -DatabasePath <path>` writes current ISO 8601 timestamp to forge_meta
- All functions include typed `param()` blocks
- Module ends with `Export-ModuleMember` listing all public functions
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\modules\ForgeSync.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\modules\ForgeSync.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\modules\ForgeSync.psm1" -Force
Import-Module "$root\modules\ForgeLearning.psm1" -Force

$config = Get-SyncConfig
if (-not $config.master_path) { Write-Error 'Config missing master_path'; exit 1 }
if ($config.max_wait_seconds -ne 30) { Write-Error 'Wrong max_wait default'; exit 1 }
if ($config.stale_lock_minutes -ne 2) { Write-Error 'Wrong stale_lock default'; exit 1 }

# Test lock with temp directory
$tempMaster = Join-Path $env:TEMP 'forge_sync_test'
New-Item -ItemType Directory -Path $tempMaster -Force | Out-Null
$lockPath = Join-Path $tempMaster 'forge_sync.lock'

$acquired = Acquire-SyncLock -LockPath $lockPath
if (-not $acquired) { Write-Error 'Failed to acquire lock'; exit 1 }
if (-not (Test-Path $lockPath)) { Write-Error 'Lock file not created'; exit 1 }

Release-SyncLock -LockPath $lockPath
if (Test-Path $lockPath) { Write-Error 'Lock file not released'; exit 1 }

# Test stale lock removal
Set-Content $lockPath '{"machine_id":"old","timestamp":"2020-01-01T00:00:00Z"}'
(Get-Item $lockPath).CreationTime = (Get-Date).AddMinutes(-5)
$acquired = Acquire-SyncLock -LockPath $lockPath
if (-not $acquired) { Write-Error 'Failed to acquire lock over stale lock'; exit 1 }
Release-SyncLock -LockPath $lockPath

# Test timestamp functions
$testDb = Join-Path $env:TEMP 'forge_sync_ts.db'
if (Test-Path $testDb) { Remove-Item $testDb -Force }
Initialize-ForgeMemory -DatabasePath $testDb
Set-LastSyncTimestamp -DatabasePath $testDb
$ts = Get-LastSyncTimestamp -DatabasePath $testDb
if (-not $ts) { Write-Error 'LastSyncTimestamp not set'; exit 1 }
Remove-Item $testDb -Force

Remove-Item $tempMaster -Recurse -Force
Write-Host 'R1-008 PASS' -ForegroundColor Green
```

### 6. Governance

**BEHAVIORAL_CONTRACTS enforcement (Global + ForgeSync):**
- Must acquire file lock before writing to master database. Always release lock in a `finally` block
- Must detect stale locks (>2 minutes old) and remove them automatically
- Must NOT sync during a run. Only at SessionStart (Pull) and SessionEnd (Push)
- All functions: typed `param()` blocks, `Export-ModuleMember` at module end
- Console: `Write-Host` only with colors — never `Write-Output` for status messages
- Before any sync operation: verify master drive path is accessible. If not, skip sync with WARN (never fail a build because external drive isn't mounted)

Update `STATE_OF_THE_BUILD.md`: Set "Cross-Machine Sync — Config & Locks" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-008`.

---

## R1-009 — Cross-Machine Sync: Pull & Push

**Estimated Tokens:** 28,000

### 1. Context

From Learning Engine spec Section 5:
"Pull (SessionStart): Read new records from master where `machine_id != local AND created_at > last_sync`. INSERT OR IGNORE into local. Read-only against master."
"Push (SessionEnd): Write local records where `machine_id = local AND created_at > last_sync` to master. INSERT OR IGNORE. Append-only."

Tables to sync (9 tables — all except forge_meta, hook_execution_log, compact_snapshots, build_fingerprints, adversary_findings): prompt_scores, fix_patterns, decision_weights, governance_rules, pending_evolutions, build_outcomes, skill_library, reconcile_decisions, scan_reports.

### 2. Task

Implement `Sync-ForgeMemory` in `ForgeSync.psm1`. Takes `-Direction` (Pull or Push). Pull reads from master DB, inserts new records into local. Push reads from local, inserts new records into master. Both use `INSERT OR IGNORE` to prevent duplicates. Uses `Get-LastSyncTimestamp`/`Set-LastSyncTimestamp` to track sync state. The function acquires a lock before Push (write to master), but not for Pull (read-only).

### 3. Acceptance Criteria

- `Sync-ForgeMemory -Direction Pull` reads records from master DB newer than last sync, inserts into local via `INSERT OR IGNORE`
- `Sync-ForgeMemory -Direction Push` acquires lock, writes local records to master, releases lock in `finally` block
- Both directions update last sync timestamp via `Set-LastSyncTimestamp` after completion
- All 9 syncable tables are covered (not forge_meta, hook_execution_log, compact_snapshots, build_fingerprints, adversary_findings)
- `INSERT OR IGNORE` prevents duplicate records — append-only, never UPDATE master records
- Push acquires lock before writing, releases in `finally` block
- Pull does not acquire lock (read-only)
- Graceful degradation: if master path unavailable, log WARN via `Write-Host -ForegroundColor Yellow` and return (no error, never fail a build)
- Must NOT sync if lock file held by another machine and less than 2 minutes old — wait and retry
- All functions include typed `param()` blocks
- `Export-ModuleMember` updated to include `Sync-ForgeMemory`
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\modules\ForgeSync.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\modules\ForgeSync.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\modules\ForgeLearning.psm1" -Force
Import-Module "$root\modules\ForgeSync.psm1" -Force

$localDb = Join-Path $env:TEMP 'forge_sync_local.db'
$masterDb = Join-Path $env:TEMP 'forge_sync_master.db'
if (Test-Path $localDb) { Remove-Item $localDb -Force }
if (Test-Path $masterDb) { Remove-Item $masterDb -Force }
Initialize-ForgeMemory -DatabasePath $localDb
Initialize-ForgeMemory -DatabasePath $masterDb

$machineId = Get-MachineId
Invoke-Sqlite -Database $masterDb -Query "INSERT INTO governance_rules (id, rule_text, rule_short_name, source, tech_stack_tags, scope, active, enforcement_count, machine_id, created_at) VALUES ('remote-rule-1', 'Always validate input', 'validate-input', 'MANUAL', '[""nextjs""]', 'GLOBAL', 1, 5, 'other-machine', datetime('now'))"

Sync-ForgeMemory -Direction Pull -LocalDbPath $localDb -MasterDbPath $masterDb
$pulled = Get-ForgeMemory -Table 'governance_rules' -Where "id = 'remote-rule-1'" -DatabasePath $localDb
if ($pulled.Count -ne 1) { Write-Error 'Pull failed - record not found in local'; exit 1 }

Save-ToForgeMemory -Table 'governance_rules' -Data @{
    rule_text = 'Local rule'; rule_short_name = 'local-test'; source = 'MANUAL'
    tech_stack_tags = '["powershell"]'; scope = 'GLOBAL'; active = 1; enforcement_count = 0
} -DatabasePath $localDb

$tempMaster = Split-Path $masterDb
Sync-ForgeMemory -Direction Push -LocalDbPath $localDb -MasterDbPath $masterDb -LockPath (Join-Path $tempMaster 'forge_sync.lock')
$pushed = Invoke-Sqlite -Database $masterDb -Query "SELECT * FROM governance_rules WHERE rule_short_name = 'local-test'"
if ($pushed.Count -ne 1) { Write-Error 'Push failed - record not found in master'; exit 1 }

Remove-Item $localDb, $masterDb -Force
Write-Host 'R1-009 PASS' -ForegroundColor Green
```

### 6. Governance

**BEHAVIORAL_CONTRACTS enforcement (Global + ForgeSync):**
- Must use `INSERT OR IGNORE` to prevent duplicate records — never UPDATE master records, append only
- Must NOT sync during a run — only at SessionStart (Pull) and SessionEnd (Push)
- Must NOT write directly to the master sync database on the 18TB drive during a run — only via `Sync-ForgeMemory` at SessionEnd
- All functions: typed `param()` blocks, `Export-ModuleMember` at module end

Update `STATE_OF_THE_BUILD.md`: Set "Cross-Machine Sync — Pull & Push" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-009`.

---

## R1-010 — Core Pipeline Controller: Entry Point & Config

**Estimated Tokens:** 25,000

### 1. Context

From Master Design Record Section 2.1: The 8-phase pipeline. `forge.ps1` is the main entry point. It routes to phases based on the command: `forge retrofit`, `forge scout`, `forge architect`, `forge scaffold`, `forge compose`, `forge execute`, `forge sentinel`, `forge deploy`.

Configuration from `forge_config.json` (project root) includes: project_path, project_name, default_tech_stack, gates (configurable per-project), max_retries, prompts_per_run, learning_db_path.

### 2. Task

Implement `forge.ps1` as the main entry point with parameter parsing, phase routing, configuration loading, and module imports. Implement `Get-ForgeConfig` and `Set-ForgeConfig` in `ForgeCore.psm1`. The entry point must validate that the project path exists, load configuration, import all required modules from `modules\`, and dispatch to the correct phase function. For Run 1, the phase functions are stubs that print "[PHASE] Not yet implemented" — they will be filled in subsequent prompts and runs.

### 3. Acceptance Criteria

- `forge.ps1` accepts: `-Command` (retrofit/scout/architect/scaffold/compose/execute/sentinel/deploy), `-ProjectPath` (required), plus command-specific flags (`-SkipDynamic`, `-ScopeA`, `-Resume`, `-IdeaFile`, `-Idea`)
- `Get-ForgeConfig -ProjectPath <path>` loads `forge_config.json` from project root or returns defaults
- `Set-ForgeConfig -ProjectPath <path> -Config <hashtable>` writes config to `forge_config.json` using `ConvertTo-Json -Depth 10`
- All modules imported at startup from `modules\`: ForgeLearning, ForgeSync, ForgeHooks, ForgeRetrofit, ForgeSession, ForgeCore
- Phase routing dispatches to correct function (stubs for now)
- Invalid command prints usage help and exits with code 1
- Missing project path prints error and exits with code 1
- All functions include typed `param()` blocks
- `ForgeCore.psm1` ends with `Export-ModuleMember` listing public functions
- `forge.ps1` passes PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\forge.ps1
C:\Users\manag\Documents\FORGE 2.0\modules\ForgeCore.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\forge.ps1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "forge.ps1 parse errors: $($errors[0].Message)"; exit 1 }
[System.Management.Automation.Language.Parser]::ParseFile("$root\modules\ForgeCore.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "ForgeCore parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\modules\ForgeCore.psm1" -Force
$config = Get-ForgeConfig -ProjectPath $root
if (-not $config.max_retries) { Write-Error 'Config missing max_retries'; exit 1 }

Write-Host 'R1-010 PASS' -ForegroundColor Green
```

### 6. Governance

**BEHAVIORAL_CONTRACTS enforcement (Global + ForgeCore):**
- Must route to the correct phase module based on command-line arguments — no silent defaults
- All functions: typed `param()` blocks, `Export-ModuleMember` at module end
- Console: `Write-Host` only with colors — Green=PASS, Red=FAIL, Yellow=WARN, Cyan=INFO, Gray=DEBUG. Never `Write-Output` for status
- JSON: `ConvertTo-Json -Depth 10` for all serialization
- Paths: never hardcode — derive from `$ProjectPath` or config

Update `STATE_OF_THE_BUILD.md`: Set "Core Pipeline — Entry Point & Config" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-010`.

---

## R1-011 — Core Pipeline: Gate Engine

**Estimated Tokens:** 22,000

### 1. Context

From Master Design Record Section 10.1-10.2: PowerShell-appropriate gates. For building FORGE itself, gates are:
- PowerShell Parser (`[System.Management.Automation.Language.Parser]::ParseFile()`) — syntax validation
- PSScriptAnalyzer — linting (if available, graceful degradation)
- SQLite schema validation — database integrity

Gates are configurable per-project via `forge_config.json` under a `gates` key. Each gate has: name, command/function, threshold, enabled, ring (which ring it runs in). The gate engine runs all enabled gates for a given ring and returns aggregate pass/fail.

### 2. Task

Implement `Invoke-ForgeGate` in `ForgeCore.psm1`. It accepts a ring number and project context, runs all enabled gates for that ring, collects results, and returns a structured result object with AllPassed boolean and per-gate details. Implement three built-in gate functions: `Test-PowerShellSyntax` (parser check on all .ps1/.psm1 files), `Test-PSScriptAnalyzer` (invoke PSScriptAnalyzer if available), `Test-SqliteSchema` (verify all 14 expected tables exist in forge_memory.db).

### 3. Acceptance Criteria

- `Invoke-ForgeGate -Ring 1 -ProjectPath <path>` runs all Ring 1 gates and returns `@{ AllPassed = $true/$false; Results = @(...) }`
- `Test-PowerShellSyntax -ProjectPath <path>` parses every .ps1/.psm1 file, returns pass/fail with error details
- `Test-PSScriptAnalyzer` gracefully degrades (returns SKIP) if PSScriptAnalyzer module not installed
- `Test-SqliteSchema` verifies all **14** expected tables exist in the learning database (matching SCHEMA_REGISTRY.md)
- Each gate result contains: Name, Status (PASS/FAIL/SKIP), Duration, Details
- Gate configuration loaded from `forge_config.json` (project root)
- All functions include typed `param()` blocks
- `Export-ModuleMember` updated to include new functions
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\modules\ForgeCore.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\modules\ForgeCore.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\modules\ForgeCore.psm1" -Force
Import-Module "$root\modules\ForgeLearning.psm1" -Force

$syntaxResult = Test-PowerShellSyntax -ProjectPath $root
if ($syntaxResult.Status -ne 'PASS') { Write-Error "Syntax gate failed: $($syntaxResult.Details)"; exit 1 }

$testDb = Join-Path $env:TEMP 'forge_gate_test.db'
if (Test-Path $testDb) { Remove-Item $testDb -Force }
Initialize-ForgeMemory -DatabasePath $testDb
$schemaResult = Test-SqliteSchema -DatabasePath $testDb
if ($schemaResult.Status -ne 'PASS') { Write-Error "Schema gate failed: $($schemaResult.Details)"; exit 1 }
Remove-Item $testDb -Force

Write-Host 'R1-011 PASS' -ForegroundColor Green
```

### 6. Governance

**BEHAVIORAL_CONTRACTS enforcement (Global + ForgeCore):**
- Must enforce all configured gates after every prompt — gate failures trigger retry logic
- All functions: typed `param()` blocks, `Export-ModuleMember` at module end
- Console: `Write-Host` only with colors — Green=PASS, Red=FAIL, Yellow=WARN, Cyan=INFO, Gray=DEBUG

Update `STATE_OF_THE_BUILD.md`: Set "Core Pipeline — Gate Engine" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-011`.

---

## R1-012 — Core Pipeline: Retry Logic & Git Snapshots

**Estimated Tokens:** 22,000

### 1. Context

From Master Design Record Section 2.2.1: Per-prompt git snapshot creation. Structured commit messages: `FORGE-[project]-P[phase]-T[task]-[status]`.

From Composer spec Section 5.7: "Rollback Instruction: Revert to git snapshot on failure. Log to learning database. Continue to next prompt."

Retry logic: configurable max_retries (default 2). On first failure, retry with error context injected. On second failure, log as FAILED, tag as skip, move to next prompt.

### 2. Task

Implement `New-ForgeSnapshot`, `Invoke-ForgeRollback`, `Invoke-PromptWithRetry`, and `New-ForgeCommit` in `ForgeCore.psm1`. Snapshots are git tags (`FORGE-SNAPSHOT-{prompt_id}`). Rollback reverts to the snapshot. Retry logic wraps prompt execution with configurable retries, injecting error context on retry. Commits use the structured message format: `FORGE-[project]-P[phase]-T[task]-[status]`.

### 3. Acceptance Criteria

- `New-ForgeSnapshot -ProjectPath <path> -PromptId 'R1-012'` creates git tag `FORGE-SNAPSHOT-R1-012`
- `Invoke-ForgeRollback -ProjectPath <path> -PromptId 'R1-012'` reverts working directory to the tagged state
- `Invoke-PromptWithRetry -ProjectPath <path> -PromptId <id> -ExecuteBlock <scriptblock> -MaxRetries <n>` runs the block, catches errors, retries with error context injected up to MaxRetries, returns structured result
- `New-ForgeCommit -ProjectPath <path> -Message 'FORGE-forge20-P2-T012-PASS'` creates a git commit with the structured message
- Before any git operation: verify `.git` directory exists — if not, initialize git
- Retry injects previous error context into the next attempt
- After max retries exhausted: log FAILED, skip prompt, continue
- All functions include typed `param()` blocks
- `Export-ModuleMember` updated to include new functions
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\modules\ForgeCore.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\modules\ForgeCore.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\modules\ForgeCore.psm1" -Force

$cmd = Get-Command New-ForgeSnapshot -ErrorAction SilentlyContinue
if (-not $cmd) { Write-Error 'New-ForgeSnapshot not found'; exit 1 }
$cmd = Get-Command Invoke-PromptWithRetry -ErrorAction SilentlyContinue
if (-not $cmd) { Write-Error 'Invoke-PromptWithRetry not found'; exit 1 }
$cmd = Get-Command New-ForgeCommit -ErrorAction SilentlyContinue
if (-not $cmd) { Write-Error 'New-ForgeCommit not found'; exit 1 }

Write-Host 'R1-012 PASS' -ForegroundColor Green
```

### 6. Governance

**BEHAVIORAL_CONTRACTS enforcement (Global + ForgeCore):**
- Must create a git snapshot (tag) before every prompt execution
- Must NOT execute a prompt if the prior prompt's blocking gate failed and max retries exhausted — skip and log
- Git commits must use structured format: `FORGE-[project]-P[phase]-T[task]-[status]`
- Before any git operation: verify `.git` directory exists — if not, initialize git
- All functions: typed `param()` blocks, `Export-ModuleMember` at module end

Update `STATE_OF_THE_BUILD.md`: Set "Core Pipeline — Retry Logic & Snapshots" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-012`.

---

## R1-013 — Core Pipeline: Build Report Generation

**Estimated Tokens:** 18,000

### 1. Context

Build reports track per-prompt execution results, aggregate pass/fail rates, token consumption, and timing. Generated at SessionEnd and stored at project root in `.forge\BUILD_REPORT.md`.

### 2. Task

Implement `Initialize-BuildTracker`, `Update-BuildTracker`, and `Export-BuildReport` in `ForgeCore.psm1`. The tracker accumulates per-prompt results in memory during a run. The report exports a markdown summary with per-prompt detail rows, aggregate statistics, and timing.

### 3. Acceptance Criteria

- `Initialize-BuildTracker -BuildId <id> -ProjectName <name>` creates an in-memory tracker hashtable
- `Update-BuildTracker -PromptId <id> -Status <PASS|FAIL|SKIP> -Attempts <n> -Tokens <n> -Duration <seconds>` appends a result entry
- `Export-BuildReport -ProjectPath <path>` writes `.forge\BUILD_REPORT.md` with:
  - Build summary (ID, project, start time, total prompts, pass rate)
  - Per-prompt table (ID, Status, Attempts, Tokens, Duration)
  - Aggregate statistics (total tokens, average duration, first-pass rate)
- Report renders as valid markdown
- All functions include typed `param()` blocks
- `Export-ModuleMember` updated to include new functions
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\modules\ForgeCore.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\modules\ForgeCore.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\modules\ForgeCore.psm1" -Force

Initialize-BuildTracker -BuildId 'test-build-001' -ProjectName 'forge20'
Update-BuildTracker -PromptId 'R1-001' -Status 'PASS' -Attempts 1 -Tokens 12000 -Duration 45
Update-BuildTracker -PromptId 'R1-002' -Status 'FAIL' -Attempts 2 -Tokens 30000 -Duration 180
Export-BuildReport -ProjectPath $root

$report = "$root\.forge\BUILD_REPORT.md"
if (-not (Test-Path $report)) { Write-Error 'Build report not created'; exit 1 }
$content = Get-Content $report -Raw
if ($content -notmatch 'R1-001') { Write-Error 'Report missing prompt R1-001'; exit 1 }
if ($content -notmatch 'PASS') { Write-Error 'Report missing PASS status'; exit 1 }

Write-Host 'R1-013 PASS' -ForegroundColor Green
```

### 6. Governance

**BEHAVIORAL_CONTRACTS enforcement (Global + ForgeCore):**
- Must generate a build report at SessionEnd summarizing pass/fail per prompt
- All functions: typed `param()` blocks, `Export-ModuleMember` at module end
- Console: `Write-Host` only with colors

Update `STATE_OF_THE_BUILD.md`: Set "Core Pipeline — Build Report" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-013`.

---

## R1-014 — Core Pipeline: Prompt Execution Orchestrator

**Estimated Tokens:** 30,000

### 1. Context

This is the EXECUTE phase engine — the function that iterates through the prompt queue and executes each prompt. From Session Orchestration spec Section 8.2:

1. Create git snapshot
2. Fire PreToolUse hooks
3. Execute the prompt (via Claude Code — in production; via a scriptblock in testing)
4. Fire PostToolUse hooks
5. Ring 2 trigger check (every 10th prompt)
6. Update prompt status
7. PreCompact trigger check
8. Git commit

The orchestrator reads a prompt status file, determines the next prompt, and drives the loop.

### 2. Task

Implement `Invoke-ForgeExecute` in `ForgeCore.psm1`. This is the main execution loop that processes prompts from a queue. It integrates snapshots, hooks, gates, retry logic, build tracking, and commit messages. For Run 1, the actual prompt execution is a scriptblock passed in (FORGE 1.0 handles the Claude Code interaction). The orchestrator manages the surrounding lifecycle.

### 3. Acceptance Criteria

- `Invoke-ForgeExecute -ProjectPath <path> -Prompts <array> -ExecuteBlock <scriptblock>` processes each prompt through the full lifecycle
- Each prompt gets: snapshot → PreToolUse hooks → execute → PostToolUse hooks → gate check → status update → commit
- Ring 2 sentinel fires every 10th prompt (calls `Invoke-SentinelRing -Ring Ring2` if available, logs SKIP if not)
- Failed prompts trigger retry logic (up to max_retries from config)
- Build tracker updated after each prompt
- PreCompact check at 80% through the queue (calls PreCompact hook)
- Function returns aggregate results (total pass/fail/retry)
- Must NOT execute a prompt if the prior prompt's blocking gate failed and max retries exhausted — skip and log
- Must NOT modify middleware.ts without explicit approval flag
- All functions include typed `param()` blocks
- `Export-ModuleMember` updated to include `Invoke-ForgeExecute`
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\modules\ForgeCore.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\modules\ForgeCore.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\modules\ForgeCore.psm1" -Force
Import-Module "$root\modules\ForgeLearning.psm1" -Force

$cmd = Get-Command Invoke-ForgeExecute -ErrorAction SilentlyContinue
if (-not $cmd) { Write-Error 'Invoke-ForgeExecute not found'; exit 1 }

Write-Host 'R1-014 PASS' -ForegroundColor Green
```

### 6. Governance

**BEHAVIORAL_CONTRACTS enforcement (Global + ForgeCore):**
- Must create a git snapshot (tag) before every prompt execution
- Must enforce all configured gates after every prompt — gate failures trigger retry logic
- Must NOT execute a prompt if the prior prompt's blocking gate failed and max retries exhausted — skip and log
- Must NOT modify middleware.ts without explicit approval flag (inherited from Reid's canonical rules)
- All functions: typed `param()` blocks, `Export-ModuleMember` at module end

Update `STATE_OF_THE_BUILD.md`: Set "Core Pipeline — Execution Orchestrator" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-014`.

---

## R1-015 — Hook System: Schema, Parser & Default Generation

**Estimated Tokens:** 25,000

### 1. Context

From Hook Lifecycle spec Section 2.1-2.3: hooks.json declarative schema with fields: name, event, action, script, blocking, timeout_seconds, enabled, on_failure, priority, description, conditions. Conditions include: file_pattern, exclude_pattern, task_types, min_prompt_number, phases.

From Section 5: 24 default hooks across 8 event types (SessionStart, PreToolUse, PostToolUse, PreCommit, PreCompact, PreDeploy, PostDeploy, SessionEnd).

### 2. Task

Implement in `ForgeHooks.psm1`: `Read-HooksConfig` (parse and validate hooks.json from project root), `Test-HooksSchema` (validate schema structure), and `New-DefaultHooksConfig` (generate the default 24-hook configuration for a new project). The parser must validate every field type, reject invalid event names, ensure unique hook names, and sort by priority.

### 3. Acceptance Criteria

- `Read-HooksConfig -ProjectPath <path>` reads `hooks.json` from project root, validates, returns structured hook array sorted by priority within each event
- `Read-HooksConfig` returns empty config (not error) if hooks.json doesn't exist
- Before executing any hook: verify hooks.json parses as valid JSON. If malformed, fall back to hardcoded minimal hooks (tsc-check, gitleaks-scan only)
- `Test-HooksSchema -Config <object>` validates schema_version, validates each hook has required fields, validates event names are one of the 8 valid types, validates timeout range (5-600)
- `New-DefaultHooksConfig -ProjectPath <path> -ProjectName <name>` generates `hooks.json` at project root with all 24 default hooks from the spec (SessionStart: sync-pull, load-knowledge, present-evolutions; PreToolUse: governance-check, fix-pattern-check; PostToolUse: tsc-check, eslint-check, schema-drift-inline, score-prompt; PreCommit: gitleaks-scan, schema-drift-commit, governance-updated; PreCompact: precompact-save; PreDeploy: sentinel-ring3, six-laws-check, env-parity; PostDeploy: health-check, readme-update, deploy-summary; SessionEnd: sync-push, update-weights, analyze-evolutions, generate-handoff, git-push-end)
- All hooks have proper priorities, blocking settings, and timeout values per the spec
- All functions include typed `param()` blocks
- Module ends with `Export-ModuleMember` listing all public functions
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\modules\ForgeHooks.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\modules\ForgeHooks.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\modules\ForgeHooks.psm1" -Force

$testPath = Join-Path $env:TEMP 'forge_hooks_test'
New-Item -ItemType Directory -Path $testPath -Force | Out-Null
New-DefaultHooksConfig -ProjectPath $testPath -ProjectName 'test-project'

$hooksFile = "$testPath\hooks.json"
if (-not (Test-Path $hooksFile)) { Write-Error 'hooks.json not created'; exit 1 }

$config = Read-HooksConfig -ProjectPath $testPath
$hookCount = ($config | Measure-Object).Count
if ($hookCount -ne 24) { Write-Error "Expected 24 hooks, got $hookCount"; exit 1 }

$events = $config | ForEach-Object { $_.event } | Select-Object -Unique
$expectedEvents = @('SessionStart','PreToolUse','PostToolUse','PreCommit','PreCompact','PreDeploy','PostDeploy','SessionEnd')
$missingEvents = $expectedEvents | Where-Object { $_ -notin $events }
if ($missingEvents) { Write-Error "Missing events: $($missingEvents -join ', ')"; exit 1 }

$rawConfig = Get-Content $hooksFile -Raw | ConvertFrom-Json
$valid = Test-HooksSchema -Config $rawConfig
if (-not $valid) { Write-Error 'Schema validation failed'; exit 1 }

Remove-Item $testPath -Recurse -Force
Write-Host 'R1-015 PASS' -ForegroundColor Green
```

### 6. Governance

**BEHAVIORAL_CONTRACTS enforcement (Global + ForgeHooks):**
- Must NOT execute disabled hooks — skip silently, no logging
- Must NOT execute hooks concurrently within the same event — sequential only
- Must NOT modify hooks.json during execution — changes go through pending_evolutions
- Before executing any hook: verify hooks.json parses as valid JSON. If malformed, fall back to hardcoded minimal hooks (tsc-check, gitleaks-scan only)
- All functions: typed `param()` blocks, `Export-ModuleMember` at module end

Update `STATE_OF_THE_BUILD.md`: Set "Hook System — Schema & Defaults" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-015`.

## R1-016 — Hook System: Condition Evaluation & Template Resolution

**Estimated Tokens:** 18,000

### 1. Context

From Hook Lifecycle spec Section 2.3 (Conditional Execution):
- `file_pattern`: Comma-separated globs. Hook fires only if affected file matches. PostToolUse only.
- `exclude_pattern`: Comma-separated globs to exclude.
- `task_types`: Hook fires only during these task types: SCAFFOLD, CRUD, INTEGRATION, etc.
- `min_prompt_number`: Skip early prompts.
- `phases`: Fire only during these FORGE phases.
All conditions are AND — every present condition must pass.

From Section 2.4 (Template Variables): `{{file}}`, `{{files}}`, `{{project_path}}`, `{{prompt_number}}`, `{{build_id}}`, `{{last_commit}}`, `{{task_type}}`, `{{phase}}`. Simple string replacement.

### 2. Task

Implement `Test-HookConditions` and `Resolve-HookTemplates` in `ForgeHooks.psm1`. `Test-HookConditions` evaluates all conditions for a hook against a context hashtable. `Resolve-HookTemplates` performs `{{key}}` replacement in the hook's action string using the context.

### 3. Acceptance Criteria

- `Test-HookConditions -Hook <hook> -Context @{ file='app/api/test/route.ts'; task_type='CRUD'; prompt_number=5; phase='EXECUTE' }` returns `$true` if all conditions pass, `$false` if any fail
- File pattern `*.ts,*.tsx` matches `test.ts` and `page.tsx` but not `style.css`
- Exclude pattern `*.config.*` excludes `tailwind.config.ts`
- Null/missing conditions are treated as "not specified" (always pass)
- `Resolve-HookTemplates -Action 'npx eslint {{file}}' -Context @{ file='app/page.tsx' }` returns `'npx eslint app/page.tsx'`
- Multiple template variables in one action all resolved
- Unresolved template variables left as-is (no error)
- All functions include typed `param()` blocks
- `Export-ModuleMember` updated to include new functions
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\modules\ForgeHooks.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\modules\ForgeHooks.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\modules\ForgeHooks.psm1" -Force

$hook = @{
    conditions = @{
        file_pattern = '*.ts,*.tsx'
        exclude_pattern = '*.config.*'
        task_types = @('CRUD','INTEGRATION')
        min_prompt_number = 3
    }
}

$pass = Test-HookConditions -Hook $hook -Context @{ file='app/api/test/route.ts'; task_type='CRUD'; prompt_number=5 }
if (-not $pass) { Write-Error 'Should pass: matching file, type, prompt'; exit 1 }

$fail1 = Test-HookConditions -Hook $hook -Context @{ file='style.css'; task_type='CRUD'; prompt_number=5 }
if ($fail1) { Write-Error 'Should fail: CSS file does not match *.ts,*.tsx'; exit 1 }

$fail2 = Test-HookConditions -Hook $hook -Context @{ file='tailwind.config.ts'; task_type='CRUD'; prompt_number=5 }
if ($fail2) { Write-Error 'Should fail: excluded by *.config.*'; exit 1 }

$resolved = Resolve-HookTemplates -Action 'npx eslint {{file}} --cwd {{project_path}}' -Context @{ file='app/page.tsx'; project_path='C:\project' }
if ($resolved -ne 'npx eslint app/page.tsx --cwd C:\project') { Write-Error "Bad resolution: $resolved"; exit 1 }

Write-Host 'R1-016 PASS' -ForegroundColor Green
```

### 6. Governance

**BEHAVIORAL_CONTRACTS enforcement (Global + ForgeHooks):**
- Must execute hooks in priority order (ascending) within each event
- All functions: typed `param()` blocks, `Export-ModuleMember` at module end

Update `STATE_OF_THE_BUILD.md`: Set "Hook System — Conditions & Templates" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-016`.

---

## R1-017 — Hook System: Action Execution with Timeout

**Estimated Tokens:** 22,000

### 1. Context

From Hook Lifecycle spec Section 3.2: "Uses Start-Job for subprocess isolation. Wait-Job with timeout_seconds. Exceeded timeout = forced kill + TIMEOUT status. PowerShell scripts execute via scriptblock. Shell commands execute via Invoke-Expression in subprocess."

From Section 2.2: `on_failure` field — BLOCK (halt pipeline), REVERT (undo last write then halt), WARN (log and continue).

### 2. Task

Implement `Invoke-HookAction` in `ForgeHooks.psm1`. It runs either a shell command (via Start-Job + Invoke-Expression) or a PowerShell function (via scriptblock) with timeout enforcement. Returns a structured result: Status (PASS/FAIL/TIMEOUT/SKIP), Output (captured stdout/stderr), Duration.

### 3. Acceptance Criteria

- `Invoke-HookAction -Hook <hook> -Action <resolved_action> -Context <hashtable>` executes the action with timeout
- Shell commands run via `Start-Job` with `Invoke-Expression` inside the job (this is the one permitted use of `Invoke-Expression` per BEHAVIORAL_CONTRACTS)
- PowerShell functions run via scriptblock in `Start-Job`
- `Wait-Job` enforces `timeout_seconds` from hook config
- Exceeded timeout = forced `Stop-Job` + `Remove-Job` + TIMEOUT status
- Successful execution with exit code 0 = PASS
- Non-zero exit code or thrown exception = FAIL
- Returns structured result: `@{ Status='PASS|FAIL|TIMEOUT|SKIP'; Output='...'; Duration=<ms> }`
- All functions include typed `param()` blocks
- `Export-ModuleMember` updated to include `Invoke-HookAction`
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\modules\ForgeHooks.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\modules\ForgeHooks.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\modules\ForgeHooks.psm1" -Force

$hook = @{ timeout_seconds = 10; action_type = 'shell' }
$result = Invoke-HookAction -Hook $hook -Action 'Write-Output "hello"' -Context @{}
if ($result.Status -ne 'PASS') { Write-Error "Expected PASS, got $($result.Status)"; exit 1 }
if ($result.Output -notmatch 'hello') { Write-Error "Expected 'hello' in output"; exit 1 }
if ($result.Duration -le 0) { Write-Error 'Duration should be positive'; exit 1 }

$hookTimeout = @{ timeout_seconds = 1; action_type = 'shell' }
$resultTimeout = Invoke-HookAction -Hook $hookTimeout -Action 'Start-Sleep -Seconds 30' -Context @{}
if ($resultTimeout.Status -ne 'TIMEOUT') { Write-Error "Expected TIMEOUT, got $($resultTimeout.Status)"; exit 1 }

Write-Host 'R1-017 PASS' -ForegroundColor Green
```

### 6. Governance

**BEHAVIORAL_CONTRACTS enforcement (Global + ForgeHooks):**
- Must enforce timeout on every hook execution — no hook runs indefinitely
- Must NOT use `Invoke-Expression` for arbitrary code execution outside of the hook system (hooks are the one permitted exception)
- All functions: typed `param()` blocks, `Export-ModuleMember` at module end

Update `STATE_OF_THE_BUILD.md`: Set "Hook System — Action Execution" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-017`.

---

## R1-018 — Hook System: Main Orchestrator (Invoke-Hook)

**Estimated Tokens:** 25,000

### 1. Context

From Hook Lifecycle spec Section 3.1: The main orchestration loop.
1. Read hooks.json
2. Filter enabled hooks matching the event
3. Sort by priority (ascending)
4. For each hook: evaluate conditions → resolve templates → execute action → handle on_failure → log result

From Section 3.3 (on_failure handling):
- `BLOCK`: Halt pipeline execution, return error to caller
- `REVERT`: Invoke `Invoke-ForgeRollback` then halt
- `WARN`: Log warning via `Write-Host -ForegroundColor Yellow`, continue to next hook

Hook recursion prevention: track execution depth. If depth > 2, suppress with WARN.

### 2. Task

Implement `Invoke-Hook` in `ForgeHooks.psm1`. This is the main entry point called by other modules when a lifecycle event fires. It reads the hook config, filters/sorts, evaluates conditions, resolves templates, executes via `Invoke-HookAction`, handles on_failure modes, prevents recursion, and logs every execution to `hook_execution_log` table via `Save-ToForgeMemory`.

### 3. Acceptance Criteria

- `Invoke-Hook -Event 'PreToolUse' -Context @{...} -ProjectPath <path>` executes all enabled hooks for the event
- Hooks execute in priority order (ascending)
- Disabled hooks are skipped silently — no logging per BEHAVIORAL_CONTRACTS
- Each execution logged to `hook_execution_log` with: hook_name, event, status, duration_ms, output, build_id, prompt_number, machine_id
- `on_failure = 'BLOCK'` halts and returns error
- `on_failure = 'WARN'` logs warning and continues
- Recursion depth > 2 suppressed with WARN — prevents infinite hook loops
- Returns aggregate result: `@{ AllPassed=$true/$false; Results=@(...); BlockedBy=$null|<hook_name> }`
- All JSON serialization uses `ConvertTo-Json -Depth 10`
- All functions include typed `param()` blocks
- `Export-ModuleMember` updated to include `Invoke-Hook`
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\modules\ForgeHooks.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\modules\ForgeHooks.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\modules\ForgeHooks.psm1" -Force
Import-Module "$root\modules\ForgeLearning.psm1" -Force

$cmd = Get-Command Invoke-Hook -ErrorAction SilentlyContinue
if (-not $cmd) { Write-Error 'Invoke-Hook not found'; exit 1 }

$testDb = Join-Path $env:TEMP 'forge_hook_test.db'
if (Test-Path $testDb) { Remove-Item $testDb -Force }
Initialize-ForgeMemory -DatabasePath $testDb

# Create a minimal test hooks.json
$testPath = Join-Path $env:TEMP 'forge_hook_project'
New-Item -ItemType Directory -Path $testPath -Force | Out-Null
@{
    schema_version = '1.0'
    hooks = @(
        @{ name='test-hook'; event='PreToolUse'; action='Write-Output "test"'; blocking=$false; timeout_seconds=10; enabled=$true; on_failure='WARN'; priority=100; description='Test' }
    )
} | ConvertTo-Json -Depth 10 | Set-Content "$testPath\hooks.json"

$result = Invoke-Hook -Event 'PreToolUse' -Context @{ build_id='test'; prompt_number=1 } -ProjectPath $testPath -DatabasePath $testDb
if (-not $result) { Write-Error 'Invoke-Hook returned null'; exit 1 }

$logs = Get-ForgeMemory -Table 'hook_execution_log' -DatabasePath $testDb
if ($logs.Count -lt 1) { Write-Error 'Hook execution not logged'; exit 1 }

Remove-Item $testDb, $testPath -Recurse -Force
Write-Host 'R1-018 PASS' -ForegroundColor Green
```

### 6. Governance

**BEHAVIORAL_CONTRACTS enforcement (Global + ForgeHooks):**
- Must execute hooks in priority order (ascending) within each event
- Must enforce timeout on every hook execution — no hook runs indefinitely
- Must log every hook execution to hook_execution_log, including SKIP results
- Must prevent hook recursion (depth > 2 suppressed with WARN)
- Must NOT execute disabled hooks — skip silently, no logging
- Must NOT execute hooks concurrently within the same event — sequential only
- All functions: typed `param()` blocks, `Export-ModuleMember` at module end
- Data: `ConvertTo-Json -Depth 10`

Update `STATE_OF_THE_BUILD.md`: Set "Hook System — Main Orchestrator" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-018`.

---

## R1-019 — Hook System: PreCompact & Context Re-injection

**Estimated Tokens:** 25,000

### 1. Context

From Hook Lifecycle spec Section 4.2: PreCompact hook saves critical context to `compact_snapshots` table before Claude's context window compaction. On resume after compaction, `Restore-CompactedContext` re-injects the saved state.

The PreCompact hook fires when FORGE detects it's at ~80% of the prompt queue (approaching context window limits in long runs). It captures: current prompt index, queue status, active errors, governance rules loaded, recent hook results.

### 2. Task

Implement `Invoke-PreCompactSave` and `Restore-CompactedContext` in `ForgeHooks.psm1`. `Invoke-PreCompactSave` gathers the current build state and writes it to `compact_snapshots` table. `Restore-CompactedContext` reads the most recent snapshot for the build and returns the state object for re-injection into the Claude Code context.

### 3. Acceptance Criteria

- `Invoke-PreCompactSave -BuildId <id> -PromptIndex <n> -State <hashtable>` serializes the state to JSON via `ConvertTo-Json -Depth 10` and writes to `compact_snapshots` table
- State hashtable includes: prompt_index, queue_status, active_errors, loaded_rules, recent_hooks, timestamp
- `Restore-CompactedContext -BuildId <id>` reads the most recent snapshot (highest prompt_index) and returns deserialized state
- Returns `$null` if no snapshot exists for the build
- All functions include typed `param()` blocks
- `Export-ModuleMember` updated to include new functions
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\modules\ForgeHooks.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\modules\ForgeHooks.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\modules\ForgeHooks.psm1" -Force
Import-Module "$root\modules\ForgeLearning.psm1" -Force

$testDb = Join-Path $env:TEMP 'forge_compact_test.db'
if (Test-Path $testDb) { Remove-Item $testDb -Force }
Initialize-ForgeMemory -DatabasePath $testDb

$state = @{
    prompt_index = 35
    queue_status = @{ total=45; completed=35; remaining=10 }
    active_errors = @()
    loaded_rules = @('rls-required','server-actions')
    recent_hooks = @('tsc-check','eslint-check')
    timestamp = (Get-Date -Format 'o')
}

Invoke-PreCompactSave -BuildId 'b1' -PromptIndex 35 -State $state -DatabasePath $testDb

$restored = Restore-CompactedContext -BuildId 'b1' -DatabasePath $testDb
if (-not $restored) { Write-Error 'Restore returned null'; exit 1 }
if ($restored.prompt_index -ne 35) { Write-Error "Expected prompt_index=35, got $($restored.prompt_index)"; exit 1 }

$empty = Restore-CompactedContext -BuildId 'nonexistent' -DatabasePath $testDb
if ($null -ne $empty) { Write-Error 'Should return null for nonexistent build'; exit 1 }

Remove-Item $testDb -Force
Write-Host 'R1-019 PASS' -ForegroundColor Green
```

### 6. Governance

**BEHAVIORAL_CONTRACTS enforcement (Global + ForgeHooks):**
- All JSON serialization uses `ConvertTo-Json -Depth 10`
- All database operations via `Invoke-Sqlite` — never raw SQLite calls
- All records include UUID `id` via `[guid]::NewGuid().ToString()` and `machine_id` via `Get-MachineId`
- All functions: typed `param()` blocks, `Export-ModuleMember` at module end

Update `STATE_OF_THE_BUILD.md`: Set "Hook System — PreCompact & Context" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-019`.

---

## R1-020 — RETROFIT Entry Point & Pre-Flight Checks

**Estimated Tokens:** 22,000

### 1. Context

From RETROFIT spec Section 2.1: "8 pre-flight checks before SCAN begins: 1. Project path exists 2. Git initialized 3. package.json exists 4. node_modules present 5. .env file exists 6. tsconfig.json exists (for TypeScript projects) 7. Database connection configured 8. Vercel project linked."

The RETROFIT pipeline lives in a single module: `modules\ForgeRetrofit.psm1` per BLUEPRINT.md. All SCAN, DIAGNOSE, and RECONCILE functions coexist in this file, organized with `#region` blocks.

### 2. Task

Implement the RETROFIT entry point and pre-flight checks in `ForgeRetrofit.psm1`. The entry function `Invoke-RetrofitScan` accepts a project path, scope (A/B/C), and flags. It runs 8 pre-flight checks before proceeding to SCAN operations. Pre-flight failures are warnings, not blockers — SCAN proceeds with degraded coverage. Also implement `Invoke-PreFlightChecks` as a standalone callable function.

### 3. Acceptance Criteria

- `Invoke-PreFlightChecks -ProjectPath <path>` runs all 8 checks and returns a results array
- Each check returns: Name, Status (PASS/WARN/FAIL), Detail
- Missing node_modules = WARN (suggest `npm install`), not FAIL
- Missing .env = WARN, not FAIL
- Missing tsconfig.json = INFO (JavaScript project, no TypeScript gates)
- No database config = WARN with degraded DB schema extraction
- No Vercel link = WARN with degraded deployment analysis
- Missing project path or no git = FAIL (these are hard blockers)
- `Invoke-RetrofitScan` stub accepts `-ProjectPath`, `-Scope` (A/B/C), `-SkipDynamic`, `-Resume` parameters
- All functions include typed `param()` blocks
- Module uses `#region SCAN`, `#region DIAGNOSE`, `#region RECONCILE` blocks for organization
- Module ends with `Export-ModuleMember` listing all public functions
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\modules\ForgeRetrofit.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\modules\ForgeRetrofit.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\modules\ForgeRetrofit.psm1" -Force

# Run pre-flight against FORGE itself (will have WARN for missing node things — that's expected)
$results = Invoke-PreFlightChecks -ProjectPath $root
if ($results.Count -ne 8) { Write-Error "Expected 8 checks, got $($results.Count)"; exit 1 }

# Verify hard blockers work
$gitCheck = $results | Where-Object { $_.Name -eq 'git-initialized' }
if ($gitCheck.Status -eq 'FAIL') { Write-Error 'Git should be initialized for FORGE project'; exit 1 }

Write-Host 'R1-020 PASS' -ForegroundColor Green
```

### 6. Governance

**BEHAVIORAL_CONTRACTS enforcement (Global + ForgeRetrofit):**
- SCAN must execute all 14 operations even if some fail — failures are logged, not fatal
- Must NOT modify any project files during SCAN or DIAGNOSE — these are read-only analysis phases
- Console: `Write-Host` only with colors — Green=PASS, Red=FAIL, Yellow=WARN, Cyan=INFO, Gray=DEBUG
- All functions: typed `param()` blocks, `Export-ModuleMember` at module end

Update `STATE_OF_THE_BUILD.md`: Set "RETROFIT — Entry Point & Pre-Flight" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-020`.

---

## R1-021 — SCAN Op 1: Directory Tree Enumeration

**Estimated Tokens:** 18,000

### 1. Context

From RETROFIT spec Section 3.1 (Operation 1): "Complete directory tree enumeration. Respects .gitignore. Captures file count, size, last modified. Excludes node_modules, .next, .git, dist, build."

### 2. Task

Implement `Invoke-ScanDirectoryTree` in `ForgeRetrofit.psm1` (inside `#region SCAN`). It walks the target project's directory tree, excluding standard build/dependency directories, and produces a structured inventory of every source file.

### 3. Acceptance Criteria

- `Invoke-ScanDirectoryTree -ProjectPath <path>` returns an array of file objects: RelativePath, Extension, SizeKB, LastModified
- Excludes: node_modules, .next, .git, dist, build, coverage, .vercel, __pycache__
- Returns aggregate stats: TotalFiles, TotalSizeKB, FilesByExtension (hashtable)
- Handles symlinks gracefully (skip with WARN)
- Must NOT modify any project files — read-only operation
- All functions include typed `param()` blocks
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\modules\ForgeRetrofit.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\modules\ForgeRetrofit.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\modules\ForgeRetrofit.psm1" -Force
$result = Invoke-ScanDirectoryTree -ProjectPath $root
if ($result.TotalFiles -lt 1) { Write-Error 'Should find at least 1 file'; exit 1 }
if (-not $result.FilesByExtension) { Write-Error 'Missing FilesByExtension'; exit 1 }

Write-Host 'R1-021 PASS' -ForegroundColor Green
```

### 6. Governance

**BEHAVIORAL_CONTRACTS enforcement (Global + ForgeRetrofit):**
- Must NOT modify any project files during SCAN — read-only analysis
- All functions: typed `param()` blocks

Update `STATE_OF_THE_BUILD.md`: Set "RETROFIT SCAN — Op 1 Directory Tree" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-021`.

---

## R1-022 — SCAN Op 2: Dependency Tree Mapping

**Estimated Tokens:** 25,000

### 1. Context

From RETROFIT spec Section 3.2 (Operation 2): "Parse all source files for import/export/require statements. Build a directed graph of file dependencies. Detect circular dependencies."

Supports: ES6 import/export, CommonJS require/module.exports, TypeScript path aliases (from tsconfig.json paths).

### 2. Task

Implement `Invoke-ScanDependencyTree` in `ForgeRetrofit.psm1`. It parses JavaScript/TypeScript files for import/export statements, resolves relative paths, handles tsconfig path aliases, and produces a dependency graph. Detects circular dependencies.

### 3. Acceptance Criteria

- `Invoke-ScanDependencyTree -ProjectPath <path> -FileInventory <array>` returns a dependency graph: Nodes (files), Edges (importer → imported), CircularDeps (array of cycles)
- Parses: `import X from 'Y'`, `import { X } from 'Y'`, `require('Y')`, `export { X }`, `export default`, dynamic `import('Y')`
- Resolves relative paths: `./utils` → `src/utils.ts` (tries .ts, .tsx, .js, .jsx, /index.ts)
- Reads tsconfig.json `paths` for alias resolution (e.g., `@/` → `src/`)
- Circular dependency detection via DFS cycle finding
- Returns: `@{ Nodes=@(...); Edges=@(...); CircularDeps=@(...); OrphanFiles=@(...) }`
- Must NOT modify any project files — read-only
- All functions include typed `param()` blocks
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\modules\ForgeRetrofit.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\modules\ForgeRetrofit.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\modules\ForgeRetrofit.psm1" -Force
$cmd = Get-Command Invoke-ScanDependencyTree -ErrorAction SilentlyContinue
if (-not $cmd) { Write-Error 'Invoke-ScanDependencyTree not found'; exit 1 }

Write-Host 'R1-022 PASS' -ForegroundColor Green
```

### 6. Governance

**BEHAVIORAL_CONTRACTS enforcement (Global + ForgeRetrofit):**
- Must NOT modify any project files during SCAN — read-only
- All functions: typed `param()` blocks

Update `STATE_OF_THE_BUILD.md`: Set "RETROFIT SCAN — Op 2 Dependency Tree" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-022`.

---

## R1-023 — SCAN Ops 3 & 4: Broken Import & Dead File Detection

**Estimated Tokens:** 22,000

### 1. Context

From RETROFIT spec Section 3.3-3.4:
- Operation 3 (Broken Imports): "Cross-reference dependency tree against file inventory. Any import target that doesn't resolve to a real file = CRITICAL finding."
- Operation 4 (Dead Files): "Files that exist in the tree but are never imported by any other file AND are not entry points (pages, API routes, layouts, middleware). Dead files = WARN finding."

### 2. Task

Implement `Invoke-ScanBrokenImports` and `Invoke-ScanDeadFiles` in `ForgeRetrofit.psm1`. Broken imports cross-references the dependency graph against the file inventory. Dead files identifies unreferenced non-entry-point files.

### 3. Acceptance Criteria

- `Invoke-ScanBrokenImports -DependencyGraph <graph> -FileInventory <array>` returns array of broken imports: SourceFile, ImportPath, ResolvedTarget (null)
- Each broken import classified as CRITICAL severity
- `Invoke-ScanDeadFiles -DependencyGraph <graph> -FileInventory <array> -RouteInventory <array>` returns array of dead files
- Entry points excluded from dead file detection: files in `pages/`, `app/` (Next.js), API routes, layouts, middleware, config files
- Dead files classified as WARN severity
- Must NOT modify any project files — read-only
- All functions include typed `param()` blocks
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\modules\ForgeRetrofit.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\modules\ForgeRetrofit.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\modules\ForgeRetrofit.psm1" -Force
$cmd1 = Get-Command Invoke-ScanBrokenImports -ErrorAction SilentlyContinue
$cmd2 = Get-Command Invoke-ScanDeadFiles -ErrorAction SilentlyContinue
if (-not $cmd1 -or -not $cmd2) { Write-Error 'Missing scan functions'; exit 1 }

Write-Host 'R1-023 PASS' -ForegroundColor Green
```

### 6. Governance

**BEHAVIORAL_CONTRACTS enforcement (Global + ForgeRetrofit):**
- Must NOT modify any project files during SCAN — read-only
- SCAN must execute even if some operations fail — failures logged, not fatal
- All functions: typed `param()` blocks

Update `STATE_OF_THE_BUILD.md`: Set "RETROFIT SCAN — Ops 3&4 Imports & Dead Files" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-023`.

---

## R1-024 — SCAN Op 5: Route Inventory

**Estimated Tokens:** 25,000

### 1. Context

From RETROFIT spec Section 3.5 (Operation 5): "Enumerate all routes: pages (file-based routing), API endpoints (with HTTP method detection), middleware chains, layout hierarchy. Capture: path, type (page/api/middleware/layout), HTTP methods (for APIs), parameters."

Supports Next.js App Router and Pages Router conventions.

### 2. Task

Implement `Invoke-ScanRouteInventory` in `ForgeRetrofit.psm1`. It scans the project for page files, API route files, middleware, and layouts. For API routes, it detects exported HTTP method handlers (GET, POST, PUT, DELETE, PATCH).

### 3. Acceptance Criteria

- `Invoke-ScanRouteInventory -ProjectPath <path>` returns array of routes: Path, Type (PAGE/API/MIDDLEWARE/LAYOUT), Methods (for API), Parameters (dynamic segments), FilePath
- Detects Next.js App Router: `app/**/page.tsx`, `app/**/route.ts`, `app/**/layout.tsx`, `middleware.ts`
- Detects Next.js Pages Router: `pages/**/*.tsx`, `pages/api/**/*.ts`
- For API routes, parses for `export async function GET/POST/PUT/DELETE/PATCH`
- Detects dynamic segments: `[id]`, `[...slug]`, `[[...slug]]`
- Returns aggregate: TotalPages, TotalAPIs, TotalMiddleware, TotalLayouts
- Must NOT modify any project files — read-only
- All functions include typed `param()` blocks
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\modules\ForgeRetrofit.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\modules\ForgeRetrofit.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\modules\ForgeRetrofit.psm1" -Force
$cmd = Get-Command Invoke-ScanRouteInventory -ErrorAction SilentlyContinue
if (-not $cmd) { Write-Error 'Invoke-ScanRouteInventory not found'; exit 1 }

Write-Host 'R1-024 PASS' -ForegroundColor Green
```

### 6. Governance

**BEHAVIORAL_CONTRACTS enforcement (Global + ForgeRetrofit):**
- Must NOT modify any project files during SCAN — read-only
- All functions: typed `param()` blocks

Update `STATE_OF_THE_BUILD.md`: Set "RETROFIT SCAN — Op 5 Route Inventory" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-024`.

---

## R1-025 — SCAN Op 6: Environment Variable Audit

**Estimated Tokens:** 20,000

### 1. Context

From RETROFIT spec Section 3.6 (Operation 6): "Three-source comparison: 1. Variables referenced in code (`process.env.X`), 2. Variables defined in `.env*` files, 3. Variables configured in Vercel (if linked). Missing in code but defined = INFO (unused). Referenced in code but missing from env = CRITICAL."

### 2. Task

Implement `Invoke-ScanEnvAudit` in `ForgeRetrofit.psm1`. It scans source files for `process.env.*` references, parses all `.env*` files, optionally reads Vercel env config, and produces a three-way comparison.

### 3. Acceptance Criteria

- `Invoke-ScanEnvAudit -ProjectPath <path>` returns: ReferencedInCode (array), DefinedInEnv (array), DefinedInVercel (array), Missing (in code but not in env — CRITICAL), Unused (in env but not in code — INFO), Mismatched (different values between .env and .env.local — WARN)
- Scans all `.ts`, `.tsx`, `.js`, `.jsx` files for `process.env.VARIABLE_NAME` patterns
- Parses `.env`, `.env.local`, `.env.development`, `.env.production`
- Vercel check is optional — if not linked, skip with INFO
- Must NOT read or expose actual secret values — only variable names
- Must NOT modify any project files — read-only
- All functions include typed `param()` blocks
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\modules\ForgeRetrofit.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\modules\ForgeRetrofit.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\modules\ForgeRetrofit.psm1" -Force
$cmd = Get-Command Invoke-ScanEnvAudit -ErrorAction SilentlyContinue
if (-not $cmd) { Write-Error 'Invoke-ScanEnvAudit not found'; exit 1 }

Write-Host 'R1-025 PASS' -ForegroundColor Green
```

### 6. Governance

**BEHAVIORAL_CONTRACTS enforcement (Global + ForgeRetrofit):**
- Must NOT store API keys, passwords, or secrets in any FORGE source file, config file, or learning database
- Must NOT modify any project files during SCAN — read-only
- All functions: typed `param()` blocks

Update `STATE_OF_THE_BUILD.md`: Set "RETROFIT SCAN — Op 6 Env Audit" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-025`.

---

## R1-026 — SCAN Op 7: Database Schema Extraction

**Estimated Tokens:** 25,000

### 1. Context

From RETROFIT spec Section 3.7 (Operation 7): "Extract schema from three sources: 1. Migration files (Supabase/Prisma), 2. TypeScript type definitions, 3. Live database (if accessible). Compare for drift: columns in migrations but not in types = WARN. Tables in types but not in migrations = CRITICAL."

### 2. Task

Implement `Invoke-ScanDbSchema` in `ForgeRetrofit.psm1`. It reads Supabase migration SQL files, TypeScript database type definitions, and optionally queries a live database. It compares the three sources for schema drift.

### 3. Acceptance Criteria

- `Invoke-ScanDbSchema -ProjectPath <path>` returns: MigrationSchema (tables/columns from SQL), TypeSchema (tables/columns from TS types), LiveSchema (from DB if accessible), Drift (array of mismatches with severity)
- Parses Supabase migrations from `supabase/migrations/*.sql` — extracts CREATE TABLE, ALTER TABLE
- Parses TypeScript types from `types/` or `lib/` directories — extracts interface/type definitions that map to tables
- Live DB query optional — skip with INFO if not accessible
- Drift: column in migration but not in types = WARN; table in types but not in migrations = CRITICAL
- Must NOT modify any project files or database — read-only
- All functions include typed `param()` blocks
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\modules\ForgeRetrofit.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\modules\ForgeRetrofit.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\modules\ForgeRetrofit.psm1" -Force
$cmd = Get-Command Invoke-ScanDbSchema -ErrorAction SilentlyContinue
if (-not $cmd) { Write-Error 'Invoke-ScanDbSchema not found'; exit 1 }

Write-Host 'R1-026 PASS' -ForegroundColor Green
```

### 6. Governance

**BEHAVIORAL_CONTRACTS enforcement (Global + ForgeRetrofit):**
- Must NOT modify any project files or database during SCAN — read-only
- Must NOT store secrets or connection strings in FORGE files
- All functions: typed `param()` blocks

Update `STATE_OF_THE_BUILD.md`: Set "RETROFIT SCAN — Op 7 DB Schema" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-026`.

---

## R1-027 — SCAN Ops 8, 9, 10: Git, Package & Governance Audits

**Estimated Tokens:** 25,000

### 1. Context

From RETROFIT spec Sections 3.8-3.10:
- Op 8 (Git History): Recent commits, branch structure, contributor count, last commit date, uncommitted changes
- Op 9 (Package Audit): Parse package.json for outdated/vulnerable dependencies via `npm audit --json` and `npm outdated --json`
- Op 10 (Governance Inventory): Detect existing governance documents (README, CONTRIBUTING, .env.example, etc.)

### 2. Task

Implement `Invoke-ScanGitHistory`, `Invoke-ScanPackageAudit`, and `Invoke-ScanGovernance` in `ForgeRetrofit.psm1`. These are lightweight analysis operations that gather project metadata.

### 3. Acceptance Criteria

- `Invoke-ScanGitHistory -ProjectPath <path>` returns: RecentCommits (last 20), BranchCount, ContributorCount, LastCommitDate, UncommittedChanges (boolean), DaysSinceLastCommit
- `Invoke-ScanPackageAudit -ProjectPath <path>` returns: TotalDeps, DevDeps, OutdatedCount, VulnerabilityCount, VulnerabilitiesBySeverity (critical/high/moderate/low)
- `Invoke-ScanGovernance -ProjectPath <path>` returns: array of detected governance files with Name, Path, Exists, SizeKB. Checks for: README.md, CONTRIBUTING.md, .env.example, .gitignore, LICENSE, CHANGELOG.md, STATE_OF_THE_BUILD.md, BLUEPRINT.md, SCHEMA_REGISTRY.md, AGENTS.md, BEHAVIORAL_CONTRACTS.md
- Each function handles graceful degradation (no git = skip, no package.json = skip)
- Must NOT modify any project files — read-only
- All functions include typed `param()` blocks
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\modules\ForgeRetrofit.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\modules\ForgeRetrofit.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\modules\ForgeRetrofit.psm1" -Force

$govResult = Invoke-ScanGovernance -ProjectPath $root
if ($govResult.Count -lt 5) { Write-Error 'Should detect governance files in FORGE project'; exit 1 }

Write-Host 'R1-027 PASS' -ForegroundColor Green
```

### 6. Governance

**BEHAVIORAL_CONTRACTS enforcement (Global + ForgeRetrofit):**
- Must NOT modify any project files during SCAN — read-only
- SCAN must execute even if some operations fail — failures logged, not fatal
- All functions: typed `param()` blocks

Update `STATE_OF_THE_BUILD.md`: Set "RETROFIT SCAN — Ops 8-10 Git/Package/Governance" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-027`.

---

## R1-028 — SCAN Ops 11 & 12: TypeScript Compilation & Test Execution

**Estimated Tokens:** 22,000

### 1. Context

From RETROFIT spec Sections 3.11-3.12:
- Op 11 (TypeScript Compilation): Run `npx tsc --noEmit` and parse structured output. Categorize errors by type (type errors, missing modules, syntax errors).
- Op 12 (Test Execution): Run existing test suite (`npm test` or `npx jest`), capture pass/fail counts, identify flaky tests.

### 2. Task

Implement `Invoke-ScanTscCheck` and `Invoke-ScanTestExecution` in `ForgeRetrofit.psm1`. Both capture structured output from CLI tools and parse results.

### 3. Acceptance Criteria

- `Invoke-ScanTscCheck -ProjectPath <path>` runs `npx tsc --noEmit 2>&1`, parses errors into: FilePath, Line, Column, ErrorCode, Message, Severity
- Groups errors by category: TypeErrors, MissingModules, SyntaxErrors
- Returns: TotalErrors, ErrorsByCategory, ErrorsByFile, TopErrors (most common)
- `Invoke-ScanTestExecution -ProjectPath <path>` runs `npx jest --json 2>&1` or `npm test`, captures: TotalTests, Passed, Failed, Skipped, Duration, FailedTestNames
- Both gracefully degrade if tools not available (return SKIP with explanation)
- Must NOT modify any project files — read-only
- All functions include typed `param()` blocks
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\modules\ForgeRetrofit.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\modules\ForgeRetrofit.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\modules\ForgeRetrofit.psm1" -Force
$cmd1 = Get-Command Invoke-ScanTscCheck -ErrorAction SilentlyContinue
$cmd2 = Get-Command Invoke-ScanTestExecution -ErrorAction SilentlyContinue
if (-not $cmd1 -or -not $cmd2) { Write-Error 'Missing scan functions'; exit 1 }

Write-Host 'R1-028 PASS' -ForegroundColor Green
```

### 6. Governance

**BEHAVIORAL_CONTRACTS enforcement (Global + ForgeRetrofit):**
- Must NOT modify any project files during SCAN — read-only
- All functions: typed `param()` blocks

Update `STATE_OF_THE_BUILD.md`: Set "RETROFIT SCAN — Ops 11-12 TSC & Tests" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-028`.

---

## R1-029 — SCAN Op 13: Dynamic Route Testing

**Estimated Tokens:** 22,000

### 1. Context

From RETROFIT spec Section 3.13 (Operation 13 — Approach A): "Start dev server, send GET requests to every discovered route, capture response codes. First RETROFIT only tests GET. No POST/PUT/DELETE."

This operation is optional and skippable via `-SkipDynamic` flag.

### 2. Task

Implement `Invoke-ScanDynamicRoutes` in `ForgeRetrofit.psm1`. It starts the dev server (`npm run dev`), waits for readiness, sends GET requests to discovered routes, captures response codes, and stops the server.

### 3. Acceptance Criteria

- `Invoke-ScanDynamicRoutes -ProjectPath <path> -Routes <array> -SkipDynamic <bool>` tests each route
- If `-SkipDynamic` is `$true`, returns SKIP immediately
- Starts dev server via `npm run dev` in background, waits for readiness (polls health endpoint or port availability, max 30 seconds)
- Sends HTTP GET to each page/API route using `Invoke-WebRequest`
- Captures: Route, StatusCode, ResponseTime, ContentType
- Dynamic segments skipped (routes with `[param]` unless test data provided)
- GET requests only — no POST/PUT/DELETE per BEHAVIORAL_CONTRACTS for first RETROFIT
- Server stopped in `finally` block (always runs)
- Timeout per request: 10 seconds
- Must NOT modify any project files — read-only
- All functions include typed `param()` blocks
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\modules\ForgeRetrofit.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\modules\ForgeRetrofit.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\modules\ForgeRetrofit.psm1" -Force

# Test skip path
$skipResult = Invoke-ScanDynamicRoutes -ProjectPath $root -Routes @() -SkipDynamic $true
if ($skipResult.Status -ne 'SKIP') { Write-Error 'SkipDynamic should return SKIP'; exit 1 }

Write-Host 'R1-029 PASS' -ForegroundColor Green
```

### 6. Governance

**BEHAVIORAL_CONTRACTS enforcement (Global + ForgeRetrofit):**
- Dynamic analysis (Operation 13) must use GET requests only on first RETROFIT — no POST/PUT/DELETE
- Must NOT modify any project files — read-only
- All functions: typed `param()` blocks

Update `STATE_OF_THE_BUILD.md`: Set "RETROFIT SCAN — Op 13 Dynamic Routes" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-029`.

---

## R1-030 — SCAN Op 14 & Report Assembly: Vercel Analysis + ScanReport Output

**Estimated Tokens:** 28,000

### 1. Context

From RETROFIT spec Section 3.14: "Query Vercel CLI for deployment history, environment variables, project settings. Compare against local configuration."

From RETROFIT spec Section 4: "ScanReport JSON assembly — all 14 operation results aggregated into a single structured report. Saved to `scan_reports` table."

### 2. Task

Implement `Invoke-ScanVercelAnalysis` and the report assembly orchestrator `Complete-ScanReport` in `ForgeRetrofit.psm1`. Also wire up the full `Invoke-RetrofitScan` orchestrator to call all 14 operations in sequence and produce the final report.

### 3. Acceptance Criteria

- `Invoke-ScanVercelAnalysis -ProjectPath <path>` returns: ProjectLinked (bool), Deployments (recent), EnvVarsConfigured (array), Framework, BuildCommand, OutputDirectory
- Graceful degradation if Vercel CLI not installed or project not linked (returns SKIP)
- `Complete-ScanReport -Results <hashtable>` assembles all 14 operation results into a structured ScanReport JSON
- ScanReport includes: project_name, scan_scope, timestamp, pre_flight_results, per-operation results, aggregate counts (critical, warn, info), summary
- `Invoke-RetrofitScan -ProjectPath <path> -Scope A` runs all 14 operations, assembles report, saves to `scan_reports` table via `Save-ToForgeMemory`, returns the complete report
- Scope determines which operations run: A (all 14), B (ops 1-10 only — no TSC/test/dynamic/Vercel), C (ops 1-4 only — structure analysis)
- Report saved with all aggregate counts per SCHEMA_REGISTRY.md scan_reports table
- All JSON uses `ConvertTo-Json -Depth 10`
- All functions include typed `param()` blocks
- `Export-ModuleMember` updated to include all new functions
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\modules\ForgeRetrofit.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\modules\ForgeRetrofit.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\modules\ForgeRetrofit.psm1" -Force
Import-Module "$root\modules\ForgeLearning.psm1" -Force

$cmd = Get-Command Invoke-RetrofitScan -ErrorAction SilentlyContinue
if (-not $cmd) { Write-Error 'Invoke-RetrofitScan not found'; exit 1 }
$cmd = Get-Command Complete-ScanReport -ErrorAction SilentlyContinue
if (-not $cmd) { Write-Error 'Complete-ScanReport not found'; exit 1 }

Write-Host 'R1-030 PASS' -ForegroundColor Green
```

### 6. Governance

**BEHAVIORAL_CONTRACTS enforcement (Global + ForgeRetrofit):**
- SCAN must execute all 14 operations even if some fail — failures are logged, not fatal
- Must NOT modify any project files during SCAN — read-only
- All JSON serialization uses `ConvertTo-Json -Depth 10`
- All database writes include `machine_id` via `Get-MachineId` and UUID `id` via `[guid]::NewGuid().ToString()`
- All functions: typed `param()` blocks, `Export-ModuleMember` at module end

Update `STATE_OF_THE_BUILD.md`: Set "RETROFIT SCAN — Op 14 & Report Assembly" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-030`.

## R1-031 — Session Orchestration: Build Fingerprinting

**Estimated Tokens:** 22,000

### 1. Context

From Session Orchestration spec Section 2: "Build fingerprint = SHA-256 hash of all source file contents + governance document contents. Used to detect drift between runs. If fingerprint changes between SessionEnd and next SessionStart, manual intervention required."

From SCHEMA_REGISTRY.md: `build_fingerprints` table stores fingerprints per build and prompt number.

### 2. Task

Implement `Get-BuildFingerprint` and `Test-FingerprintMatch` in `ForgeSession.psm1`. The fingerprint function hashes all source files and governance documents in the project. The match function compares current fingerprint against the last stored fingerprint for a build.

### 3. Acceptance Criteria

- `Get-BuildFingerprint -ProjectPath <path>` returns a 64-character hex SHA-256 hash
- Hash includes all `.ps1`, `.psm1` files and all `.md` governance documents
- Hash excludes: `.forge/`, `node_modules/`, `.git/`, `lib/`
- Same project state produces same fingerprint on repeated calls
- Adding/modifying a file changes the fingerprint
- `Test-FingerprintMatch -BuildId <id> -CurrentFingerprint <hash>` checks the most recent stored fingerprint for the build against the provided hash, returns `$true` if they match
- Fingerprint saved to `build_fingerprints` table via `Save-ToForgeMemory` with build_id, prompt_number, fingerprint, file_count, total_size_kb
- All functions include typed `param()` blocks
- Module ends with `Export-ModuleMember` listing all public functions
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\modules\ForgeSession.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\modules\ForgeSession.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\modules\ForgeSession.psm1" -Force
Import-Module "$root\modules\ForgeLearning.psm1" -Force

$fp1 = Get-BuildFingerprint -ProjectPath $root
$fp2 = Get-BuildFingerprint -ProjectPath $root
if ($fp1 -ne $fp2) { Write-Error 'Fingerprint not stable'; exit 1 }
if ($fp1.Length -ne 64) { Write-Error "Expected 64-char hex, got $($fp1.Length)"; exit 1 }

Write-Host 'R1-031 PASS' -ForegroundColor Green
```

### 6. Governance

**BEHAVIORAL_CONTRACTS enforcement (Global + ForgeSession):**
- Must verify build fingerprint at every SessionStart before resuming — mismatch requires human decision
- All functions: typed `param()` blocks, `Export-ModuleMember` at module end
- All database writes include `machine_id` and UUID `id`

Update `STATE_OF_THE_BUILD.md`: Set "Session — Build Fingerprinting" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-031`.

---

## R1-032 — Session Orchestration: State Serialization

**Estimated Tokens:** 25,000

### 1. Context

From Session Orchestration spec Section 3: "Export-SessionState serializes complete build state to `session_state.json`. Includes: build_id, project_name, project_path, current_prompt, queue_status, all prompt results, build fingerprint, timestamp, error summary, learning engine stats."

### 2. Task

Implement `Export-SessionState` and `Import-SessionState` in `ForgeSession.psm1`. Export serializes the current build state to a JSON file at `.forge\session_state.json`. Import reads it back.

### 3. Acceptance Criteria

- `Export-SessionState -ProjectPath <path> -State <hashtable>` writes `.forge\session_state.json`
- State includes 30+ fields: build_id, project_name, project_path, mode (GREENFIELD/RETROFIT), current_run, current_prompt_index, total_prompts, prompts_completed, prompts_remaining, prompt_results (array), build_fingerprint, start_time, last_update_time, end_reason, error_summary, governance_rules_loaded, hooks_executed, tokens_consumed, first_pass_rate, machine_id, tech_stack, config_snapshot
- Uses `ConvertTo-Json -Depth 10` for serialization
- `Import-SessionState -ProjectPath <path>` reads and deserializes `.forge\session_state.json`
- Returns `$null` if file doesn't exist (not error)
- Must NOT overwrite session_state.json during a run — only at SessionEnd per BEHAVIORAL_CONTRACTS
- All functions include typed `param()` blocks
- `Export-ModuleMember` updated
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\modules\ForgeSession.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\modules\ForgeSession.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\modules\ForgeSession.psm1" -Force

$testPath = Join-Path $env:TEMP 'forge_session_test'
New-Item -ItemType Directory -Path "$testPath\.forge" -Force | Out-Null

$state = @{
    build_id = 'test-build'
    project_name = 'test'
    current_prompt_index = 10
    total_prompts = 45
    prompts_completed = 10
    prompts_remaining = 35
    start_time = (Get-Date -Format 'o')
    machine_id = 'test-machine'
}

Export-SessionState -ProjectPath $testPath -State $state
$loaded = Import-SessionState -ProjectPath $testPath
if (-not $loaded) { Write-Error 'Import returned null'; exit 1 }
if ($loaded.build_id -ne 'test-build') { Write-Error 'build_id mismatch'; exit 1 }

$empty = Import-SessionState -ProjectPath (Join-Path $env:TEMP 'nonexistent')
if ($null -ne $empty) { Write-Error 'Should return null for missing file'; exit 1 }

Remove-Item $testPath -Recurse -Force
Write-Host 'R1-032 PASS' -ForegroundColor Green
```

### 6. Governance

**BEHAVIORAL_CONTRACTS enforcement (Global + ForgeSession):**
- Must serialize complete state to `session_state.json` at every SessionEnd, regardless of end reason
- Must NOT overwrite session_state.json during a run — only at SessionEnd
- Data: `ConvertTo-Json -Depth 10`, ISO 8601 timestamps
- All functions: typed `param()` blocks, `Export-ModuleMember` at module end

Update `STATE_OF_THE_BUILD.md`: Set "Session — State Serialization" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-032`.

---

## R1-033 — Session Orchestration: Queue Status Tracking

**Estimated Tokens:** 18,000

### 1. Context

From Session Orchestration spec Section 4: "Track per-prompt execution status. Support filtering by status, module, and date range."

### 2. Task

Implement `Get-DetailedQueueStatus` and `Update-PromptStatus` in `ForgeSession.psm1`. These manage the prompt queue tracking within a run.

### 3. Acceptance Criteria

- `Update-PromptStatus -BuildId <id> -PromptId <id> -Status <PASS|FAIL|SKIP|PENDING> -Attempts <n> -Tokens <n> -Duration <seconds> -Error <string>` records prompt execution status
- Status stored in memory during the run (hashtable keyed by prompt ID)
- `Get-DetailedQueueStatus -BuildId <id>` returns: array of prompt statuses, aggregate stats (total, completed, passed, failed, skipped, pending), first_pass_rate, average_tokens, average_duration
- Filter support: `-Status 'FAIL'` returns only failed prompts
- All functions include typed `param()` blocks
- `Export-ModuleMember` updated
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\modules\ForgeSession.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\modules\ForgeSession.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\modules\ForgeSession.psm1" -Force

Update-PromptStatus -BuildId 'b1' -PromptId 'R1-001' -Status 'PASS' -Attempts 1 -Tokens 12000 -Duration 45
Update-PromptStatus -BuildId 'b1' -PromptId 'R1-002' -Status 'FAIL' -Attempts 2 -Tokens 30000 -Duration 180 -Error 'Parse error'

$status = Get-DetailedQueueStatus -BuildId 'b1'
if ($status.Completed -ne 2) { Write-Error "Expected 2 completed, got $($status.Completed)"; exit 1 }
if ($status.Passed -ne 1) { Write-Error "Expected 1 passed"; exit 1 }

$failed = Get-DetailedQueueStatus -BuildId 'b1' -Status 'FAIL'
if ($failed.Prompts.Count -ne 1) { Write-Error "Expected 1 failed prompt"; exit 1 }

Write-Host 'R1-033 PASS' -ForegroundColor Green
```

### 6. Governance

**BEHAVIORAL_CONTRACTS enforcement (Global + ForgeSession):**
- All functions: typed `param()` blocks, `Export-ModuleMember` at module end
- Console: `Write-Host` only with colors

Update `STATE_OF_THE_BUILD.md`: Set "Session — Queue Status" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-033`.

---

## R1-034 — Session Orchestration: Session Resumption

**Estimated Tokens:** 22,000

### 1. Context

From Session Orchestration spec Section 5: "Resume-ForgeSession loads session_state.json, verifies build fingerprint, checks for stale locks, and reconstructs the execution context for continued prompt execution."

### 2. Task

Implement `Resume-ForgeSession` in `ForgeSession.psm1`. It loads the serialized session state, verifies the build fingerprint hasn't changed, warns if the session is stale (>24 hours since last activity), and returns the reconstruction context.

### 3. Acceptance Criteria

- `Resume-ForgeSession -ProjectPath <path>` loads `.forge\session_state.json`
- Verifies build fingerprint matches via `Test-FingerprintMatch`
- If fingerprint mismatch: returns `@{ CanResume=$false; Reason='FINGERPRINT_MISMATCH'; Details=<diff_info> }`
- If session stale (>24 hours): adds WARN but allows resume with `@{ CanResume=$true; Warnings=@('Session stale: X hours since last activity') }`
- If clean match: returns `@{ CanResume=$true; State=<restored_state>; NextPrompt=<id> }`
- Must NOT resume from a stale session without fingerprint verification per BEHAVIORAL_CONTRACTS
- All functions include typed `param()` blocks
- `Export-ModuleMember` updated
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\modules\ForgeSession.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\modules\ForgeSession.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\modules\ForgeSession.psm1" -Force
$cmd = Get-Command Resume-ForgeSession -ErrorAction SilentlyContinue
if (-not $cmd) { Write-Error 'Resume-ForgeSession not found'; exit 1 }

Write-Host 'R1-034 PASS' -ForegroundColor Green
```

### 6. Governance

**BEHAVIORAL_CONTRACTS enforcement (Global + ForgeSession):**
- Must verify build fingerprint at every SessionStart before resuming — mismatch requires human decision
- Must NOT resume from a stale session without fingerprint verification
- Must check for crash recovery (stale lock file) before any other SessionStart action
- All functions: typed `param()` blocks, `Export-ModuleMember` at module end

Update `STATE_OF_THE_BUILD.md`: Set "Session — Resumption" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-034`.

---

## R1-035 — Session Orchestration: Fingerprint Mismatch Handling

**Estimated Tokens:** 18,000

### 1. Context

From Session Orchestration spec Section 5.2: "When fingerprint mismatch detected: 1. Run git diff to identify changed files, 2. Present options: CONTINUE (accept changes), ROLLBACK (revert to last snapshot), ABORT (stop entirely), 3. Log decision to learning database."

### 2. Task

Implement `Handle-FingerprintMismatch` in `ForgeSession.psm1`. It gathers diff information, presents options to the operator, and executes the chosen action.

### 3. Acceptance Criteria

- `Handle-FingerprintMismatch -ProjectPath <path> -ExpectedFingerprint <hash> -ActualFingerprint <hash>` gathers diff info
- Runs `git diff --name-only` to list changed files
- Runs `git diff --stat` for summary statistics
- Returns structured result: ChangedFiles (array), DiffStats (insertions/deletions), Options (CONTINUE/ROLLBACK/ABORT)
- In automated mode: accepts a `-Decision` parameter to skip interactive prompt
- In interactive mode: uses `Read-Host` to ask operator for decision
- Decision logged to `build_outcomes` or `build_fingerprints` table
- All functions include typed `param()` blocks
- `Export-ModuleMember` updated
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\modules\ForgeSession.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\modules\ForgeSession.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\modules\ForgeSession.psm1" -Force
$cmd = Get-Command Handle-FingerprintMismatch -ErrorAction SilentlyContinue
if (-not $cmd) { Write-Error 'Handle-FingerprintMismatch not found'; exit 1 }

Write-Host 'R1-035 PASS' -ForegroundColor Green
```

### 6. Governance

**BEHAVIORAL_CONTRACTS enforcement (Global + ForgeSession):**
- All functions: typed `param()` blocks, `Export-ModuleMember` at module end

Update `STATE_OF_THE_BUILD.md`: Set "Session — Fingerprint Mismatch" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-035`.

---

## R1-036 — Session Orchestration: Crash Recovery & Locks

**Estimated Tokens:** 18,000

### 1. Context

From Session Orchestration spec Section 6: "Crash recovery via lock file detection. If `forge_running.lock` exists at SessionStart, a previous run crashed. Read lock file for build_id, check compact_snapshots for recovery data."

### 2. Task

Implement `Test-CrashRecovery`, `Set-ForgeLock`, and `Remove-ForgeLock` in `ForgeSession.psm1`. The lock file marks a run as in-progress and enables crash detection on next startup.

### 3. Acceptance Criteria

- `Set-ForgeLock -ProjectPath <path> -BuildId <id>` creates `.forge\forge_running.lock` with build_id, machine_id, timestamp (ISO 8601)
- `Remove-ForgeLock -ProjectPath <path>` removes the lock file — must be safe in `finally` blocks (no error if file missing)
- `Test-CrashRecovery -ProjectPath <path>` checks if lock file exists
- If lock exists: reads build_id from lock, checks `compact_snapshots` for recovery data, returns `@{ CrashDetected=$true; BuildId=<id>; RecoveryAvailable=$true/$false; LastSnapshot=<data> }`
- If no lock: returns `@{ CrashDetected=$false }`
- Must create lock at SessionStart and remove at SessionEnd (in `finally` block) per BEHAVIORAL_CONTRACTS
- All functions include typed `param()` blocks
- `Export-ModuleMember` updated
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\modules\ForgeSession.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\modules\ForgeSession.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\modules\ForgeSession.psm1" -Force

$testPath = Join-Path $env:TEMP 'forge_lock_test'
New-Item -ItemType Directory -Path "$testPath\.forge" -Force | Out-Null

# Test no crash
$noCrash = Test-CrashRecovery -ProjectPath $testPath
if ($noCrash.CrashDetected) { Write-Error 'Should not detect crash'; exit 1 }

# Test lock creation and crash detection
Set-ForgeLock -ProjectPath $testPath -BuildId 'crash-test'
$crash = Test-CrashRecovery -ProjectPath $testPath
if (-not $crash.CrashDetected) { Write-Error 'Should detect crash'; exit 1 }
if ($crash.BuildId -ne 'crash-test') { Write-Error 'Wrong build_id'; exit 1 }

# Test lock removal
Remove-ForgeLock -ProjectPath $testPath
$afterRemove = Test-CrashRecovery -ProjectPath $testPath
if ($afterRemove.CrashDetected) { Write-Error 'Should not detect crash after removal'; exit 1 }

# Test idempotent removal
Remove-ForgeLock -ProjectPath $testPath  # should not error

Remove-Item $testPath -Recurse -Force
Write-Host 'R1-036 PASS' -ForegroundColor Green
```

### 6. Governance

**BEHAVIORAL_CONTRACTS enforcement (Global + ForgeSession):**
- Must create `forge_running.lock` at SessionStart and remove it at SessionEnd (in a `finally` block)
- Must check for crash recovery (stale lock file) before any other SessionStart action
- All functions: typed `param()` blocks, `Export-ModuleMember` at module end

Update `STATE_OF_THE_BUILD.md`: Set "Session — Crash Recovery & Locks" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-036`.

---

## R1-037 — Session Orchestration: Handoff Document Generation

**Estimated Tokens:** 20,000

### 1. Context

From Session Orchestration spec Section 7: "Export-SessionHandoff generates a markdown document summarizing everything the next run needs to know. This is the bridge between runs."

### 2. Task

Implement `Export-SessionHandoff` in `ForgeSession.psm1`. It generates a comprehensive handoff document with 8 sections.

### 3. Acceptance Criteria

- `Export-SessionHandoff -ProjectPath <path> -State <hashtable>` writes `SESSION_HANDOFF.md` at project root
- Document includes 8 sections:
  1. Build Summary — ID, project, mode, dates, total prompts executed
  2. Completion Status — per-module status table
  3. Queue Status — remaining prompts with dependencies
  4. Known Issues — failed prompts, unresolved errors
  5. Learning Summary — new patterns learned, governance rules added, skills generated
  6. Architecture Decisions — decisions made during the run
  7. Environment Notes — machine-specific configuration, external dependencies
  8. Next Run Recommendations — priority modules, estimated prompts, prerequisites
- All functions include typed `param()` blocks
- `Export-ModuleMember` updated
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\modules\ForgeSession.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\modules\ForgeSession.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\modules\ForgeSession.psm1" -Force

$testPath = Join-Path $env:TEMP 'forge_handoff_test'
New-Item -ItemType Directory -Path $testPath -Force | Out-Null

$state = @{
    build_id = 'test-build'
    project_name = 'test'
    total_prompts = 45
    prompts_completed = 40
    prompt_results = @()
    start_time = (Get-Date).AddHours(-2).ToString('o')
}

Export-SessionHandoff -ProjectPath $testPath -State $state
$handoff = Join-Path $testPath 'SESSION_HANDOFF.md'
if (-not (Test-Path $handoff)) { Write-Error 'Handoff not created'; exit 1 }
$content = Get-Content $handoff -Raw
if ($content -notmatch 'Build Summary') { Write-Error 'Missing Build Summary section'; exit 1 }
if ($content -notmatch 'Next Run') { Write-Error 'Missing Next Run section'; exit 1 }

Remove-Item $testPath -Recurse -Force
Write-Host 'R1-037 PASS' -ForegroundColor Green
```

### 6. Governance

**BEHAVIORAL_CONTRACTS enforcement (Global + ForgeSession):**
- All functions: typed `param()` blocks, `Export-ModuleMember` at module end

Update `STATE_OF_THE_BUILD.md`: Set "Session — Handoff Document" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-037`.

---

## R1-038 — Session Orchestration: Run Lifecycle Integration

**Estimated Tokens:** 22,000

### 1. Context

From Session Orchestration spec Section 8: "Wire Invoke-RunStart and Invoke-RunEnd into forge.ps1. These functions bookend every FORGE run."

### 2. Task

Implement `Invoke-RunStart` and `Invoke-RunEnd` in `ForgeSession.psm1`, then wire them into `forge.ps1`. RunStart handles: crash recovery check, fingerprint verification, session resumption, lock creation, SessionStart hooks. RunEnd handles: state serialization, build report, handoff generation, lock removal, SessionEnd hooks.

### 3. Acceptance Criteria

- `Invoke-RunStart -ProjectPath <path> -BuildId <id>` executes in order: Test-CrashRecovery → Resume-ForgeSession (if applicable) → Get-BuildFingerprint → Set-ForgeLock → Invoke-Hook SessionStart
- `Invoke-RunEnd -ProjectPath <path> -State <hashtable> -EndReason <COMPLETED|PAUSED|FAILED|INTERRUPTED>` executes in order: Export-SessionState → Export-BuildReport → Export-SessionHandoff → Invoke-Hook SessionEnd → Remove-ForgeLock (in `finally`)
- Lock removal in `Invoke-RunEnd` must be in a `finally` block — always executes
- `forge.ps1` calls `Invoke-RunStart` before phase dispatch and `Invoke-RunEnd` after (in try/finally)
- Save build outcome to `build_outcomes` table via `Save-ToForgeMemory`
- All functions include typed `param()` blocks
- `Export-ModuleMember` updated
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\forge.ps1
C:\Users\manag\Documents\FORGE 2.0\modules\ForgeSession.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\forge.ps1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "forge.ps1 parse errors: $($errors[0].Message)"; exit 1 }
[System.Management.Automation.Language.Parser]::ParseFile("$root\modules\ForgeSession.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "ForgeSession parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\modules\ForgeSession.psm1" -Force
$cmd1 = Get-Command Invoke-RunStart -ErrorAction SilentlyContinue
$cmd2 = Get-Command Invoke-RunEnd -ErrorAction SilentlyContinue
if (-not $cmd1 -or -not $cmd2) { Write-Error 'Missing RunStart/RunEnd functions'; exit 1 }

Write-Host 'R1-038 PASS' -ForegroundColor Green
```

### 6. Governance

**BEHAVIORAL_CONTRACTS enforcement (Global + ForgeSession + ForgeCore):**
- Must create `forge_running.lock` at SessionStart and remove at SessionEnd (in `finally` block)
- Must serialize complete state to `session_state.json` at every SessionEnd, regardless of end reason
- Must verify build fingerprint at every SessionStart before resuming
- Must check for crash recovery before any other SessionStart action
- All functions: typed `param()` blocks, `Export-ModuleMember` at module end

Update `STATE_OF_THE_BUILD.md`: Set "Session — Run Lifecycle Integration" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-038`.

---

## R1-039 — DIAGNOSE: Console Output Formatter

**Estimated Tokens:** 20,000

### 1. Context

From RETROFIT spec Section 5.1: "DIAGNOSE output is designed for immediate Reid consumption. Color-coded console output with severity badges. Findings grouped by category and sorted by severity."

### 2. Task

Implement `Write-Finding` and `Format-ScanFindings` in `ForgeRetrofit.psm1` (inside `#region DIAGNOSE`). These format SCAN results into color-coded, categorized console output.

### 3. Acceptance Criteria

- `Write-Finding -Finding <object>` renders a single finding with severity badge and color:
  - CRITICAL: Red background, `[CRITICAL]` prefix
  - WARN: Yellow, `[WARN]` prefix
  - INFO: Cyan, `[INFO]` prefix
- `Format-ScanFindings -ScanReport <object>` groups findings by category (Imports, Dead Files, Schema, Routes, Env, Tests, Security), sorts by severity within each group, and renders all via `Write-Finding`
- Summary header shows: total findings, critical count, warn count, info count
- Summary footer shows: recommended next actions
- Uses only `Write-Host` with `-ForegroundColor` per BEHAVIORAL_CONTRACTS — never `Write-Output`
- All functions include typed `param()` blocks
- `Export-ModuleMember` updated
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\modules\ForgeRetrofit.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\modules\ForgeRetrofit.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\modules\ForgeRetrofit.psm1" -Force

# Test Write-Finding with a mock finding
$finding = @{ Severity='CRITICAL'; Category='Imports'; Message='Missing module'; File='app/api/route.ts'; Detail='Cannot resolve ./utils' }
Write-Finding -Finding $finding  # Should render with red color

$cmd = Get-Command Format-ScanFindings -ErrorAction SilentlyContinue
if (-not $cmd) { Write-Error 'Format-ScanFindings not found'; exit 1 }

Write-Host 'R1-039 PASS' -ForegroundColor Green
```

### 6. Governance

**BEHAVIORAL_CONTRACTS enforcement (Global + ForgeRetrofit):**
- Console: `Write-Host` only with colors — Green=PASS, Red=FAIL, Yellow=WARN, Cyan=INFO, Gray=DEBUG. Never `Write-Output` for status
- Must NOT modify any project files during DIAGNOSE — read-only
- All functions: typed `param()` blocks

Update `STATE_OF_THE_BUILD.md`: Set "DIAGNOSE — Console Formatter" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-039`.

---

## R1-040 — DIAGNOSE: Architecture Health Report

**Estimated Tokens:** 25,000

### 1. Context

From RETROFIT spec Section 5.2: "Architecture Health Report assesses overall project health across dimensions: Structural Integrity, Dependency Health, Test Coverage, Security Posture, Documentation Completeness, Schema Consistency."

From RETROFIT spec Section 5.3: "Maturity stage detection: FOUNDATION (0-3 months, basic structure), GROWTH (3-12 months, feature expansion), ENTERPRISE (12+ months, optimization and hardening)."

### 2. Task

Implement `New-ArchitectureHealthReport` in `ForgeRetrofit.psm1`. It takes the ScanReport and produces a multi-dimensional health assessment with scores, maturity stage detection, and improvement recommendations.

### 3. Acceptance Criteria

- `New-ArchitectureHealthReport -ScanReport <object>` returns structured report with:
  - Overall health score (0-100)
  - Per-dimension scores: StructuralIntegrity, DependencyHealth, TestCoverage, SecurityPosture, DocumentationCompleteness, SchemaConsistency
  - Maturity stage: FOUNDATION, GROWTH, or ENTERPRISE (detected from project age, feature count, test coverage, governance doc count)
  - Top 5 improvement recommendations sorted by impact
  - Risk assessment: critical risks, moderate risks, minor risks
- Each dimension scored 0-100 based on SCAN findings:
  - StructuralIntegrity: broken imports (-20 per CRITICAL), dead files (-5 per WARN), circular deps (-15 per cycle)
  - DependencyHealth: outdated packages (-2 per), vulnerabilities (-10 per critical, -5 per high)
  - TestCoverage: test pass rate directly, -10 per failing test
  - SecurityPosture: env vars exposed (-20 per), gitleaks findings (-30 per)
  - DocumentationCompleteness: governance docs present (+15 per), README (+10)
  - SchemaConsistency: schema drift (-15 per mismatch)
- Maturity stage inferred from: days since first commit, total routes, test count, governance doc coverage
- Must NOT modify any project files — read-only
- All functions include typed `param()` blocks
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\modules\ForgeRetrofit.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\modules\ForgeRetrofit.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\modules\ForgeRetrofit.psm1" -Force
$cmd = Get-Command New-ArchitectureHealthReport -ErrorAction SilentlyContinue
if (-not $cmd) { Write-Error 'New-ArchitectureHealthReport not found'; exit 1 }

Write-Host 'R1-040 PASS' -ForegroundColor Green
```

### 6. Governance

**BEHAVIORAL_CONTRACTS enforcement (Global + ForgeRetrofit):**
- Must NOT modify any project files during DIAGNOSE — read-only
- All functions: typed `param()` blocks

Update `STATE_OF_THE_BUILD.md`: Set "DIAGNOSE — Architecture Health Report" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-040`.

---

## R1-041 — DIAGNOSE: Governance Reconciliation Report

**Estimated Tokens:** 18,000

### 1. Context

From RETROFIT spec Section 5.4: "Compare what governance documents describe against what the codebase actually implements. Two categories: UNBUILT (documented but not implemented), UNDOCUMENTED (implemented but not documented)."

### 2. Task

Implement `New-GovernanceReconciliationReport` in `ForgeRetrofit.psm1`. It cross-references governance documents (BLUEPRINT, AGENTS, SCHEMA_REGISTRY) against actual codebase state from the ScanReport.

### 3. Acceptance Criteria

- `New-GovernanceReconciliationReport -ScanReport <object> -ProjectPath <path>` returns: UnbuiltFeatures (in docs but not in code), UndocumentedFeatures (in code but not in docs), ReconciliationScore (percentage of alignment)
- Reads BLUEPRINT.md for expected file structure and compares against actual directory tree
- Reads AGENTS.md for expected functions and compares against actual exports
- Reads SCHEMA_REGISTRY.md for expected tables and compares against actual database schema
- Each finding includes: FeatureName, Source (which governance doc), Category (UNBUILT/UNDOCUMENTED), Severity, Detail
- Must NOT modify any project files — read-only
- All functions include typed `param()` blocks
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\modules\ForgeRetrofit.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\modules\ForgeRetrofit.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\modules\ForgeRetrofit.psm1" -Force
$cmd = Get-Command New-GovernanceReconciliationReport -ErrorAction SilentlyContinue
if (-not $cmd) { Write-Error 'New-GovernanceReconciliationReport not found'; exit 1 }

Write-Host 'R1-041 PASS' -ForegroundColor Green
```

### 6. Governance

**BEHAVIORAL_CONTRACTS enforcement (Global + ForgeRetrofit):**
- Must NOT modify any project files during DIAGNOSE — read-only
- All functions: typed `param()` blocks

Update `STATE_OF_THE_BUILD.md`: Set "DIAGNOSE — Governance Reconciliation" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-041`.

---

## R1-042 — DIAGNOSE: Enterprise Patterns Gap Analysis

**Estimated Tokens:** 18,000

### 1. Context

From RETROFIT spec Section 5.5: "Check for enterprise-grade patterns filtered by maturity stage. FOUNDATION stage checks: basic error handling, input validation, env separation. GROWTH stage adds: logging, monitoring hooks, test coverage thresholds. ENTERPRISE adds: rate limiting, RBAC patterns, audit logging, circuit breakers."

### 2. Task

Implement `New-EnterpriseGapReport` in `ForgeRetrofit.psm1`. It checks the codebase for enterprise patterns appropriate to the detected maturity stage.

### 3. Acceptance Criteria

- `New-EnterpriseGapReport -ScanReport <object> -MaturityStage <stage>` returns array of gap findings
- FOUNDATION checks: try/catch in API routes, input validation patterns, .env separation, basic auth middleware
- GROWTH checks (includes FOUNDATION): structured logging, error boundary components, test coverage >50%, API rate limiting stub
- ENTERPRISE checks (includes GROWTH): RBAC/permission patterns, audit logging, circuit breaker patterns, test coverage >80%, security headers
- Each finding: PatternName, MaturityStage, Present (bool), Severity, Location (where to add), Recommendation
- Only checks patterns appropriate to the detected stage — does not overwhelm a FOUNDATION project with ENTERPRISE requirements
- Must NOT modify any project files — read-only
- All functions include typed `param()` blocks
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\modules\ForgeRetrofit.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\modules\ForgeRetrofit.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\modules\ForgeRetrofit.psm1" -Force
$cmd = Get-Command New-EnterpriseGapReport -ErrorAction SilentlyContinue
if (-not $cmd) { Write-Error 'New-EnterpriseGapReport not found'; exit 1 }

Write-Host 'R1-042 PASS' -ForegroundColor Green
```

### 6. Governance

**BEHAVIORAL_CONTRACTS enforcement (Global + ForgeRetrofit):**
- Must NOT modify any project files during DIAGNOSE — read-only
- All functions: typed `param()` blocks

Update `STATE_OF_THE_BUILD.md`: Set "DIAGNOSE — Enterprise Patterns" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-042`.

---

## R1-043 — DIAGNOSE: Orchestrator & Report Assembly with Adversarial Review

**Estimated Tokens:** 28,000

### 1. Context

From RETROFIT spec Section 5.6: "Invoke-RetrofitDiagnose orchestrates all DIAGNOSE sub-reports: Architecture Health, Governance Reconciliation, Enterprise Patterns. Assembles into a unified DiagnoseReport."

From BEHAVIORAL_CONTRACTS: "DIAGNOSE must run adversarial review on every Architecture Health Report. No skipping."

The full Adversarial Review module is Run 2+, but a lightweight adversarial challenge step must be included per contract. This step questions the Architecture Health Report's assumptions, checks for blind spots, and validates scoring methodology.

### 2. Task

Implement `Invoke-RetrofitDiagnose` and `Invoke-LightweightAdversarialReview` in `ForgeRetrofit.psm1`. The orchestrator runs all sub-reports, then runs a lightweight adversarial review on the Architecture Health Report, and assembles everything into a unified report. The adversarial review checks for: overly optimistic scores, missing risk factors, scoring methodology consistency, and blind spots in the health assessment.

### 3. Acceptance Criteria

- `Invoke-RetrofitDiagnose -ScanReport <object> -ProjectPath <path>` orchestrates the full DIAGNOSE pipeline:
  1. `Format-ScanFindings` — console output of SCAN results
  2. `New-ArchitectureHealthReport` — health assessment
  3. `Invoke-LightweightAdversarialReview` — challenge the health report
  4. `New-GovernanceReconciliationReport` — governance alignment
  5. `New-EnterpriseGapReport` — enterprise pattern gaps
  6. Assemble unified DiagnoseReport
- `Invoke-LightweightAdversarialReview -HealthReport <object> -ScanReport <object>` returns:
  - Challenges (array): assumption challenged, evidence for/against, revised assessment
  - BlindSpots (array): areas not covered by SCAN that could affect health score
  - ScoringValidation: whether dimension weights are proportional to actual risk
  - RevisedScore: adjusted overall score after adversarial review (if warranted)
- DiagnoseReport includes all sub-reports plus adversarial findings, saved to learning database
- Console output rendered with color coding per BEHAVIORAL_CONTRACTS
- All JSON serialization uses `ConvertTo-Json -Depth 10`
- All functions include typed `param()` blocks
- `Export-ModuleMember` updated to include `Invoke-RetrofitDiagnose`
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\modules\ForgeRetrofit.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\modules\ForgeRetrofit.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\modules\ForgeRetrofit.psm1" -Force
Import-Module "$root\modules\ForgeLearning.psm1" -Force

$cmd1 = Get-Command Invoke-RetrofitDiagnose -ErrorAction SilentlyContinue
if (-not $cmd1) { Write-Error 'Invoke-RetrofitDiagnose not found'; exit 1 }
$cmd2 = Get-Command Invoke-LightweightAdversarialReview -ErrorAction SilentlyContinue
if (-not $cmd2) { Write-Error 'Invoke-LightweightAdversarialReview not found'; exit 1 }

Write-Host 'R1-043 PASS' -ForegroundColor Green
```

### 6. Governance

**BEHAVIORAL_CONTRACTS enforcement (Global + ForgeRetrofit):**
- DIAGNOSE must run adversarial review on every Architecture Health Report — no skipping
- Must NOT modify any project files during DIAGNOSE — read-only
- Must NOT auto-apply CRITICAL fixes without presenting them to Reid first
- Console: `Write-Host` only with colors
- Data: `ConvertTo-Json -Depth 10`
- All functions: typed `param()` blocks, `Export-ModuleMember` at module end

Update `STATE_OF_THE_BUILD.md`: Set "DIAGNOSE — Orchestrator & Adversarial Review" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-043`.

---

## R1-044 — Integration: Module Wiring & Import Validation

**Estimated Tokens:** 20,000

### 1. Context

All modules have been built. This prompt ensures every module properly imports its dependencies, all exported functions are accessible, and cross-module calls work correctly. This is the integration test prompt for Run 1.

### 2. Task

Verify and fix all module imports in `forge.ps1`. Ensure every module exports its public functions via `Export-ModuleMember`. Create a comprehensive integration test script at `tests\Run1-Integration.ps1` that imports all modules, calls key functions, and validates the dependency chain: Learning → Sync → Core → Hooks → Retrofit → Session.

### 3. Acceptance Criteria

- `forge.ps1` imports all modules from `modules\` in correct dependency order per BLUEPRINT.md
- Every public function from every module is accessible after import
- Integration test validates the chain:
  1. `Initialize-ForgeMemory` creates database with all 14 tables
  2. `Save-ToForgeMemory` writes a record
  3. `Get-ForgeMemory` reads it back
  4. `Get-MachineId` returns consistent value
  5. `Get-ErrorFingerprint` returns 64-char hash
  6. `Register-Fix` records a fix
  7. `Invoke-AutoElevation` checks elevation threshold
  8. `Read-HooksConfig` reads hooks.json from project root
  9. `Get-BuildFingerprint` returns 64-char hash
  10. `Invoke-PreFlightChecks` runs against FORGE itself
  11. `Invoke-ScanDirectoryTree` returns file listing
- Integration test file at `tests\Run1-Integration.ps1` passes PowerShell parser validation
- All module files pass PowerShell parser validation
- Zero import errors when running `forge.ps1`

### 4. File Manifest — CREATE / MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\tests\Run1-Integration.ps1     (CREATE)
C:\Users\manag\Documents\FORGE 2.0\forge.ps1                       (MODIFY)
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'

# Parse check all files
Get-ChildItem -Path $root -Recurse -Include *.ps1,*.psm1 | ForEach-Object {
    $errors = $null
    [System.Management.Automation.Language.Parser]::ParseFile($_.FullName, [ref]$null, [ref]$errors)
    if ($errors.Count -gt 0) { Write-Error "Parse errors in $($_.Name): $($errors[0].Message)"; exit 1 }
}

# Run integration test
& "$root\tests\Run1-Integration.ps1"
if ($LASTEXITCODE -ne 0) { Write-Error 'Integration test failed'; exit 1 }

Write-Host 'R1-044 PASS' -ForegroundColor Green
```

### 6. Governance

**BEHAVIORAL_CONTRACTS enforcement (Global):**
- Every module (.psm1) must export its public functions explicitly via `Export-ModuleMember`
- All code must be PowerShell only
- All functions: typed `param()` blocks

Update `STATE_OF_THE_BUILD.md`: Set "Run 1 — Integration Wiring" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-044`.

---

## R1-045 — Run 1 Final: Governance Update & Build Report

**Estimated Tokens:** 15,000

### 1. Context

Final prompt of Run 1. Updates all governance documents to reflect the completed state. Generates the Run 1 build report. Prepares the SESSION_HANDOFF for Run 2.

### 2. Task

Update all five governance documents with the final status of every module built in Run 1. Generate the final Run 1 build report. Create `SESSION_HANDOFF.md` noting what Run 2 needs to build.

### 3. Acceptance Criteria

- `STATE_OF_THE_BUILD.md` shows all Run 1 modules as COMPLETED with dates
- `STATE_OF_THE_BUILD.md` shows Run 2+ modules as NOT_STARTED
- `BLUEPRINT.md` updated with actual file structure and function inventory matching `modules\` flat layout
- `SCHEMA_REGISTRY.md` verified — all 14 tables match implemented schema
- `AGENTS.md` updated with actual function lists per module (noting deferred functions for Run 2)
- `BEHAVIORAL_CONTRACTS.md` verified — no new contracts needed
- Build report at `.forge\BUILD_REPORT_RUN1.md` with per-prompt status
- `SESSION_HANDOFF.md` lists Run 2 priorities:
  - RETROFIT RECONCILE (~8 prompts) — interactive decision flow
  - Sentinel Pipeline (~25 prompts) — 18 tools across 4 rings
  - Composer Engine (~15 prompts) — DAG, topological sort, prompt templates
  - Adversarial Review (~7 prompts) — full module replacing lightweight stub
  - Deferred ForgeLearning functions: Update-DecisionWeights, Analyze-ForEvolutions, Present-Evolutions, Apply-Evolution, Load-CrossProjectKnowledge
- All governance files pass markdown lint (no broken headers, no orphaned links)
- All code files pass PowerShell parser validation

### 4. File Manifest — MODIFY / CREATE

```
C:\Users\manag\Documents\FORGE 2.0\STATE_OF_THE_BUILD.md           (MODIFY)
C:\Users\manag\Documents\FORGE 2.0\BLUEPRINT.md                    (MODIFY)
C:\Users\manag\Documents\FORGE 2.0\SCHEMA_REGISTRY.md              (MODIFY — verify)
C:\Users\manag\Documents\FORGE 2.0\AGENTS.md                       (MODIFY)
C:\Users\manag\Documents\FORGE 2.0\BEHAVIORAL_CONTRACTS.md          (MODIFY — verify)
C:\Users\manag\Documents\FORGE 2.0\.forge\BUILD_REPORT_RUN1.md      (CREATE)
C:\Users\manag\Documents\FORGE 2.0\SESSION_HANDOFF.md               (CREATE)
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$requiredFiles = @(
    'STATE_OF_THE_BUILD.md', 'BLUEPRINT.md', 'SCHEMA_REGISTRY.md',
    'AGENTS.md', 'BEHAVIORAL_CONTRACTS.md',
    '.forge\BUILD_REPORT_RUN1.md', 'SESSION_HANDOFF.md'
)
foreach ($f in $requiredFiles) {
    $path = Join-Path $root $f
    if (-not (Test-Path $path)) { Write-Error "Missing: $f"; exit 1 }
    $content = Get-Content $path -Raw
    if ($content.Length -lt 100) { Write-Error "$f is suspiciously short ($($content.Length) chars)"; exit 1 }
}

$state = Get-Content "$root\STATE_OF_THE_BUILD.md" -Raw
if ($state -notmatch 'COMPLETED') { Write-Error 'STATE_OF_THE_BUILD missing COMPLETED entries'; exit 1 }

# Final syntax check on all code
Get-ChildItem -Path $root -Recurse -Include *.ps1,*.psm1 | ForEach-Object {
    $errors = $null
    [System.Management.Automation.Language.Parser]::ParseFile($_.FullName, [ref]$null, [ref]$errors)
    if ($errors.Count -gt 0) { Write-Error "Parse errors in $($_.Name): $($errors[0].Message)"; exit 1 }
}

Write-Host 'R1-045 PASS — RUN 1 COMPLETE' -ForegroundColor Green
```

### 6. Governance

Final governance update is the task itself. All five governance documents must be internally consistent with each other and with the implemented codebase.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-045`.

---

# Token Budget Summary

| Prompt Range | Module | Prompts | Est. Tokens |
|---|---|---|---|
| R1-001 | Project Scaffold | 1 | 15,000 |
| R1-002 — R1-007 | Learning Engine | 6 | 173,000 |
| R1-008 — R1-009 | Cross-Machine Sync | 2 | 50,000 |
| R1-010 — R1-014 | Core Pipeline Controller | 5 | 117,000 |
| R1-015 — R1-019 | Hook Lifecycle System | 5 | 115,000 |
| R1-020 — R1-030 | RETROFIT SCAN | 11 | 254,000 |
| R1-031 — R1-038 | Session Orchestration | 8 | 165,000 |
| R1-039 — R1-043 | RETROFIT DIAGNOSE | 5 | 109,000 |
| R1-044 — R1-045 | Integration & Governance | 2 | 35,000 |
| **TOTAL** | **8 Modules** | **45** | **~1,033,000** |

**Conflict Resolutions Applied:**

| # | Conflict | Resolution |
|---|---|---|
| 1 | Directory `src/<Module>/` vs `modules/` | Changed to `modules/` flat per BLUEPRINT.md |
| 2 | RETROFIT split files vs single module | Single `modules/ForgeRetrofit.psm1` with `#region` blocks per BLUEPRINT.md |
| 3 | 10 tables vs 14 tables | All 14 tables per SCHEMA_REGISTRY.md created in R1-003 |
| 4 | `forge_config.json` in `.forge/` vs root | Project root per BLUEPRINT.md |
| 5 | `hooks.json` in `.forge/` vs root | Project root (consistent with `forge_config.json`) |
| 6 | Test directory `.forge/tests/` vs `tests/` | `tests/` at root per BLUEPRINT.md |
| 7 | Missing 10 functions from AGENTS.md | Added: Score-PromptExecution, Invoke-AutoElevation (R1-006), Register-Fix (R1-007), Get/Set-LastSyncTimestamp (R1-008). Deferred to Run 2: Update-DecisionWeights, Analyze-ForEvolutions, Present-Evolutions, Apply-Evolution, Load-CrossProjectKnowledge |
| 8 | Export-ModuleMember never referenced | Added to every module prompt's acceptance criteria |
| 9 | BEHAVIORAL_CONTRACTS not injected | Every prompt Section 6 now includes contract enforcement block |
| 10 | DIAGNOSE missing adversarial review | Added Invoke-LightweightAdversarialReview to R1-043 per contract |
| 11 | ConvertTo-Json -Depth 5 vs -Depth 10 | All references now `-Depth 10` per BEHAVIORAL_CONTRACTS |
| 12 | R1-011 checked 10 tables | Now checks 14 tables per SCHEMA_REGISTRY.md |

**Run 2 Targets (estimated ~55 prompts):**
- RETROFIT RECONCILE (~8 prompts) — interactive decision flow, persistence
- Sentinel Pipeline (~25 prompts) — 18 tools across 4 rings
- Composer Engine (~15 prompts) — DAG, topological sort, prompt templates
- Adversarial Review (~7 prompts) — full module replacing lightweight R1-043 stub
- Deferred ForgeLearning functions (folded into Composer/Architect prompts)

**Run 3-4 Targets:**
- Architect & PRD (SCOUT, four-pass refinement, governance suite generation)
- Deploy Pipeline (migrations, canary, env parity, rollback)
- Prompt A/B Testing
- Full integration + hardening
