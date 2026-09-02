# FORGE 2.0 — Agents Registry

**Last Updated:** June 22, 2026

---

## Agent: ForgeCore (forge.ps1 + ForgeCore.psm1)

- **Purpose:** Main entry point and pipeline controller. Routes commands to phases, manages gate execution, retry logic, git snapshots, structured commits, and build report generation.
- **Inputs:** Command-line arguments (phase, project path, flags)
- **Outputs:** Phase-specific module invocation, build report (markdown)
- **Dependencies:** ForgeLearning.psm1, ForgeHooks.psm1, ForgeSession.psm1
- **Database tables:** build_outcomes (write), governance_rules (read)
- **Key functions:** Invoke-Forge, Invoke-Gate, Invoke-Retry, New-GitSnapshot, New-StructuredCommit, Export-BuildReport
- **Status:** NOT_STARTED
- **Estimated complexity:** HIGH
- **Estimated prompts:** 5 (R1-010 through R1-014)

---

## Agent: ForgeLearning (ForgeLearning.psm1)

- **Purpose:** The brain of FORGE. Manages the local SQLite learning database, provides the query layer for all read/write operations, implements error fingerprinting, and drives all 5 learning loops.
- **Inputs:** Error data, prompt execution results, architectural decisions
- **Outputs:** Known fixes, governance rules, optimal templates, relevant skills, evolution proposals
- **Dependencies:** None (foundation module — everything depends on this)
- **Database tables:** ALL tables (read + write)
- **Key functions:** Initialize-ForgeMemory, Invoke-Sqlite, Get-ForgeMemory, Save-ToForgeMemory, Get-FixPattern, Get-GovernanceRules, Get-BestPromptTemplates, Get-DecisionWeights, Get-RelevantSkills, Get-PendingEvolutions, Get-ErrorFingerprint, Get-MachineId, Save-PromptScore, Update-FixPattern, Register-Error, Register-Fix, Score-PromptExecution, Update-DecisionWeights, Analyze-ForEvolutions, Present-Evolutions, Apply-Evolution, Load-CrossProjectKnowledge, Invoke-AutoElevation
- **Status:** NOT_STARTED
- **Estimated complexity:** CRITICAL
- **Estimated prompts:** 6 (R1-002 through R1-007)

---

## Agent: ForgeSync (ForgeSync.psm1)

- **Purpose:** Cross-machine learning database synchronization. Manages the append-only sync protocol between local forge_memory.db and the master copy on the 18TB external drive.
- **Inputs:** Sync direction (Pull/Push), sync configuration
- **Outputs:** Synchronized learning database records
- **Dependencies:** ForgeLearning.psm1 (Invoke-Sqlite, Get-ForgeDbPath, Get-MachineId)
- **Database tables:** All tables (read for Push, write for Pull)
- **Key functions:** Sync-ForgeMemory, Acquire-SyncLock, Release-SyncLock, Get-LastSyncTimestamp, Set-LastSyncTimestamp
- **Status:** NOT_STARTED
- **Estimated complexity:** MEDIUM
- **Estimated prompts:** 2 (R1-008 through R1-009)

---

## Agent: ForgeHooks (ForgeHooks.psm1)

- **Purpose:** Hook lifecycle execution engine. Parses hooks.json, evaluates conditions, resolves templates, executes hooks with timeouts, handles blocking behavior, and logs execution to the learning database.
- **Inputs:** Lifecycle event name, context hashtable with template variables
- **Outputs:** Pass/fail result, blocked-by information, execution logs
- **Dependencies:** ForgeLearning.psm1 (Save-ToForgeMemory for hook_execution_log)
- **Database tables:** hook_execution_log (write), compact_snapshots (write via PreCompact)
- **Key functions:** Invoke-Hook, Test-HookConditions, Resolve-HookTemplates, Invoke-HookAction, New-DefaultHooksJson, Invoke-PreCompactSave, Restore-CompactedContext
- **Status:** NOT_STARTED
- **Estimated complexity:** HIGH
- **Estimated prompts:** 5 (R1-015 through R1-019)

---

## Agent: ForgeRetrofit (ForgeRetrofit.psm1)

