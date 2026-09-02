# FORGE 2.0 — Hook Lifecycle Deep Specification

**Specification Conversation 6 of 10 | June 22, 2026**

This document specifies the complete hook system: the hooks.json declarative schema, the execution engine, every hook type with its implementation, blocking behavior, timeout management, failure handling, PreCompact context preservation, and hook evolution through the learning engine.

---

## 1. Architecture Overview

Hooks are the nervous system of FORGE 2.0. Every significant lifecycle event fires one or more hooks. Hooks can block operations (preventing a file write, a git commit, or a deployment), inject context (loading governance rules into prompt context), or trigger side effects (syncing the learning database, generating handoff documents).

The hook system is declarative — all hooks are defined in `.forge/hooks.json`, version-controlled alongside the project. No hooks are hardcoded into FORGE's PowerShell source. This means the hook configuration evolves via Loop 5 (Self-Modification) of the learning engine without touching FORGE's code.

The execution engine (`Invoke-Hook`) is the single function that all FORGE modules call. No module implements its own hook logic.

---

## 2. hooks.json Declarative Schema

### 2.1 Complete Schema Definition

```json
{
  "schema_version": "1.0",
  "project_name": "hail-intel",
  "hooks": [
    {
      "name": "eslint-postwrite",
      "event": "PostToolUse",
      "action": "npx eslint --fix {{file}}",
      "script": null,
      "blocking": true,
      "timeout_seconds": 30,
      "enabled": true,
      "on_failure": "REVERT",
      "priority": 10,
      "description": "Run ESLint with auto-fix on every file write",
      "conditions": {
        "file_pattern": "*.ts,*.tsx",
        "exclude_pattern": "*.config.*,*.d.ts",
        "task_types": null,
        "min_prompt_number": 0
      }
    }
  ]
}
```

### 2.2 Field Definitions

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| name | string | Yes | — | Unique identifier. Convention: description-event (e.g., eslint-postwrite). |
| event | string | Yes | — | Lifecycle event: PreToolUse, PostToolUse, SessionStart, SessionEnd, PreCompact, PreCommit, PreDeploy, PostDeploy. |
| action | string | Yes | — | Shell command with template vars. Set to "powershell" to invoke script field. |
| script | string | Conditional | null | PowerShell function name. Required when action is "powershell". |
| blocking | boolean | Yes | — | If true, non-zero exit halts the operation. |
| timeout_seconds | integer | Yes | — | Max wall-clock time. Min 5, max 600. Terminated hooks = failures. |
| enabled | boolean | Yes | — | Toggle without removing. Disabled hooks skipped silently. |
| on_failure | string | No | "BLOCK" | BLOCK (halt pipeline), REVERT (undo last write then halt), WARN (log and continue). |
| priority | integer | No | 50 | Execution order within same event. Lower = first. Range 1-999. |
| description | string | No | "" | Human-readable purpose. |
| conditions | object | No | null | Conditional execution filters. See 2.3. |

### 2.3 Conditional Execution

| Condition | Type | Description |
|-----------|------|-------------|
| file_pattern | string | Comma-separated globs. Hook fires only if affected file matches. PostToolUse only. |
| exclude_pattern | string | Comma-separated globs to exclude. |
| task_types | string[] | Hook fires only during these task types: SCAFFOLD, CRUD, INTEGRATION, etc. |
| min_prompt_number | integer | Skip early prompts (e.g., scaffolding). |
| phases | string[] | Fire only during these FORGE phases. |

### 2.4 Template Variables

| Variable | Available In | Replaced With |
|----------|-------------|---------------|
| {{file}} | PostToolUse, PreCommit | Absolute path of affected file |
| {{files}} | PostToolUse, PreCommit | Space-separated list of all affected files |
| {{project_path}} | All events | Project root absolute path |
| {{prompt_number}} | All during EXECUTE | Current prompt number |
| {{build_id}} | All events | Current build ID |
| {{last_commit}} | PreCommit, PostDeploy | Most recent git commit SHA |
| {{task_type}} | PreToolUse, PostToolUse | Current prompt's task classification |
| {{phase}} | All events | Current FORGE phase |

---

## 3. Hook Execution Engine

### 3.1 Core Function: Invoke-Hook

