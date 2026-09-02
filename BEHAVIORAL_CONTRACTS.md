# FORGE 2.0 — Behavioral Contracts

**Last Updated:** June 22, 2026

These contracts are hard rules enforced during every FORGE build. Violation of a MUST DO or MUST NOT DO is a build failure. These are not suggestions.

---

## Global Contracts (Apply to ALL Agents)

### MUST DO
- All code must be PowerShell (.ps1 or .psm1 files). No Python, no JavaScript, no Bash, no batch files.
- All functions must include `param()` blocks with explicit parameter types.
- All database operations must use `Invoke-Sqlite` from ForgeLearning.psm1. No raw SQLite calls.
- All file writes must include error handling (`try/catch` or `-ErrorAction Stop`).
- All console output must use `Write-Host` with explicit `-ForegroundColor` for status indication: Green = PASS/success, Red = FAIL/error, Yellow = WARN/caution, Cyan = INFO/progress, Gray = DEBUG/detail.
- All functions that write to the learning database must include `machine_id` from `Get-MachineId`.
- All records written to the learning database must include a UUID `id` field generated via `[guid]::NewGuid().ToString()`.
- All timestamps must use ISO 8601 format via `(Get-Date -Format 'o')`.
- All JSON serialization must use `ConvertTo-Json -Depth 10` to prevent shallow serialization.
- Every module (.psm1) must export its public functions explicitly via `Export-ModuleMember`.
- Every prompt must update STATE_OF_THE_BUILD.md with current completion status before finishing.
- Every git commit must use the structured format: `FORGE-[project]-P[phase]-T[task]-[status]`.

### MUST NOT DO
- Must NOT use any language other than PowerShell for FORGE's own codebase.
- Must NOT use Supabase for FORGE's learning database. SQLite only.
- Must NOT write directly to the master sync database on the 18TB drive during a run. Only via Sync-ForgeMemory at SessionEnd.
- Must NOT hardcode file paths. All paths must be relative to `$ProjectPath` or derived from configuration.
- Must NOT use `Write-Output` for status messages (it pollutes the pipeline). Use `Write-Host`.
- Must NOT use `Invoke-Expression` for arbitrary code execution outside of the hook system.
- Must NOT modify hooks.json directly from code. Hook evolution goes through pending_evolutions with human approval.
- Must NOT store API keys, passwords, or secrets in any FORGE source file, config file, or learning database.
- Must NOT assume a specific machine. All machine-specific values come from `Get-MachineId` or configuration.
- Must NOT catch exceptions silently. Every `catch` block must either re-throw, log to the learning database via `Register-Error`, or write a visible console message.

