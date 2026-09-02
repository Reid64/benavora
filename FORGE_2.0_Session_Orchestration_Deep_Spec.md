# FORGE 2.0 — Session Orchestration Deep Specification

**Specification Conversation 9 of 10 | June 22, 2026**

This document specifies multi-run session management: state serialization at run end, state resumption at run start, build fingerprinting for integrity verification, mini-RETROFIT on fingerprint mismatch, SESSION_HANDOFF document generation, and queue status tracking across runs.

---

## 1. Architecture Overview

FORGE 2.0 builds span multiple autonomous runs. A complete build may require 4-5 runs of 40-50 prompts each, separated by hours or days. Session orchestration is the infrastructure that makes this possible by answering three questions at every run boundary:

1. **Where did we stop?** — State serialization captures the exact build position and context.
2. **Has anything changed since we stopped?** — Build fingerprinting detects modifications between runs.
3. **What do we do next?** — Queue status tracking and recomposition determine the next batch.

---

## 2. Session State Serialization

### 2.1 When It Fires

Serialization occurs at every SessionEnd, whether the run completed normally, was paused by the user, failed on an unrecoverable error, or was interrupted (e.g., machine restart, power loss caught by UPS). The SessionEnd hook is designed to be crash-safe — if the hook itself is interrupted, the most recent compact_snapshot (from the PreCompact hook) serves as the fallback recovery point.

### 2.2 Complete State Object