- **Purpose:** RETROFIT pipeline — scan, diagnose, reconcile, and queue existing codebases for autonomous continuation. The primary operating mode for resurrecting abandoned builds.
- **Inputs:** Project path, scope (A/B/C), flags (SkipDynamic, Resume)
- **Outputs:** ScanReport JSON, DiagnoseReport (console + .docx), reconcile decisions, prompt queue
- **Dependencies:** ForgeLearning.psm1, ForgeHooks.psm1
- **Database tables:** scan_reports (write), fix_patterns (write), reconcile_decisions (write), governance_rules (read)
- **Key functions:** Invoke-RetrofitScan (orchestrates 14 operations), Invoke-RetrofitDiagnose, Invoke-RetrofitReconcile, Invoke-RetrofitQueue, plus all 14 individual SCAN operations
- **SCAN Operations:** Directory tree enumeration, dependency tree mapping, broken import detection, dead file detection, route inventory, environment variable audit, database schema extraction, git history analysis, package audit, governance document inventory, TypeScript compilation check, existing test execution, dynamic route testing (GET-only), Vercel deployment analysis
- **Status:** NOT_STARTED
- **Estimated complexity:** CRITICAL
- **Estimated prompts:** 11 SCAN (R1-020 through R1-030), 5 DIAGNOSE (R1-039 through R1-043), RECONCILE deferred to Run 2

---

## Agent: ForgeSession (ForgeSession.psm1)

- **Purpose:** Multi-run session orchestration. Serializes build state at run end, resumes from serialized state at run start, verifies build integrity via fingerprinting, handles crash recovery, generates handoff documents.
- **Inputs:** Project path, build ID, session state
- **Outputs:** session_state.json, SESSION_HANDOFF.md, fingerprint verification results
- **Dependencies:** ForgeLearning.psm1 (Save-ToForgeMemory, Get-ForgeMemory)
- **Database tables:** build_outcomes (write), build_fingerprints (write), compact_snapshots (read for crash recovery)
- **Key functions:** Export-SessionState, Resume-ForgeSession, Get-BuildFingerprint, Test-FingerprintMatch, Handle-FingerprintMismatch, Export-SessionHandoff, Get-DetailedQueueStatus, Update-PromptStatus, Test-CrashRecovery, Set-ForgeLock, Remove-ForgeLock
- **Status:** NOT_STARTED
- **Estimated complexity:** HIGH
- **Estimated prompts:** 8 (R1-031 through R1-038)

---

## Agent: ForgeSentinel (ForgeSentinel.psm1)

- **Purpose:** 18-tool quality pipeline across 4 rings. Installs, configures, executes, parses output, enforces thresholds, and logs results for all quality tools.
- **Inputs:** Ring selection, project path, base URL (for dynamic tools)
- **Outputs:** Per-tool pass/fail results, Sentinel report
- **Dependencies:** ForgeLearning.psm1 (Register-Error, Save-ToForgeMemory)
- **Database tables:** fix_patterns (write via Register-Error)
- **Status:** NOT_STARTED
- **Estimated complexity:** CRITICAL
- **Estimated prompts:** 25 (Run 2-3)

---

## Agent: ForgeComposer (ForgeComposer.psm1)

- **Purpose:** Transforms governance documents into dependency-ordered, atomic prompts. Builds DAG, performs topological sort, generates prompts from templates, forecasts token budgets, runs adversarial queue review.
- **Inputs:** Governance documents (BLUEPRINT, SCHEMA, AGENTS), learning engine data
- **Outputs:** queue.yaml, individual prompt files in .forge/prompts/
- **Dependencies:** ForgeLearning.psm1 (Get-BestPromptTemplates, Get-RelevantSkills)
- **Status:** NOT_STARTED
- **Estimated complexity:** CRITICAL
- **Estimated prompts:** 15 (Run 3-4)

---

## Agent: ForgeArchitect (ForgeArchitect.psm1)

- **Purpose:** Greenfield pipeline phases 0-1. SCOUT (feasibility analysis) and ARCHITECT (PRD generation with four-pass refinement, governance suite generation, schema validation gate).
- **Inputs:** Natural language idea or outline
- **Outputs:** PRD.md, BLUEPRINT.md, SCHEMA_REGISTRY.md, AGENTS.md, BEHAVIORAL_CONTRACTS.md, STATE_OF_THE_BUILD.md
- **Dependencies:** ForgeLearning.psm1 (Get-RecommendedDecision, Record-ArchitectureDecision)
- **Status:** NOT_STARTED
- **Estimated complexity:** CRITICAL
- **Estimated prompts:** 15-20 (Run 4)

---

## Agent: ForgeDeploy (ForgeDeploy.psm1)

- **Purpose:** Phase 6 deployment pipeline. Migration sequencing, canary deployment via Vercel preview, environment parity verification, production rollback, README auto-generation.
- **Inputs:** Project path, Vercel CLI access, Supabase credentials
- **Outputs:** Production deployment, README.md, deploy.ps1
- **Dependencies:** ForgeSentinel.psm1 (Invoke-SentinelRing), ForgeLearning.psm1
- **Status:** NOT_STARTED
- **Estimated complexity:** HIGH
- **Estimated prompts:** 10 (Run 4-5)
