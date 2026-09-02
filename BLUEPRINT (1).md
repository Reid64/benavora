# FORGE 2.0 — Blueprint

**Project:** FORGE 2.0 Autonomous Build Orchestration Framework
**Language:** PowerShell (.ps1, .psm1)
**Storage:** Local SQLite (forge_memory.db)
**Target Path:** C:\Users\manag\Documents\FORGE 2.0\
**Last Updated:** June 22, 2026

---

## Tech Stack

| Technology | Version | Purpose |
|-----------|---------|---------|
| PowerShell | 7.x | Primary language for all FORGE modules |
| SQLite | 3.x | Local learning database (forge_memory.db) |
| sqlite3 CLI | 3.x | Database access from PowerShell (primary) |
| System.Data.SQLite | .NET assembly | Database access fallback if CLI unavailable |
| Git | 2.x | Version control, per-prompt snapshots, rollback |
| Claude Code | Current | Execution agent (receives prompts from FORGE) |
| Pester | 5.x | PowerShell testing framework (between-run validation) |
| PSScriptAnalyzer | 1.x | PowerShell linting (gate during runs) |

---

## Project File Structure

```
C:\Users\manag\Documents\FORGE 2.0\
├── forge.ps1                          # Main entry point — phase routing
├── forge_config.json                  # Global FORGE configuration
├── modules/
│   ├── ForgeCore.psm1                 # Core pipeline controller
│   ├── ForgeLearning.psm1             # Learning engine (SQLite query layer)
│   ├── ForgeSync.psm1                 # Cross-machine sync script
│   ├── ForgeHooks.psm1                # Hook lifecycle execution engine
│   ├── ForgeRetrofit.psm1             # RETROFIT pipeline (SCAN, DIAGNOSE, RECONCILE, QUEUE)
│   ├── ForgeSession.psm1              # Session orchestration (serialize, resume, fingerprint)
│   ├── ForgeSentinel.psm1             # Sentinel quality pipeline (18 tools)
│   ├── ForgeComposer.psm1             # Composer engine (DAG, prompts, templates)
│   ├── ForgeArchitect.psm1            # Architect & PRD (SCOUT, 4-pass refinement)
│   └── ForgeDeploy.psm1              # Deploy pipeline (canary, env parity, rollback)
├── lib/
│   ├── System.Data.SQLite.dll         # .NET SQLite assembly (fallback)
│   └── sqlite3.exe                    # SQLite CLI binary (if not in PATH)
├── templates/
│   ├── hooks_default.json             # Default hooks.json for new projects
│   ├── forge_config_default.json      # Default configuration template
│   └── prompt_template.md             # Canonical 7-section prompt template
├── .forge/
│   ├── forge_memory.db                # Learning database (per-machine)
│   └── sync_config.json               # Cross-machine sync configuration
├── tests/
│   ├── ForgeCore.Tests.ps1            # Pester tests for core module
│   ├── ForgeLearning.Tests.ps1        # Pester tests for learning engine
│   ├── ForgeSync.Tests.ps1            # Pester tests for sync
│   ├── ForgeHooks.Tests.ps1           # Pester tests for hooks
│   └── ForgeRetrofit.Tests.ps1        # Pester tests for RETROFIT
├── STATE_OF_THE_BUILD.md
├── BLUEPRINT.md                       # This file
├── SCHEMA_REGISTRY.md
├── AGENTS.md
└── BEHAVIORAL_CONTRACTS.md
```

---

## Module Dependency Graph

