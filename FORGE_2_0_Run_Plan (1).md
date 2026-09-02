# FORGE Enhancement — Complete Build Run Plan

**Created:** June 23, 2026
**Approach:** Enhance existing FORGE codebase (NOT a rebuild)
**Working Directory:** C:\Users\manag\Documents\forge-2
**Queue Location:** C:\Users\manag\Documents\forge-2\projects\forge2\queue.yaml
**Existing Stack:** Node.js/TypeScript, ESM, Commander CLI, Supabase memory, Pino logger, Chalk, Zod
**Adding:** SQLite learning engine (better-sqlite3) alongside existing Supabase memory

---

## Run 1: Learning Engine Foundation (12 prompts) — READY

**Queue file:** queue-run1.yaml
**Place at:** C:\Users\manag\Documents\forge-2\projects\forge2\queue.yaml

| Prompt | What It Does |
|--------|-------------|
| R1-001 | Audit existing codebase, catalog every file, identify enhancement gaps |
| R1-002 | Install better-sqlite3, create learning DB module with all 14 tables |
| R1-003 | Build query layer (14 functions: save, get, update, register, etc.) |
| R1-004 | Build error fingerprinting algorithm (SHA-256, path/message generalization) |
| R1-005 | Build five learning loops (scoring, fix patterns, decisions, knowledge, self-mod) |
| R1-006 | Build cross-machine sync protocol with file locking |
| R1-007 | Build enhanced hooks (24 defaults, conditions, templates, PreCompact) |
| R1-008 | Build session orchestration (state, fingerprinting, crash recovery, handoff) |
| R1-009 | Wire learning engine into existing phase3 executor |
| R1-010 | Add learning commands to existing CLI |
| R1-011 | Create tests for all learning engine modules |
| R1-012 | Final audit and governance document update |

---

## Run 2: RETROFIT SCAN + Session Orchestration (~22 prompts) — PENDING

| Area | Prompts | What It Builds |
|------|---------|----------------|
| RETROFIT Entry | 2 | Entry point, pre-flight checks (8 checks) |
| SCAN Operations 1-7 | 7 | Directory tree, dependency mapping, broken imports, dead files, route inventory, env audit, schema extraction |
| SCAN Operations 8-14 | 7 | Git history, package audit, governance inventory, tsc check, test execution, dynamic route testing, Vercel analysis |
| SCAN Output | 1 | Report assembly, JSON output, learning DB persistence |
| Session State | 2 | State serialization, build fingerprinting |
| Session Resume | 2 | Resumption, fingerprint mismatch handling |
| Session Crash | 1 | Crash recovery, lock management |

---

## Run 3: RETROFIT DIAGNOSE + Adversarial Review (~18 prompts) — PENDING

| Area | Prompts | What It Builds |
|------|---------|----------------|
| DIAGNOSE | 5 | Architecture Health Report, Governance Reconciliation, Enterprise Patterns Gap, console output formatting, adversarial review of reports |
| RECONCILE | 5 | Previous decision check, CRITICAL auto-approval, UNBUILT triage, WARN selection, decision persistence + governance regen |
| RETROFIT QUEUE | 3 | Queue composition order, dependency graph, prompt generation |
| Adversarial Review | 5 | Review engine, phase-specific prompts, challenge classification, resolution protocol, accuracy tracking |

---

## Run 4: Sentinel Pipeline (~22 prompts) — PENDING

| Area | Prompts | What It Builds |
|------|---------|----------------|
| Sentinel Core | 2 | Ring execution engine, tool installation script |
| Ring 1 (Every Prompt) | 3 | TypeScript (tsc), ESLint, Schema Drift Detection |
| Ring 2 (Every 10th) | 4 | Vitest, Playwright smoke, Semgrep, knip |
| Ring 3 (End of Run) | 4 | Trivy, Gitleaks, Lighthouse, Axe accessibility |
| Ring 4 (Pre-Deploy) | 7 | CodeQL, AgentShield, OWASP ZAP, Spectral, k6 load, pass@k, OpenTelemetry |
| Failure Remediation | 2 | Auto-fix protocol, graceful degradation |

---

## Run 5: Composer + Architect + Deploy (~30 prompts) — PENDING

| Area | Prompts | What It Builds |
|------|---------|----------------|
| Composer Engine | 10 | Task extraction, DAG construction, cycle detection, topological sort, prompt templates (7 sections), token budget forecasting, prompt splitting, adversarial queue review, queue output, recomposition |
| Architect & PRD | 10 | SCOUT feasibility, PRD generation, 4-pass refinement (completeness, adversarial, dependency, human), governance suite generation, schema validation gate |
| Deploy Pipeline | 10 | Migration sequencing, env parity check, canary deployment, Sentinel Ring 4 gate, production rollback, README auto-generation, deploy script generation, post-deploy hooks |

---

## Run 6: Integration Testing + Hardening (~15 prompts) — PENDING

| Area | Prompts | What It Builds |
|------|---------|----------------|
| End-to-end tests | 5 | Full pipeline simulation (greenfield + retrofit) |
| Edge case handling | 5 | Network failures, corrupt databases, concurrent access, partial runs, large codebases |
| Documentation | 3 | API documentation, user guide, contribution guide |
| Hardening | 2 | Error boundary audit, graceful degradation verification |

---

## Total Estimated Prompts: ~85-100

| Run | Prompts | Focus |
|-----|---------|-------|
| Run 1 | 12 | Learning engine, sync, hooks, session, CLI integration |
| Run 2 | ~18 | RETROFIT pipeline (SCAN, DIAGNOSE, RECONCILE, QUEUE) |
| Run 3 | ~15 | Adversarial review, Sentinel 4-ring organization |
| Run 4 | ~18 | Composer engine, Architect/PRD enhancements |
| Run 5 | ~15 | Deploy pipeline, integration testing, hardening |
| **Total** | **~78-100** | **~25-40 hours execution** |

---

## Key Architectural Decision: Enhance, Not Rebuild

The existing FORGE codebase has ~60+ TypeScript files across src/engine/, src/memory/, src/phases/, src/tools/, src/analysis/, src/cli/. It already has a working claude-runner, hook-manager, git-manager, governance-gate, prompt-assembler, phase routing, 25+ tools, and a full Supabase memory layer.

The enhancement approach:
- **ADD** new src/learning/ directory for SQLite learning engine
- **ADD** new capabilities (fingerprinting, sync, session orchestration, learning loops)
- **WIRE** new modules into the existing executor at minimal integration points
- **PRESERVE** all existing functionality — learning is additive, never replacing
- **Supabase stays** as the existing memory layer. SQLite is a new parallel system for learning data specifically. They serve different purposes.

No existing files are deleted. Modifications to existing files are minimal and surgical.
