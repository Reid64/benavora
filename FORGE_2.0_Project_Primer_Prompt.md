# FORGE 2.0 — Project Primer Prompt

**Copy and paste everything below the line into the first message of the FORGE 2.0 project chat.**

---

You are the build architect for FORGE 2.0, an autonomous build orchestration framework written entirely in PowerShell. Your project knowledge base contains 10 specification documents totaling approximately 85KB that define every aspect of this system. You must read and internalize all 10 documents before responding to any build instruction. They are:

1. **FORGE_2.0_Master_Design_Record.md** — The source of truth. All foundational principles, the 8-phase pipeline, multi-run session orchestration, application development factory architecture, learning database sync protocol, all 19 design decisions. Nothing in any other document overrides this.

2. **FORGE_2.0_RETROFIT_Deep_Spec.md** — Phase R implementation. 14 SCAN operations with PowerShell code, DIAGNOSE with three adversarial-reviewed reports, RECONCILE hybrid interactive console flow, QUEUE composition with fix-first ordering.

3. **FORGE_2.0_Learning_Engine_Deep_Spec.md** — The brain. 10 SQLite tables with complete CREATE TABLE SQL, the PowerShell query layer, error fingerprinting algorithm (4-component SHA-256), all 5 learning loops with exact functions, the cross-machine sync script with lock management.

4. **FORGE_2.0_Sentinel_Pipeline_Deep_Spec.md** — 18 quality tools across 4 rings. Installation, configuration, execution commands, output parsing, threshold enforcement, failure handling, and learning engine integration for every tool.

5. **FORGE_2.0_Composer_Engine_Deep_Spec.md** — DAG construction with inferred dependency rules, Kahn's topological sort, 7-section prompt template with context slicing, token budget forecasting, prompt splitting heuristics, adversarial queue review, A/B testing for low-performing templates.

6. **FORGE_2.0_Architect_PRD_Deep_Spec.md** — Phase 0 SCOUT feasibility analysis, Phase 1 ARCHITECT with PRD generation, four-pass refinement (Completeness, Adversarial, Dependency Integrity, Human Review), governance suite generation, schema validation gate.

7. **FORGE_2.0_Hook_Lifecycle_Deep_Spec.md** — hooks.json declarative schema with conditions and template variables, execution engine with timeout management, PreCompact context preservation with re-injection, 24 default hooks, hook evolution via learning engine, edge cases (recursion prevention, crash recovery).

8. **FORGE_2.0_Deploy_Pipeline_Deep_Spec.md** — Supabase migration-before-deployment sequencing, destructive operation detection, canary deployment via Vercel preview, production rollback protocol, environment parity check (3-source comparison), README auto-generation, deploy.ps1 generation.

9. **FORGE_2.0_Adversarial_Review_Deep_Spec.md** — Devil's advocacy system. When it fires (5 phases), exact adversary prompts with 7 attack vectors, 4 severity levels with resolution protocol, cost management (selective review criteria), adversary accuracy tracking via learning engine.

10. **FORGE_2.0_Session_Orchestration_Deep_Spec.md** — State serialization (30+ field state object), build fingerprinting (SHA-256 of file tree), fingerprint mismatch handling with mini-RETROFIT, crash recovery from compact snapshots, lock file management, complete multi-run lifecycle sequence.

---

## Build Context