```powershell
function Invoke-Hook {
    param([string]$Event, [hashtable]$Context)

    $hooksFile = Join-Path $Context.project_path '.forge' 'hooks.json'
    if (-not (Test-Path $hooksFile)) { return @{ AllPassed = $true; Results = @() } }

    $config = Get-Content $hooksFile -Raw | ConvertFrom-Json
    $eventHooks = $config.hooks |
        Where-Object { $_.event -eq $Event -and $_.enabled } |
        Sort-Object priority

    $results = @()
    foreach ($hook in $eventHooks) {
        if (-not (Test-HookConditions -Hook $hook -Context $Context)) { continue }

        $action = Resolve-HookTemplates -Action $hook.action -Context $Context
        $startTime = Get-Date
        Write-Host "  [HOOK] $($hook.name) " -ForegroundColor Gray -NoNewline

        $result = Invoke-HookAction -Hook $hook -Action $action -Context $Context
        $duration = (Get-Date) - $startTime
        $statusColor = switch ($result.Status) { 'PASS'{'Green'} 'FAIL'{'Red'} 'TIMEOUT'{'Red'} 'SKIP'{'Yellow'} }
        Write-Host "$($result.Status) ($([Math]::Round($duration.TotalMilliseconds))ms)" -ForegroundColor $statusColor

        # Log to learning database
        Save-ToForgeMemory -Table 'hook_execution_log' -Data @{
            hook_name = $hook.name; event = $Event; status = $result.Status
            duration_ms = [int]$duration.TotalMilliseconds
            output = if ($result.Output) { $result.Output.Substring(0, [Math]::Min(1000, $result.Output.Length)) } else { '' }
            build_id = $Context.build_id; prompt_number = $Context.prompt_number
        }
        $results += $result

        # Handle blocking failure
        if ($result.Status -ne 'PASS' -and $hook.blocking) {
            $failAction = if ($hook.on_failure) { $hook.on_failure } else { 'BLOCK' }
            switch ($failAction) {
                'REVERT' { if ($Context.file) { git checkout -- $Context.file 2>$null } }
                'WARN' { Write-Host "  Warning logged." -ForegroundColor Yellow; continue }
            }
            if ($failAction -ne 'WARN') {
                Write-Host "  [HOOK] Pipeline BLOCKED by $($hook.name)" -ForegroundColor Red
                return @{ AllPassed = $false; BlockedBy = $hook.name; Results = $results }
            }
        }
    }
    return @{ AllPassed = $true; Results = $results }
}
```

### 3.2 Action Execution with Timeout

Uses Start-Job for subprocess isolation. Wait-Job with timeout_seconds. Exceeded timeout = forced kill + TIMEOUT status. PowerShell scripts execute via scriptblock. Shell commands execute via Invoke-Expression in subprocess.

### 3.3 Condition Evaluation

Test-HookConditions checks file_pattern (glob match), exclude_pattern (glob exclude), task_types (membership check), min_prompt_number (threshold), phases (membership check). All conditions are AND — every present condition must pass.

### 3.4 Template Resolution

Simple string replacement: `{{key}}` replaced with `$Context[$key]`. All template variables are populated by the calling FORGE module before invoking hooks.

---

## 4. PreCompact Hook — Context Preservation

### 4.1 Problem

During long runs (40-50 prompts), Claude's context fills up and older content gets compacted. Critical state — active errors, governance rules, prompt position, acceptance criteria — can be lost.

### 4.2 Solution

PreCompact fires at ~80% context capacity. Saves to compact_snapshots table: build_id, prompt_index, phase, active unresolved errors, active governance rules, queue status, pending git changes, current acceptance criteria.

### 4.3 Context Re-injection

When FORGE detects compaction occurred (previous prompt context is incomplete), it reads the latest compact_snapshot and injects preserved state into the next prompt's context section. This is transparent to the developer — FORGE handles it automatically.

### 4.4 Database Schema

```sql
CREATE TABLE IF NOT EXISTS hook_execution_log (
    id TEXT PRIMARY KEY, hook_name TEXT NOT NULL, event TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('PASS','FAIL','TIMEOUT','SKIP')),
    duration_ms INTEGER NOT NULL, output TEXT,
    build_id TEXT NOT NULL, prompt_number INTEGER,
    machine_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_hook_log_build ON hook_execution_log(build_id);
CREATE INDEX idx_hook_log_name ON hook_execution_log(hook_name, status);

CREATE TABLE IF NOT EXISTS compact_snapshots (
    id TEXT PRIMARY KEY, build_id TEXT NOT NULL,
    prompt_index INTEGER NOT NULL, state_json TEXT NOT NULL,
    machine_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_compact_build ON compact_snapshots(build_id, prompt_index DESC);
```

