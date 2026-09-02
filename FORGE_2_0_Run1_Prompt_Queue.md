# FORGE 2.0 — Run 1 Prompt Queue

**Build ID:** forge-forge20-greenfield-run1
**Total Prompts:** 45
**Estimated Total Tokens:** ~1,420,000
**Modules Covered:** Core Pipeline Controller, Learning Engine, Cross-Machine Sync, Hook Lifecycle, RETROFIT SCAN, Session Orchestration, RETROFIT DIAGNOSE

---

## R1-001 — Project Scaffold & Directory Structure

**Estimated Tokens:** 12,000

### 1. Context

FORGE 2.0 is a PowerShell-only autonomous build orchestration framework. The project lives at `C:\Users\manag\Documents\FORGE 2.0\`. All source code is `.ps1` (scripts) and `.psm1` (modules). The project requires a `.forge/` directory for runtime state and a `src/` directory tree organized by module. The learning database lives at `~/.forge/forge_memory.db`. The governance documents live at the project root.

### 2. Task

Create the complete directory structure and stub files for FORGE 2.0. Every module gets its own `.psm1` file. The main entry point is `forge.ps1` at the project root. Create empty governance documents. Create `.forge/` configuration templates.

### 3. Acceptance Criteria

- Directory tree exists with all module directories
- `forge.ps1` exists at project root with a placeholder `param()` block and module import stubs
- Each `.psm1` module file exists with a comment header and empty function stubs
- `.forge/forge_config.json` exists with default configuration template
- `.forge/hooks.json` exists with `schema_version: "1.0"` and empty hooks array
- `STATE_OF_THE_BUILD.md` exists with all modules listed as NOT_STARTED
- `BLUEPRINT.md` exists with project description header
- All `.ps1` files pass `[System.Management.Automation.Language.Parser]::ParseFile()` with zero errors

### 4. File Manifest — CREATE

```
C:\Users\manag\Documents\FORGE 2.0\forge.ps1
C:\Users\manag\Documents\FORGE 2.0\src\Core\ForgeCore.psm1
C:\Users\manag\Documents\FORGE 2.0\src\Learning\ForgeLearning.psm1
C:\Users\manag\Documents\FORGE 2.0\src\Sync\ForgeSync.psm1
C:\Users\manag\Documents\FORGE 2.0\src\Hooks\ForgeHooks.psm1
C:\Users\manag\Documents\FORGE 2.0\src\Retrofit\ForgeRetrofit.psm1
C:\Users\manag\Documents\FORGE 2.0\src\Retrofit\ForgeScan.psm1
C:\Users\manag\Documents\FORGE 2.0\src\Retrofit\ForgeDiagnose.psm1
C:\Users\manag\Documents\FORGE 2.0\src\Retrofit\ForgeReconcile.psm1
C:\Users\manag\Documents\FORGE 2.0\src\Sentinel\ForgeSentinel.psm1
C:\Users\manag\Documents\FORGE 2.0\src\Composer\ForgeComposer.psm1
C:\Users\manag\Documents\FORGE 2.0\src\Architect\ForgeArchitect.psm1
C:\Users\manag\Documents\FORGE 2.0\src\Deploy\ForgeDeploy.psm1
C:\Users\manag\Documents\FORGE 2.0\src\Session\ForgeSession.psm1
C:\Users\manag\Documents\FORGE 2.0\.forge\forge_config.json
C:\Users\manag\Documents\FORGE 2.0\.forge\hooks.json
C:\Users\manag\Documents\FORGE 2.0\STATE_OF_THE_BUILD.md
C:\Users\manag\Documents\FORGE 2.0\BLUEPRINT.md
```

### 5. Verification

```powershell
# Verify all files exist
$files = @(
    'forge.ps1','src\Core\ForgeCore.psm1','src\Learning\ForgeLearning.psm1',
    'src\Sync\ForgeSync.psm1','src\Hooks\ForgeHooks.psm1',
    'src\Retrofit\ForgeRetrofit.psm1','src\Retrofit\ForgeScan.psm1',
    'src\Retrofit\ForgeDiagnose.psm1','src\Retrofit\ForgeReconcile.psm1',
    'src\Sentinel\ForgeSentinel.psm1','src\Composer\ForgeComposer.psm1',
    'src\Architect\ForgeArchitect.psm1','src\Deploy\ForgeDeploy.psm1',
    'src\Session\ForgeSession.psm1','.forge\forge_config.json',
    '.forge\hooks.json','STATE_OF_THE_BUILD.md','BLUEPRINT.md'
)
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$missing = $files | Where-Object { -not (Test-Path (Join-Path $root $_)) }
if ($missing) { Write-Error "Missing: $($missing -join ', ')"; exit 1 }

# Syntax check all PS1/PSM1 files
Get-ChildItem -Path $root -Recurse -Include *.ps1,*.psm1 | ForEach-Object {
    $errors = $null
    [System.Management.Automation.Language.Parser]::ParseFile($_.FullName, [ref]$null, [ref]$errors)
    if ($errors.Count -gt 0) { Write-Error "Parse errors in $($_.Name): $($errors[0].Message)"; exit 1 }
}
Write-Host 'R1-001 PASS' -ForegroundColor Green
```

### 6. Governance

Update `STATE_OF_THE_BUILD.md`: Set "Project Scaffold" to COMPLETED with timestamp.

### 7. Rollback

On failure: `git checkout -- .` to revert all changes from this prompt. FORGE restores to snapshot `FORGE-SNAPSHOT-R1-001`.

---

## R1-002 — SQLite Core Wrapper (Invoke-Sqlite)

**Estimated Tokens:** 25,000

### 1. Context

From Learning Engine spec Section 2: "Core SQLite wrapper using sqlite3 CLI with JSON output, fallback to .NET assembly. All modules use high-level functions, never raw SQL."

The wrapper must handle: parameterized queries, JSON output parsing, error handling, and fallback from CLI to .NET. Performance target from spec Section 7: single row read <1ms, aggregate read 1-5ms, single write <1ms. Database path: `~/.forge/forge_memory.db`.

### 2. Task

Implement `Invoke-Sqlite` in `src\Learning\ForgeLearning.psm1`. This is the lowest-level data access function. Every other learning engine function depends on it. It must support SELECT (returns PSCustomObject array), INSERT/UPDATE/DELETE (returns affected row count), and raw DDL (CREATE TABLE, CREATE INDEX). Implement `Get-ForgeDbPath` helper that resolves `~/.forge/forge_memory.db` cross-platform.

### 3. Acceptance Criteria

- `Invoke-Sqlite` function exported from `ForgeLearning.psm1`
- Accepts `-Database` (path), `-Query` (SQL string), `-Parameters` (hashtable, optional)
- Attempts sqlite3 CLI first with `-json` flag; if sqlite3 not found, falls back to `System.Data.SQLite` .NET assembly
- Returns `[PSCustomObject[]]` for SELECT queries
- Returns `[int]` affected row count for INSERT/UPDATE/DELETE
- Handles single quotes in values (escaping)
- Throws terminating error on SQL syntax errors with the original error message preserved
- `Get-ForgeDbPath` returns the expanded path `~/.forge/forge_memory.db`
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\src\Learning\ForgeLearning.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\src\Learning\ForgeLearning.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

# Import and test
Import-Module "$root\src\Learning\ForgeLearning.psm1" -Force
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

Update `STATE_OF_THE_BUILD.md`: Set "Learning Engine — SQLite Wrapper" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-002`.

---

## R1-003 — Machine Identity & Database Initialization

**Estimated Tokens:** 30,000

### 1. Context

From Learning Engine spec Section 1: "Database lives at `~/.forge/forge_memory.db`. Created on first FORGE invocation. Schema version tracked in metadata table."

From Master Design Record Section 2.3.3: "Machine identity generated from `COMPUTERNAME + MAC address`. Stored in forge_meta. Unique per physical machine."

Complete schema from Learning Engine spec Section 1.1 — 10 tables:
- `forge_meta` — Schema version, machine ID, creation timestamp
- `prompt_scores` — Template hash, task type, first_pass_success, retry_count, tokens_consumed, gate_pass_rate, drift_score, project_name, build_id, machine_id, created_at
- `fix_patterns` — error_fingerprint (UNIQUE), error_message, error_category, file_path_pattern, fix_diff, fix_description, fix_files_modified (JSON), tech_stack_tags (JSON), occurrence_count, success_rate, times_fix_applied, times_fix_succeeded, auto_governance_rule, governance_rule_id, last_seen, machine_id, created_at
- `decision_weights` — decision_type, option_chosen, downstream_error_rate, downstream_retry_rate, downstream_prompts, downstream_errors, downstream_retries, sample_size, project_name, build_id, machine_id, created_at
- `governance_rules` — rule_text, rule_short_name, source, source_error_fingerprint, tech_stack_tags (JSON), scope, project_name, active, enforcement_count, last_enforced, machine_id, created_at
- `pending_evolutions` — evolution_type, proposed_change, change_detail (JSON), evidence (JSON), estimated_impact, confidence, status, reviewed_at, review_note, machine_id, created_at
- `build_outcomes` — project_name, mode, start_time, end_time, end_reason, total_prompts_planned, total_prompts_executed, prompts_passed, prompts_retried, prompts_failed, total_tokens, architecture_decisions (JSON), maturity_stage, first_pass_rate, machine_id, created_at
- `skill_library` — skill_name, content, tech_stack_tags (JSON), source_error_fingerprint, source_build_id, trigger_context, usage_count, effectiveness_rate, times_injected, times_prevented_error, machine_id, created_at
- `reconcile_decisions` — project_name, feature_id, feature_name, decision, category, severity, rationale, machine_id, created_at
- `scan_reports` — project_name, scan_scope, critical_count, warn_count, info_count, broken_imports, dead_files, schema_drift, tsc_errors, test_pass_rate, report_json, machine_id, created_at

### 2. Task

Implement `Get-MachineId` and `Initialize-ForgeMemory` in `ForgeLearning.psm1`. `Get-MachineId` generates a deterministic ID from COMPUTERNAME + MAC address. `Initialize-ForgeMemory` creates the `~/.forge/` directory if missing, creates all 10 tables with indexes, inserts the initial `forge_meta` row. Must be idempotent — running twice must not error or duplicate data. Use `CREATE TABLE IF NOT EXISTS` and `INSERT OR IGNORE` for the meta row.

### 3. Acceptance Criteria

- `Get-MachineId` returns a consistent string on repeated calls on the same machine
- `Initialize-ForgeMemory` creates `~/.forge/` directory if it doesn't exist
- All 10 tables created with correct column definitions and constraints
- All indexes from the spec created (prompt_scores: task_type, template_hash, project, created_at; fix_patterns: fingerprint, category, stack, count; decision_weights: type+option, error_rate; governance_rules: active+scope, stack)
- `forge_meta` row inserted with schema_version='1.0', machine_id, created_at
- Running `Initialize-ForgeMemory` twice produces zero errors
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\src\Learning\ForgeLearning.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\src\Learning\ForgeLearning.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\src\Learning\ForgeLearning.psm1" -Force

# Test machine ID stability
$id1 = Get-MachineId
$id2 = Get-MachineId
if ($id1 -ne $id2) { Write-Error 'MachineId not stable'; exit 1 }

# Test initialization (use temp DB for testing)
$testDb = Join-Path $env:TEMP 'forge_test_init.db'
if (Test-Path $testDb) { Remove-Item $testDb -Force }
Initialize-ForgeMemory -DatabasePath $testDb

# Verify all 10 tables exist
$tables = Invoke-Sqlite -Database $testDb -Query "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
$expected = @('build_outcomes','decision_weights','fix_patterns','forge_meta','governance_rules','pending_evolutions','prompt_scores','reconcile_decisions','scan_reports','skill_library')
$tableNames = $tables | ForEach-Object { $_.name } | Sort-Object
$diff = Compare-Object $expected $tableNames
if ($diff) { Write-Error "Table mismatch: expected=$($expected -join ',') got=$($tableNames -join ',')"; exit 1 }

# Verify idempotency
Initialize-ForgeMemory -DatabasePath $testDb  # Second call must not error

# Verify meta row
$meta = Invoke-Sqlite -Database $testDb -Query "SELECT * FROM forge_meta"
if ($meta.Count -ne 1) { Write-Error "Expected 1 meta row, got $($meta.Count)"; exit 1 }

Remove-Item $testDb -Force
Write-Host 'R1-003 PASS' -ForegroundColor Green
```

### 6. Governance

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
- All functions handle empty result sets gracefully (return empty array, not error)
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\src\Learning\ForgeLearning.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\src\Learning\ForgeLearning.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\src\Learning\ForgeLearning.psm1" -Force
$testDb = Join-Path $env:TEMP 'forge_test_read.db'
if (Test-Path $testDb) { Remove-Item $testDb -Force }
Initialize-ForgeMemory -DatabasePath $testDb

# Insert test data
$machineId = Get-MachineId
Invoke-Sqlite -Database $testDb -Query "INSERT INTO governance_rules (id, rule_text, rule_short_name, source, tech_stack_tags, scope, project_name, active, enforcement_count, machine_id, created_at) VALUES ('r1', 'Always use RLS', 'rls-required', 'MANUAL', '[\"supabase\"]', 'GLOBAL', NULL, 1, 0, '$machineId', datetime('now'))"
Invoke-Sqlite -Database $testDb -Query "INSERT INTO governance_rules (id, rule_text, rule_short_name, source, tech_stack_tags, scope, project_name, active, enforcement_count, machine_id, created_at) VALUES ('r2', 'Use server actions', 'server-actions', 'MANUAL', '[\"nextjs\"]', 'PROJECT_SPECIFIC', 'hail-intel', 1, 0, '$machineId', datetime('now'))"

# Test Get-ForgeMemory
$all = Get-ForgeMemory -Table 'governance_rules' -DatabasePath $testDb
if ($all.Count -ne 2) { Write-Error "Expected 2 rules, got $($all.Count)"; exit 1 }

# Test Get-GovernanceRules
$rules = Get-GovernanceRules -TechStack @('supabase') -ProjectName 'hail-intel' -DatabasePath $testDb
if ($rules.Count -lt 1) { Write-Error "Expected at least 1 rule for supabase stack"; exit 1 }

# Test empty result
$empty = Get-ForgeMemory -Table 'fix_patterns' -DatabasePath $testDb
if ($empty.Count -ne 0) { Write-Error "Expected 0 fix patterns"; exit 1 }

Remove-Item $testDb -Force
Write-Host 'R1-004 PASS' -ForegroundColor Green
```

### 6. Governance

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
- All functions return empty arrays when no data matches (not errors)
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\src\Learning\ForgeLearning.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\src\Learning\ForgeLearning.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\src\Learning\ForgeLearning.psm1" -Force
$testDb = Join-Path $env:TEMP 'forge_test_read2.db'
if (Test-Path $testDb) { Remove-Item $testDb -Force }
Initialize-ForgeMemory -DatabasePath $testDb

$machineId = Get-MachineId

# Insert prompt_scores test data (4 samples of same template)
1..4 | ForEach-Object {
    Invoke-Sqlite -Database $testDb -Query "INSERT INTO prompt_scores (id, prompt_template_hash, task_type, tech_stack_tags, first_pass_success, retry_count, tokens_consumed, gate_pass_rate, drift_score, project_name, build_id, machine_id, created_at) VALUES ('ps$_', 'tmpl_abc', 'CRUD', '[""nextjs""]', $(if($_ -le 3){1}else{0}), 0, 25000, 1.0, 0.0, 'test', 'b1', '$machineId', datetime('now'))"
}

$best = Get-BestPromptTemplates -TaskType 'CRUD' -MinSamples 3 -DatabasePath $testDb
if ($best.Count -lt 1) { Write-Error "Expected at least 1 template result"; exit 1 }

