# FORGE 2.0 — Building the Machine
## Canonical Architecture for Autonomous Multi-Queue Build Orchestration

**Author:** Reid's Claude sessions  
**Purpose:** Educate any project chat (Benavora, Tarritrix, future projects) on how to extend the FORGE orchestration system with its own library, manifest, and queue files — enabling truly non-stop autonomous overnight builds.

---

## What This System Is

FORGE is a three-layer autonomous build system:

```
Layer 1: forge.ps1              — Runs a single queue.yaml, one prompt at a time
Layer 2: forge-orchestrator.ps1 — Reads a manifest, runs ALL queues in dependency order
Layer 3: library/[project]/     — The fuel depot: all pre-written queue YAML files
```

The orchestrator is what enables non-stop overnight builds. Without it, you manually swap `queue.yaml` after every run. With it, you launch once and walk away for 20-60 hours.

---

## Directory Structure

```
C:\Users\manag\Documents\FORGE\
├── forge.ps1                          # Original single-queue runner (never modify)
├── forge-orchestrator.ps1             # Multi-queue orchestrator
├── library\
│   ├── benavora\
│   │   ├── library-manifest.yaml      # Master build index for Benavora
│   │   ├── queue-autonomous-agents.yaml
│   │   ├── queue-ui-flightpath-hud.yaml
│   │   ├── queue-fundability-score.yaml
│   │   └── ... (22+ queue files)
│   └── tarritrix\                     # Tarritrix gets its own library here
│       ├── library-manifest.yaml
│       └── queue-*.yaml
├── projects\
│   ├── benavora\
│   │   ├── queue.yaml                 # Active queue (orchestrator writes this)
│   │   └── *.md                       # Governance docs (synced from repo)
│   └── tarritrix\
│       ├── queue.yaml
│       └── *.md
└── reports\
    └── orchestrator_[project]_[timestamp].log
```

---

## How the Manifest Works

`library-manifest.yaml` is the master build plan. The orchestrator reads it, resolves dependency order, and runs queues sequentially. Every project gets its OWN manifest.

### Manifest Structure

```yaml
project: benavora          # or tarritrix, or any project name
version: "1.0"
description: "Project build manifest"
created: "2026-07-19"

queues:
  - id: autonomous-agents           # Unique ID — never change after first run
    file: queue-autonomous-agents.yaml   # File in library/[project]/
    description: "18 agents upgraded to autonomous"
    status: complete                # pending | running | complete | failed | planned
    depends_on: []                  # IDs that must be complete first
    prompt_count: 24                # For display only
    estimated_hours: 8
    priority: 1                     # Lower runs first when multiple are runnable

  - id: ui-flightpath-hud
    file: queue-ui-flightpath-hud.yaml
    description: "FlightPath HUD inline style rewrite"
    status: pending
    depends_on: [autonomous-agents] # Won't run until autonomous-agents = complete
    prompt_count: 5
    estimated_hours: 2
    priority: 2
```

### Status Values
- `pending` — ready to run when dependencies met
- `running` — currently executing (set by orchestrator)
- `complete` — finished successfully
- `failed` — failed, orchestrator continues with unblocked queues
- `planned` — intentionally deferred (e.g. "build after 25 customers")

---

## How to Add a New Project (e.g. Tarritrix)

**Step 1 — Create the library folder:**
```powershell
New-Item -ItemType Directory -Force -Path "C:\Users\manag\Documents\FORGE\library\tarritrix"
New-Item -ItemType Directory -Force -Path "C:\Users\manag\Documents\FORGE\projects\tarritrix"
```

**Step 2 — Create `library-manifest.yaml`** for Tarritrix (same format as above, `project: tarritrix`)