```
ForgeCore.psm1
  ├── depends on: ForgeLearning.psm1 (Initialize-ForgeMemory, Get-GovernanceRules)
  ├── depends on: ForgeHooks.psm1 (Invoke-Hook for SessionStart/SessionEnd)
  ├── depends on: ForgeSession.psm1 (Resume-ForgeSession, Export-SessionState)
  └── provides: Invoke-Forge (main entry), Invoke-Gate, Invoke-Retry, New-GitSnapshot

ForgeLearning.psm1
  ├── depends on: nothing (foundation module)
  └── provides: Invoke-Sqlite, Initialize-ForgeMemory, Get-ForgeMemory, Save-ToForgeMemory,
                Get-FixPattern, Get-GovernanceRules, Get-BestPromptTemplates, Get-DecisionWeights,
                Get-RelevantSkills, Get-PendingEvolutions, Get-ErrorFingerprint, Get-MachineId,
                Save-PromptScore, Update-FixPattern, Register-Error, Register-Fix,
                Score-PromptExecution, Update-DecisionWeights, Analyze-ForEvolutions

ForgeSync.psm1
  ├── depends on: ForgeLearning.psm1 (Invoke-Sqlite, Get-ForgeDbPath, Get-MachineId)
  └── provides: Sync-ForgeMemory, Acquire-SyncLock, Release-SyncLock

ForgeHooks.psm1
  ├── depends on: ForgeLearning.psm1 (Save-ToForgeMemory for hook_execution_log)
  └── provides: Invoke-Hook, Test-HookConditions, Resolve-HookTemplates,
                Invoke-HookAction, New-DefaultHooksJson, Invoke-PreCompactSave,
                Restore-CompactedContext

ForgeRetrofit.psm1
  ├── depends on: ForgeLearning.psm1 (all read/write functions)
  ├── depends on: ForgeHooks.psm1 (Invoke-Hook for SessionStart)
  └── provides: Invoke-RetrofitScan, Invoke-RetrofitDiagnose, Invoke-RetrofitReconcile,
                Invoke-RetrofitQueue, all 14 SCAN operations

ForgeSession.psm1
  ├── depends on: ForgeLearning.psm1 (Save-ToForgeMemory, Get-ForgeMemory)
  └── provides: Export-SessionState, Resume-ForgeSession, Get-BuildFingerprint,
                Test-FingerprintMatch, Handle-FingerprintMismatch, Export-SessionHandoff,
                Get-DetailedQueueStatus, Update-PromptStatus, Test-CrashRecovery

ForgeSentinel.psm1 (Run 2-3)
  ├── depends on: ForgeLearning.psm1 (Register-Error, Save-ToForgeMemory)
  └── provides: Invoke-SentinelRing, Install-SentinelTools, all 18 tool functions

ForgeComposer.psm1 (Run 3-4)
  ├── depends on: ForgeLearning.psm1 (Get-BestPromptTemplates, Get-RelevantSkills)
  └── provides: Extract-Tasks, New-ForgeDAG, Get-TopologicalOrder, Build-Prompt,
                Export-Queue, Recompose-Queue

ForgeArchitect.psm1 (Run 4)
  ├── depends on: ForgeLearning.psm1 (Get-RecommendedDecision, Record-ArchitectureDecision)
  └── provides: Invoke-Scout, Invoke-Architect, four-pass refinement functions,
                governance suite generation, Invoke-SchemaValidation

ForgeDeploy.psm1 (Run 4-5)
  ├── depends on: ForgeSentinel.psm1 (Invoke-SentinelRing)
  ├── depends on: ForgeLearning.psm1 (Register-Error, Save-ToForgeMemory)
  └── provides: Invoke-ForgeDeploy, Invoke-CanaryDeploy, Apply-ProductionMigrations,
                Invoke-EnvParityCheck, Invoke-ProductionRollback, Update-ReadmeFromGovernance
```

---

## Data Flow

### Build Execution Flow
```
Reid provides idea or project path
  → forge.ps1 routes to correct phase
    → SessionStart hooks fire (sync pull, load knowledge, present evolutions)
      → Phase-specific module executes
        → Per-prompt: PreToolUse hooks → Claude Code executes → PostToolUse hooks
          → Learning engine records results (prompt scores, error patterns, fix patterns)
        → Ring 2 Sentinel every 10th prompt
      → SessionEnd hooks fire (update weights, analyze evolutions, sync push, handoff doc)
    → Between runs: Reid reviews handoff, Composer recomposes queue
  → Repeat until queue complete
    → Ring 3/4 Sentinel → Deploy
```

### Learning Data Flow
```
Error occurs during prompt execution
  → Register-Error captures fingerprint + context
    → fix_patterns table stores error-fix pair
      → 3+ occurrences → auto-elevate to governance_rules
        → PreToolUse hook injects prevention into future prompts
          → Error prevented before it occurs
```

### Cross-Machine Sync Flow
```
Run ends on Machine A
  → SessionEnd hook: Sync-ForgeMemory -Direction Push
    → New records written to master copy on 18TB drive (with file lock)
      → Lock released
Run begins on Machine B
  → SessionStart hook: Sync-ForgeMemory -Direction Pull
    → New records from master pulled into local forge_memory.db
      → Machine B now has Machine A's learned knowledge
```