```powershell
function Export-SessionState {
    param(
        [string]$ProjectPath,
        [string]$BuildId,
        [int]$LastPromptExecuted,
        [string]$EndReason  # COMPLETED, PAUSED, FAILED, INTERRUPTED
    )

    $projectName = Split-Path $ProjectPath -Leaf

    $state = @{
        # === Build Identity ===
        build_id              = $BuildId
        project_name          = $projectName
        project_path          = $ProjectPath
        serialized_at         = (Get-Date -Format 'o')
        machine_id            = Get-MachineId
        end_reason            = $EndReason

        # === Execution Position ===
        last_prompt_executed  = $LastPromptExecuted
        current_phase         = $Global:ForgeCurrentPhase
        current_run_number    = $Global:ForgeRunNumber

        # === Git State ===
        git_branch            = (git -C $ProjectPath branch --show-current 2>$null)
        git_commit_sha        = (git -C $ProjectPath rev-parse HEAD 2>$null)
        git_dirty             = ((git -C $ProjectPath status --porcelain 2>$null) -ne $null)
        last_forge_tag        = (git -C $ProjectPath tag -l 'FORGE-*' --sort=-version:refname 2>$null |
                                  Select-Object -First 1)

        # === Build Fingerprint ===
        build_fingerprint     = Get-BuildFingerprint -ProjectPath $ProjectPath

        # === Queue Status ===
        queue_status          = Get-DetailedQueueStatus -ProjectPath $ProjectPath

        # === Active Blockers ===
        active_blockers       = Get-ActiveBlockers -BuildId $BuildId

        # === Environment Snapshot ===
        environment = @{
            node_version        = (node --version 2>$null)
            pnpm_version        = (pnpm --version 2>$null)
            powershell_version  = $PSVersionTable.PSVersion.ToString()
            supabase_accessible = (Test-SupabaseConnection -ProjectPath $ProjectPath)
            vercel_authenticated = (Test-VercelAuth)
            forge_memory_db_size = if (Test-Path (Get-ForgeDbPath)) {
                [Math]::Round((Get-Item (Get-ForgeDbPath)).Length / 1MB, 2)
            } else { 0 }
        }

        # === Run Statistics ===
        run_stats = @{
            prompts_executed    = $Global:ForgePromptsExecuted
            prompts_passed      = $Global:ForgePromptsPassed
            prompts_retried     = $Global:ForgePromptsRetried
            prompts_failed      = $Global:ForgePromptsFailed
            total_tokens        = $Global:ForgeTotalTokens
            first_pass_rate     = if ($Global:ForgePromptsExecuted -gt 0) {
                [Math]::Round($Global:ForgePromptsPassed / $Global:ForgePromptsExecuted, 3)
            } else { 0 }
            start_time          = $Global:ForgeRunStartTime
            duration_minutes    = [Math]::Round(((Get-Date) - $Global:ForgeRunStartTime).TotalMinutes, 1)
        }

        # === Learning Summary ===
        learning_summary = @{
            errors_registered     = (Get-ForgeMemory -Table 'fix_patterns' `
                -Where "last_seen > '$($Global:ForgeRunStartTime)'" -Limit 200).Count
            governance_rules_enforced = (Get-ForgeMemory -Table 'governance_rules' `
                -Where "last_enforced > '$($Global:ForgeRunStartTime)'" -Limit 200).Count
            skills_injected       = $Global:ForgeSkillsInjectedCount
            evolutions_generated  = (Get-ForgeMemory -Table 'pending_evolutions' `
                -Where "created_at > '$($Global:ForgeRunStartTime)' AND status = 'PENDING'" -Limit 50).Count
            fix_patterns_applied  = $Global:ForgeFixPatternsApplied
        }

        # === Files Modified This Run ===
        files_modified = @(git -C $ProjectPath diff --name-only "$($Global:ForgeRunStartCommit)..HEAD" 2>$null)
    }

    # Save as JSON
    $stateJson = $state | ConvertTo-Json -Depth 10
    $stateFile = "$ProjectPath/.forge/session_state.json"
    Set-Content $stateFile $stateJson

    # Also save to learning database (for cross-machine visibility)
    Save-ToForgeMemory -Table 'build_outcomes' -Data @{
        id                     = $BuildId
        project_name           = $projectName
        mode                   = $Global:ForgeBuildMode
        start_time             = $Global:ForgeRunStartTime
        end_time               = (Get-Date -Format 'o')
        end_reason             = $EndReason
        total_prompts_planned  = $state.queue_status.total
        total_prompts_executed = $state.run_stats.prompts_executed
        prompts_passed         = $state.run_stats.prompts_passed
        prompts_retried        = $state.run_stats.prompts_retried
        prompts_failed         = $state.run_stats.prompts_failed
        total_tokens           = $state.run_stats.total_tokens
        first_pass_rate        = $state.run_stats.first_pass_rate
        maturity_stage         = $Global:ForgeMaturityStage
    }

    Write-Host '[SESSION] State serialized:' -ForegroundColor Green
    Write-Host "  Prompts: $($state.run_stats.prompts_executed) executed, $($state.run_stats.prompts_passed) passed, $($state.run_stats.prompts_failed) failed" -ForegroundColor Gray
    Write-Host "  Duration: $($state.run_stats.duration_minutes) minutes" -ForegroundColor Gray
    Write-Host "  Fingerprint: $($state.build_fingerprint.Substring(0, 16))..." -ForegroundColor Gray
    Write-Host "  Saved to: $stateFile" -ForegroundColor Gray

    return $state
}
```

---

## 3. Build Fingerprinting

### 3.1 Algorithm

The build fingerprint is a SHA-256 hash of the project's file structure and content. It serves as a tamper-detection mechanism between runs. If any file changes outside of FORGE (manual edit, another tool, git merge), the fingerprint will mismatch.

```powershell
function Get-BuildFingerprint {
    param([string]$ProjectPath)

    # Get all project files, excluding generated/transient directories
    $files = Get-ChildItem -Path $ProjectPath -Recurse -File |
        Where-Object {
            $_.FullName -notmatch 'node_modules|\.next|\.git[/\\]|\.forge[/\\]session_state|dist|build|coverage'
        } | Sort-Object FullName

    # Build the fingerprint input: relative path + content hash for each file
    $hashBuilder = [System.Text.StringBuilder]::new()
    foreach ($file in $files) {
        $relativePath = $file.FullName.Substring($ProjectPath.Length).Replace('\', '/')
        $contentHash = (Get-FileHash $file.FullName -Algorithm SHA256).Hash
        [void]$hashBuilder.AppendLine("$relativePath|$contentHash")
    }

    # Hash the composite
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($hashBuilder.ToString())
    $hash = [System.Security.Cryptography.SHA256]::Create().ComputeHash($bytes)
    $fingerprint = [BitConverter]::ToString($hash).Replace('-', '').ToLower()

    return $fingerprint
}
```

### 3.2 What the Fingerprint Includes

- All `.ts`, `.tsx`, `.js`, `.jsx`, `.css`, `.json`, `.md`, `.yaml`, `.yml`, `.sql`, `.html` files
- Configuration files (tsconfig.json, tailwind.config.ts, next.config.mjs, etc.)
- Governance documents (BLUEPRINT.md, SCHEMA_REGISTRY.md, etc.)
- Migration files (supabase/migrations/*.sql)

### 3.3 What the Fingerprint Excludes

- `node_modules/` — changes with every install, not meaningful
- `.next/` — build cache, regenerated on every build
- `.git/` — git internals, not project content
- `.forge/session_state.json` — changes every session (would always mismatch)
- `dist/`, `build/`, `coverage/` — generated output directories

### 3.4 Fingerprint Storage

Each fingerprint is stored in the learning database for historical tracking:

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

## 4. Session Resumption

### 4.1 Resumption Flow

```powershell
function Resume-ForgeSession {
    param([string]$ProjectPath)

    $stateFile = "$ProjectPath/.forge/session_state.json"

    # Check for existing session state
    if (-not (Test-Path $stateFile)) {
        Write-Host '[SESSION] No previous session state found.' -ForegroundColor Yellow
        Write-Host '  Starting fresh build or RETROFIT.' -ForegroundColor Gray
        return $null
    }

    $state = Get-Content $stateFile -Raw | ConvertFrom-Json

    Write-Host '[SESSION] Previous session found:' -ForegroundColor Cyan
    Write-Host "  Build ID: $($state.build_id)" -ForegroundColor Gray
    Write-Host "  Last prompt: $($state.last_prompt_executed)" -ForegroundColor Gray
    Write-Host "  End reason: $($state.end_reason)" -ForegroundColor Gray
    Write-Host "  Serialized: $($state.serialized_at)" -ForegroundColor Gray
    Write-Host "  Machine: $($state.machine_id)" -ForegroundColor Gray

    # Calculate staleness
    $hoursSince = [Math]::Round(((Get-Date) - [DateTime]$state.serialized_at).TotalHours, 1)
    if ($hoursSince -gt 48) {
        Write-Host "  WARNING: Session is $hoursSince hours old." -ForegroundColor Yellow
    }

    # Step 1: Verify fingerprint
    Write-Host '[SESSION] Verifying build fingerprint...' -ForegroundColor Cyan
    $currentFingerprint = Get-BuildFingerprint -ProjectPath $ProjectPath
    $expectedFingerprint = $state.build_fingerprint

    if ($currentFingerprint -eq $expectedFingerprint) {
        Write-Host '  Fingerprint MATCH. No changes between runs.' -ForegroundColor Green
    } else {
        Write-Host '  Fingerprint MISMATCH. Files changed between runs.' -ForegroundColor Yellow
        $mismatchResult = Handle-FingerprintMismatch -ProjectPath $ProjectPath `
            -ExpectedCommit $state.git_commit_sha -State $state
        if (-not $mismatchResult.Continue) { return $null }
    }

    # Step 2: Verify environment
    Write-Host '[SESSION] Verifying environment...' -ForegroundColor Cyan
    $envIssues = @()
    $currentNode = (node --version 2>$null)
    if ($currentNode -ne $state.environment.node_version) {
        $envIssues += "Node.js version changed: $($state.environment.node_version) -> $currentNode"
    }
    if (-not (Test-SupabaseConnection -ProjectPath $ProjectPath) -and $state.environment.supabase_accessible) {
        $envIssues += "Supabase was accessible last run but is not accessible now"
    }

    if ($envIssues.Count -gt 0) {
        Write-Host '  Environment changes detected:' -ForegroundColor Yellow
        $envIssues | ForEach-Object { Write-Host "    - $_" -ForegroundColor Yellow }
    } else {
        Write-Host '  Environment consistent.' -ForegroundColor Green
    }

    # Step 3: Show active blockers
    if ($state.active_blockers -and $state.active_blockers.Count -gt 0) {
        Write-Host ''
        Write-Host '  ACTIVE BLOCKERS from previous run:' -ForegroundColor Red
        foreach ($blocker in $state.active_blockers) {
            Write-Host "    - $($blocker.description)" -ForegroundColor Red
        }
        Write-Host ''
        $proceed = Read-Host '  Continue despite blockers? [Y/N]'
        if ($proceed -ne 'Y') {
            Write-Host '  Session resumption cancelled.' -ForegroundColor Yellow
            return $null
        }
    }

    # Step 4: Show queue status
    Write-Host ''
    Write-Host "  Queue: $($state.queue_status.completed)/$($state.queue_status.total) complete ($($state.queue_status.percent_complete)%)" -ForegroundColor Cyan
    Write-Host "  Next prompt: $($state.queue_status.next_prompt)" -ForegroundColor Gray
    Write-Host "  Remaining: $($state.queue_status.pending) pending, $($state.queue_status.blocked) blocked" -ForegroundColor Gray

    return $state
}
```

### 4.2 Fingerprint Mismatch Handling (Mini-RETROFIT)

When the fingerprint doesn't match, files were modified between runs. FORGE identifies exactly which files changed and assesses the impact:

```powershell
function Handle-FingerprintMismatch {
    param(
        [string]$ProjectPath,
        [string]$ExpectedCommit,
        [PSCustomObject]$State
    )

    # Identify changed files using git
    $changedFiles = @()

    # Files changed in git since last session
    if ($ExpectedCommit) {
        $gitChanges = git -C $ProjectPath diff --name-status "$ExpectedCommit..HEAD" 2>$null
        if ($gitChanges) {
            $changedFiles += $gitChanges | ForEach-Object {
                $parts = $_ -split '\t'
                @{ Status = $parts[0]; File = $parts[1] }
            }
        }
    }

    # Uncommitted changes (working directory)
    $uncommitted = git -C $ProjectPath diff --name-only 2>$null
    $untracked = git -C $ProjectPath ls-files --others --exclude-standard 2>$null
    $uncommitted | ForEach-Object { $changedFiles += @{ Status = 'M'; File = $_ } }
    $untracked | ForEach-Object { $changedFiles += @{ Status = 'A'; File = $_ } }

    # Deduplicate
    $changedFiles = $changedFiles | Sort-Object { $_.File } -Unique

    Write-Host "  $($changedFiles.Count) file(s) changed between runs:" -ForegroundColor Yellow
    foreach ($cf in $changedFiles | Select-Object -First 20) {
        $statusLabel = switch ($cf.Status) { 'M'{'Modified'} 'A'{'Added'} 'D'{'Deleted'} 'R'{'Renamed'} default{$cf.Status} }
        Write-Host "    [$statusLabel] $($cf.File)" -ForegroundColor Gray
    }
    if ($changedFiles.Count -gt 20) {
        Write-Host "    ... and $($changedFiles.Count - 20) more" -ForegroundColor Gray
    }

    # Assess impact
    $governanceChanged = $changedFiles | Where-Object {
        $_.File -match 'BLUEPRINT|SCHEMA_REGISTRY|AGENTS|BEHAVIORAL_CONTRACTS|STATE_OF_THE_BUILD'
    }
    $migrationChanged = $changedFiles | Where-Object { $_.File -match 'supabase/migrations' }
    $middlewareChanged = $changedFiles | Where-Object { $_.File -match 'middleware\.ts' }

    $highImpact = @()
    if ($governanceChanged.Count -gt 0) {
        $highImpact += "Governance documents modified ($($governanceChanged.Count) files). Queue may need recomposition."
    }
    if ($migrationChanged.Count -gt 0) {
        $highImpact += "Database migrations modified. Schema drift check required."
    }
    if ($middlewareChanged.Count -gt 0) {
        $highImpact += "middleware.ts modified. Auth behavior may have changed."
    }

    if ($highImpact.Count -gt 0) {
        Write-Host ''
        Write-Host '  HIGH IMPACT CHANGES:' -ForegroundColor Red
        $highImpact | ForEach-Object { Write-Host "    - $_" -ForegroundColor Red }
    }

    Write-Host ''
    Write-Host '  Options:' -ForegroundColor Yellow
    Write-Host '    [C] Continue — accept changes and resume from next prompt'
    Write-Host '    [R] Recompose — recompose the prompt queue accounting for changes'
    Write-Host '    [S] Full SCAN — run RETROFIT SCAN to reassess the codebase'
    Write-Host '    [X] Cancel — abort session resumption'

    $decision = Read-Host '  Choice'
    switch ($decision.ToUpper()) {
        'C' { return @{ Continue = $true; Action = 'ACCEPT' } }
        'R' {
            Write-Host '  Recomposing queue...' -ForegroundColor Cyan
            Invoke-ForgeCompose -ProjectPath $ProjectPath -Mode 'Recompose'
            return @{ Continue = $true; Action = 'RECOMPOSE' }
        }
        'S' {
            Write-Host '  Initiating RETROFIT SCAN...' -ForegroundColor Cyan
            Invoke-RetrofitScan -ProjectPath $ProjectPath
            return @{ Continue = $false; Action = 'FULL_SCAN' }
        }
        'X' { return @{ Continue = $false; Action = 'CANCELLED' } }
        default { return @{ Continue = $false; Action = 'CANCELLED' } }
    }
}
```

---

## 5. Queue Status Tracking

### 5.1 Detailed Queue Status

```powershell
function Get-DetailedQueueStatus {
    param([string]$ProjectPath)

    $queueFile = "$ProjectPath/.forge/queue.yaml"
    if (-not (Test-Path $queueFile)) {
        return @{ status = 'NO_QUEUE'; total = 0 }
    }

    # Parse queue YAML (simplified — actual implementation uses a YAML parser)
    $queueContent = Get-Content $queueFile -Raw
    $promptFiles = Get-ChildItem "$ProjectPath/.forge/prompts" -Filter '*.md' -ErrorAction SilentlyContinue

    # Track status per prompt (stored in .forge/prompt_status.json)
    $statusFile = "$ProjectPath/.forge/prompt_status.json"
    $promptStatus = @{}
    if (Test-Path $statusFile) {
        $promptStatus = Get-Content $statusFile -Raw | ConvertFrom-Json -AsHashtable
    }

    $total = if ($promptFiles) { $promptFiles.Count } else { 0 }
    $completed = ($promptStatus.Values | Where-Object { $_ -eq 'COMPLETED' }).Count
    $failed = ($promptStatus.Values | Where-Object { $_ -eq 'FAILED' }).Count
    $skipped = ($promptStatus.Values | Where-Object { $_ -eq 'SKIPPED' }).Count
    $pending = $total - $completed - $failed - $skipped

    # Find next pending prompt (in topological order)
    $nextPrompt = $null
    if ($promptFiles) {
        foreach ($pf in $promptFiles | Sort-Object Name) {
            $id = $pf.BaseName
            if (-not $promptStatus.ContainsKey($id) -or $promptStatus[$id] -eq 'PENDING') {
                $nextPrompt = $id
                break
            }
        }
    }

    return @{
        total            = $total
        completed        = $completed
        failed           = $failed
        skipped          = $skipped
        pending          = $pending
        blocked          = 0  # Computed from dependency graph
        next_prompt      = $nextPrompt
        percent_complete = if ($total -gt 0) { [Math]::Round(($completed / $total) * 100, 1) } else { 0 }
    }
}
```

### 5.2 Prompt Status Updates

```powershell
function Update-PromptStatus {
    param(
        [string]$ProjectPath,
        [string]$PromptId,
        [string]$Status  # COMPLETED, FAILED, SKIPPED
    )

    $statusFile = "$ProjectPath/.forge/prompt_status.json"
    $statuses = @{}
    if (Test-Path $statusFile) {
        $statuses = Get-Content $statusFile -Raw | ConvertFrom-Json -AsHashtable
    }

    $statuses[$PromptId] = $Status
    $statuses | ConvertTo-Json | Set-Content $statusFile
}
```

---

## 6. SESSION_HANDOFF Document Generation

### 6.1 Handoff Content Structure

```powershell
function Export-SessionHandoff {
    param(
        [string]$ProjectPath,
        [hashtable]$SessionState
    )

    $handoffPrompt = @"
Generate a concise, actionable session handoff document in markdown format.
This document will be read by a human (Reid) reviewing the overnight build
results and by FORGE when composing the next run's prompts.

REQUIRED SECTIONS:

## 1. Build Summary
- Project name, build ID, run number
- Prompts executed / passed / failed / remaining
- First-pass success rate
- Total run duration
- End reason (completed, paused, failed, interrupted)

## 2. Completed This Run
List every prompt that passed with a one-line description of what it built.
Group by feature area if there are more than 10.

## 3. Failed This Run
For each failed prompt:
- Prompt ID and description
- Error summary (one line)
- Whether a known fix exists in the learning database
- Whether it was retried and how many times

## 4. Active Blockers
Issues that prevent forward progress and require human intervention.
For each: description, severity, suggested resolution.

## 5. Queue Status
- Total prompts in build: X
- Completed: X (X%)
- Remaining: X prompts across estimated Y hours of execution
- Next prompt: [ID] — [description]

## 6. Next Run Plan
What the next batch of prompts will focus on.
Any queue recomposition needed?
Any specs that need deepening before the next run?

## 7. Environment Notes
Any environment issues to resolve before next run:
- Missing env vars
- Outdated dependencies
- Database migration status
- Vercel deployment status

## 8. Learning Highlights
- New governance rules created or enforced
- New fix patterns learned
- Skills injected from prior builds
- Self-modification proposals generated (pending approval)
- Error recurrence patterns observed

SESSION STATE:
$($SessionState | ConvertTo-Json -Depth 5)
"@

    $handoff = Invoke-ClaudeAPI -Prompt $handoffPrompt -MaxTokens 4000

    # Save as markdown
    $mdPath = "$ProjectPath/.forge/SESSION_HANDOFF.md"
    Set-Content $mdPath $handoff

    Write-Host '[SESSION] Handoff document generated:' -ForegroundColor Green
    Write-Host "  $mdPath" -ForegroundColor Gray
}
```

---

## 7. Crash Recovery

### 7.1 Interrupted Run Recovery

If FORGE is interrupted mid-run (machine restart, power loss, Ctrl+C), the SessionEnd hook may not fire. On the next invocation, FORGE detects the incomplete state:

```powershell
function Test-CrashRecovery {
    param([string]$ProjectPath)

    $stateFile = "$ProjectPath/.forge/session_state.json"
    $lockFile = "$ProjectPath/.forge/forge_running.lock"

    # Check for stale lock file (FORGE creates this at SessionStart, deletes at SessionEnd)
    if (Test-Path $lockFile) {
        $lockAge = (Get-Date) - (Get-Item $lockFile).CreationTime
        if ($lockAge.TotalMinutes -gt 5) {
            Write-Host '[SESSION] CRASH DETECTED: Previous run did not complete cleanly.' -ForegroundColor Yellow
            Write-Host "  Lock file age: $([Math]::Round($lockAge.TotalHours, 1)) hours" -ForegroundColor Gray

            # Check for compact snapshots (PreCompact hook saves these)
            $db = Get-ForgeDbPath
            $lastSnapshot = Invoke-Sqlite -Database $db -Query @"
                SELECT * FROM compact_snapshots
                ORDER BY created_at DESC LIMIT 1
"@

            if ($lastSnapshot) {
                Write-Host "  Recovery point found: prompt $($lastSnapshot.prompt_index)" -ForegroundColor Cyan
                Write-Host "  Snapshot time: $($lastSnapshot.created_at)" -ForegroundColor Gray
                $recover = Read-Host '  Recover from this point? [Y/N]'
                if ($recover -eq 'Y') {
                    # Restore state from compact snapshot
                    Remove-Item $lockFile -Force
                    return @{ Recovered = $true; Snapshot = $lastSnapshot }
                }
            } else {
                Write-Host '  No recovery snapshot found. Previous run data may be incomplete.' -ForegroundColor Yellow
                Remove-Item $lockFile -Force
            }
        }
    }

    return @{ Recovered = $false }
}
```

### 7.2 Lock File Management

```powershell
# At SessionStart:
function Set-ForgeLock {
    param([string]$ProjectPath, [string]$BuildId)
    $lockContent = @{
        build_id = $BuildId
        machine_id = Get-MachineId
        started_at = (Get-Date -Format 'o')
        pid = $PID
    } | ConvertTo-Json
    Set-Content "$ProjectPath/.forge/forge_running.lock" $lockContent
}

# At SessionEnd:
function Remove-ForgeLock {
    param([string]$ProjectPath)
    $lockFile = "$ProjectPath/.forge/forge_running.lock"
    if (Test-Path $lockFile) { Remove-Item $lockFile -Force }
}
```

---

## 8. Multi-Run Lifecycle — Complete Sequence

### 8.1 Run Start Sequence

1. `Test-CrashRecovery` — check for stale lock file, recover from compact snapshot if needed
2. `Set-ForgeLock` — create lock file indicating FORGE is running
3. `Sync-ForgeMemory -Direction Pull` — pull latest learning data from master
4. `Load-CrossProjectKnowledge` — load rules, skills, fix patterns
5. `Present-Evolutions` — show pending self-modification proposals
6. `Resume-ForgeSession` — load previous state, verify fingerprint, show queue status
7. Begin prompt execution from the next pending prompt

### 8.2 Per-Prompt Sequence (within EXECUTE)

1. Create git snapshot: `git tag FORGE-SNAPSHOT-{prompt_id}`
2. Fire `PreToolUse` hooks (governance check, fix pattern check)
3. Execute the prompt via Claude Code
4. Fire `PostToolUse` hooks (tsc, eslint, schema drift, score prompt)
5. If Ring 2 trigger (every 10th): run `Invoke-SentinelRing -Ring Ring2`
6. If adversarial review trigger: run adversarial code review
7. `Update-PromptStatus` — mark prompt as COMPLETED or FAILED
8. If `PreCompact` trigger: save context snapshot
9. Git commit: `FORGE-{project}-P{phase}-T{task}-{status}`
10. Advance to next prompt

### 8.3 Run End Sequence

1. `Export-SessionState` — serialize complete build state
2. `Update-DecisionWeights` — compute downstream error rates
3. `Analyze-ForEvolutions` — generate self-modification proposals
4. `Evaluate-AdversaryAccuracy` — track adversary effectiveness
5. `Export-SessionHandoff` — generate handoff document
6. `Sync-ForgeMemory -Direction Push` — push learning data to master
7. Git commit and push: `FORGE-SESSION-END-{run_number}`
8. `Remove-ForgeLock` — release lock file
9. Print run summary to console

### 8.4 Between Runs (Human Review)

1. Reid reviews SESSION_HANDOFF.md
2. Reid reviews pending_evolutions (approved/rejected during next SessionStart)
3. If queue recomposition needed: Composer runs `Recompose-Queue`
4. If new specs needed for upcoming phases: conversation with Claude
5. Launch next run: `forge execute -ProjectPath '...'`

### 8.5 Build Complete

When the queue reaches 0 pending prompts:
1. Run Ring 3 Sentinel (end-of-run gate)
2. If deploying: transition to Phase 6 DEPLOY
3. Generate final build report with complete statistics
4. Archive build artifacts to 18TB drive
5. Update project maturity profile in learning database
