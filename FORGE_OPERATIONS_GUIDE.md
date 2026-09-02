# FORGE Operations Guide — Complete Reference

## 1. WHAT IS FORGE?

FORGE is an autonomous AI orchestration engine that runs Claude Code sessions end-to-end without human intervention. It executes pre-written prompts in sequence, handles retries on failure, logs all output, and can be scheduled to run on a timer.

**Key Insight:** FORGE is not a language. It's a launcher for Claude Code sessions that survive between runs. Each FORGE "queue" is a list of prompts that execute linearly (or via orchestrator, in parallel batches). FORGE manages state, logs, exit codes, and deployment.

**Why it exists:** 
- Solo developers can queue 40+ hours of work and walk away
- Work survives Claude API outages (cached on disk between runs)
- No manual "run this, wait 2 hours, copy results, run next" dance
- Deployed code is verified before pushing to production

---

## 2. FILE STRUCTURE & PATHS

### Core FORGE Installation

Location: `C:\Users\manag\Documents\FORGE\`

```
FORGE/
├── forge.ps1                        (main launcher — run this)
├── forge-orchestrator.ps1           (for parallel queues or overnight automation)
├── projects/
│   ├── benavora/
│   │   ├── queue.yaml               (current/default queue)
│   │   ├── queue-*.yaml             (other queues: priority-0-4, autosave, etc.)
│   │   ├── *.md                     (synced governance docs from repo)
│   │   └── logs/                    (FORGE output logs, auto-created)
│   │       ├── 2026-08-26--14-32.log
│   │       └── manifest.yaml        (run summary: status, queue, times)
│   └── [other-project]/
├── lib/
│   ├── orchestrator-library.ps1     (runs multiple queues in sequence/parallel)
│   └── [other supporting scripts]
└── README.md
```

### In Your Repo

Location: `C:\Users\manag\Documents\benavora\`

```
benavora/
├── queue.yaml                       (default queue)
├── queue-fix-priority-0-4.yaml      (RLS, crons, grants, BMF)
├── queue-autosave-email-ux.yaml     (auto-save + email)
├── queue-pil-agents-complete.yaml   (PIL agent families)
├── queue-migrations-reconciliation.yaml (hard migration merge)
├── FORGE_OPERATIONS_GUIDE.md        (this file)
├── STATE_OF_THE_BUILD.md            (synced to FORGE, governance)
├── SESSION_STATE.md                 (synced to FORGE, session notes)
└── [all .md governance docs]        (auto-synced before each FORGE run)
```

---

## 3. QUEUE.YAML FORMAT (The Language)

A queue.yaml file is a flat list of prompts executed sequentially by FORGE.

### Minimal Example

```yaml
prompts:
  - id: "0-rls-fix"
    prompt: |
      Project root: C:\Users\manag\Documents\benavora
      
      TASK: Add RLS policies to sales_campaigns table.
      
      1. Open schema migration file: supabase/migrations/055_sales_campaigns.sql
      2. Add: REVOKE ALL ON sales_campaigns FROM anon;
      3. Verify: grep -n "REVOKE ALL.*sales_campaigns" supabase/migrations/055_sales_campaigns.sql
      4. Commit: git add supabase/migrations/055_sales_campaigns.sql; git commit -m "Add RLS to sales_campaigns"
      5. Deploy: npx vercel deploy --prod
      6. Verify live: test RLS with curl (non-auth request should 403)
    
    expected_output: "Verified RLS applied to sales_campaigns"
    rollback_cmd: "git revert HEAD; npx vercel deploy --prod"

  - id: "1-register-crons"
    prompt: |
      Project root: C:\Users\manag\Documents\benavora
      
      TASK: Register 6 email cron routes in vercel.json.
      
      1. Edit: vercel.json
      2. In "crons" array, add:
         { "path": "/api/cron/email-send-daily", "schedule": "0 9 * * *" }
         { "path": "/api/cron/email-send-weekly", "schedule": "0 9 * * 1" }
         (... add 4 more from src/app/api/cron/email-* routes)
      3. Deploy: npx vercel deploy --prod
      4. Verify: curl https://your-app.vercel.app/api/cron/email-send-daily
         (should return 200, not 404)
    
    expected_output: "All 6 cron routes registered and callable"
    rollback_cmd: "git checkout vercel.json; npx vercel deploy --prod"