# Test pending evolutions (empty)
$evos = Get-PendingEvolutions -DatabasePath $testDb
if ($evos.Count -ne 0) { Write-Error "Expected 0 pending evolutions"; exit 1 }

Remove-Item $testDb -Force
Write-Host 'R1-005 PASS' -ForegroundColor Green
```

### 6. Governance

Update `STATE_OF_THE_BUILD.md`: Set "Learning Engine — Read Functions Part 2" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-005`.

---

## R1-006 — Learning Engine Write Functions

**Estimated Tokens:** 30,000

### 1. Context

From Learning Engine spec Section 2, Key Write Functions:
- `Save-ToForgeMemory` — Generic insert with auto-generated UUID and machine_id. Used by every module that writes to the learning database.
- `Update-FixPattern` — Update fix_diff, fix_description, increment occurrence_count. Used during Loop 2 Stage 2 CORRELATE when a known error recurs.
- `Increment-GovernanceEnforcement` — Increment enforcement_count, update last_enforced. Used by PreToolUse hook when a governance rule fires.
- `Save-PromptScore` — Write prompt execution score with all four dimensions (first_pass_success, token efficiency, gate_pass_rate, drift_score). Used by PostToolUse hook Loop 1.

### 2. Task

Implement all four write functions in `ForgeLearning.psm1`. `Save-ToForgeMemory` generates a UUID via `[guid]::NewGuid().ToString()`, auto-populates `machine_id` via `Get-MachineId`, and auto-populates `created_at` with ISO 8601 timestamp. It accepts a table name and a hashtable of column-value pairs. `Update-FixPattern` takes a fingerprint and updates the matching row. `Increment-GovernanceEnforcement` takes a rule ID. `Save-PromptScore` takes all four dimensions plus metadata.

### 3. Acceptance Criteria

- `Save-ToForgeMemory -Table 'fix_patterns' -Data @{...}` inserts a row with auto-generated id, machine_id, and created_at
- `Save-ToForgeMemory` handles JSON array values (tech_stack_tags) by serializing them as JSON strings
- `Update-FixPattern -Fingerprint <hash> -FixDiff <diff> -FixDescription <desc>` updates the matching row and increments occurrence_count
- `Increment-GovernanceEnforcement -RuleId <id>` increments enforcement_count and sets last_enforced to current timestamp
- `Save-PromptScore` writes a complete prompt_scores row with all required fields
- All writes are verified by reading back the data
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\src\Learning\ForgeLearning.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\src\Learning\ForgeLearning.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\src\Learning\ForgeLearning.psm1" -Force
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

# Test Update-FixPattern
Update-FixPattern -Fingerprint 'abc123' -FixDiff 'new diff' -FixDescription 'Updated fix' -DatabasePath $testDb
$updated = Get-FixPattern -Fingerprint 'abc123' -DatabasePath $testDb
if ($updated.occurrence_count -ne 2) { Write-Error "Expected occurrence_count=2, got $($updated.occurrence_count)"; exit 1 }

# Test Save-PromptScore
Save-PromptScore -TemplateHash 'tmpl1' -TaskType 'CRUD' -TechStack @('nextjs') -FirstPassSuccess 1 -RetryCount 0 -TokensConsumed 25000 -GatePassRate 1.0 -DriftScore 0.0 -ProjectName 'test' -BuildId 'b1' -DatabasePath $testDb

$score = Get-ForgeMemory -Table 'prompt_scores' -Where "prompt_template_hash = 'tmpl1'" -DatabasePath $testDb
if ($score.Count -ne 1) { Write-Error 'Prompt score not saved'; exit 1 }

Remove-Item $testDb -Force
Write-Host 'R1-006 PASS' -ForegroundColor Green
```

### 6. Governance

Update `STATE_OF_THE_BUILD.md`: Set "Learning Engine — Write Functions" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-006`.

---

## R1-007 — Error Fingerprinting Algorithm

**Estimated Tokens:** 18,000

### 1. Context

From Learning Engine spec Section 3: "SHA-256 hash of four concatenated components:
1. Error code — Machine-readable identifier (TS2307, no-unused-vars, TypeError, etc.)
2. Generalized file path — Dynamic segments wildcarded (`app/api/storms/route.ts` → `app/api/*/route.ts`)
3. Error message template — Specific identifiers replaced with `*` (`Module './StormMap' not found` → `Module '*' not found`)
4. Tech stack context — Sorted, comma-separated tags

Result: 32-character hex fingerprint. Two identical errors in different files = same fingerprint. Two different errors in same file = different fingerprints."

### 2. Task

Implement `Get-ErrorFingerprint` and its helper `ConvertTo-GeneralizedPath` in `ForgeLearning.psm1`. The fingerprint function takes an error code, file path, error message, and tech stack array. It generalizes the file path (replacing dynamic path segments with `*`), templatizes the error message (replacing quoted identifiers, specific module names, and variable names with `*`), sorts the tech stack, concatenates all four components, and returns the SHA-256 hex hash.

Also implement `Register-Error` convenience function that creates a fingerprint and either inserts a new fix_patterns row or increments an existing one.

### 3. Acceptance Criteria

- `Get-ErrorFingerprint -ErrorCode 'TS2307' -FilePath 'app/api/storms/route.ts' -ErrorMessage "Module './StormMap' not found" -TechStack @('typescript','nextjs')` returns a 64-character hex string
- Same inputs produce same fingerprint on repeated calls
- Different error codes produce different fingerprints even with same file/message
- `app/api/storms/route.ts` generalizes to `app/api/*/route.ts`
- `app/[id]/page.tsx` generalizes to `app/*/page.tsx` (Next.js dynamic segments)
- `Module './StormMap' not found` templatizes to `Module '*' not found`
- `Register-Error` creates new fix_patterns row on first occurrence, increments on subsequent
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\src\Learning\ForgeLearning.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\src\Learning\ForgeLearning.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\src\Learning\ForgeLearning.psm1" -Force

# Test fingerprint consistency
$fp1 = Get-ErrorFingerprint -ErrorCode 'TS2307' -FilePath 'app/api/storms/route.ts' -ErrorMessage "Module './StormMap' not found" -TechStack @('typescript','nextjs')
$fp2 = Get-ErrorFingerprint -ErrorCode 'TS2307' -FilePath 'app/api/storms/route.ts' -ErrorMessage "Module './StormMap' not found" -TechStack @('nextjs','typescript')
if ($fp1 -ne $fp2) { Write-Error 'Fingerprint not stable across tech stack ordering'; exit 1 }
if ($fp1.Length -ne 64) { Write-Error "Expected 64-char hex, got $($fp1.Length) chars"; exit 1 }

# Test different error code = different fingerprint
$fp3 = Get-ErrorFingerprint -ErrorCode 'TS2304' -FilePath 'app/api/storms/route.ts' -ErrorMessage "Module './StormMap' not found" -TechStack @('typescript','nextjs')
if ($fp1 -eq $fp3) { Write-Error 'Different error codes should produce different fingerprints'; exit 1 }

# Test same error in different specific files = same fingerprint (wildcarded paths)
$fp4 = Get-ErrorFingerprint -ErrorCode 'TS2307' -FilePath 'app/api/users/route.ts' -ErrorMessage "Module './UserMap' not found" -TechStack @('typescript','nextjs')
if ($fp1 -ne $fp4) { Write-Error 'Same error pattern in different files should match'; exit 1 }

Write-Host 'R1-007 PASS' -ForegroundColor Green
```

### 6. Governance

Update `STATE_OF_THE_BUILD.md`: Set "Learning Engine — Error Fingerprinting" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-007`.

---

## R1-008 — Cross-Machine Sync: Config & Lock Management

**Estimated Tokens:** 20,000

### 1. Context

From Learning Engine spec Section 5:
"Configuration: `~/.forge/sync_config.json` — master_path (18TB drive), lock_file path, max wait, retry interval."

"Lock Management: Create `forge_sync.lock` file before writing to master. Contains machine ID for debugging. If lock exists, wait 5 seconds, retry (max 30 seconds). Stale locks (>2 minutes old) auto-removed (crashed machine). Lock released in `finally` block (always runs)."

From Master Design Record Section 2.3.3: "The sync script creates a forge_sync.lock file on the 18TB drive before writing. If the lock file exists, the machine waits 5 seconds and retries (max 3 retries). Prevents two machines finishing at the exact same moment."

### 2. Task

Implement `ForgeSync.psm1` with: `Get-SyncConfig` (reads/creates `~/.forge/sync_config.json`), `Acquire-SyncLock` (creates lock file with retry logic and stale lock detection), `Release-SyncLock` (removes lock file), and `Test-SyncAvailable` (checks if master path is accessible).

### 3. Acceptance Criteria

- `Get-SyncConfig` returns a config object with master_path, lock_file, max_wait_seconds (30), retry_interval_seconds (5), stale_lock_minutes (2)
- `Get-SyncConfig` creates `~/.forge/sync_config.json` with defaults if file doesn't exist
- `Acquire-SyncLock` creates lock file at configured path containing machine_id and timestamp
- `Acquire-SyncLock` waits and retries if lock exists (up to max_wait_seconds)
- `Acquire-SyncLock` removes stale locks older than stale_lock_minutes
- `Acquire-SyncLock` returns `$true` on success, `$false` on timeout
- `Release-SyncLock` removes the lock file; no error if file already gone
- `Test-SyncAvailable` returns `$true` if master_path exists, `$false` otherwise
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\src\Sync\ForgeSync.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\src\Sync\ForgeSync.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\src\Sync\ForgeSync.psm1" -Force
Import-Module "$root\src\Learning\ForgeLearning.psm1" -Force

# Test config creation
$config = Get-SyncConfig
if (-not $config.master_path) { Write-Error 'Config missing master_path'; exit 1 }
if ($config.max_wait_seconds -ne 30) { Write-Error 'Wrong max_wait default'; exit 1 }

# Test lock with temp directory as master
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

Remove-Item $tempMaster -Recurse -Force
Write-Host 'R1-008 PASS' -ForegroundColor Green
```

### 6. Governance

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

Tables to sync: prompt_scores, fix_patterns, decision_weights, governance_rules, pending_evolutions, build_outcomes, skill_library, reconcile_decisions, scan_reports.

From spec Section 7: "Sync Pull/Push: 1-5 seconds. Once per run."

### 2. Task

Implement `Sync-ForgeMemory` in `ForgeSync.psm1`. Takes `-Direction` (Pull or Push). Pull reads from master DB, inserts new records into local. Push reads from local, inserts new records into master. Both use `INSERT OR IGNORE` to prevent duplicates. Track last sync timestamp in `forge_meta` table. The function acquires a lock before Push (write to master), but not for Pull (read-only).

### 3. Acceptance Criteria

- `Sync-ForgeMemory -Direction Pull` reads records from master DB newer than last sync, inserts into local
- `Sync-ForgeMemory -Direction Push` acquires lock, writes local records to master, releases lock
- Both directions update `last_sync_timestamp` in local `forge_meta` after completion
- All 9 syncable tables are covered (not forge_meta itself)
- `INSERT OR IGNORE` prevents duplicate records
- Push acquires lock before writing, releases in `finally` block
- Pull does not acquire lock (read-only)
- Graceful degradation: if master path unavailable, log warning and return (no error)
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\src\Sync\ForgeSync.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\src\Sync\ForgeSync.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\src\Learning\ForgeLearning.psm1" -Force
Import-Module "$root\src\Sync\ForgeSync.psm1" -Force

# Setup: create local and master test databases
$localDb = Join-Path $env:TEMP 'forge_sync_local.db'
$masterDb = Join-Path $env:TEMP 'forge_sync_master.db'
if (Test-Path $localDb) { Remove-Item $localDb -Force }
if (Test-Path $masterDb) { Remove-Item $masterDb -Force }
Initialize-ForgeMemory -DatabasePath $localDb
Initialize-ForgeMemory -DatabasePath $masterDb

# Insert data into master that local doesn't have
Invoke-Sqlite -Database $masterDb -Query "INSERT INTO governance_rules (id, rule_text, rule_short_name, source, tech_stack_tags, scope, active, enforcement_count, machine_id, created_at) VALUES ('remote-rule-1', 'Always validate input', 'validate-input', 'MANUAL', '[""nextjs""]', 'GLOBAL', 1, 5, 'other-machine', datetime('now'))"

# Test Pull
Sync-ForgeMemory -Direction Pull -LocalDbPath $localDb -MasterDbPath $masterDb
$pulled = Get-ForgeMemory -Table 'governance_rules' -Where "id = 'remote-rule-1'" -DatabasePath $localDb
if ($pulled.Count -ne 1) { Write-Error 'Pull failed - record not found in local'; exit 1 }

# Insert data into local for Push test
Save-ToForgeMemory -Table 'governance_rules' -Data @{
    rule_text = 'Local rule'; rule_short_name = 'local-test'; source = 'MANUAL'
    tech_stack_tags = '["powershell"]'; scope = 'GLOBAL'; active = 1; enforcement_count = 0
} -DatabasePath $localDb

# Test Push
$tempMaster = Split-Path $masterDb
Sync-ForgeMemory -Direction Push -LocalDbPath $localDb -MasterDbPath $masterDb -LockPath (Join-Path $tempMaster 'forge_sync.lock')
$pushed = Invoke-Sqlite -Database $masterDb -Query "SELECT * FROM governance_rules WHERE rule_short_name = 'local-test'"
if ($pushed.Count -ne 1) { Write-Error 'Push failed - record not found in master'; exit 1 }

Remove-Item $localDb, $masterDb -Force
Write-Host 'R1-009 PASS' -ForegroundColor Green
```

### 6. Governance

Update `STATE_OF_THE_BUILD.md`: Set "Cross-Machine Sync — Pull & Push" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-009`.

---

## R1-010 — Core Pipeline Controller: Entry Point & Config

**Estimated Tokens:** 25,000

### 1. Context

From Master Design Record Section 2.1: The 8-phase pipeline. `forge.ps1` is the main entry point. It routes to phases based on the command: `forge retrofit`, `forge scout`, `forge architect`, `forge scaffold`, `forge compose`, `forge execute`, `forge sentinel`, `forge deploy`.

Configuration from `.forge/forge_config.json` includes: project_path, project_name, default_tech_stack, gates (configurable per-project), max_retries, prompts_per_run, learning_db_path.

### 2. Task

Implement `forge.ps1` as the main entry point with parameter parsing, phase routing, configuration loading, and module imports. Implement `Get-ForgeConfig` and `Set-ForgeConfig` in `ForgeCore.psm1`. The entry point must validate that the project path exists, load configuration, import all required modules, and dispatch to the correct phase function. For Run 1, the phase functions are stubs that print "[PHASE] Not yet implemented" — they will be filled in subsequent prompts and runs.

### 3. Acceptance Criteria

- `forge.ps1` accepts: `-Command` (retrofit/scout/architect/scaffold/compose/execute/sentinel/deploy), `-ProjectPath` (required), plus command-specific flags (`-SkipDynamic`, `-ScopeA`, `-Resume`, `-IdeaFile`, `-Idea`)
- `Get-ForgeConfig -ProjectPath <path>` loads `.forge/forge_config.json` or returns defaults
- `Set-ForgeConfig -ProjectPath <path> -Config <hashtable>` writes config
- All modules imported at startup: ForgeLearning, ForgeSync, ForgeHooks, ForgeRetrofit, ForgeScan, ForgeSession, ForgeCore
- Phase routing dispatches to correct function (stubs for now)
- Invalid command prints usage help and exits with code 1
- Missing project path prints error and exits with code 1
- `forge.ps1` passes PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\forge.ps1
C:\Users\manag\Documents\FORGE 2.0\src\Core\ForgeCore.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'

# Syntax check
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\forge.ps1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "forge.ps1 parse errors: $($errors[0].Message)"; exit 1 }
[System.Management.Automation.Language.Parser]::ParseFile("$root\src\Core\ForgeCore.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "ForgeCore parse errors: $($errors[0].Message)"; exit 1 }

# Test config
Import-Module "$root\src\Core\ForgeCore.psm1" -Force
$config = Get-ForgeConfig -ProjectPath $root
if (-not $config.max_retries) { Write-Error 'Config missing max_retries'; exit 1 }

Write-Host 'R1-010 PASS' -ForegroundColor Green
```