- **Language:** PowerShell exclusively. This is NOT a Next.js application. All code is .ps1 and .psm1 files.
- **Build tool:** This project is being built using the current FORGE executor (FORGE 1) with PowerShell-appropriate gates substituted for the standard TypeScript gates.
- **Gates during autonomous runs:** PowerShell syntax validation via `[System.Management.Automation.Language.Parser]::ParseFile()` and SQLite schema validation. Comprehensive testing (Pester tests, integration tests) happens between runs during human review.
- **Learning database:** Local SQLite at `~/.forge/forge_memory.db`. No Supabase dependency for FORGE itself.
- **Target path:** `C:\Users\manag\Documents\FORGE 2.0\`
- **Developer:** Reid Whitesides. Non-technical founder. Uses voice-to-text input, PowerShell Black Window exclusively, Windows laptops.
- **Run structure:** 40-50 prompts per autonomous run, approximately 15 hours each. Total build estimated at 175-245 prompts across 4-5 runs.
- **Cross-machine sync:** 18TB external drive with ethernet-connected multi-port router and UPS. Local SQLite per machine, master copy on the drive, append-only sync with file locking.

---

## What I Need From You Right Now

Compose the complete prompt queue for **Run 1** of the FORGE 2.0 build.

Run 1 must build the foundation that every subsequent run depends on. Based on the specifications, Run 1 covers:

**Module 1: Core Pipeline Controller (forge.ps1)**
- The main entry point script that routes to phases (RETROFIT, SCOUT, ARCHITECT, SCAFFOLD, COMPOSE, EXECUTE, SENTINEL, DEPLOY)
- Phase routing logic
- Global configuration loading (.forge/forge_config.json)
- Gate engine (configurable per-project, PowerShell-appropriate gates for this build)
- Retry logic with configurable max retries
- Per-prompt git snapshot creation and rollback capability
- Structured commit messages: FORGE-[project]-P[phase]-T[task]-[status]
- Build report generation (markdown summary with pass/fail per prompt)

**Module 2: Learning Engine (SQLite)**
- Database initialization function (Initialize-ForgeMemory)
- Complete schema creation (all 10+ tables from the Learning Engine spec)
- Core SQLite wrapper (Invoke-Sqlite) with both sqlite3 CLI and .NET fallback
- All high-level read functions (Get-ForgeMemory, Get-FixPattern, Get-GovernanceRules, Get-BestPromptTemplates, Get-DecisionWeights, Get-RelevantSkills, Get-PendingEvolutions)
- All high-level write functions (Save-ToForgeMemory, Update-FixPattern, Increment-GovernanceEnforcement, Save-PromptScore)
- Error fingerprinting algorithm (Get-ErrorFingerprint)
- Machine identity generation (Get-MachineId)

**Module 3: Cross-Machine Sync**
- Sync configuration (sync_config.json)
- Sync-ForgeMemory function (Pull and Push directions)
- Lock acquisition and release (Acquire-SyncLock, Release-SyncLock)
- Stale lock detection and recovery

**Module 4: Hook Lifecycle System**
- hooks.json parser and validator
- Hook execution engine (Invoke-Hook)
- Condition evaluation (Test-HookConditions)
- Template variable resolution (Resolve-HookTemplates)
- Action execution with timeout (Invoke-HookAction)
- Default hooks.json generation for new projects
- PreCompact context preservation (Invoke-PreCompactSave)
- Context re-injection after compaction (Restore-CompactedContext)
- hook_execution_log and compact_snapshots table creation

**Module 5: RETROFIT SCAN**
- Pre-flight checks (8 checks from the RETROFIT spec)
- All 14 SCAN operations with PowerShell implementations:
  - Directory tree enumeration
  - Dependency tree mapping
  - Broken import detection
  - Dead file detection
  - Route inventory
  - Environment variable audit
  - Database schema extraction
  - Git history analysis
  - Package audit
  - Governance document inventory
  - TypeScript compilation check
  - Existing test execution
  - Dynamic route testing (GET-only, Approach A)
  - Vercel deployment analysis
- ScanReport JSON output generation

**Module 6: RETROFIT DIAGNOSE**
- Architecture Health Report generation (Claude prompt)
- Adversarial review of health report (separate Claude prompt)
- Governance Reconciliation Report generation
- Enterprise Patterns Gap Analysis (with maturity stage detection)
- Console output with color-coded findings (Format C)
- DiagnoseReport JSON and .docx output

**Module 7: RETROFIT RECONCILE**
- Previous decision loading from learning database
- CRITICAL fix auto-approval with override
- UNBUILT feature triage (BUILD/DEFER/ABANDON)
- WARN fix grouped selection
- Enterprise pattern injection selection
- Final confirmation gate
- Decision persistence to learning database
- Governance document regeneration

**Module 8: Session Orchestration**
- Session state serialization (Export-SessionState)
- Build fingerprinting (Get-BuildFingerprint)
- Session resumption (Resume-ForgeSession)
- Fingerprint mismatch handling with mini-RETROFIT
- SESSION_HANDOFF.md generation
- Queue status tracking
- Crash recovery (lock file, compact snapshot recovery)

---

## Output Format

Produce the prompts as individual markdown files following the 7-section canonical template from the Composer Engine spec:

1. **Context Injection** — relevant spec sections (sliced, not entire documents)
2. **Task Description** — atomic task, one module, one testable outcome
3. **Acceptance Criteria** — specific, testable conditions
4. **File Manifest** — files to CREATE (no modify on Run 1 — everything is new)
5. **Verification Commands** — PowerShell commands that confirm completion (syntax parse check, function existence check, SQLite schema validation)
6. **Governance Update Mandate** — update STATE_OF_THE_BUILD.md after each prompt
7. **Rollback Instruction** — revert to git snapshot on failure

Number each prompt sequentially: R1-001, R1-002, ... through R1-0XX.

Order them by dependency: foundation utilities first (SQLite wrapper, config loading), then the learning engine tables, then the query layer, then the hook system, then RETROFIT operations, then session orchestration.

Estimate the token count per prompt and provide a total budget at the end.

Begin composing the Run 1 prompt queue now.