```

### Queue File Anatomy

Every prompt must have:
- **id**: Unique string (e.g., "0-rls-fix", "1-register-crons")
- **prompt**: Full, executable Claude Code prompt (include project root path!)
- **expected_output**: What FORGE looks for to confirm success
- **rollback_cmd**: Command to undo if something breaks

Optional:
- **depends_on**: Array of prompt IDs that must complete first (e.g., `["0-rls-fix"]`)
- **parallel**: Boolean (if true, can run alongside other parallel prompts)
- **retry_on_fail**: Boolean or count (e.g., 3 = retry up to 3 times)
- **timeout_minutes**: Kill prompt if it exceeds this (default 120)

### Complex Example (With Dependencies)

```yaml
prompts:
  - id: "autosave-draft-backend"
    prompt: |
      Project root: C:\Users\manag\Documents\benavora
      [... full prompt for auto-save API implementation ...]
    expected_output: "Auto-save API endpoint tested and deployed"
    timeout_minutes: 90

  - id: "autosave-draft-frontend"
    prompt: |
      Project root: C:\Users\manag\Documents\benavora
      [... full prompt for draft UI keystroke listener ...]
    expected_output: "Draft UI auto-saves on keystroke, verified in local dev"
    depends_on: ["autosave-draft-backend"]  # Wait for backend first
    timeout_minutes: 60

  - id: "autosave-all-content"
    prompt: |
      Project root: C:\Users\manag\Documents\benavora
      [... extend auto-save pattern to all user content ...]
    expected_output: "All content types auto-save, integration tested"
    depends_on: ["autosave-draft-frontend"]  # Build on top of draft work
    timeout_minutes: 120
```

---

## 4. CREATING A QUEUE.YAML FILE

### Step 1: Define Your Work Items

Break down the task into discrete prompts. Example for "RLS Security Fixes":

1. Add RLS to sales_campaigns (1 hr)
2. Add RLS to sales_campaign_steps (30 min)
3. Add RLS to sales_sends (30 min)
4. Add anon-revoke to suppression_list (30 min)
5. Test RLS via curl + verify logs (30 min)

### Step 2: Write Prompts

Each prompt must be **self-contained** and include:
- Full project path (e.g., `C:\Users\manag\Documents\benavora`)
- Concrete, step-by-step instructions (not vague)
- Verification commands (show proof it worked)
- Rollback if needed

**Golden Rule:** If a human could run your prompt in Claude Code and finish in the time estimate, the prompt is correct.

### Step 3: Define Dependencies

- If Prompt B needs Prompt A's output, add `depends_on: ["A"]`
- If prompts are independent, no `depends_on` — FORGE can run them in parallel
- Linear sequence = each depends on the previous

### Step 4: Save and Test Locally (Optional)

```powershell
# Syntax check (PowerShell will parse the YAML)
$queue = ConvertFrom-Yaml (Get-Content queue-test.yaml -Raw)
$queue.prompts | ForEach-Object { Write-Host $_.id }
```

### Step 5: Commit to Repo

```powershell
cd C:\Users\manag\Documents\benavora
git add queue-*.yaml
git commit -m "Add queues: priority-0-4, autosave, pil-agents, migrations"
git push
```

---

## 5. LAUNCHING FORGE (Single Queue)

### Basic Launch

```powershell
$repo = "C:\Users\manag\Documents\benavora"
$forge = "C:\Users\manag\Documents\FORGE\projects\benavora"

# Step 1: Sync governance docs to FORGE
Get-ChildItem "$repo\*.md" | ForEach-Object { Copy-Item $_.FullName "$forge\$($_.Name)" -Force }

# Step 2: Launch FORGE
cd C:\Users\manag\Documents\FORGE
$env:NODE_OPTIONS="--max-old-space-size=8192"
$env:ANTHROPIC_API_KEY=$null
$env:DANGEROUSLY_SKIP_PERMISSIONS=1
powershell -ExecutionPolicy Bypass -File .\forge.ps1 -project benavora
```

**What happens:**
1. FORGE reads `projects/benavora/queue.yaml` (or you specify `-queue queue-fix-priority-0-4.yaml`)
2. Executes prompts sequentially
3. Logs all output to `projects/benavora/logs/2026-08-26--14-32.log`
4. Writes manifest with status (success, fail, partial)
5. Returns exit code (0=success, 1=failure)

### Launch Specific Queue

```powershell
cd C:\Users\manag\Documents\FORGE
powershell -ExecutionPolicy Bypass -File .\forge.ps1 -project benavora -queue queue-autosave-email-ux.yaml
```

### Check Results

```powershell
# View latest log
cat C:\Users\manag\Documents\FORGE\projects\benavora\logs\manifest.yaml