### 6. Governance

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

Gates are configurable per-project via `.forge/forge_config.json` under a `gates` key. Each gate has: name, command/function, threshold, enabled, ring (which ring it runs in). The gate engine runs all enabled gates for a given ring and returns aggregate pass/fail.

### 2. Task

Implement `Invoke-ForgeGate` in `ForgeCore.psm1`. It accepts a ring number and project context, runs all enabled gates for that ring, collects results, and returns a structured result object with AllPassed boolean and per-gate details. Implement three built-in gate functions: `Test-PowerShellSyntax` (parser check on all .ps1/.psm1 files), `Test-PSScriptAnalyzer` (invoke PSScriptAnalyzer if available), `Test-SqliteSchema` (verify all expected tables exist in forge_memory.db).

### 3. Acceptance Criteria

- `Invoke-ForgeGate -Ring 1 -ProjectPath <path>` runs all Ring 1 gates and returns `@{ AllPassed = $true/$false; Results = @(...) }`
- `Test-PowerShellSyntax -ProjectPath <path>` parses every .ps1/.psm1 file, returns pass/fail with error details
- `Test-PSScriptAnalyzer` gracefully degrades (returns SKIP) if PSScriptAnalyzer module not installed
- `Test-SqliteSchema` verifies all 10 expected tables exist in the learning database
- Each gate result contains: Name, Status (PASS/FAIL/SKIP), Duration, Details
- Gate configuration loaded from `.forge/forge_config.json`
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\src\Core\ForgeCore.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\src\Core\ForgeCore.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\src\Core\ForgeCore.psm1" -Force
Import-Module "$root\src\Learning\ForgeLearning.psm1" -Force

# Test syntax gate
$syntaxResult = Test-PowerShellSyntax -ProjectPath $root
if ($syntaxResult.Status -ne 'PASS') { Write-Error "Syntax gate failed: $($syntaxResult.Details)"; exit 1 }

# Test schema gate
$testDb = Join-Path $env:TEMP 'forge_gate_test.db'
if (Test-Path $testDb) { Remove-Item $testDb -Force }
Initialize-ForgeMemory -DatabasePath $testDb
$schemaResult = Test-SqliteSchema -DatabasePath $testDb
if ($schemaResult.Status -ne 'PASS') { Write-Error "Schema gate failed: $($schemaResult.Details)"; exit 1 }
Remove-Item $testDb -Force

Write-Host 'R1-011 PASS' -ForegroundColor Green
```

### 6. Governance

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

Implement `New-ForgeSnapshot`, `Invoke-ForgeRollback`, `Invoke-PromptWithRetry`, and `New-ForgeCommit` in `ForgeCore.psm1`. Snapshots are git tags (`FORGE-SNAPSHOT-{prompt_id}`). Rollback reverts to the snapshot. Retry logic wraps prompt execution with configurable retries, injecting error context on retry. Commits use the structured message format.

### 3. Acceptance Criteria

- `New-ForgeSnapshot -ProjectPath <path> -PromptId 'R1-012'` creates git tag `FORGE-SNAPSHOT-R1-012`
- `Invoke-ForgeRollback -ProjectPath <path> -PromptId 'R1-012'` reverts working directory to the tagged state
- `Invoke-PromptWithRetry -ProjectPath <path> -PromptId <id> -ScriptBlock <sb> -MaxRetries 2` executes the block, retries on failure with error context, returns structured result
- `New-ForgeCommit -ProjectPath <path> -Project 'forge20' -Phase 'R' -Task 'SCAN-01' -Status 'PASS'` creates commit with message `FORGE-forge20-PR-TSCAN-01-PASS`
- Retry result includes: PromptId, Status (PASS/FAIL), Attempts, Errors, Duration
- Failed prompts logged to learning engine via `Register-Error`
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\src\Core\ForgeCore.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\src\Core\ForgeCore.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\src\Core\ForgeCore.psm1" -Force

# Verify git repo exists
if (-not (Test-Path "$root\.git")) { git -C $root init; git -C $root add -A; git -C $root commit -m 'init' }

# Test snapshot creation
New-ForgeSnapshot -ProjectPath $root -PromptId 'TEST-001'
$tag = git -C $root tag -l 'FORGE-SNAPSHOT-TEST-001'
if (-not $tag) { Write-Error 'Snapshot tag not created'; exit 1 }

# Test commit message format
New-ForgeCommit -ProjectPath $root -Project 'forge20' -Phase 'R' -Task 'TEST' -Status 'PASS'
$lastMsg = git -C $root log -1 --format='%s'
if ($lastMsg -notmatch 'FORGE-forge20-PR-TTEST-PASS') { Write-Error "Bad commit message: $lastMsg"; exit 1 }

# Cleanup test tag
git -C $root tag -d 'FORGE-SNAPSHOT-TEST-001' 2>$null

Write-Host 'R1-012 PASS' -ForegroundColor Green
```

### 6. Governance

Update `STATE_OF_THE_BUILD.md`: Set "Core Pipeline — Retry & Git Snapshots" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-012`.

---

## R1-013 — Core Pipeline: Build Report Generation

**Estimated Tokens:** 18,000

### 1. Context

The build report is a markdown summary generated at SessionEnd. It includes: build ID, project name, total prompts, pass/fail/retry counts, first-pass rate, total tokens consumed, per-prompt results table, active blockers, and queue status. The report is written to `.forge/BUILD_REPORT.md` and also included in SESSION_HANDOFF.

### 2. Task

Implement `Export-BuildReport` in `ForgeCore.psm1`. It reads the prompt execution results (stored in a runtime hashtable during the run) and generates a formatted markdown report. Also implement `Initialize-BuildTracker` (creates the runtime tracking hashtable) and `Update-BuildTracker` (records individual prompt results).

### 3. Acceptance Criteria

- `Initialize-BuildTracker -BuildId <id> -ProjectName <name>` creates a `$Global:ForgeBuildTracker` hashtable with metadata and empty results array
- `Update-BuildTracker -PromptId <id> -Status 'PASS' -Attempts 1 -Tokens 25000 -Duration 120` appends to results
- `Export-BuildReport -ProjectPath <path>` generates `.forge/BUILD_REPORT.md` with:
  - Build summary header (ID, project, timestamp, first-pass rate)
  - Per-prompt results table (ID, Status, Attempts, Tokens, Duration)
  - Statistics (total tokens, duration, pass/fail/retry counts)
- Report file exists and is valid markdown
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\src\Core\ForgeCore.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\src\Core\ForgeCore.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\src\Core\ForgeCore.psm1" -Force

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

The orchestrator reads `queue.yaml` or a prompt status file, determines the next prompt, and drives the loop.

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
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\src\Core\ForgeCore.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\src\Core\ForgeCore.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\src\Core\ForgeCore.psm1" -Force
Import-Module "$root\src\Learning\ForgeLearning.psm1" -Force

# Verify function exists and has correct parameters
$cmd = Get-Command Invoke-ForgeExecute -ErrorAction SilentlyContinue
if (-not $cmd) { Write-Error 'Invoke-ForgeExecute not found'; exit 1 }

Write-Host 'R1-014 PASS' -ForegroundColor Green
```

### 6. Governance

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

Implement in `ForgeHooks.psm1`: `Read-HooksConfig` (parse and validate hooks.json), `Test-HooksSchema` (validate schema structure), and `New-DefaultHooksConfig` (generate the default 24-hook configuration for a new project). The parser must validate every field type, reject invalid event names, ensure unique hook names, and sort by priority.

### 3. Acceptance Criteria

- `Read-HooksConfig -ProjectPath <path>` reads `.forge/hooks.json`, validates, returns structured hook array sorted by priority within each event
- `Read-HooksConfig` returns empty config (not error) if hooks.json doesn't exist
- `Test-HooksSchema -Config <object>` validates schema_version, validates each hook has required fields, validates event names are one of the 8 valid types, validates timeout range (5-600)
- `New-DefaultHooksConfig -ProjectPath <path> -ProjectName <name>` generates `.forge/hooks.json` with all 24 default hooks from the spec (SessionStart: sync-pull, load-knowledge, present-evolutions; PreToolUse: governance-check, fix-pattern-check; PostToolUse: tsc-check, eslint-check, schema-drift-inline, score-prompt; PreCommit: gitleaks-scan, schema-drift-commit, governance-updated; PreCompact: precompact-save; PreDeploy: sentinel-ring3, six-laws-check, env-parity; PostDeploy: health-check, readme-update, deploy-summary; SessionEnd: sync-push, update-weights, analyze-evolutions, generate-handoff, git-push-end)
- All hooks have proper priorities, blocking settings, and timeout values per the spec
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\src\Hooks\ForgeHooks.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\src\Hooks\ForgeHooks.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\src\Hooks\ForgeHooks.psm1" -Force

# Generate default hooks
$testPath = Join-Path $env:TEMP 'forge_hooks_test'
New-Item -ItemType Directory -Path "$testPath\.forge" -Force | Out-Null
New-DefaultHooksConfig -ProjectPath $testPath -ProjectName 'test-project'

$hooksFile = "$testPath\.forge\hooks.json"
if (-not (Test-Path $hooksFile)) { Write-Error 'hooks.json not created'; exit 1 }

$config = Read-HooksConfig -ProjectPath $testPath
$hookCount = ($config | Measure-Object).Count
if ($hookCount -ne 24) { Write-Error "Expected 24 hooks, got $hookCount"; exit 1 }

# Verify events covered
$events = $config | ForEach-Object { $_.event } | Select-Object -Unique
$expectedEvents = @('SessionStart','PreToolUse','PostToolUse','PreCommit','PreCompact','PreDeploy','PostDeploy','SessionEnd')
$missingEvents = $expectedEvents | Where-Object { $_ -notin $events }
if ($missingEvents) { Write-Error "Missing events: $($missingEvents -join ', ')"; exit 1 }

# Validate schema
$rawConfig = Get-Content $hooksFile -Raw | ConvertFrom-Json
$valid = Test-HooksSchema -Config $rawConfig
if (-not $valid) { Write-Error 'Schema validation failed'; exit 1 }

Remove-Item $testPath -Recurse -Force
Write-Host 'R1-015 PASS' -ForegroundColor Green
```

### 6. Governance

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
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\src\Hooks\ForgeHooks.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\src\Hooks\ForgeHooks.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\src\Hooks\ForgeHooks.psm1" -Force

# Test condition evaluation
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

# Test template resolution
$resolved = Resolve-HookTemplates -Action 'npx eslint {{file}} --cwd {{project_path}}' -Context @{ file='app/page.tsx'; project_path='C:\project' }
if ($resolved -ne 'npx eslint app/page.tsx --cwd C:\project') { Write-Error "Bad resolution: $resolved"; exit 1 }

Write-Host 'R1-016 PASS' -ForegroundColor Green
```

### 6. Governance

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

- `Invoke-HookAction -Hook <hook> -Action 'echo hello' -Context <ctx>` runs the command in a job, captures output, returns PASS if exit code 0
- Shell commands that return non-zero exit code produce FAIL status
- Commands exceeding `timeout_seconds` are killed and produce TIMEOUT status
- PowerShell script hooks (action="powershell", script="FunctionName") invoke the named function
- Output captured up to 10,000 characters (truncated beyond)
- Duration tracked in milliseconds
- SKIP status returned if hook is disabled or conditions don't match (handled upstream, but the function supports it)
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\src\Hooks\ForgeHooks.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\src\Hooks\ForgeHooks.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\src\Hooks\ForgeHooks.psm1" -Force

# Test successful command
$hook = @{ name='test-pass'; timeout_seconds=10; action='powershell'; blocking=$true }
$result = Invoke-HookAction -Hook $hook -Action 'Write-Output "hello"' -Context @{}
if ($result.Status -ne 'PASS') { Write-Error "Expected PASS, got $($result.Status)"; exit 1 }

# Test failing command
$failResult = Invoke-HookAction -Hook $hook -Action 'throw "error"' -Context @{}
if ($failResult.Status -ne 'FAIL') { Write-Error "Expected FAIL, got $($failResult.Status)"; exit 1 }

# Test timeout (command that sleeps longer than timeout)
$timeoutHook = @{ name='test-timeout'; timeout_seconds=2; action='powershell'; blocking=$true }
$toResult = Invoke-HookAction -Hook $timeoutHook -Action 'Start-Sleep -Seconds 10' -Context @{}
if ($toResult.Status -ne 'TIMEOUT') { Write-Error "Expected TIMEOUT, got $($toResult.Status)"; exit 1 }

Write-Host 'R1-017 PASS' -ForegroundColor Green
```

### 6. Governance

Update `STATE_OF_THE_BUILD.md`: Set "Hook System — Action Execution" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-017`.

---

## R1-018 — Hook System: Main Orchestrator (Invoke-Hook)

**Estimated Tokens:** 28,000

### 1. Context

From Hook Lifecycle spec Section 3.1 — the complete `Invoke-Hook` function. This is the single entry point all FORGE modules call. It:
1. Reads hooks.json
2. Filters hooks by event and enabled status
3. Sorts by priority
4. For each hook: checks conditions → resolves templates → executes action → logs result → handles blocking failures
5. Returns aggregate result

From Section 7: Error handling edge cases — hooks.json parse failure falls back to minimal set (tsc + gitleaks only). Recursive hooks suppressed at depth > 2. Sequential execution only.

### 2. Task

Implement `Invoke-Hook` in `ForgeHooks.psm1` exactly as specified. This function ties together Read-HooksConfig, Test-HookConditions, Resolve-HookTemplates, and Invoke-HookAction. It logs every hook execution to the learning database (hook_execution_log table). It handles on_failure modes (BLOCK, REVERT, WARN). It maintains `$Global:HookDepth` for recursion prevention.

### 3. Acceptance Criteria

- `Invoke-Hook -Event 'PostToolUse' -Context @{ project_path=$root; file='test.ts'; ... }` runs all enabled PostToolUse hooks in priority order
- Returns `@{ AllPassed = $true/$false; BlockedBy = <name>; Results = @(...) }`
- Blocking hooks with FAIL status halt further hook execution and return AllPassed=$false
- Non-blocking hooks with FAIL status log warning and continue
- on_failure='WARN' logs and continues even for blocking hooks
- on_failure='REVERT' calls `git checkout -- $file` before blocking
- Hook execution logged to hook_execution_log table (if DB available)
- Recursion depth > 2 suppressed with WARN
- hooks.json parse failure falls back to minimal config
- Console output: `[HOOK] <name> PASS/FAIL (XXms)` with appropriate colors
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\src\Hooks\ForgeHooks.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\src\Hooks\ForgeHooks.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\src\Hooks\ForgeHooks.psm1" -Force

# Create a test hooks.json with one simple hook
$testPath = Join-Path $env:TEMP 'forge_invoke_hook_test'
New-Item -ItemType Directory -Path "$testPath\.forge" -Force | Out-Null
$testHooks = @{
    schema_version = '1.0'
    project_name = 'test'
    hooks = @(
        @{ name='test-hook'; event='PostToolUse'; action='powershell'; script=$null; blocking=$false; timeout_seconds=10; enabled=$true; on_failure='WARN'; priority=10; description='Test hook' }
    )
} | ConvertTo-Json -Depth 5
Set-Content "$testPath\.forge\hooks.json" $testHooks

