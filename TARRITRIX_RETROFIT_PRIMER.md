# Tarritrix RETROFIT Session Primer

**Copy this entire message and paste it as your first message in the Tarritrix Claude project.**

---

## Context for Claude

You are picking up the Tarritrix build using FORGE 2.0 — a fully autonomous software factory built specifically for this workflow. Read everything below before doing anything.

---

## What FORGE 2.0 Is

FORGE 2.0 is at `C:\Users\manag\Documents\forge-2`. It is a TypeScript CLI with these commands relevant to Tarritrix:

- `forge retrofit <path>` — SCAN 14 operations, DIAGNOSE 3 reports, RECONCILE decisions, generate execution queue
- `forge build <path> --skip-design` — Skip PRD/Architect, compose from existing governance, execute autonomously
- `forge compose <path>` — Generate queue from existing BLUEPRINT.md, SCHEMA_REGISTRY.md, AGENTS.md
- `forge sentinel <path>` — Run full quality pipeline

FORGE 1.0 (the orchestrator at `C:\Users\manag\Documents\FORGE`) reads `queue.yaml` and executes prompts autonomously via Claude Code with quality gates on every prompt.

---

## Tarritrix Current State

Based on FORGE 2.0's Master Design Record, Tarritrix is classified as **FOUNDATION stage** — approximately 30-40% complete with an incomplete core. The RETROFIT pipeline is the correct entry point.

Before doing anything else, you must:

1. Read all governance documents in this project
2. Run RETROFIT audit to get current actual state
3. Generate a fix queue targeting CRITICAL issues first
4. Launch autonomous overnight execution

---

## Canonical Rules — Never Violate

**Rule 1 — Zero Manual Tasks:** Claude Code writes every file directly to correct paths. You never ask the user to place files manually. The final prompt of every queue writes the next queue directly to `C:\Users\manag\Documents\FORGE\projects\Tarritrix\queue.yaml`.

**Rule 2 — Gates on Every Prompt:** Every prompt in every queue must have gates. Minimum:
```yaml
gates:
- type: compile
- type: build
- type: governance
```

**Rule 3 — Governance Updates:** Every prompt must end with: Update STATE_OF_THE_BUILD.md and SESSION_STATE.md from actual codebase audit — not from memory.

**Rule 4 — No Stubs:** Every prompt contains full inline TypeScript implementations. No "implement as described." No "read and fill gaps." If a prompt completes in under 5 minutes it produced shallow work.

**Rule 5 — Queue Format:** FORGE 1.0 requires double-quoted single-line prompt strings with `\n` for newlines. NEVER use `|` block scalars — they break FORGE's YAML parser and produce 0 prompts found.

---

## Step 1 — Audit Current State

Run this first:

```powershell
cd C:\path\to\Tarritrix
node C:\Users\manag\Documents\forge-2\dist\cli\index.js retrofit . --scope A --non-interactive 2>&1
```

This runs all 14 SCAN operations and produces:
- `.forge/scan_report.json` — complete technical audit
- Architecture Health Report with CRITICAL/WARN/INFO findings
- Governance Reconciliation Report — what's documented vs what's built

---

## Step 2 — Review and Decide

Read `.forge/gap-report.md` and the handoff. For each CRITICAL finding, FORGE will ask: BUILD, DEFER, or ABANDON. With `--non-interactive` it auto-approves BUILD for everything.

---

## Step 3 — Compose Execution Queue

```powershell
node C:\Users\manag\Documents\forge-2\dist\cli\index.js compose C:\path\to\Tarritrix --api-key $YOUR_KEY
```

This reads governance docs, extracts tasks, builds dependency graph, and writes queue files to `C:\Users\manag\Documents\FORGE\projects\Tarritrix\`.

---

## Step 4 — Launch Overnight Run

```powershell
cd C:\Users\manag\Documents\FORGE
$env:NODE_OPTIONS="--max-old-space-size=8192"
$env:ANTHROPIC_API_KEY=$null
$env:DANGEROUSLY_SKIP_PERMISSIONS=1
powershell -ExecutionPolicy Bypass -File .\forge.ps1 -project Tarritrix -startFrom 0
```

Set Windows power settings to Never Sleep before walking away.

---

## Step 5 — Monitor in the Morning

```powershell
# Check progress
Get-Content "C:\Users\manag\Documents\FORGE\state\Tarritrix\gate-results.jsonl" | Select-Object -Last 20

# Check for halts
Get-Content "C:\Users\manag\Documents\FORGE\state\Tarritrix\halt-reason.md" -ErrorAction SilentlyContinue

# Check what was built
cd C:\path\to\Tarritrix; npx tsc --noEmit 2>&1 | Select-Object -First 10
```

---

## FORGE 1.0 Gate Scripts Location

```
C:\Users\manag\Documents\FORGE\gates\compile.ps1  — pnpm tsc --noEmit
C:\Users\manag\Documents\FORGE\gates\build.ps1    — pnpm build
C:\Users\manag\Documents\FORGE\gates\test.ps1     — pnpm test
C:\Users\manag\Documents\FORGE\gates\governance.ps1 — governance docs updated within 30min
```

---

## Your First Task

Read all governance documents uploaded to this project. Then run the RETROFIT audit on Tarritrix. Then produce a queue targeting CRITICAL fixes first, then WARN, then BUILD features. The queue must be large enough for an all-night autonomous run — aim for 40-45 prompts. Every prompt must have gates. The final prompt must write the next queue to disk as its first action.

Do not ask for permission to proceed. Do not produce anything shorter than a full engineering specification. Begin.