# Tail log in real-time
Get-Content "C:\Users\manag\Documents\FORGE\projects\benavora\logs\*.log" -Tail 20 -Wait
```

---

## 6. ORCHESTRATOR: RUNNING MULTIPLE QUEUES

The **orchestrator** runs multiple queues in sequence or parallel, with dependency management and rollback.

### Orchestrator Manifest File (library.yaml)

```yaml
# C:\Users\manag\Documents\benavora\library.yaml
# Orchestrator reads this to decide queue order and parallelization

queues:
  - name: "Priority 0-4 Fixes"
    file: queue-fix-priority-0-4.yaml
    depends_on: []  # Run first
    parallel: false

  - name: "Auto-Save & Email"
    file: queue-autosave-email-ux.yaml
    depends_on: ["queue-fix-priority-0-4.yaml"]  # After Priority 0-4
    parallel: false

  - name: "PIL Agent Families"
    file: queue-pil-agents-complete.yaml
    depends_on: []  # Independent, can run anytime
    parallel: true  # This queue can parallelize internally

  - name: "Migrations Reconciliation"
    file: queue-migrations-reconciliation.yaml
    depends_on: ["queue-pil-agents-complete.yaml", "queue-autosave-email-ux.yaml"]
    parallel: false  # Must run alone, it's resource-intensive
```

### Launch Orchestrator

```powershell
$repo = "C:\Users\manag\Documents\benavora"
$forge = "C:\Users\manag\Documents\FORGE\projects\benavora"

# Sync docs
Get-ChildItem "$repo\*.md" | ForEach-Object { Copy-Item $_.FullName "$forge\$($_.Name)" -Force }

# Launch orchestrator with manifest
cd C:\Users\manag\Documents\FORGE
$env:NODE_OPTIONS="--max-old-space-size=8192"
$env:ANTHROPIC_API_KEY=$null
$env:DANGEROUSLY_SKIP_PERMISSIONS=1
powershell -ExecutionPolicy Bypass -File .\forge-orchestrator.ps1 -project benavora -manifest library.yaml
```

**Orchestrator behavior:**
1. Reads library.yaml
2. Executes queues in dependency order
3. If a queue fails, stops and reports (unless `on_fail: continue`)
4. Runs parallel queues concurrently (up to 4 at once, configurable)
5. Logs aggregate status to `projects/benavora/logs/orchestrator-manifest.yaml`

---

## 7. AUTONOMOUS RUNS (Scheduled/Overnight)

### Via Windows Task Scheduler

Create a .ps1 script that FORGE calls:

```powershell
# C:\Users\manag\Documents\FORGE\run-benavora-overnight.ps1

$repo = "C:\Users\manag\Documents\benavora"
$forge = "C:\Users\manag\Documents\FORGE\projects\benavora"
$timestamp = Get-Date -Format "yyyy-MM-dd--HH-mm"

# Log file for the scheduled run
$logFile = "C:\Users\manag\Documents\FORGE\logs\scheduled-$timestamp.log"

# Sync docs
Get-ChildItem "$repo\*.md" | ForEach-Object { Copy-Item $_.FullName "$forge\$($_.Name)" -Force } 2>&1 | Tee-Object -FilePath $logFile

# Launch orchestrator
cd C:\Users\manag\Documents\FORGE
$env:NODE_OPTIONS="--max-old-space-size=8192"
$env:ANTHROPIC_API_KEY=$null
$env:DANGEROUSLY_SKIP_PERMISSIONS=1

powershell -ExecutionPolicy Bypass -File .\forge-orchestrator.ps1 `
  -project benavora `
  -manifest library.yaml `
  -log $logFile 2>&1 | Tee-Object -FilePath $logFile

# Email results (optional)
$manifest = Get-Content "$forge\logs\orchestrator-manifest.yaml" | ConvertFrom-Yaml
if ($manifest.status -eq "failed") {
  Send-MailMessage -To "you@example.com" -Subject "FORGE Run Failed" -Body "See logs at $logFile"
}
```

### Schedule with Windows Task Scheduler

```powershell
# Create scheduled task (run as SYSTEM, every night at 10pm)
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-ExecutionPolicy Bypass -File C:\Users\manag\Documents\FORGE\run-benavora-overnight.ps1"
$trigger = New-ScheduledTaskTrigger -Daily -At 22:00
Register-ScheduledTask -TaskName "FORGE-Benavora-Nightly" -Action $action -Trigger $trigger -RunLevel Highest
```