$result = Invoke-Hook -Event 'PostToolUse' -Context @{ project_path=$testPath; file='test.ts' }
if (-not $result.AllPassed) { Write-Error 'Invoke-Hook failed'; exit 1 }

# Test with no matching hooks
$result2 = Invoke-Hook -Event 'PreDeploy' -Context @{ project_path=$testPath }
if (-not $result2.AllPassed) { Write-Error 'No-match event should pass'; exit 1 }

Remove-Item $testPath -Recurse -Force
Write-Host 'R1-018 PASS' -ForegroundColor Green
```

### 6. Governance

Update `STATE_OF_THE_BUILD.md`: Set "Hook System — Invoke-Hook Orchestrator" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-018`.

---

## R1-019 — Hook System: PreCompact & Context Re-injection

**Estimated Tokens:** 22,000

### 1. Context

From Hook Lifecycle spec Section 4:
"PreCompact fires at ~80% context capacity. Saves to compact_snapshots table: build_id, prompt_index, phase, active unresolved errors, active governance rules, queue status, pending git changes, current acceptance criteria."

"When FORGE detects compaction occurred (previous prompt context is incomplete), it reads the latest compact_snapshot and injects preserved state into the next prompt's context section."

Database schema from Section 4.4:
```sql
CREATE TABLE IF NOT EXISTS compact_snapshots (
    id TEXT PRIMARY KEY, build_id TEXT NOT NULL,
    prompt_index INTEGER NOT NULL, state_json TEXT NOT NULL,
    machine_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_compact_build ON compact_snapshots(build_id, prompt_index DESC);
```

Also: hook_execution_log table.

### 2. Task

Implement `Invoke-PreCompactSave` and `Restore-CompactedContext` in `ForgeHooks.psm1`. The save function gathers current build state (unresolved errors, governance rules, queue position, git status) and stores it as JSON in compact_snapshots. The restore function reads the latest snapshot for a build and returns it as a context object for injection into the next prompt.

Also ensure the compact_snapshots and hook_execution_log tables are created during `Initialize-ForgeMemory` (add them if not already present from R1-003).

### 3. Acceptance Criteria