---

## 5. Default Hook Configuration (24 hooks)

### SessionStart (Non-Blocking, Priority 1-3)

1. **sync-pull** (P1) — Pull learning data from master 18TB drive
2. **load-knowledge** (P2) — Load governance rules, skills, fix patterns for this tech stack
3. **present-evolutions** (P3) — Show pending self-modification proposals for approval

### PreToolUse (Priority 10-20)

4. **governance-check** (P10, Blocking) — Query governance_rules matching current task. Inject matching rules into context. Block if any rule is type BLOCK.
5. **fix-pattern-check** (P20, Non-Blocking) — Query fix_patterns for known errors. Inject known fixes as [KNOWN FIX] notes.

### PostToolUse (Priority 10-99)

6. **tsc-check** (P10, Blocking) — `npx tsc --noEmit`. Condition: `file_pattern: "*.ts,*.tsx"`. Zero errors required.
7. **eslint-check** (P20, Blocking) — `npx eslint {{file}}`. Condition: `file_pattern: "*.ts,*.tsx"`, `exclude_pattern: "*.config.*"`. Zero errors, warnings OK.
8. **schema-drift-inline** (P30, Blocking) — Schema drift check. Condition: `task_types: ["CRUD","INTEGRATION"]`.
9. **score-prompt** (P99, Non-Blocking) — `Score-PromptExecution`. Records four-dimension score. Always last.

### PreCommit (All Blocking, Priority 1-20)

10. **gitleaks-scan** (P1) — `gitleaks detect` with custom .gitleaks.toml.
11. **schema-drift-commit** (P10) — Full schema drift: TypeScript types vs live Supabase.
12. **governance-updated** (P20) — Verify governance files from prompt mandate were modified.

### PreCompact (Non-Blocking, Priority 1)

13. **precompact-save** (P1) — `Invoke-PreCompactSave`. Serialize critical context to SQLite.

### PreDeploy (All Blocking, Priority 1-20)

14. **sentinel-ring3** (P1) — Full Ring 3 Sentinel pipeline.
15. **six-laws-check** (P10) — All Six Laws verified. Block if any UNVERIFIED.
16. **env-parity** (P20) — Compare .env.local vs Vercel production env vars.

### PostDeploy (Non-Blocking, Priority 1-20)

17. **health-check** (P1) — HTTP 200 on production URL.
18. **readme-update** (P10) — Regenerate README.md from governance.
19. **deploy-summary** (P20) — Log cost summary, timestamp, URL to build_outcomes.

### SessionEnd (Non-Blocking, Priority 1-40)

20. **sync-push** (P1) — Push new learning data to master.
21. **update-weights** (P10) — Compute downstream error rates for decisions.
22. **analyze-evolutions** (P20) — Generate self-modification proposals.
23. **generate-handoff** (P30) — Produce SESSION_HANDOFF document.
24. **git-push-end** (P40) — `git add -A; git commit -m 'FORGE-SESSION-END'; git push`.

---

## 6. Hook Evolution via Learning Engine

### 6.1 Performance Monitoring

At SessionEnd, `Analyze-HookPerformance` queries hook_execution_log for the build. Flags: hooks failing >30% of executions (propose timeout/threshold adjustment), hooks averaging >10 seconds (propose moving to less frequent ring), hooks with zero failures over 100+ executions (propose disabling to reduce latency).

### 6.2 What Can Evolve

- Timeout adjustment (too many timeouts → increase)
- Priority reordering (fast catchers before slow ones)
- Condition refinement (only fails on certain file types → add condition)
- Enable/disable (zero value → disable proposal)
- New hook creation (error pattern elevation → new PreToolUse hook)

All proposals require Reid's approval at SessionStart.

---

## 7. Error Handling Edge Cases

- **hooks.json parse failure:** Log CRITICAL, fall back to hardcoded minimal set (tsc + gitleaks only)
- **Hook script not found:** Return FAIL with "Function not found" message. Register error pattern.
- **Recursive hooks:** Maintain $HookDepth counter. Suppress at depth > 2 with WARN log.
- **Concurrent execution:** Sequential only within same event. No parallelism. Prevents race conditions in SQLite writes.
