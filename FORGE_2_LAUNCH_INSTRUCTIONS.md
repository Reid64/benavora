# FORGE 2.0 — Launch Instructions

## What FORGE 2.0 Does

FORGE 2.0 is an autonomous software factory. It takes an idea, a PRD, or an abandoned codebase and builds it to production without human intervention. Three modes:

**Mode 1 — Greenfield:** `forge build <path> --idea "your idea"` → Scout → PRD → Architect → Compose → Execute → Deploy

**Mode 2 — RETROFIT:** `forge retrofit <path>` → SCAN 14 ops → DIAGNOSE → RECONCILE → QUEUE → Execute → Deploy

**Mode 3 — PRD Import:** `forge build <path> --prd <file>` or `forge sequence <specs-dir> <path>` → Skip Scout/PRD → Architect → Compose → Execute → Deploy

---

## Prerequisites

- Node.js installed
- pnpm installed
- FORGE 1.0 at `C:\Users\manag\Documents\FORGE`
- FORGE 2.0 CLI built at `C:\Users\manag\Documents\forge-2`

---

## CLI Commands Reference

```powershell
# Show all commands
node C:\Users\manag\Documents\forge-2\dist\cli\index.js --help

# Greenfield build from idea
node C:\Users\manag\Documents\forge-2\dist\cli\index.js build C:\path\to\project --idea "your idea" --api-key $YOUR_KEY

# RETROFIT abandoned build
node C:\Users\manag\Documents\forge-2\dist\cli\index.js retrofit C:\path\to\project --api-key $YOUR_KEY

# Import existing PRD/specs
node C:\Users\manag\Documents\forge-2\dist\cli\index.js build C:\path\to\project --prd C:\path\to\prd.md --api-key $YOUR_KEY

# 40+ document enterprise build
node C:\Users\manag\Documents\forge-2\dist\cli\index.js sequence C:\path\to\specs C:\path\to\project --api-key $YOUR_KEY

# Compose queue from governance docs only
node C:\Users\manag\Documents\forge-2\dist\cli\index.js compose C:\path\to\project --api-key $YOUR_KEY

# Deploy to production
node C:\Users\manag\Documents\forge-2\dist\cli\index.js deploy C:\path\to\project

# Cost estimate before building
node C:\Users\manag\Documents\forge-2\dist\cli\index.js estimate C:\path\to\project
```

---

## FORGE 1.0 Autonomous Execution

Once `forge compose` or `forge build` generates a queue file, FORGE 1.0 runs it autonomously:

```powershell
# Standard launch
cd C:\Users\manag\Documents\FORGE
$env:NODE_OPTIONS="--max-old-space-size=8192"
$env:ANTHROPIC_API_KEY=$null
$env:DANGEROUSLY_SKIP_PERMISSIONS=1
powershell -ExecutionPolicy Bypass -File .\forge.ps1 -project YOUR_PROJECT_NAME -startFrom 0

# Resume from specific prompt (after interruption)
powershell -ExecutionPolicy Bypass -File .\forge.ps1 -project YOUR_PROJECT_NAME -startFrom 5
```

Replace `YOUR_PROJECT_NAME` with the folder name under `C:\Users\manag\Documents\FORGE\projects\`.

---

## RETROFIT Workflow (Tarritrix Example)

```powershell
# Step 1: Run RETROFIT scan and compose fix queue
node C:\Users\manag\Documents\forge-2\dist\cli\index.js retrofit C:\path\to\Tarritrix --api-key $YOUR_KEY

# Step 2: Review .forge/gap-report.md and .forge/composition-summary.md

# Step 3: Launch autonomous execution
cd C:\Users\manag\Documents\FORGE
$env:DANGEROUSLY_SKIP_PERMISSIONS=1
powershell -ExecutionPolicy Bypass -File .\forge.ps1 -project Tarritrix -startFrom 0
```

---

## Quality Gates (Enforced on Every Prompt)

| Gate | What It Checks | Fail Behavior |
|------|---------------|---------------|
| compile | pnpm tsc --noEmit = 0 errors | Retry 3x then skip |
| build | pnpm build succeeds | Retry 3x then skip |
| test | pnpm test = 0 failures | Retry 3x then skip |
| file_exists | Required files present | Retry 3x then skip |
| governance | STATE_OF_THE_BUILD.md + SESSION_STATE.md updated within 30min | Retry 3x then skip |

---

## Overnight Run Checklist

Before leaving FORGE to run overnight:

1. Set Windows power settings to Never Sleep
2. Verify `queue.yaml` has correct content: `Select-String -Path "...\queue.yaml" -Pattern "^- id:" | Measure-Object`
3. Verify gate scripts exist: `Get-ChildItem C:\Users\manag\Documents\FORGE\gates\`
4. Launch and confirm first prompt starts executing
5. Check back in the morning — `Get-Content C:\Users\manag\Documents\FORGE\state\PROJECT\gate-results.jsonl | Select-Object -Last 10`

---

## Key File Locations

| File | Location |
|------|----------|
| FORGE 1.0 orchestrator | `C:\Users\manag\Documents\FORGE\forge.ps1` |
| Queue file (FORGE reads this) | `C:\Users\manag\Documents\FORGE\projects\PROJECT\queue.yaml` |
| Gate scripts | `C:\Users\manag\Documents\FORGE\gates\` |
| Run state | `C:\Users\manag\Documents\FORGE\state\PROJECT\` |
| Run logs | `C:\Users\manag\Documents\FORGE\logs\PROJECT\` |
| Run reports | `C:\Users\manag\Documents\FORGE\reports\` |
| FORGE 2.0 CLI | `C:\Users\manag\Documents\forge-2\dist\cli\index.js` |
| Learning database | `~\.forge\forge_memory.db` |
| Project governance | `C:\Users\manag\Documents\FORGE\projects\PROJECT\` |