### Or: Via GitHub Actions (Cloud)

```yaml
# .github/workflows/forge-nightly.yml
name: FORGE Nightly Build
on:
  schedule:
    - cron: '0 22 * * *'  # 10pm UTC

jobs:
  forge:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run FORGE Orchestrator
        run: |
          cd C:\Users\manag\Documents\FORGE
          $env:ANTHROPIC_API_KEY = '${{ secrets.ANTHROPIC_API_KEY }}'
          powershell -ExecutionPolicy Bypass -File .\forge-orchestrator.ps1 -project benavora -manifest library.yaml
      - name: Upload Logs
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: forge-logs
          path: C:\Users\manag\Documents\FORGE\projects\benavora\logs\
```

---

## 8. LIBRARY SYSTEM (Reusable Components)

The **library** is a PowerShell module of reusable FORGE functions, callable from any queue or orchestrator.

### Structure

```
FORGE/
├── lib/
│   ├── orchestrator-library.ps1          (main library)
│   ├── db-helpers.ps1                    (database utilities)
│   ├── deployment-helpers.ps1            (Vercel/Railway helpers)
│   └── verification-helpers.ps1          (test/validation functions)
```

### Using Library Functions in a Queue Prompt

Library functions are pre-loaded by FORGE before running prompts. Call them in your prompt:

```yaml
prompts:
  - id: "verify-deployment"
    prompt: |
      Project root: C:\Users\manag\Documents\benavora
      
      # Library function is available in this context
      Verify-VercelDeployment -URL "https://benavora.vercel.app" -ExpectedStatus 200
      
      # Or call a custom helper
      Test-RLSPolicy -Table "suppression_list" -ExpectAnon $false
    
    expected_output: "RLS verified: anon cannot access suppression_list"
```

### Writing a Library Function

```powershell
# C:\Users\manag\Documents\FORGE\lib\db-helpers.ps1

function Test-RLSPolicy {
  param(
    [string]$Table,
    [bool]$ExpectAnon = $true
  )
  
  $result = curl -s "https://benavora.supabase.co/rest/v1/$Table?limit=1" `
    -H "apikey: $env:SUPABASE_ANON_KEY"
  
  if ($result -like "*401*" -or $result -like "*403*") {
    if ($ExpectAnon -eq $false) {
      Write-Host "✓ Anon blocked from $Table (correct)"
      return $true
    } else {
      Write-Host "✗ Anon blocked from $Table (expected access)"
      return $false
    }
  } else {
    if ($ExpectAnon -eq $true) {
      Write-Host "✓ Anon can access $Table (correct)"
      return $true
    } else {
      Write-Host "✗ Anon can access $Table (RLS failed)"
      return $false
    }
  }
}

Export-ModuleMember -Function Test-RLSPolicy
```

Then FORGE automatically loads this and makes `Test-RLSPolicy` available in all prompts.

---

## 9. COMMON PATTERNS & GOTCHAS

### Pattern 1: Atomic Commits (All-or-Nothing)

If Prompt A and B must both succeed or both fail:

```yaml
prompts:
  - id: "rls-fix-all"
    prompt: |
      Project root: C:\Users\manag\Documents\benavora
      
      # Do NOT commit yet
      # Make all changes to 4 migration files:
      # - Add RLS to sales_campaigns
      # - Add RLS to sales_campaign_steps
      # - Add RLS to sales_sends
      # - Add anon-revoke to suppression_list
      
      # Verify all 4 in one test
      npm run test -- --grep "RLS.*sales"
      
      # If test passes, commit everything together
      git add supabase/migrations/055*.sql
      git commit -m "Add RLS to all sales tables (atomic fix)"
      git push
    
    expected_output: "All 4 RLS policies added and tested"
    rollback_cmd: "git revert HEAD"
```

### Pattern 2: Progressive Deployment (Staging → Prod)

```yaml
prompts:
  - id: "deploy-staging"
    prompt: |
      [... build and deploy to staging environment ...]
      npx vercel deploy --scope=benavora --alias=staging
    expected_output: "Deployed to https://staging-benavora.vercel.app"

  - id: "test-staging"
    prompt: |
      [... run integration tests against staging ...]
      npm run test:e2e -- --base-url https://staging-benavora.vercel.app
    expected_output: "All e2e tests pass on staging"
    depends_on: ["deploy-staging"]

  - id: "deploy-prod"
    prompt: |
      [... promote staging to prod ...]
      npx vercel promote staging-benavora.vercel.app
    expected_output: "Deployed to production"
    depends_on: ["test-staging"]