**Step 3 — Write queue files** into `C:\Users\manag\Documents\FORGE\library\tarritrix\`

**Step 4 — Launch orchestrator for Tarritrix:**
```powershell
$repo = "C:\Users\manag\Documents\Tarritrix"
$forge = "C:\Users\manag\Documents\FORGE\projects\tarritrix"
Get-ChildItem "$repo\*.md" | ForEach-Object { Copy-Item $_.FullName "$forge\$($_.Name)" -Force }
cd C:\Users\manag\Documents\FORGE
$env:NODE_OPTIONS="--max-old-space-size=8192"
$env:ANTHROPIC_API_KEY=$null
$env:DANGEROUSLY_SKIP_PERMISSIONS=1
powershell -ExecutionPolicy Bypass -File .\forge-orchestrator.ps1 -project tarritrix
```

The orchestrator auto-detects the project name and reads from `library\tarritrix\`.

---

## The Governance Sync — MANDATORY Before Every Launch

FORGE reads governance docs from `C:\Users\manag\Documents\FORGE\projects\[project]\`. They must be synced from the repo before every run or FORGE operates without context.

**Canonical pre-launch sync (STANDING DIRECTIVE 016):**
```powershell
$repo = "C:\Users\manag\Documents\benavora"   # Change for each project
$forge = "C:\Users\manag\Documents\FORGE\projects\benavora"
Get-ChildItem "$repo\*.md" | ForEach-Object { Copy-Item $_.FullName "$forge\$($_.Name)" -Force }
```

**This must also be the FIRST instruction in every queue file's first prompt.** Add this to prompt 1 of every queue:
```
First: sync all governance docs by running PowerShell:
$repo = 'C:\Users\manag\Documents\benavora'
$forge = 'C:\Users\manag\Documents\FORGE\projects\benavora'
Get-ChildItem $repo -Filter '*.md' | ForEach-Object { Copy-Item $_.FullName (Join-Path $forge $_.Name) -Force }
```

---

## Orchestrator Launch Commands

**Dry run — see plan without executing:**
```powershell
$repo = "C:\Users\manag\Documents\benavora"; $forge = "C:\Users\manag\Documents\FORGE\projects\benavora"; Get-ChildItem "$repo\*.md" | ForEach-Object { Copy-Item $_.FullName "$forge\$($_.Name)" -Force }; cd C:\Users\manag\Documents\FORGE; powershell -ExecutionPolicy Bypass -File .\forge-orchestrator.ps1 -project benavora -dryRun
```

**Full overnight run:**
```powershell
$repo = "C:\Users\manag\Documents\benavora"; $forge = "C:\Users\manag\Documents\FORGE\projects\benavora"; Get-ChildItem "$repo\*.md" | ForEach-Object { Copy-Item $_.FullName "$forge\$($_.Name)" -Force }; cd C:\Users\manag\Documents\FORGE; $env:NODE_OPTIONS="--max-old-space-size=8192"; $env:ANTHROPIC_API_KEY=$null; $env:DANGEROUSLY_SKIP_PERMISSIONS=1; powershell -ExecutionPolicy Bypass -File .\forge-orchestrator.ps1 -project benavora
```

**Skip to specific queue (resume after failure):**
```powershell
... -File .\forge-orchestrator.ps1 -project benavora -skipTo ui-command-center
```

**Run single queue only:**
```powershell
... -File .\forge-orchestrator.ps1 -project benavora -only ui-flightpath-hud
```

**Reset queues for re-run** (edit manifest status back to `pending`):
```powershell
(Get-Content "C:\Users\manag\Documents\FORGE\library\benavora\library-manifest.yaml") -replace 'status: complete','status: pending' | Set-Content "C:\Users\manag\Documents\FORGE\library\benavora\library-manifest.yaml"
```

---

## The OutOfMemoryException Fix

When the manifest grows large and many queues complete, PowerShell runs out of memory reading it via `Get-Content -Raw`. The orchestrator handles this gracefully — failed manifest updates don't stop execution, but the status won't update correctly.

**Fix:** After long runs, trim the manifest by removing `complete` entries or archiving them. Alternatively, split into phase-specific manifests.

---

## Writing Queue Files That Don't Produce Slop

The single biggest cause of shallow builds is vague prompts. Every enterprise-grade queue prompt must follow these rules:

### Rule 1: Start with file reads
Never write code against assumed structure. Always read first:
```yaml
prompt: |
  Read src/lib/agents/autonomous-base.ts in full.
  Read src/lib/agents/probability-scoring-agent.ts in full.
  Read SCHEMA_REGISTRY_v2.md sections for [relevant tables] in full.
  DO NOT write any code until you have read all three files above.
