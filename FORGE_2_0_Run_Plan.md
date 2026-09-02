# FORGE 2.0 — Complete Build Run Plan

**Created:** June 23, 2026
**Stack:** Node.js / TypeScript (extending FORGE 1.0)
**Working Directory:** C:\Users\manag\Documents\forge-2
**Database:** SQLite via better-sqlite3 at ~/.forge/forge_memory.db

---

## Run 1: Foundation (22 prompts) — READY

**Queue file:** queue-run1.yaml

| Prompt | Module | What It Builds |
|--------|--------|----------------|
| R1-001 | Scaffold | Project structure, types.ts, constants.ts, all stub modules |
| R1-002 | Learning Engine | Database init, all 14 tables, machine identity |
| R1-003 | Learning Engine | Core query infrastructure (15 functions) |
| R1-004 | Learning Engine | Error fingerprinting algorithm (SHA-256) |
| R1-005 | Learning Engine | Five learning loops |
| R1-006 | Sync | Cross-machine sync protocol + lock management |
| R1-007 | Core Pipeline | Entry point, phase routing, command parsing |
| R1-008 | Core Pipeline | Gate engine, gate configuration |
| R1-009 | Core Pipeline | Retry logic with error context injection |
| R1-010 | Core Pipeline | Git snapshots + structured commits |
| R1-011 | Core Pipeline | Build report generation |
| R1-012 | Hook Lifecycle | hooks.json parser + schema validation |
| R1-013 | Hook Lifecycle | Execution engine (core invokeHook) |
| R1-014 | Hook Lifecycle | Conditions, templates, glob matching |
| R1-015 | Hook Lifecycle | PreCompact context preservation |
| R1-016 | Hook Lifecycle | Default 24-hook configuration |
| R1-017 | Hook Lifecycle | Hook evolution analysis |
| R1-018 | Integration | Wire all modules into run lifecycle |
| R1-019 | Testing | Vitest tests for Learning Engine |
| R1-020 | Testing | Vitest tests for Core and Hooks |
| R1-021 | CLI | Register FORGE 2.0 commands in existing CLI |
| R1-022 | Governance | Full codebase audit + document update |

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

## Total Estimated Prompts: ~130

| Run | Prompts | Estimated Duration |
|-----|---------|-------------------|
| Run 1 | 22 | 6-10 hours |
| Run 2 | 22 | 6-10 hours |
| Run 3 | 18 | 5-8 hours |
| Run 4 | 22 | 6-10 hours |
| Run 5 | 30 | 8-12 hours |
| Run 6 | 15 | 4-6 hours |
| **Total** | **~130** | **~35-56 hours** |

---

## Key Architectural Decision: TypeScript over PowerShell

The original spec documents reference PowerShell (.psm1 modules, forge.ps1). This has been overridden:

- **FORGE 1.0 is Node.js/TypeScript.** forge.ps1 does not exist.
- **FORGE 2.0 extends FORGE 1.0.** Both live in the same directory.
- **All new modules are TypeScript** in src/forge2/
- **SQLite via better-sqlite3** (native Node.js binding, synchronous API)
- **Git via child_process.execSync** (same behavior as PowerShell git commands)
- **Tests via Vitest** (replaces Pester)

The architecture, behavior, database schema, hook system, and learning engine are identical to the specs. Only the implementation language changed.