### MUST VALIDATE
- Before any SQLite operation: verify `forge_memory.db` exists via `Get-ForgeDbPath`. If missing, call `Initialize-ForgeMemory`.
- Before any sync operation: verify the master drive path is accessible. If not, skip sync with WARN (never fail a build because the external drive isn't mounted).
- Before any git operation: verify the project path contains a `.git` directory. If not, initialize git.
- Before executing any hook: verify hooks.json parses as valid JSON. If malformed, fall back to hardcoded minimal hooks (tsc-check, gitleaks-scan only).

---

## Contract: ForgeLearning

### MUST DO
- `Initialize-ForgeMemory` must be idempotent. Running it on an existing database must not drop or modify existing data.
- All `Get-*` functions must return empty arrays (not null) when no results match.
- `Get-ErrorFingerprint` must produce identical fingerprints for the same error pattern across different files (generalized path, templated message).
- `Invoke-Sqlite` must support parameterized queries (never string-interpolate user data into SQL).

### MUST NOT DO
- Must NOT delete records from the learning database. All data is append-only. "Deletion" is done by setting an `active` flag to 0.
- Must NOT run `DROP TABLE` or `DELETE FROM` without a WHERE clause under any circumstance.

---

## Contract: ForgeSync

### MUST DO
- Must acquire file lock before writing to master database. Always release lock in a `finally` block.
- Must detect stale locks (>2 minutes old) and remove them automatically.
- Must use INSERT OR IGNORE to prevent duplicate records. Never UPDATE master records — append only.

### MUST NOT DO
- Must NOT sync during a run. Only at SessionStart (Pull) and SessionEnd (Push).
- Must NOT sync if the lock file is held by another machine and is less than 2 minutes old. Wait and retry.

---

## Contract: ForgeHooks

### MUST DO
- Must execute hooks in priority order (ascending) within each event.
- Must enforce timeout on every hook execution. No hook runs indefinitely.
- Must log every hook execution to hook_execution_log, including SKIP results.
- Must prevent hook recursion (depth > 2 suppressed with WARN).

### MUST NOT DO
- Must NOT execute disabled hooks. Skip silently, no logging.
- Must NOT execute hooks concurrently within the same event. Sequential only.
- Must NOT modify hooks.json during execution. Changes go through pending_evolutions.

---

## Contract: ForgeRetrofit

### MUST DO
- SCAN must execute all 14 operations even if some fail. Failures are logged, not fatal.
- Dynamic analysis (Operation 13) must use GET requests only on first RETROFIT. No POST/PUT/DELETE.
- DIAGNOSE must run adversarial review on every Architecture Health Report. No skipping.
- RECONCILE must persist all decisions to the learning database before executing any changes.
- RECONCILE must present UNBUILT items as BUILD/DEFER/ABANDON choices. Never auto-build undiscussed features.

### MUST NOT DO
- Must NOT modify any project files during SCAN or DIAGNOSE. These are read-only analysis phases.
- Must NOT auto-apply CRITICAL fixes without presenting them to Reid first (auto-approve with override).
- Must NOT delete governance documents. ABANDONED features are removed from content, not by deleting files.

---

## Contract: ForgeSession

### MUST DO
- Must create `forge_running.lock` at SessionStart and remove it at SessionEnd (in a `finally` block).
- Must serialize complete state to `session_state.json` at every SessionEnd, regardless of end reason.
- Must verify build fingerprint at every SessionStart before resuming. Mismatch requires human decision.
- Must check for crash recovery (stale lock file) before any other SessionStart action.

### MUST NOT DO
- Must NOT resume from a stale session without fingerprint verification.
- Must NOT overwrite session_state.json during a run. Only at SessionEnd.

---

## Contract: ForgeCore

### MUST DO
- Must route to the correct phase module based on command-line arguments. No silent defaults.
- Must create a git snapshot (tag) before every prompt execution.
- Must enforce all configured gates after every prompt. Gate failures trigger retry logic.
- Must generate a build report at SessionEnd summarizing pass/fail per prompt.

### MUST NOT DO
- Must NOT execute a prompt if the prior prompt's blocking gate failed and max retries are exhausted. Skip and log.
- Must NOT modify middleware.ts without explicit approval flag. (Inherited from Reid's canonical rules.)

---

## Contract: ForgeSentinel (Run 2-3)

### MUST DO
- Must gracefully degrade when a tool is not installed. Log SKIP, never block the build for optional tools.
- Must run Ring 1 tools (tsc, ESLint, schema drift) on every prompt during EXECUTE. No exceptions.
- Must log all tool results to the learning database via Register-Error for failures.

### MUST NOT DO
- Must NOT run Ring 4 tools (CodeQL, OWASP ZAP, k6) during EXECUTE phase. Ring 4 is pre-deploy only.
- Must NOT treat SKIP as FAIL. Missing tools degrade gracefully.

---

## Contract: ForgeComposer (Run 3-4)

### MUST DO
- Must validate the dependency graph for cycles before producing any prompts. Cycles halt composition.
- Must cap each prompt at one module, one feature, one testable outcome. Never combine unrelated tasks.
- Must include all 7 canonical sections in every prompt. No section may be omitted.
- Must inject only relevant governance slices, never entire documents.

### MUST NOT DO
- Must NOT produce prompts that reference "the previous prompt" or assume shared context. Every prompt is self-contained.

---

## Contract: ForgeArchitect (Run 4)

### MUST DO
- Must run all four PRD refinement passes. No shortcuts.
- Must validate the generated schema before proceeding to SCAFFOLD. Validation failure blocks Phase 2.
- Must record every architectural decision to decision_weights.

### MUST NOT DO
- Must NOT proceed past Phase 1 without Reid's explicit PRD approval (Pass 4).

---

## Contract: ForgeDeploy (Run 4-5)

### MUST DO
- Must apply Supabase migrations to production BEFORE deploying code to Vercel. Migration-first, always.
- Must deploy to Vercel preview (canary) before production. Never deploy directly to production.
- Must verify environment parity before deployment. Missing CRITICAL env vars block deploy.
- Must execute production rollback if health check fails after promotion.

### MUST NOT DO
- Must NOT apply migrations containing DROP TABLE or DROP COLUMN without explicit human approval.
- Must NOT deploy if Ring 3 Sentinel has not passed.