```

### Rule 2: Enforce minimum line counts
```yaml
  This file must be at minimum 200 lines of real implementation code.
  If your implementation is under 200 lines you have NOT completed the task.
  Expand every method with full logic, error handling, retry logic, and logging.
```

### Rule 3: Name exact function signatures
Not: "create a function that scores grants"
Yes: 
```
Create async run(triggerSource: string, input?: { opportunityId?: string }): Promise<AgentRunResult>
Parameters: triggerSource: 'autonomous' | 'manual' | 'chain' | 'schedule'
Returns: { success: boolean, itemsProcessed: number, summary: string, errors: string[] }
```

### Rule 4: Specify exact database operations
Not: "save results to database"
Yes:
```
INSERT INTO fundability_scores (org_id, opportunity_id, overall_score, probability_without_fixes,
probability_with_fixes, confidence, deficiencies, recommendation, generated_at)
VALUES (...) ON CONFLICT (org_id, opportunity_id) DO UPDATE SET ...
```

### Rule 5: Never put Supabase migrations inside FORGE prompts
Migrations fail because FORGE can't interactively provide Management API tokens.
Apply migrations via Supabase SQL editor BEFORE launching FORGE.
Queue prompts should assume schema already exists.

### Rule 6: Specify error handling requirements
```
Every database call must have try/catch with:
- Error logged to console.error with context
- Graceful degradation (continue to next item, don't abort run)
- Error count tracked and reported in completeRun summary
```

### Rule 7: End with explicit commit
```
Run pnpm tsc --noEmit, fix all TypeScript errors before committing.
Run pnpm build, fix all build errors.
git add -A
git commit -m 'feat: [specific description of what was built]'
git push
```

### Rule 8: Specify Claude API parameters explicitly
```
Call Claude API with:
- model: 'claude-sonnet-4-6'
- max_tokens: 2000
- system: '[full system prompt here — do not abbreviate]'
- user: '[full user prompt construction with all context]'
Parse response.content[0].text as JSON.
Handle JSON parse errors with fallback behavior.
```

---

## Manifest Management Between Runs

After a full run completes, reset only the queues you want to rebuild:

```powershell
# Reset specific queue to pending for re-run with better prompts
$manifest = "C:\Users\manag\Documents\FORGE\library\benavora\library-manifest.yaml"
$content = Get-Content $manifest -Raw
# Manually edit: change specific queue's status: complete -> status: pending
# Then relaunch orchestrator — it will only run pending queues
```

Or write a new queue file targeting only the files that need enrichment and add it to the manifest as a new entry.

---

## The stdout Pipe Fix

The orchestrator now streams forge.ps1 output directly into the orchestrator log in real time. This means:
- Every `[PROMPT X/Y]` line from forge appears in the orchestrator log
- Every `[PASS]` and `[FAIL]` gate result is visible
- No more silent 15-minute pauses where you don't know what's happening

This was implemented by replacing the direct `& powershell` call with `Start-Process -PassThru -RedirectStandardOutput` and streaming the temp file while the process runs.

---

## Complete Session Handoff Checklist

Before ending any session that used the orchestrator:

1. `git add -A; git commit -m '[description]'; git push` — commit everything
2. `npx vercel deploy --prod` — deploy to production
3. Check manifest status: `Get-Content library-manifest.yaml | Select-String "status:"`
4. Note which queues completed, which failed, which are pending
5. Write new queue files for next session's work
6. Update `library-manifest.yaml` with new queue entries
7. Copy new queues to library folder
8. Record in SESSION_STATE.md what was built, what remains

---

## Permanent Rules (Never Violate)

1. **FORGE projects folder governance sync before every launch** — DIRECTIVE-016
2. **Never put Supabase migrations inside FORGE prompts**
3. **Every prompt reads files before writing code**
4. **Minimum 150-200 lines enforced per agent file**
5. **Every queue's last prompt deploys to Vercel**
6. **Every Claude Code session ends with governance doc update**
7. **FORGE queue format: flat `prompts:` list, never `phases:` key**
8. **Answer `n` to Vercel CLI upgrade prompts — v51.7.0 is canonical**
9. **`git clean -fd` after every rollback — not just `git reset --hard`**
10. **`$env:ANTHROPIC_API_KEY=$null` forces Max subscription billing**