- `Invoke-PreCompactSave -BuildId <id> -PromptIndex 25 -ProjectPath <path>` saves state to compact_snapshots table
- State JSON includes: build_id, prompt_index, phase, active_errors (from fix_patterns with status=unresolved), active_rules (from governance_rules), pending_git_changes (from `git status --porcelain`), timestamp
- `Restore-CompactedContext -BuildId <id>` returns the latest compact snapshot as a PSCustomObject, or $null if none exists
- hook_execution_log table exists with columns: id, hook_name, event, status, duration_ms, output, build_id, prompt_number, machine_id, created_at
- compact_snapshots table exists with columns per spec
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\src\Hooks\ForgeHooks.psm1
C:\Users\manag\Documents\FORGE 2.0\src\Learning\ForgeLearning.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
foreach ($f in @("$root\src\Hooks\ForgeHooks.psm1","$root\src\Learning\ForgeLearning.psm1")) {
    $errors = $null
    [System.Management.Automation.Language.Parser]::ParseFile($f, [ref]$null, [ref]$errors)
    if ($errors.Count -gt 0) { Write-Error "Parse errors in $f": $($errors[0].Message)"; exit 1 }
}

Import-Module "$root\src\Learning\ForgeLearning.psm1" -Force
Import-Module "$root\src\Hooks\ForgeHooks.psm1" -Force

$testDb = Join-Path $env:TEMP 'forge_compact_test.db'
if (Test-Path $testDb) { Remove-Item $testDb -Force }
Initialize-ForgeMemory -DatabasePath $testDb

# Verify new tables exist
$tables = Invoke-Sqlite -Database $testDb -Query "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('compact_snapshots','hook_execution_log')"
if ($tables.Count -ne 2) { Write-Error "Expected compact_snapshots and hook_execution_log tables"; exit 1 }

# Test save
Invoke-PreCompactSave -BuildId 'test-build' -PromptIndex 25 -ProjectPath $root -DatabasePath $testDb

# Test restore
$snapshot = Restore-CompactedContext -BuildId 'test-build' -DatabasePath $testDb
if (-not $snapshot) { Write-Error 'Snapshot not found after save'; exit 1 }
if ($snapshot.prompt_index -ne 25) { Write-Error "Wrong prompt_index: $($snapshot.prompt_index)"; exit 1 }

Remove-Item $testDb -Force
Write-Host 'R1-019 PASS' -ForegroundColor Green
```

### 6. Governance

Update `STATE_OF_THE_BUILD.md`: Set "Hook System — PreCompact & Context Recovery" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-019`.

---

## R1-020 — RETROFIT Entry Point & Pre-Flight Checks

**Estimated Tokens:** 25,000

### 1. Context

From RETROFIT spec Section 1: Entry point `forge retrofit -ProjectPath "..."` with flags: `-SkipDynamic`, `-ScopeA`, `-Resume`.

Section 1.1 — 8 Pre-Flight Checks:
1. Project path exists (FAIL if not)
2. Git repository (init if missing)
3. Node.js available (fix PATH if needed)
4. Package manager (detect pnpm/npm/yarn from lock files)
5. Environment file (.env.local)
6. Supabase credentials (Scope B/C)
7. Vercel CLI (Scope C)
8. Learning database (create if missing)

Results color coded: Green=PASS, Yellow=WARN/SKIP, Red=FAIL. FAIL on checks 1 or 2 halts.

### 2. Task

Implement `Invoke-ForgeRetrofit` entry point in `ForgeRetrofit.psm1` and `Invoke-PreFlightChecks` in `ForgeScan.psm1`. The retrofit entry point orchestrates the SCAN → DIAGNOSE → RECONCILE → QUEUE pipeline (DIAGNOSE/RECONCILE/QUEUE are stubs for now). Pre-flight checks validate all 8 conditions and set scope flags ($SupabaseAvailable, $VercelAvailable).

### 3. Acceptance Criteria

- `Invoke-ForgeRetrofit -ProjectPath <path>` runs pre-flight checks then dispatches to SCAN
- `Invoke-PreFlightChecks -ProjectPath <path>` returns a structured result with 8 check statuses
- Check 1 failure (missing path) halts with error
- Check 2 failure (no git) initializes git repo automatically
- Check 3 (Node.js) attempts PATH fix, sets $NodeAvailable flag
- Check 4 detects package manager from lock files (pnpm-lock.yaml → pnpm, package-lock.json → npm, yarn.lock → yarn)
- Check 5 parses .env.local into hashtable if present
- Check 6 extracts SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, sets $SupabaseAvailable
- Check 7 tests `vercel whoami`, sets $VercelAvailable
- Check 8 checks for forge_memory.db, creates if missing via Initialize-ForgeMemory
- Console output shows color-coded results per check
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\src\Retrofit\ForgeRetrofit.psm1
C:\Users\manag\Documents\FORGE 2.0\src\Retrofit\ForgeScan.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
foreach ($f in @("$root\src\Retrofit\ForgeRetrofit.psm1","$root\src\Retrofit\ForgeScan.psm1")) {
    $errors = $null
    [System.Management.Automation.Language.Parser]::ParseFile($f, [ref]$null, [ref]$errors)
    if ($errors.Count -gt 0) { Write-Error "Parse errors in $f: $($errors[0].Message)"; exit 1 }
}

Import-Module "$root\src\Learning\ForgeLearning.psm1" -Force
Import-Module "$root\src\Retrofit\ForgeScan.psm1" -Force

# Test pre-flight against FORGE project itself
$result = Invoke-PreFlightChecks -ProjectPath $root
if (-not $result) { Write-Error 'Pre-flight returned null'; exit 1 }
if ($result.ProjectPathExists -ne $true) { Write-Error 'Project path check failed'; exit 1 }

Write-Host 'R1-020 PASS' -ForegroundColor Green
```

### 6. Governance

Update `STATE_OF_THE_BUILD.md`: Set "RETROFIT — Entry Point & Pre-Flight" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-020`.

---

## R1-021 — SCAN Op 1: Directory Tree Enumeration

**Estimated Tokens:** 15,000

### 1. Context

From RETROFIT spec Section 2.1:
```powershell
$tree = Get-ChildItem -Path $ProjectPath -Recurse -File |
  Where-Object { $_.FullName -notmatch 'node_modules|.next|.git|dist|build' } |
  Select-Object FullName, Extension, Length, LastWriteTime

$summary = $tree | Group-Object Extension |
  Select-Object @{N='Extension';E={$_.Name}}, Count,
    @{N='TotalSizeKB';E={($_.Group | Measure-Object Length -Sum).Sum / 1KB}}
```
Output: FileTree object with total file count, breakdown by extension, total project size, last modification date per file.

### 2. Task

Implement `Invoke-ScanDirectoryTree` in `ForgeScan.psm1`. Returns a structured FileTree object with the full file listing and summary statistics.

### 3. Acceptance Criteria

- Function returns object with: `Files` (array of file objects), `Summary` (grouped by extension with count and size), `TotalFiles` (int), `TotalSizeKB` (float), `ScanTimestamp`
- Excludes node_modules, .next, .git, dist, build directories
- Each file entry has: FullName, Extension, Length, LastWriteTime, RelativePath (relative to project root)
- Summary groups by extension with count and total size per extension
- Works on any valid project directory
- Function passes PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\src\Retrofit\ForgeScan.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\src\Retrofit\ForgeScan.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\src\Retrofit\ForgeScan.psm1" -Force

$tree = Invoke-ScanDirectoryTree -ProjectPath $root
if ($tree.TotalFiles -lt 5) { Write-Error "Expected at least 5 files, got $($tree.TotalFiles)"; exit 1 }
if (-not $tree.Summary) { Write-Error 'Summary missing'; exit 1 }

# Should find .ps1 files
$ps1 = $tree.Summary | Where-Object { $_.Extension -eq '.ps1' }
if (-not $ps1) { Write-Error 'No .ps1 files found in summary'; exit 1 }

Write-Host 'R1-021 PASS' -ForegroundColor Green
```

### 6. Governance

Update `STATE_OF_THE_BUILD.md`: Set "RETROFIT SCAN — Directory Tree" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-021`.

---

## R1-022 — SCAN Op 2: Dependency Tree Mapping

**Estimated Tokens:** 28,000

### 1. Context

From RETROFIT spec Section 2.2:
```powershell
$files = Get-ChildItem -Path $ProjectPath -Recurse -Include *.ts,*.tsx,*.js,*.jsx |
  Where-Object { $_.FullName -notmatch 'node_modules|.next' }

foreach ($file in $files) {
  $content = Get-Content $file.FullName -Raw
  $imports = [regex]::Matches($content,
    '(?:import\s+.*?from\s+["\x27]([^"\x27]+)["\x27]|require\(["\x27]([^"\x27]+)["\x27]\))')
}
```
Output: DependencyGraph — directed graph where nodes are files, edges are imports. Each node includes: file path, export names, import count, dependency count.

Note: FORGE 2.0 is PowerShell, but this SCAN operation analyzes TARGET projects which are Next.js/TypeScript. The dependency mapper must work on .ts/.tsx/.js/.jsx files.

### 2. Task

Implement `Invoke-ScanDependencyTree` in `ForgeScan.psm1`. It parses import/export statements from TypeScript/JavaScript files, builds a directed graph, and resolves relative imports to absolute paths. Also extracts export names from each file for broken import detection.

### 3. Acceptance Criteria

- Parses ES6 imports: `import X from 'path'`, `import { X } from 'path'`, `import * as X from 'path'`
- Parses CommonJS: `require('path')`
- Parses dynamic imports: `import('path')`
- Resolves relative paths (`./`, `../`) to absolute file paths, trying `.ts`, `.tsx`, `.js`, `.jsx`, `/index.ts`, `/index.tsx` extensions
- Identifies non-relative imports as external packages (npm modules)
- Extracts export names per file: `export function X`, `export const X`, `export default`, `export { X, Y }`
- Returns graph object with: Nodes (keyed by file path, value = exports + import count), Edges (source → target with imported names)
- Handles files with zero imports and zero exports
- Function passes PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\src\Retrofit\ForgeScan.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\src\Retrofit\ForgeScan.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\src\Retrofit\ForgeScan.psm1" -Force

# Create a test TypeScript project structure
$testDir = Join-Path $env:TEMP 'forge_dep_test'
New-Item -ItemType Directory -Path "$testDir\src" -Force | Out-Null
Set-Content "$testDir\src\utils.ts" "export function helper() { return 1; }`nexport const VALUE = 42;"
Set-Content "$testDir\src\main.ts" "import { helper, VALUE } from './utils';`nconsole.log(helper(), VALUE);"
Set-Content "$testDir\src\orphan.ts" "export const lonely = true;"

$graph = Invoke-ScanDependencyTree -ProjectPath $testDir
if (-not $graph.Nodes) { Write-Error 'Graph has no nodes'; exit 1 }
if (-not $graph.Edges) { Write-Error 'Graph has no edges'; exit 1 }

# main.ts should import from utils.ts
$mainEdges = $graph.Edges | Where-Object { $_.Source -match 'main\.ts' }
if ($mainEdges.Count -lt 1) { Write-Error 'main.ts should have import edges'; exit 1 }

Remove-Item $testDir -Recurse -Force
Write-Host 'R1-022 PASS' -ForegroundColor Green
```

### 6. Governance

Update `STATE_OF_THE_BUILD.md`: Set "RETROFIT SCAN — Dependency Tree" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-022`.

---

## R1-023 — SCAN Ops 3 & 4: Broken Import & Dead File Detection

**Estimated Tokens:** 22,000

### 1. Context

From RETROFIT spec Section 2.3 (Broken Import Detection): For each edge in the dependency graph, resolve the target path. If the target file doesn't exist → CRITICAL. If the file exists but the imported name isn't in its exports → CRITICAL.

From Section 2.4 (Dead File Detection): Files that exist but are never imported by anything. Entry points (page.tsx, route.ts, layout.tsx, middleware.ts, config files) are NOT dead. Dead files are INFO severity — candidates for removal.

### 2. Task

Implement `Invoke-ScanBrokenImports` and `Invoke-ScanDeadFiles` in `ForgeScan.psm1`. Both consume the DependencyGraph from Op 2. Broken imports checks each edge for resolvability and export membership. Dead files identifies unreferenced non-entry-point files.

### 3. Acceptance Criteria

- `Invoke-ScanBrokenImports -DependencyGraph <graph> -ProjectPath <path>` returns array of BrokenImport objects
- Each BrokenImport has: SourceFile, ImportPath, ResolvedPath (or null), MissingExport (or null), Severity='CRITICAL'
- Missing file imports detected (file doesn't exist at resolved path)
- Missing export imports detected (file exists but named export not found)
- `Invoke-ScanDeadFiles -DependencyGraph <graph> -ProjectPath <path>` returns array of dead file paths
- Entry points excluded: files matching `page\.tsx$|route\.ts$|layout\.tsx$|middleware\.ts$|tailwind\.config|next\.config|tsconfig`
- Dead files have Severity='INFO'
- Both functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\src\Retrofit\ForgeScan.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\src\Retrofit\ForgeScan.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\src\Retrofit\ForgeScan.psm1" -Force

# Create test project with broken import and dead file
$testDir = Join-Path $env:TEMP 'forge_broken_test'
New-Item -ItemType Directory -Path "$testDir\app" -Force | Out-Null
Set-Content "$testDir\app\page.tsx" "import { missing } from './nonexistent';"
Set-Content "$testDir\app\utils.ts" "export function helper() {}"
Set-Content "$testDir\app\dead.ts" "export const unused = true;"

$graph = Invoke-ScanDependencyTree -ProjectPath $testDir
$broken = Invoke-ScanBrokenImports -DependencyGraph $graph -ProjectPath $testDir
if ($broken.Count -lt 1) { Write-Error 'Should detect broken import to nonexistent'; exit 1 }

$dead = Invoke-ScanDeadFiles -DependencyGraph $graph -ProjectPath $testDir
# dead.ts and utils.ts should be candidates (utils not imported by page since import is broken)
# page.tsx should NOT be dead (it's an entry point)
$deadNames = $dead | ForEach-Object { Split-Path $_ -Leaf }
if ('page.tsx' -in $deadNames) { Write-Error 'page.tsx should not be dead (entry point)'; exit 1 }

Remove-Item $testDir -Recurse -Force
Write-Host 'R1-023 PASS' -ForegroundColor Green
```

### 6. Governance

Update `STATE_OF_THE_BUILD.md`: Set "RETROFIT SCAN — Broken Imports & Dead Files" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-023`.

---

## R1-024 — SCAN Op 5: Route Inventory

**Estimated Tokens:** 18,000

### 1. Context

From RETROFIT spec Section 2.5:
```powershell
# Page routes
$pageRoutes = Get-ChildItem -Path "$ProjectPath/app" -Recurse -Filter 'page.tsx' |
  ForEach-Object {
    $route = $_.DirectoryName.Replace("$ProjectPath/app", '').Replace('\', '/')
    @{ Type = 'PAGE'; Route = $route; File = $_.FullName }
  }

# API routes with method detection
$apiRoutes = Get-ChildItem -Path "$ProjectPath/app/api" -Recurse -Filter 'route.ts' |
  ForEach-Object {
    $content = Get-Content $_.FullName -Raw
    $methods = @()
    if ($content -match 'export.*function\s+GET')  { $methods += 'GET' }
    # ... POST, PUT, DELETE
  }
```
Output: RouteInventory with pages, API routes (with methods), middleware, layout hierarchy.

### 2. Task

Implement `Invoke-ScanRouteInventory` in `ForgeScan.psm1`. Scans the Next.js `app/` directory structure for page routes, API routes (with HTTP method detection), middleware files, and layout hierarchy.

### 3. Acceptance Criteria

- Detects page routes from `page.tsx` / `page.ts` / `page.jsx` / `page.js` files
- Detects API routes from `route.ts` / `route.js` with HTTP method extraction (GET/POST/PUT/DELETE/PATCH)
- Detects middleware from `middleware.ts` / `middleware.js` at project root or nested
- Detects layouts from `layout.tsx` files with their scope
- Route paths correctly derived from directory structure (e.g., `app/dashboard/settings/page.tsx` → `/dashboard/settings`)
- Dynamic segments preserved in route path (e.g., `app/[id]/page.tsx` → `/[id]`)
- Returns structured RouteInventory with: PageRoutes, ApiRoutes, Middleware, Layouts
- Handles missing `app/` directory gracefully (returns empty inventory)
- Function passes PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\src\Retrofit\ForgeScan.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\src\Retrofit\ForgeScan.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\src\Retrofit\ForgeScan.psm1" -Force

# Create test Next.js app structure
$testDir = Join-Path $env:TEMP 'forge_route_test'
New-Item -ItemType Directory -Path "$testDir\app\api\users" -Force | Out-Null
New-Item -ItemType Directory -Path "$testDir\app\dashboard\[id]" -Force | Out-Null
Set-Content "$testDir\app\page.tsx" "export default function Home() {}"
Set-Content "$testDir\app\layout.tsx" "export default function Layout({children}) {}"
Set-Content "$testDir\app\dashboard\page.tsx" "export default function Dashboard() {}"
Set-Content "$testDir\app\dashboard\[id]\page.tsx" "export default function Detail() {}"
Set-Content "$testDir\app\api\users\route.ts" "export async function GET() {}`nexport async function POST() {}"
Set-Content "$testDir\middleware.ts" "export function middleware() {}"

$inventory = Invoke-ScanRouteInventory -ProjectPath $testDir
if ($inventory.PageRoutes.Count -lt 3) { Write-Error "Expected 3+ page routes, got $($inventory.PageRoutes.Count)"; exit 1 }
if ($inventory.ApiRoutes.Count -lt 1) { Write-Error "Expected 1+ API route"; exit 1 }

# Verify API route has methods
$usersApi = $inventory.ApiRoutes | Where-Object { $_.Route -match 'users' }
if ($usersApi.Methods -notcontains 'GET') { Write-Error 'API route missing GET method'; exit 1 }
if ($usersApi.Methods -notcontains 'POST') { Write-Error 'API route missing POST method'; exit 1 }

Remove-Item $testDir -Recurse -Force
Write-Host 'R1-024 PASS' -ForegroundColor Green
```

### 6. Governance

Update `STATE_OF_THE_BUILD.md`: Set "RETROFIT SCAN — Route Inventory" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-024`.

---

## R1-025 — SCAN Op 6: Environment Variable Audit

**Estimated Tokens:** 22,000

### 1. Context

From RETROFIT spec Section 2.6: Three-source comparison of environment variables.
- Source 1: Code references — scan all .ts/.tsx files for `process.env.VARIABLE_NAME`
- Source 2: .env.local — parse key=value pairs
- Source 3: Vercel production — `vercel env ls --json` (Scope C only)

Classifications:
- MISSING_LOCAL: In code but not .env.local → CRITICAL
- MISSING_PRODUCTION: In .env.local but not Vercel → CRITICAL
- UNUSED: In .env.local but never in code → INFO
- VALUE_MISMATCH: Different values local vs production → WARN

### 2. Task

Implement `Invoke-ScanEnvAudit` in `ForgeScan.psm1`. Extracts env vars from code, parses .env.local, optionally queries Vercel, and produces the three-way comparison with classifications.

### 3. Acceptance Criteria

- Extracts `process.env.XXX` references from all .ts/.tsx files (excluding node_modules, .next)
- Parses .env.local (ignoring comments starting with #, handling quoted values)
- Queries Vercel env vars if $VercelAvailable flag is true (graceful skip if false)
- Classifications correct per spec (MISSING_LOCAL, MISSING_PRODUCTION, UNUSED, VALUE_MISMATCH)
- NEXT_PUBLIC_ vars treated as WARN instead of CRITICAL for MISSING_PRODUCTION
- Returns structured EnvAudit with: CodeRefs, LocalVars, VercelVars, Issues (array with Variable, Issue, Severity)
- Handles missing .env.local gracefully (all code refs become MISSING_LOCAL)
- Function passes PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\src\Retrofit\ForgeScan.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\src\Retrofit\ForgeScan.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\src\Retrofit\ForgeScan.psm1" -Force

# Create test project
$testDir = Join-Path $env:TEMP 'forge_env_test'
New-Item -ItemType Directory -Path "$testDir\src" -Force | Out-Null
Set-Content "$testDir\src\config.ts" "const url = process.env.SUPABASE_URL;`nconst key = process.env.SUPABASE_ANON_KEY;`nconst pub = process.env.NEXT_PUBLIC_APP_NAME;"
Set-Content "$testDir\.env.local" "SUPABASE_URL=https://test.supabase.co`nUNUSED_VAR=something`n# comment line"

$audit = Invoke-ScanEnvAudit -ProjectPath $testDir -VercelAvailable $false
if ($audit.CodeRefs.Count -lt 3) { Write-Error "Expected 3 code refs, got $($audit.CodeRefs.Count)"; exit 1 }

# SUPABASE_ANON_KEY should be MISSING_LOCAL
$missingLocal = $audit.Issues | Where-Object { $_.Variable -eq 'SUPABASE_ANON_KEY' -and $_.Severity -eq 'CRITICAL' }
if (-not $missingLocal) { Write-Error 'SUPABASE_ANON_KEY should be CRITICAL MISSING_LOCAL'; exit 1 }

# UNUSED_VAR should be INFO
$unused = $audit.Issues | Where-Object { $_.Variable -eq 'UNUSED_VAR' }
if (-not $unused -or $unused.Severity -ne 'INFO') { Write-Error 'UNUSED_VAR should be INFO'; exit 1 }

Remove-Item $testDir -Recurse -Force
Write-Host 'R1-025 PASS' -ForegroundColor Green
```

### 6. Governance

Update `STATE_OF_THE_BUILD.md`: Set "RETROFIT SCAN — Env Variable Audit" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-025`.

---

## R1-026 — SCAN Op 7: Database Schema Extraction

**Estimated Tokens:** 25,000

### 1. Context

From RETROFIT spec Section 2.7: Three-source comparison.
- Source 1: Migration files in `supabase/migrations/*.sql`
- Source 2: TypeScript types in `database.types.ts`
- Source 3: Live Supabase schema (Scope B/C only) via information_schema and pg_policies

Classifications:
- TABLE_MISSING_IN_DB → CRITICAL (unapplied migrations)
- TABLE_MISSING_IN_TYPES → WARN (needs type regeneration)
- COLUMN_DRIFT → CRITICAL
- MISSING_RLS → CRITICAL (violates Six Laws, Law 1)
- STALE_MIGRATION → CRITICAL

### 2. Task

Implement `Invoke-ScanSchemaAudit` in `ForgeScan.psm1`. Extracts table definitions from migration SQL files (parsing CREATE TABLE statements), from database.types.ts (parsing TypeScript interfaces), and optionally from live Supabase. Produces three-way comparison with classifications.

### 3. Acceptance Criteria

- Parses CREATE TABLE statements from .sql files to extract table names and column definitions
- Parses TypeScript types file to extract table names from the Database type interface
- Queries live Supabase information_schema and pg_policies if $SupabaseAvailable (graceful skip)
- Compares sources and classifies differences per spec
- Tables without RLS policies flagged as MISSING_RLS (CRITICAL)
- Returns structured SchemaAudit with: MigrationTables, TypesTables, LiveTables, RlsPolicies, Issues
- Handles missing migration directory, missing types file, and unavailable Supabase gracefully
- Function passes PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\src\Retrofit\ForgeScan.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\src\Retrofit\ForgeScan.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\src\Retrofit\ForgeScan.psm1" -Force

# Create test project with migration
$testDir = Join-Path $env:TEMP 'forge_schema_test'
New-Item -ItemType Directory -Path "$testDir\supabase\migrations" -Force | Out-Null
Set-Content "$testDir\supabase\migrations\001_init.sql" @"
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  email TEXT NOT NULL
);
"@

$audit = Invoke-ScanSchemaAudit -ProjectPath $testDir -SupabaseAvailable $false
if ($audit.MigrationTables.Count -lt 2) { Write-Error "Expected 2 migration tables, got $($audit.MigrationTables.Count)"; exit 1 }

Remove-Item $testDir -Recurse -Force
Write-Host 'R1-026 PASS' -ForegroundColor Green
```

### 6. Governance

Update `STATE_OF_THE_BUILD.md`: Set "RETROFIT SCAN — Schema Audit" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-026`.

---

## R1-027 — SCAN Ops 8, 9, 10: Git, Package & Governance Audits

**Estimated Tokens:** 22,000

### 1. Context

These three operations are relatively lightweight and can be combined:

From Section 2.8 (Git History): Last commit, days since commit, uncommitted changes, branches, tags.

From Section 2.9 (Package Audit): Parse package.json, run `npm audit --json`, run `npm outdated --json`.

From Section 2.10 (Governance Inventory): Check for standard governance files, classify each as CURRENT (<7 days), AGING (7-30), STALE (30+), or MISSING.

### 2. Task

Implement `Invoke-ScanGitAudit`, `Invoke-ScanPackageAudit`, and `Invoke-ScanGovernanceInventory` in `ForgeScan.psm1`.

### 3. Acceptance Criteria

- `Invoke-ScanGitAudit` returns: LastCommit (hash, date, message), DaysSinceCommit, UncommittedChanges (array), Branches (array), Tags (array), IsClean (bool)
- `Invoke-ScanPackageAudit` returns: Dependencies (from package.json), DevDependencies, AuditResults (from npm/pnpm audit, or empty if unavailable), OutdatedPackages
- `Invoke-ScanGovernanceInventory` checks for: STATE_OF_THE_BUILD.md, SESSION_STATE.md, BLUEPRINT.md, AGENTS.md, SCHEMA_REGISTRY.md, BEHAVIORAL_CONTRACTS.md, queue.yaml, PRD.md. Returns each with Status (CURRENT/AGING/STALE/MISSING) and LastModified
- All three handle missing prerequisites gracefully (no git → skip git audit, no package.json → skip package audit)
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\src\Retrofit\ForgeScan.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\src\Retrofit\ForgeScan.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\src\Retrofit\ForgeScan.psm1" -Force

# Test git audit against FORGE itself
$gitAudit = Invoke-ScanGitAudit -ProjectPath $root
if (-not $gitAudit.LastCommit) { Write-Error 'Git audit missing LastCommit'; exit 1 }

# Test governance inventory
$govInventory = Invoke-ScanGovernanceInventory -ProjectPath $root
if (-not $govInventory) { Write-Error 'Governance inventory is null'; exit 1 }
$stateDoc = $govInventory | Where-Object { $_.Name -eq 'STATE_OF_THE_BUILD.md' }
if (-not $stateDoc) { Write-Error 'STATE_OF_THE_BUILD.md not found in inventory'; exit 1 }
if ($stateDoc.Status -eq 'MISSING') { Write-Error 'STATE_OF_THE_BUILD.md should exist'; exit 1 }

Write-Host 'R1-027 PASS' -ForegroundColor Green
```

### 6. Governance

Update `STATE_OF_THE_BUILD.md`: Set "RETROFIT SCAN — Git/Package/Governance Audits" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-027`.

---

## R1-028 — SCAN Ops 11 & 12: TypeScript Compilation & Test Execution

**Estimated Tokens:** 20,000

### 1. Context

From Section 2.11 (TypeScript Compilation):
```powershell
$tscOutput = & npx tsc --noEmit --pretty 2>&1
$errors = [regex]::Matches($tscOutput,
  '(\S+)\((\d+),(\d+)\): error (TS\d+): (.+)') |
  ForEach-Object { @{
    File = $_.Groups[1].Value; Line = $_.Groups[2].Value
    Code = $_.Groups[4].Value; Message = $_.Groups[5].Value
  }}
```

From Section 2.12: Run Vitest and Playwright if configured. Count test files even if no runner.

### 2. Task

Implement `Invoke-ScanTscCheck` and `Invoke-ScanTestExecution` in `ForgeScan.psm1`. TSC check runs the TypeScript compiler and parses errors. Test execution runs Vitest/Playwright if configured and counts test files.

### 3. Acceptance Criteria

- `Invoke-ScanTscCheck` runs `npx tsc --noEmit`, parses output for errors with file, line, code, message
- Gracefully handles: no tsconfig.json (SKIP), npx not available (SKIP), compilation success (returns empty errors array)
- Returns: Errors (array), ErrorCount (int), Status (PASS/FAIL/SKIP)
- `Invoke-ScanTestExecution` detects test frameworks from config (vitest.config.ts, playwright.config.ts)
- Runs `npx vitest run --reporter=json` if Vitest configured, parses results
- Counts test files matching patterns `*.test.ts`, `*.spec.ts`, `*.test.tsx`, `*.spec.tsx`
- Returns: Framework, TestFileCount, PassCount, FailCount, Status (PASS/FAIL/SKIP/NO_TESTS)
- Both functions handle missing dependencies gracefully (SKIP, not error)
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\src\Retrofit\ForgeScan.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\src\Retrofit\ForgeScan.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\src\Retrofit\ForgeScan.psm1" -Force

# Test against FORGE itself (no tsconfig → should SKIP)
$tscResult = Invoke-ScanTscCheck -ProjectPath $root
if ($tscResult.Status -notin @('PASS','FAIL','SKIP')) { Write-Error "Bad TSC status: $($tscResult.Status)"; exit 1 }

$testResult = Invoke-ScanTestExecution -ProjectPath $root
if ($testResult.Status -notin @('PASS','FAIL','SKIP','NO_TESTS')) { Write-Error "Bad test status: $($testResult.Status)"; exit 1 }

Write-Host 'R1-028 PASS' -ForegroundColor Green
```

### 6. Governance

Update `STATE_OF_THE_BUILD.md`: Set "RETROFIT SCAN — TSC & Test Execution" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-028`.

---

## R1-029 — SCAN Op 13: Dynamic Route Testing

**Estimated Tokens:** 25,000

### 1. Context

From RETROFIT spec Section 2.13:
```powershell
# Start dev server on port 3099
$devProcess = Start-Process -FilePath 'npx' -ArgumentList 'next','dev','--port','3099' ...
# Poll until ready (max 60 seconds)
# Hit every page route with GET
# Hit every API route that has GET method
# Capture status codes
# Stop dev server
```
Classifications: 500 = CRITICAL, 401/403 = INFO (expected for auth), 404 = WARN.

### 2. Task

Implement `Invoke-ScanDynamicRoutes` in `ForgeScan.psm1`. Starts the dev server, waits for it to be ready, hits every route from the RouteInventory with GET requests, captures HTTP status codes, classifies results, and stops the server. Uses Approach A (GET-only, safe, no side effects).

### 3. Acceptance Criteria

- Starts dev server on port 3099 with `npx next dev --port 3099`
- Polls `http://localhost:3099` every 2 seconds until 200 response (max 60 seconds)
- Hits every page route with `Invoke-WebRequest` (or curl)
- Hits every API route that supports GET
- Captures status code for each route
- Classifies: 200=PASS, 500=CRITICAL, 401/403=INFO, 404=WARN, timeout=WARN
- Stops dev server via `Stop-Process` in `finally` block (always cleans up)
- Returns: Results (array with Route, StatusCode, Severity), ServerStarted (bool), Duration
- Graceful degradation: if `next` not installed, returns SKIP
- `-SkipDynamic` flag skips this entire operation
- Function passes PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\src\Retrofit\ForgeScan.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\src\Retrofit\ForgeScan.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\src\Retrofit\ForgeScan.psm1" -Force

# Test with SkipDynamic (since FORGE itself is not a Next.js app)
$emptyInventory = @{ PageRoutes = @(); ApiRoutes = @() }
$result = Invoke-ScanDynamicRoutes -ProjectPath $root -RouteInventory $emptyInventory -SkipDynamic $true
if ($result.Status -ne 'SKIP') { Write-Error "Expected SKIP, got $($result.Status)"; exit 1 }

# Verify function exists with correct params
$cmd = Get-Command Invoke-ScanDynamicRoutes
if (-not $cmd) { Write-Error 'Function not found'; exit 1 }

Write-Host 'R1-029 PASS' -ForegroundColor Green
```

### 6. Governance

Update `STATE_OF_THE_BUILD.md`: Set "RETROFIT SCAN — Dynamic Route Testing" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-029`.

---

## R1-030 — SCAN Op 14 & Report Assembly: Vercel Analysis + ScanReport Output

**Estimated Tokens:** 25,000

### 1. Context

From RETROFIT spec Section 2.14 (Vercel Deployment Analysis): Check deployment age, domain config, deployment-to-code match. Deployment >14 days not matching code = WARN.

From Section 3 (SCAN Output Structure): Complete `$ScanReport` hashtable with all 14 operation results, serialized to `.forge/scan_report.json`.

### 2. Task

Implement `Invoke-ScanVercelAnalysis` and `Export-ScanReport` in `ForgeScan.psm1`. Also implement the master `Invoke-RetrofitScan` orchestrator that calls all 14 operations in sequence and assembles the final report.

### 3. Acceptance Criteria

- `Invoke-ScanVercelAnalysis` checks deployment age, domain config via `vercel` CLI
- Graceful degradation if Vercel CLI unavailable (SKIP)
- Deployment >14 days flagged as WARN
- `Export-ScanReport` assembles all 14 operation results into the structured ScanReport hashtable
- Report serialized to `.forge/scan_report.json` with `-Depth 10`
- Report also saved to learning database (scan_reports table) with summary counts
- `Invoke-RetrofitScan` orchestrates: pre-flight → all 14 ops → report assembly
- Console output shows progress per operation with timing
- Total scan time tracked and displayed
- Report includes: ProjectName, ProjectPath, ScanTimestamp, ScanScope, and all 14 operation results
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\src\Retrofit\ForgeScan.psm1
C:\Users\manag\Documents\FORGE 2.0\src\Retrofit\ForgeRetrofit.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
foreach ($f in @("$root\src\Retrofit\ForgeScan.psm1","$root\src\Retrofit\ForgeRetrofit.psm1")) {
    $errors = $null
    [System.Management.Automation.Language.Parser]::ParseFile($f, [ref]$null, [ref]$errors)
    if ($errors.Count -gt 0) { Write-Error "Parse errors in $f: $($errors[0].Message)"; exit 1 }
}

Import-Module "$root\src\Retrofit\ForgeScan.psm1" -Force

# Verify Export-ScanReport function exists
$cmd = Get-Command Export-ScanReport -ErrorAction SilentlyContinue
if (-not $cmd) { Write-Error 'Export-ScanReport not found'; exit 1 }

# Verify Invoke-RetrofitScan function exists
$cmd2 = Get-Command Invoke-RetrofitScan -ErrorAction SilentlyContinue
if (-not $cmd2) { Write-Error 'Invoke-RetrofitScan not found'; exit 1 }

Write-Host 'R1-030 PASS' -ForegroundColor Green
```

### 6. Governance

Update `STATE_OF_THE_BUILD.md`: Set "RETROFIT SCAN — Vercel Analysis & Report Assembly" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-030`.

## R1-031 — Session Orchestration: Build Fingerprinting

**Estimated Tokens:** 18,000

### 1. Context

From Session Orchestration spec Section 3: Build fingerprint is SHA-256 of the project's file structure and content. Includes all source files, configs, governance docs, migrations. Excludes node_modules, .next, .git, .forge/session_state.json, dist, build, coverage.

```powershell
function Get-BuildFingerprint {
    param([string]$ProjectPath)
    $files = Get-ChildItem -Path $ProjectPath -Recurse -File |
        Where-Object {
            $_.FullName -notmatch 'node_modules|\.next|\.git[/\\]|\.forge[/\\]session_state|dist|build|coverage'
        } | Sort-Object FullName
    # Build composite hash: relative path + content hash per file
    # SHA-256 of the composite
}
```

Fingerprint stored in build_fingerprints table:
```sql
CREATE TABLE IF NOT EXISTS build_fingerprints (
    id TEXT PRIMARY KEY, build_id TEXT NOT NULL,
    prompt_number INTEGER NOT NULL, fingerprint TEXT NOT NULL,
    file_count INTEGER NOT NULL, total_size_kb INTEGER NOT NULL,
    machine_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 2. Task

Implement `Get-BuildFingerprint` and `Save-BuildFingerprint` in `ForgeSession.psm1`. Add the `build_fingerprints` table to `Initialize-ForgeMemory` in `ForgeLearning.psm1`.

### 3. Acceptance Criteria

- `Get-BuildFingerprint -ProjectPath <path>` returns 64-character hex SHA-256 hash
- Same project state produces same fingerprint on repeated calls
- Modifying any file changes the fingerprint
- Adding or removing a file changes the fingerprint
- Excluded directories (node_modules, .next, .git, etc.) do not affect fingerprint
- `Save-BuildFingerprint -BuildId <id> -PromptNumber <n> -Fingerprint <hash> -FileCount <n> -TotalSizeKB <n>` saves to build_fingerprints table
- build_fingerprints table created during Initialize-ForgeMemory
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\src\Session\ForgeSession.psm1
C:\Users\manag\Documents\FORGE 2.0\src\Learning\ForgeLearning.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
foreach ($f in @("$root\src\Session\ForgeSession.psm1","$root\src\Learning\ForgeLearning.psm1")) {
    $errors = $null
    [System.Management.Automation.Language.Parser]::ParseFile($f, [ref]$null, [ref]$errors)
    if ($errors.Count -gt 0) { Write-Error "Parse errors in $f: $($errors[0].Message)"; exit 1 }
}

Import-Module "$root\src\Session\ForgeSession.psm1" -Force
Import-Module "$root\src\Learning\ForgeLearning.psm1" -Force

# Test fingerprint stability
$fp1 = Get-BuildFingerprint -ProjectPath $root
$fp2 = Get-BuildFingerprint -ProjectPath $root
if ($fp1 -ne $fp2) { Write-Error 'Fingerprint not stable'; exit 1 }
if ($fp1.Length -ne 64) { Write-Error "Expected 64-char hex, got $($fp1.Length)"; exit 1 }

# Verify table exists
$testDb = Join-Path $env:TEMP 'forge_fp_test.db'
if (Test-Path $testDb) { Remove-Item $testDb -Force }
Initialize-ForgeMemory -DatabasePath $testDb
$tables = Invoke-Sqlite -Database $testDb -Query "SELECT name FROM sqlite_master WHERE type='table' AND name='build_fingerprints'"
if ($tables.Count -ne 1) { Write-Error 'build_fingerprints table not created'; exit 1 }
Remove-Item $testDb -Force

Write-Host 'R1-031 PASS' -ForegroundColor Green
```

### 6. Governance

Update `STATE_OF_THE_BUILD.md`: Set "Session Orchestration — Build Fingerprinting" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-031`.

---

## R1-032 — Session Orchestration: State Serialization

**Estimated Tokens:** 30,000

### 1. Context

From Session Orchestration spec Section 2.2: Complete state object with 30+ fields including build identity, execution position, git state, build fingerprint, queue status, active blockers, environment snapshot, run statistics, learning summary, and files modified.

The function fires at SessionEnd and serializes to both `.forge/session_state.json` and the build_outcomes table.

### 2. Task

Implement `Export-SessionState` in `ForgeSession.psm1` as specified in the Session Orchestration spec. It assembles the complete state object from runtime globals, git state, build fingerprint, queue status, environment checks, and learning database queries. Saves as JSON and to build_outcomes table.

### 3. Acceptance Criteria

- `Export-SessionState -ProjectPath <path> -BuildId <id> -LastPromptExecuted <n> -EndReason 'COMPLETED'` creates `.forge/session_state.json`
- State object includes all sections: build_identity, execution_position, git_state, build_fingerprint, queue_status, active_blockers, environment, run_stats, learning_summary, files_modified
- Build identity includes: build_id, project_name, project_path, serialized_at, machine_id, end_reason
- Git state includes: branch, commit SHA, dirty flag, last forge tag
- Run stats includes: prompts_executed, prompts_passed, prompts_retried, prompts_failed, total_tokens, first_pass_rate, start_time, duration_minutes
- Data also saved to build_outcomes table in learning database
- Console output shows summary of serialized state
- Function passes PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\src\Session\ForgeSession.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\src\Session\ForgeSession.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\src\Session\ForgeSession.psm1" -Force
Import-Module "$root\src\Learning\ForgeLearning.psm1" -Force
Import-Module "$root\src\Core\ForgeCore.psm1" -Force

# Set globals for testing
$Global:ForgeCurrentPhase = 'EXECUTE'
$Global:ForgeRunNumber = 1
$Global:ForgePromptsExecuted = 5
$Global:ForgePromptsPassed = 4
$Global:ForgePromptsRetried = 1
$Global:ForgePromptsFailed = 0
$Global:ForgeTotalTokens = 150000
$Global:ForgeRunStartTime = (Get-Date).AddHours(-2)
$Global:ForgeBuildMode = 'GREENFIELD'
$Global:ForgeMaturityStage = 'FOUNDATION'

Export-SessionState -ProjectPath $root -BuildId 'test-build' -LastPromptExecuted 5 -EndReason 'PAUSED'

$stateFile = "$root\.forge\session_state.json"
if (-not (Test-Path $stateFile)) { Write-Error 'Session state file not created'; exit 1 }
$state = Get-Content $stateFile -Raw | ConvertFrom-Json
if ($state.build_id -ne 'test-build') { Write-Error 'Wrong build_id'; exit 1 }
if ($state.end_reason -ne 'PAUSED') { Write-Error 'Wrong end_reason'; exit 1 }

Write-Host 'R1-032 PASS' -ForegroundColor Green
```

### 6. Governance

Update `STATE_OF_THE_BUILD.md`: Set "Session Orchestration — State Serialization" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-032`.

---

## R1-033 — Session Orchestration: Queue Status Tracking

**Estimated Tokens:** 18,000

### 1. Context

From Session Orchestration spec Section 5: `Get-DetailedQueueStatus` reads queue.yaml and `.forge/prompt_status.json` to determine completed/failed/skipped/pending/blocked counts. `Update-PromptStatus` records individual prompt results.

### 2. Task

Implement `Get-DetailedQueueStatus` and `Update-PromptStatus` in `ForgeSession.psm1`. Queue status tracks which prompts have been executed and their outcomes. The status file `.forge/prompt_status.json` is a simple key-value map of prompt ID → status.

### 3. Acceptance Criteria

- `Update-PromptStatus -ProjectPath <path> -PromptId 'R1-001' -Status 'COMPLETED'` writes to `.forge/prompt_status.json`
- `Get-DetailedQueueStatus -ProjectPath <path>` returns: total, completed, failed, skipped, pending, blocked, next_prompt, percent_complete
- Status file is created if it doesn't exist
- Existing status file is read and updated (not overwritten)
- next_prompt returns the first prompt not in COMPLETED/FAILED/SKIPPED status
- percent_complete calculated as (completed / total) * 100
- Handles missing queue.yaml gracefully (returns status='NO_QUEUE')
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\src\Session\ForgeSession.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\src\Session\ForgeSession.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\src\Session\ForgeSession.psm1" -Force

# Create test prompt files
$testPath = Join-Path $env:TEMP 'forge_queue_test'
New-Item -ItemType Directory -Path "$testPath\.forge\prompts" -Force | Out-Null
Set-Content "$testPath\.forge\prompts\R1-001.md" 'test prompt 1'
Set-Content "$testPath\.forge\prompts\R1-002.md" 'test prompt 2'
Set-Content "$testPath\.forge\prompts\R1-003.md" 'test prompt 3'

Update-PromptStatus -ProjectPath $testPath -PromptId 'R1-001' -Status 'COMPLETED'
Update-PromptStatus -ProjectPath $testPath -PromptId 'R1-002' -Status 'FAILED'

$status = Get-DetailedQueueStatus -ProjectPath $testPath
if ($status.total -ne 3) { Write-Error "Expected 3 total, got $($status.total)"; exit 1 }
if ($status.completed -ne 1) { Write-Error "Expected 1 completed, got $($status.completed)"; exit 1 }
if ($status.failed -ne 1) { Write-Error "Expected 1 failed, got $($status.failed)"; exit 1 }
if ($status.next_prompt -ne 'R1-003') { Write-Error "Expected R1-003 next, got $($status.next_prompt)"; exit 1 }

Remove-Item $testPath -Recurse -Force
Write-Host 'R1-033 PASS' -ForegroundColor Green
```

### 6. Governance

Update `STATE_OF_THE_BUILD.md`: Set "Session Orchestration — Queue Status" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-033`.

---

## R1-034 — Session Orchestration: Session Resumption

**Estimated Tokens:** 28,000

### 1. Context

From Session Orchestration spec Section 4.1: Resume-ForgeSession reads session_state.json, verifies fingerprint, checks environment consistency, shows active blockers, and presents queue status. The complete resumption flow includes staleness warning (>48 hours) and human confirmation for blockers.

### 2. Task

Implement `Resume-ForgeSession` in `ForgeSession.psm1`. Reads the previous session state, verifies the build fingerprint matches, checks environment consistency, displays active blockers, and shows queue status. Returns the loaded state or $null if no previous session or user cancels.

### 3. Acceptance Criteria

- Reads `.forge/session_state.json` if it exists, returns $null if not
- Displays build ID, last prompt, end reason, serialization timestamp, machine ID
- Warns if session is >48 hours old
- Computes current fingerprint and compares to stored fingerprint
- Fingerprint MATCH proceeds normally
- Fingerprint MISMATCH calls Handle-FingerprintMismatch (stub for now, implemented in R1-035)
- Checks environment consistency (Node.js version, Supabase accessibility)
- Lists active blockers from previous session with human confirmation to proceed
- Shows queue status (completed/total with percentage)
- Returns the loaded state object on success, $null on cancellation or no prior state
- Function passes PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\src\Session\ForgeSession.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\src\Session\ForgeSession.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\src\Session\ForgeSession.psm1" -Force

# Test with no prior session
$result = Resume-ForgeSession -ProjectPath (Join-Path $env:TEMP 'nonexistent_forge')
if ($result -ne $null) { Write-Error 'Should return null for missing session'; exit 1 }

# Test with existing session state (from R1-032)
if (Test-Path "$root\.forge\session_state.json") {
    # Function should at least not throw
    $cmd = Get-Command Resume-ForgeSession
    if (-not $cmd) { Write-Error 'Function not found'; exit 1 }
}

Write-Host 'R1-034 PASS' -ForegroundColor Green
```

### 6. Governance

Update `STATE_OF_THE_BUILD.md`: Set "Session Orchestration — Session Resumption" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-034`.

---

## R1-035 — Session Orchestration: Fingerprint Mismatch Handling

**Estimated Tokens:** 25,000

### 1. Context

From Session Orchestration spec Section 4.2: When fingerprint doesn't match, identify changed files using git diff, assess impact (governance changes, migration changes, middleware changes), and present options: [C]ontinue, [R]ecompose queue, [S] full SCAN, [X] cancel.

### 2. Task

Implement `Handle-FingerprintMismatch` in `ForgeSession.psm1`. Identifies changed files via `git diff`, classifies impact, presents interactive options to the user. The [R]ecompose and [S]can options call stubs (Composer and RETROFIT SCAN respectively — Composer isn't built yet).

### 3. Acceptance Criteria

- Identifies changed files between expected commit and HEAD using `git diff --name-status`
- Identifies uncommitted changes and untracked files
- Deduplicates file list
- Classifies high-impact changes: governance documents, migrations, middleware.ts
- Displays changed file list (capped at 20 with "and X more")
- Presents [C]ontinue / [R]ecompose / [S]can / [X]cancel options
- [C] returns `@{ Continue=$true; Action='ACCEPT' }`
- [R] calls queue recomposition (stub) and returns Continue=$true
- [S] calls RETROFIT SCAN and returns Continue=$false (user needs to re-enter)
- [X] returns Continue=$false
- Function passes PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\src\Session\ForgeSession.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\src\Session\ForgeSession.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\src\Session\ForgeSession.psm1" -Force

# Verify function exists with correct params
$cmd = Get-Command Handle-FingerprintMismatch -ErrorAction SilentlyContinue
if (-not $cmd) { Write-Error 'Handle-FingerprintMismatch not found'; exit 1 }

Write-Host 'R1-035 PASS' -ForegroundColor Green
```

### 6. Governance

Update `STATE_OF_THE_BUILD.md`: Set "Session Orchestration — Fingerprint Mismatch" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-035`.

---

## R1-036 — Session Orchestration: Crash Recovery & Locks

**Estimated Tokens:** 20,000

### 1. Context

From Session Orchestration spec Section 7: If FORGE is interrupted mid-run, SessionEnd may not fire. On next invocation, detect stale lock file. Recover from most recent compact_snapshot if available.

Lock file at `.forge/forge_running.lock` contains machine_id, build_id, started_at, PID. Created at SessionStart, removed at SessionEnd. Stale if >5 minutes old.

### 2. Task

Implement `Test-CrashRecovery`, `Set-ForgeLock`, and `Remove-ForgeLock` in `ForgeSession.psm1`. Crash recovery checks for stale lock, offers recovery from compact snapshot, and cleans up.

### 3. Acceptance Criteria

- `Set-ForgeLock -ProjectPath <path> -BuildId <id>` creates `.forge/forge_running.lock` with machine_id, build_id, started_at, PID as JSON
- `Remove-ForgeLock -ProjectPath <path>` deletes the lock file, no error if missing
- `Test-CrashRecovery -ProjectPath <path>` checks for stale lock (>5 minutes old)
- If stale lock found: reads most recent compact_snapshot from learning DB
- If snapshot found: offers recovery with prompt index displayed
- If no snapshot: warns about incomplete run data, removes stale lock
- Returns `@{ Recovered=$true/$false; Snapshot=<data> }`
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\src\Session\ForgeSession.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\src\Session\ForgeSession.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\src\Session\ForgeSession.psm1" -Force

# Test lock creation and removal
Set-ForgeLock -ProjectPath $root -BuildId 'test-lock-build'
if (-not (Test-Path "$root\.forge\forge_running.lock")) { Write-Error 'Lock not created'; exit 1 }
$lockContent = Get-Content "$root\.forge\forge_running.lock" -Raw | ConvertFrom-Json
if ($lockContent.build_id -ne 'test-lock-build') { Write-Error 'Wrong build_id in lock'; exit 1 }

Remove-ForgeLock -ProjectPath $root
if (Test-Path "$root\.forge\forge_running.lock") { Write-Error 'Lock not removed'; exit 1 }

# Remove again (should not error)
Remove-ForgeLock -ProjectPath $root

# Test crash recovery with no lock (should return Recovered=$false)
$recovery = Test-CrashRecovery -ProjectPath $root
if ($recovery.Recovered) { Write-Error 'Should not recover when no lock exists'; exit 1 }

Write-Host 'R1-036 PASS' -ForegroundColor Green
```

### 6. Governance

Update `STATE_OF_THE_BUILD.md`: Set "Session Orchestration — Crash Recovery & Locks" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-036`.

---

## R1-037 — Session Orchestration: Handoff Document Generation

**Estimated Tokens:** 22,000

### 1. Context

From Session Orchestration spec Section 6: SESSION_HANDOFF document generated at SessionEnd. Includes 8 sections: Build Summary, Completed This Run, Failed This Run, Active Blockers, Queue Status, Next Run Plan, Environment Notes, Learning Highlights.

The handoff is generated by Claude API call with the session state as input. For FORGE 2.0's self-build, it generates a markdown template populated from the session state data (no Claude API dependency during self-build).

### 2. Task

Implement `Export-SessionHandoff` in `ForgeSession.psm1`. For the self-build phase, this generates the handoff document directly from session state data (template-based, no Claude API). The function populates all 8 sections from the runtime data.

### 3. Acceptance Criteria

- `Export-SessionHandoff -ProjectPath <path> -SessionState <state>` creates `.forge/SESSION_HANDOFF.md`
- Document includes all 8 sections with data from session state
- Build Summary shows: project, build ID, run number, prompts executed/passed/failed, first-pass rate, duration, end reason
- Completed This Run lists passed prompts with descriptions (from build tracker)
- Failed This Run lists failed prompts with error summaries
- Active Blockers listed if any exist in session state
- Queue Status shows completion percentage and remaining work
- Environment Notes lists any environment issues detected
- Learning Highlights summarizes errors registered, rules enforced, evolutions generated
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\src\Session\ForgeSession.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\src\Session\ForgeSession.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\src\Session\ForgeSession.psm1" -Force

# Create test session state
$testState = @{
    build_id = 'test-handoff-build'
    project_name = 'forge20'
    end_reason = 'COMPLETED'
    run_stats = @{ prompts_executed=10; prompts_passed=9; prompts_failed=1; total_tokens=250000; first_pass_rate=0.9; duration_minutes=120 }
    queue_status = @{ total=45; completed=10; pending=35; percent_complete=22.2 }
    active_blockers = @()
    learning_summary = @{ errors_registered=3; governance_rules_enforced=5; evolutions_generated=1 }
}

Export-SessionHandoff -ProjectPath $root -SessionState $testState
$handoff = "$root\.forge\SESSION_HANDOFF.md"
if (-not (Test-Path $handoff)) { Write-Error 'Handoff not created'; exit 1 }
$content = Get-Content $handoff -Raw
if ($content -notmatch 'Build Summary') { Write-Error 'Missing Build Summary section'; exit 1 }
if ($content -notmatch 'Queue Status') { Write-Error 'Missing Queue Status section'; exit 1 }

Write-Host 'R1-037 PASS' -ForegroundColor Green
```

### 6. Governance

Update `STATE_OF_THE_BUILD.md`: Set "Session Orchestration — Handoff Generation" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-037`.

---

## R1-038 — Session Orchestration: Run Lifecycle Integration

**Estimated Tokens:** 25,000

### 1. Context

From Session Orchestration spec Section 8: Complete multi-run lifecycle sequence.

Run Start: crash recovery → lock → sync pull → load knowledge → present evolutions → resume session → begin execution.
Run End: export state → update weights → analyze evolutions → evaluate adversary → export handoff → sync push → git commit → remove lock → print summary.

### 2. Task

Implement `Invoke-RunStart` and `Invoke-RunEnd` in `ForgeSession.psm1`. These orchestrate the complete startup and shutdown sequences, calling all the component functions built in prior prompts. Wire these into the core pipeline controller (forge.ps1) so every FORGE run goes through proper startup/shutdown.

### 3. Acceptance Criteria

- `Invoke-RunStart -ProjectPath <path> -BuildId <id>` executes the startup sequence in order
- Startup includes: crash recovery check, lock acquisition, sync pull (if master available), knowledge loading (stub), evolution presentation (stub), session resumption
- `Invoke-RunEnd -ProjectPath <path> -BuildId <id> -EndReason 'COMPLETED'` executes the shutdown sequence
- Shutdown includes: state serialization, handoff generation, sync push (if master available), git commit + push, lock removal, summary output
- Both functions handle errors gracefully — shutdown MUST complete even if individual steps fail (use try/finally)
- `forge.ps1` calls `Invoke-RunStart` at the beginning and `Invoke-RunEnd` at the end of every command
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\src\Session\ForgeSession.psm1
C:\Users\manag\Documents\FORGE 2.0\forge.ps1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
foreach ($f in @("$root\src\Session\ForgeSession.psm1","$root\forge.ps1")) {
    $errors = $null
    [System.Management.Automation.Language.Parser]::ParseFile($f, [ref]$null, [ref]$errors)
    if ($errors.Count -gt 0) { Write-Error "Parse errors in $f: $($errors[0].Message)"; exit 1 }
}

Import-Module "$root\src\Session\ForgeSession.psm1" -Force

$cmd1 = Get-Command Invoke-RunStart -ErrorAction SilentlyContinue
$cmd2 = Get-Command Invoke-RunEnd -ErrorAction SilentlyContinue
if (-not $cmd1) { Write-Error 'Invoke-RunStart not found'; exit 1 }
if (-not $cmd2) { Write-Error 'Invoke-RunEnd not found'; exit 1 }

Write-Host 'R1-038 PASS' -ForegroundColor Green
```

### 6. Governance

Update `STATE_OF_THE_BUILD.md`: Set "Session Orchestration — Run Lifecycle" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-038`.

---

## R1-039 — DIAGNOSE: Console Output Formatter

**Estimated Tokens:** 18,000

### 1. Context

From RETROFIT spec Section 4.1 (Console Output, Format C):
```powershell
function Write-Finding {
  param([string]$Severity, [string]$Category, [string]$Message)
  $color = switch ($Severity) {
    'CRITICAL' { 'Red' }
    'WARN'     { 'Yellow' }
    'INFO'     { 'Gray' }
  }
  Write-Host "[$Severity]" -ForegroundColor $color -NoNewline
  Write-Host " [$Category] " -ForegroundColor Cyan -NoNewline
  Write-Host $Message
}
```

DIAGNOSE transforms raw SCAN data into actionable findings displayed in the console with color-coded severity.

### 2. Task

Implement `Write-Finding`, `Write-DiagnoseHeader`, `Write-DiagnoseSummary`, and `Format-ScanFindings` in `ForgeDiagnose.psm1`. `Format-ScanFindings` takes the raw ScanReport and extracts all findings with severity classifications from each operation. This is the presentation layer for DIAGNOSE output.

### 3. Acceptance Criteria

- `Write-Finding -Severity 'CRITICAL' -Category 'IMPORTS' -Message 'Broken import in page.tsx'` outputs color-coded console line
- `Write-DiagnoseHeader` displays the DIAGNOSE phase header with project info
- `Write-DiagnoseSummary` displays totals: X CRITICAL, Y WARN, Z INFO
- `Format-ScanFindings -ScanReport <report>` extracts findings from all operations:
  - Broken imports → CRITICAL
  - Dead files → INFO
  - Missing env vars (MISSING_LOCAL) → CRITICAL
  - Schema drift → CRITICAL
  - TSC errors → CRITICAL
  - 500 status codes from dynamic testing → CRITICAL
  - Stale governance → WARN
- Returns structured array of Finding objects: Severity, Category, Message, Source (which SCAN operation)
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\src\Retrofit\ForgeDiagnose.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\src\Retrofit\ForgeDiagnose.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\src\Retrofit\ForgeDiagnose.psm1" -Force

# Test Write-Finding (visual check — just verify it doesn't throw)
Write-Finding -Severity 'CRITICAL' -Category 'TEST' -Message 'Test critical finding'
Write-Finding -Severity 'WARN' -Category 'TEST' -Message 'Test warning'
Write-Finding -Severity 'INFO' -Category 'TEST' -Message 'Test info'

# Test Format-ScanFindings with mock report
$mockReport = @{
    BrokenImports = @(@{ SourceFile='test.ts'; ImportPath='./missing'; Severity='CRITICAL' })
    DeadFiles = @('orphan.ts')
    EnvAudit = @{ Issues = @(@{ Variable='SECRET'; Severity='CRITICAL'; Issue='Missing from .env.local' }) }
    CompilationAudit = @{ Errors=@(); ErrorCount=0; Status='PASS' }
}
$findings = Format-ScanFindings -ScanReport $mockReport
if ($findings.Count -lt 2) { Write-Error "Expected at least 2 findings from mock report"; exit 1 }

Write-Host 'R1-039 PASS' -ForegroundColor Green
```

### 6. Governance

Update `STATE_OF_THE_BUILD.md`: Set "DIAGNOSE — Console Formatter" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-039`.

---

## R1-040 — DIAGNOSE: Architecture Health Report

**Estimated Tokens:** 25,000

### 1. Context

From RETROFIT spec Section 4.2: "Architecture Health Report — Every structural issue classified into three tiers: CRITICAL (blocks forward progress), WARN (suboptimal but functional), INFO (noted for awareness)."

The health report is generated by analyzing the scan findings, grouping by category, and producing a structured markdown document. In the production FORGE, this uses a Claude API call. For self-build, we generate it from the structured findings data.

### 2. Task

Implement `New-ArchitectureHealthReport` in `ForgeDiagnose.psm1`. It takes the scan report and formatted findings, groups them by category and severity, and generates a comprehensive markdown health report. Also implement maturity stage detection based on the scan results.

### 3. Acceptance Criteria

- `New-ArchitectureHealthReport -ScanReport <report> -Findings <findings> -ProjectPath <path>` generates `.forge/ARCHITECTURE_HEALTH_REPORT.md`
- Report grouped by category (IMPORTS, SCHEMA, ENV, ROUTES, TESTS, GOVERNANCE, etc.)
- Each category shows CRITICAL items first, then WARN, then INFO
- Summary section with total counts per severity
- Maturity stage auto-detected: FOUNDATION (can't compile or critical breakage), GROWTH (core works, needs optimization), ENTERPRISE (production-ready, needs hardening)
- Detection logic: >0 CRITICAL compile/schema issues → FOUNDATION; 0 CRITICAL but WARN present → GROWTH; 0 CRITICAL and 0 WARN → ENTERPRISE
- Report includes recommended action for each finding
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\src\Retrofit\ForgeDiagnose.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\src\Retrofit\ForgeDiagnose.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\src\Retrofit\ForgeDiagnose.psm1" -Force

$mockFindings = @(
    @{ Severity='CRITICAL'; Category='IMPORTS'; Message='Broken import'; Source='BrokenImports' }
    @{ Severity='WARN'; Category='GOVERNANCE'; Message='Stale doc'; Source='GovernanceInventory' }
    @{ Severity='INFO'; Category='FILES'; Message='Dead file found'; Source='DeadFiles' }
)
$mockReport = @{ ProjectName='test-project'; ScanTimestamp=(Get-Date -Format 'o') }

$testPath = Join-Path $env:TEMP 'forge_health_test'
New-Item -ItemType Directory -Path "$testPath\.forge" -Force | Out-Null

New-ArchitectureHealthReport -ScanReport $mockReport -Findings $mockFindings -ProjectPath $testPath
$reportPath = "$testPath\.forge\ARCHITECTURE_HEALTH_REPORT.md"
if (-not (Test-Path $reportPath)) { Write-Error 'Health report not created'; exit 1 }
$content = Get-Content $reportPath -Raw
if ($content -notmatch 'CRITICAL') { Write-Error 'Report missing CRITICAL section'; exit 1 }
if ($content -notmatch 'FOUNDATION') { Write-Error 'Maturity stage should be FOUNDATION with critical findings'; exit 1 }

Remove-Item $testPath -Recurse -Force
Write-Host 'R1-040 PASS' -ForegroundColor Green
```

### 6. Governance

Update `STATE_OF_THE_BUILD.md`: Set "DIAGNOSE — Architecture Health Report" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-040`.

---

## R1-041 — DIAGNOSE: Governance Reconciliation Report

**Estimated Tokens:** 22,000

### 1. Context

From RETROFIT spec Section 4.3: "Governance Reconciliation Report — Compares governance docs against codebase. Classifies as UNBUILT (planned, not built — needs BUILD/DEFER/ABANDON decision) or UNDOCUMENTED (built, not documented — gets governance entries added)."

### 2. Task

Implement `New-GovernanceReconciliationReport` in `ForgeDiagnose.psm1`. It compares the governance inventory and route/schema data from the scan to identify features that are documented but not built (UNBUILT) and code that exists but isn't documented (UNDOCUMENTED).

### 3. Acceptance Criteria

- Compares governance documents (AGENTS.md, STATE_OF_THE_BUILD.md) against actual route inventory and schema
- Items in governance with status NOT_STARTED or QUEUED but no corresponding routes/tables → UNBUILT
- Routes and tables that exist in code but aren't referenced in governance → UNDOCUMENTED
- Each UNBUILT item tagged with [BUILD/DEFER/ABANDON needed]
- Each UNDOCUMENTED item tagged with [Governance entry needed]
- Report generated as `.forge/GOVERNANCE_RECONCILIATION_REPORT.md`
- Handles missing governance docs gracefully (everything is UNDOCUMENTED)
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\src\Retrofit\ForgeDiagnose.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\src\Retrofit\ForgeDiagnose.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\src\Retrofit\ForgeDiagnose.psm1" -Force

$cmd = Get-Command New-GovernanceReconciliationReport -ErrorAction SilentlyContinue
if (-not $cmd) { Write-Error 'Function not found'; exit 1 }

Write-Host 'R1-041 PASS' -ForegroundColor Green
```

### 6. Governance

Update `STATE_OF_THE_BUILD.md`: Set "DIAGNOSE — Governance Reconciliation" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-041`.

---

## R1-042 — DIAGNOSE: Enterprise Patterns Gap Analysis

**Estimated Tokens:** 20,000

### 1. Context

From RETROFIT spec Section 4.4 (Enterprise Patterns Gap Analysis), filtered by maturity stage:

| Pattern | FOUNDATION | GROWTH | ENTERPRISE |
|---------|-----------|---------|------------|
| Error boundaries | Skip | Check | Require |
| Loading states | Skip | Check | Require |
| RLS policies | Check | Require | Require |
| company_id scoping | Check | Require | Require |
| Rate limiting | Skip | Skip | Check |
| Audit logging | Skip | Skip | Check |
| OpenTelemetry | Skip | Skip | Check |
| Feature flags | Skip | Skip | Check |

### 2. Task

Implement `New-EnterpriseGapAnalysis` in `ForgeDiagnose.psm1`. It takes the detected maturity stage and scan report, checks for the presence of each enterprise pattern based on the maturity filter, and generates a gap analysis report.

### 3. Acceptance Criteria

- Checks for each pattern based on maturity stage (Skip/Check/Require per the table)
- Patterns detected by scanning codebase: error boundaries (ErrorBoundary component), loading states (loading.tsx files), RLS (from schema audit), company_id (from schema audit), rate limiting (middleware patterns), audit logging (log table or function), OpenTelemetry (instrumentation.ts), feature flags (flags table or config)
- REQUIRE patterns missing → CRITICAL
- CHECK patterns missing → WARN
- SKIP patterns → not included in report
- Report generated as `.forge/ENTERPRISE_GAP_ANALYSIS.md`
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\src\Retrofit\ForgeDiagnose.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("$root\src\Retrofit\ForgeDiagnose.psm1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { Write-Error "Parse errors: $($errors[0].Message)"; exit 1 }

Import-Module "$root\src\Retrofit\ForgeDiagnose.psm1" -Force

$cmd = Get-Command New-EnterpriseGapAnalysis -ErrorAction SilentlyContinue
if (-not $cmd) { Write-Error 'Function not found'; exit 1 }

Write-Host 'R1-042 PASS' -ForegroundColor Green
```

### 6. Governance

Update `STATE_OF_THE_BUILD.md`: Set "DIAGNOSE — Enterprise Gap Analysis" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-042`.

---

## R1-043 — DIAGNOSE: Orchestrator & Report Assembly

**Estimated Tokens:** 22,000

### 1. Context

DIAGNOSE needs a master orchestrator that calls all report generators in sequence, combines outputs, and persists the complete diagnosis to the learning database. The orchestrator ties together: console output, health report, governance reconciliation, and enterprise gap analysis.

### 2. Task

Implement `Invoke-RetrofitDiagnose` in `ForgeDiagnose.psm1`. This is the master DIAGNOSE function that takes a ScanReport, generates all three reports, displays console output, and saves results to the learning database.

### 3. Acceptance Criteria

- `Invoke-RetrofitDiagnose -ScanReport <report> -ProjectPath <path>` executes the complete DIAGNOSE pipeline
- Calls `Format-ScanFindings` → `Write-DiagnoseHeader` → findings display → `New-ArchitectureHealthReport` → `New-GovernanceReconciliationReport` → `New-EnterpriseGapAnalysis` → `Write-DiagnoseSummary`
- All three reports saved as markdown files in `.forge/`
- Summary counts saved to scan_reports table in learning database
- Returns structured DiagnoseResult: MaturityStage, CriticalCount, WarnCount, InfoCount, Reports (paths to generated files)
- Console displays total findings with color-coded summary
- Wire into `Invoke-ForgeRetrofit` so DIAGNOSE runs after SCAN
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\src\Retrofit\ForgeDiagnose.psm1
C:\Users\manag\Documents\FORGE 2.0\src\Retrofit\ForgeRetrofit.psm1
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
foreach ($f in @("$root\src\Retrofit\ForgeDiagnose.psm1","$root\src\Retrofit\ForgeRetrofit.psm1")) {
    $errors = $null
    [System.Management.Automation.Language.Parser]::ParseFile($f, [ref]$null, [ref]$errors)
    if ($errors.Count -gt 0) { Write-Error "Parse errors in $f: $($errors[0].Message)"; exit 1 }
}

Import-Module "$root\src\Retrofit\ForgeDiagnose.psm1" -Force

$cmd = Get-Command Invoke-RetrofitDiagnose -ErrorAction SilentlyContinue
if (-not $cmd) { Write-Error 'Invoke-RetrofitDiagnose not found'; exit 1 }

Write-Host 'R1-043 PASS' -ForegroundColor Green
```

### 6. Governance

Update `STATE_OF_THE_BUILD.md`: Set "DIAGNOSE — Orchestrator" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-043`.

---

## R1-044 — Integration: Module Wiring & Import Validation

**Estimated Tokens:** 20,000

### 1. Context

All modules have been built. This prompt ensures every module properly imports its dependencies, all exported functions are accessible, and cross-module calls work correctly. This is the integration test prompt for Run 1.

### 2. Task

Verify and fix all module imports in `forge.ps1`. Ensure every module exports its public functions. Create a comprehensive integration test script at `.forge/tests/Run1-Integration.ps1` that imports all modules, calls key functions, and validates the dependency chain: Learning → Sync → Core → Hooks → Scan → Session → Diagnose.

### 3. Acceptance Criteria

- `forge.ps1` imports all modules in correct dependency order
- Every public function from every module is accessible after import
- Integration test validates the chain:
  1. Initialize-ForgeMemory creates database with all tables
  2. Save-ToForgeMemory writes a record
  3. Get-ForgeMemory reads it back
  4. Get-MachineId returns consistent value
  5. Get-ErrorFingerprint returns 64-char hash
  6. Read-HooksConfig reads hooks.json
  7. Get-BuildFingerprint returns 64-char hash
  8. Invoke-PreFlightChecks runs against FORGE itself
  9. Invoke-ScanDirectoryTree returns file listing
- Integration test file passes PowerShell parser validation
- All module files pass PowerShell parser validation
- Zero import errors when running forge.ps1

### 4. File Manifest — CREATE / MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\.forge\tests\Run1-Integration.ps1   (CREATE)
C:\Users\manag\Documents\FORGE 2.0\forge.ps1                            (MODIFY)
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
& "$root\.forge\tests\Run1-Integration.ps1"
if ($LASTEXITCODE -ne 0) { Write-Error 'Integration test failed'; exit 1 }

Write-Host 'R1-044 PASS' -ForegroundColor Green
```

### 6. Governance

Update `STATE_OF_THE_BUILD.md`: Set "Run 1 — Integration Wiring" to COMPLETED.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-044`.

---

## R1-045 — Run 1 Final: Governance Update & Build Report

**Estimated Tokens:** 15,000

### 1. Context

Final prompt of Run 1. Updates all governance documents to reflect the completed state. Generates the Run 1 build report. Prepares the SESSION_HANDOFF for Run 2.

### 2. Task

Update `STATE_OF_THE_BUILD.md` with the final status of every module built in Run 1. Update `BLUEPRINT.md` with the actual module structure (file paths, function lists, dependency map). Generate the final Run 1 build report. Create a `SESSION_HANDOFF.md` noting what Run 2 needs to build: Sentinel Pipeline, Composer Engine, Architect/PRD, Deploy Pipeline, Adversarial Review, RECONCILE.

### 3. Acceptance Criteria

- `STATE_OF_THE_BUILD.md` shows all Run 1 modules as COMPLETED with dates
- `STATE_OF_THE_BUILD.md` shows Run 2 modules as NOT_STARTED
- `BLUEPRINT.md` updated with actual file structure and function inventory
- Build report at `.forge/BUILD_REPORT_RUN1.md` with per-prompt status
- `SESSION_HANDOFF.md` lists Run 2 priorities:
  - Module 9: Sentinel Pipeline (18 tools, 4 rings)
  - Module 10: Composer Engine (DAG, topological sort, prompt templates)
  - Module 11: Architect & PRD (SCOUT, four-pass refinement, governance generation)
  - Module 12: Deploy Pipeline (migrations, canary, rollback)
  - Module 13: Adversarial Review (prompts, resolution protocol, accuracy tracking)
  - Module 14: RECONCILE (interactive decision flow)
- All governance files pass markdown lint (no broken headers, no orphaned links)
- All functions pass PowerShell parser validation

### 4. File Manifest — MODIFY

```
C:\Users\manag\Documents\FORGE 2.0\STATE_OF_THE_BUILD.md
C:\Users\manag\Documents\FORGE 2.0\BLUEPRINT.md
C:\Users\manag\Documents\FORGE 2.0\.forge\BUILD_REPORT_RUN1.md      (CREATE)
C:\Users\manag\Documents\FORGE 2.0\.forge\SESSION_HANDOFF.md         (CREATE or MODIFY)
```

### 5. Verification

```powershell
$root = 'C:\Users\manag\Documents\FORGE 2.0'
$requiredFiles = @(
    'STATE_OF_THE_BUILD.md', 'BLUEPRINT.md',
    '.forge\BUILD_REPORT_RUN1.md', '.forge\SESSION_HANDOFF.md'
)
foreach ($f in $requiredFiles) {
    $path = Join-Path $root $f
    if (-not (Test-Path $path)) { Write-Error "Missing: $f"; exit 1 }
    $content = Get-Content $path -Raw
    if ($content.Length -lt 100) { Write-Error "$f is suspiciously short ($($content.Length) chars)"; exit 1 }
}

# Verify STATE_OF_THE_BUILD shows completions
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

Final governance update already handled in the task itself.

### 7. Rollback

On failure: revert to `FORGE-SNAPSHOT-R1-045`.

---

# Token Budget Summary

| Prompt Range | Module | Prompts | Est. Tokens |
|---|---|---|---|
| R1-001 | Project Scaffold | 1 | 12,000 |
| R1-002 — R1-007 | Learning Engine | 6 | 159,000 |
| R1-008 — R1-009 | Cross-Machine Sync | 2 | 48,000 |
| R1-010 — R1-014 | Core Pipeline Controller | 5 | 117,000 |
| R1-015 — R1-019 | Hook Lifecycle System | 5 | 115,000 |
| R1-020 — R1-030 | RETROFIT SCAN | 11 | 247,000 |
| R1-031 — R1-038 | Session Orchestration | 8 | 186,000 |
| R1-039 — R1-043 | RETROFIT DIAGNOSE | 5 | 107,000 |
| R1-044 — R1-045 | Integration & Governance | 2 | 35,000 |
| **TOTAL** | **8 Modules** | **45** | **~1,026,000** |

**Run 1 Coverage:**

| Module | Status | Prompts |
|---|---|---|
| Core Pipeline Controller | COMPLETE | 5 |
| Learning Engine (SQLite) | COMPLETE | 6 |
| Cross-Machine Sync | COMPLETE | 2 |
| Hook Lifecycle System | COMPLETE | 5 |
| RETROFIT SCAN (all 14 ops) | COMPLETE | 11 |
| Session Orchestration | COMPLETE | 8 |
| RETROFIT DIAGNOSE | COMPLETE | 5 |
| Integration Wiring | COMPLETE | 2 |
| RETROFIT RECONCILE | **DEFERRED → Run 2** | — |

**Run 2 Targets (estimated ~50 prompts):**
- RETROFIT RECONCILE (~8 prompts)
- Sentinel Pipeline — 18 tools across 4 rings (~25 prompts)
- Composer Engine — DAG, topological sort, prompt templates (~15 prompts)
- Adversarial Review — prompt system, resolution protocol (~7 prompts)

**Run 3-4 Targets:**
- Architect & PRD (SCOUT, four-pass refinement)
- Deploy Pipeline (migrations, canary, rollback)
- Prompt A/B Testing
- Full integration + hardening