```

### Pattern 3: Rollback Cascade

If Prompt A deploys and Prompt B's tests fail, rollback both:

```yaml
prompts:
  - id: "deploy-api"
    prompt: |
      [... deploy new API ...]
      npx vercel deploy --prod
    expected_output: "API deployed to prod"
    rollback_cmd: "npx vercel rollback"

  - id: "test-api"
    prompt: |
      [... test new API ...]
      npm run test:api
    expected_output: "All API tests pass"
    depends_on: ["deploy-api"]
    on_fail: "rollback_all"  # Special: rollback this AND deploy-api
```

### Gotcha 1: Project Root Requirement

Every prompt MUST start with:
```
Project root: C:\Users\manag\Documents\benavora
```

FORGE uses this to set working directory. Without it, relative paths fail.

### Gotcha 2: No `&&` in PowerShell

PowerShell 5 doesn't support `&&`. Use `;` to chain commands:

```powershell
# ✗ Wrong
git add . && git commit && git push

# ✓ Correct
git add .; git commit -m "msg"; git push
```

### Gotcha 3: Exit Codes Matter

If your prompt's last command is `curl` or a test, FORGE reads the exit code:
- Exit 0 = success
- Exit 1+ = failure (FORGE marks prompt as failed, stops queue or retries)

Always end with a successful command:

```powershell
# ✗ Risky (if test fails, exit code is 1)
npm run test:e2e

# ✓ Better (explicitly check and report)
npm run test:e2e
if ($LASTEXITCODE -eq 0) {
  Write-Host "✓ All tests pass"
} else {
  Write-Host "✗ Tests failed"
  exit 1
}
```

### Gotcha 4: Env Vars Are Ephemeral

Each prompt runs in a fresh PowerShell session. Env vars set in Prompt A are NOT available in Prompt B.

If you need to pass data between prompts, write to a file:

```yaml
prompts:
  - id: "get-version"
    prompt: |
      $version = npm list benavora | grep benavora | cut -d: -f2
      Write-Host $version | Out-File -FilePath "C:\temp\version.txt"
    
  - id: "use-version"
    prompt: |
      $version = Get-Content "C:\temp\version.txt"
      Write-Host "Version is $version"
    depends_on: ["get-version"]
```

---

## 10. MONITORING & DEBUGGING

### View Current Status

```powershell
# List all runs for a project
ls C:\Users\manag\Documents\FORGE\projects\benavora\logs\

# Check latest manifest
Get-Content C:\Users\manag\Documents\FORGE\projects\benavora\logs\manifest.yaml
```

### Tail Logs in Real-Time

```powershell
# PowerShell 7+
tail -f C:\Users\manag\Documents\FORGE\projects\benavora\logs\*.log

# PowerShell 5
Get-Content C:\Users\manag\Documents\FORGE\projects\benavora\logs\*.log -Tail 50 -Wait
```

### Run Queue in Debug Mode (Step-by-Step)

```powershell
# Run with verbose logging
powershell -ExecutionPolicy Bypass -File .\forge.ps1 -project benavora -verbose
```

### Rerun Failed Queue

```powershell
# Automatically re-runs from the first failed prompt
powershell -ExecutionPolicy Bypass -File .\forge.ps1 -project benavora -resume
```

---

## 11. RECAP FOR THE NEXT CHAT

**If you're a different chat agent and need to use FORGE:**

1. **Understand the goal**: FORGE runs Claude Code prompts in sequence, survives outages, and deploys code automatically.

2. **Create queue.yaml**: List your prompts with IDs, instructions, and rollback commands. Include project root path in every prompt.

3. **Test locally**: Run one prompt in Claude Code. If it works solo, it works in FORGE.

4. **Sync docs**: Before launching, run the sync command (repo → FORGE projects folder).

5. **Launch**: Use the canonical launch command (single queue) or orchestrator (multiple queues).

6. **Monitor**: Check logs in `projects/benavora/logs/`. If something fails, rollback and fix.

7. **Automate**: Use Windows Task Scheduler or GitHub Actions for nightly runs.

**Key principle:** FORGE is transparent. All prompts, all logs, all results are human-readable. No magic.
