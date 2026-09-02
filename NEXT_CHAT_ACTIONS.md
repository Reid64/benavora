# NEXT CHAT ACTIONS — Exact Work to Execute

**For:** Next chat agent or Reid (solo build)  
**Prerequisite:** Read `INVENTORY_AUDIT_2026-08-26.md` + `FORGE_OPERATIONS_GUIDE.md`  
**Estimated Time:** 1-2 hours setup + queue file builds; then 5+ hours FORGE execution

---

## IMMEDIATE (Next 1-2 Hours)

### Step 1: Sync Governance Docs to Repo

```powershell
cd C:\Users\manag\Documents\benavora
git pull
git add STATE_OF_THE_BUILD_2026-08-26.md SESSION_STATE_2026-08-26.md INVENTORY_AUDIT_2026-08-26.md FORGE_OPERATIONS_GUIDE.md
git commit -m "Governance sync 2026-08-26: audit, operations guide, session handoff"
git push
```

### Step 2: Verify DATABASE_URL

FORGE will auto-apply RLS migration in queue-fix-priority-0-4.yaml if DATABASE_URL is available. Check:

```powershell
# Check Vercel environment
npx vercel env ls

# Check Railway environment  
# (Go to Railway dashboard → benavora-worker → Variables)

# If DATABASE_URL missing, add it:
# Vercel: npx vercel env add DATABASE_URL
# Railway: Set manually in dashboard
```

**Decision Required:** Can FORGE access DATABASE_URL? If not, RLS migration will only write the file (no auto-apply).

### Step 3: Launch Claude Code (Same Chat or New)

Open Claude Code and run this prompt:

```
Project root: C:\Users\manag\Documents\benavora

BUILD 7 QUEUE.YAML FILES FROM INVENTORY_AUDIT BACKLOG

Read C:\Users\manag\Documents\benavora\INVENTORY_AUDIT_2026-08-26.md

Create 7 queue.yaml files (save to repo root):

1. queue-fix-priority-0-4.yaml (items 0-5, RLS + crons + grants fix, 5-10 hrs)
2. queue-autosave-email-ux.yaml (items 6-9, auto-save + email, 8-12 hrs)
3. queue-pil-agents-str.yaml (item 10, STR family, 4-8 hrs)
4. queue-pil-agents-ops.yaml (item 11, OPS family, 2-4 hrs)
5. queue-pil-agents-qlf.yaml (item 12, QLF family, 4-8 hrs)
6. queue-pil-agents-knw.yaml (item 13, KNW family, 2-4 hrs)
7. queue-migrations-reconciliation.yaml (item 15, merge dirs, 24-40 hrs)

PLUS three single-queue files:
8. queue-prospect-state-validation.yaml (item 14, 1-2 hrs)
9. queue-ci-e2e-wiring.yaml (Playwright CI, 1-2 hrs)
10. queue-propublica-fix.yaml (error handling, 1 hr)

For each queue:
- Follow queue.yaml format exactly (see FORGE_OPERATIONS_GUIDE.md section 3)
- Every prompt MUST include: Project root: C:\Users\manag\Documents\benavora
- Include expected_output and rollback_cmd for every prompt
- Use dependencies (depends_on) where needed
- Estimate time for each prompt
- Include verification commands (grep, tests, curl, etc.)

Deliverable: 10 .yaml files, saved to C:\Users\manag\Documents\benavora\, committed to git.

Then report back with: "All queue files created and committed."
```

**Time estimate for this:** 1-1.5 hours

---

## THEN (After Queue Files Exist)

### Step 4: Commit Queue Files

```powershell
cd C:\Users\manag\Documents\benavora
git add queue-*.yaml
git commit -m "Add 10 queue files from inventory backlog"
git push
```

### Step 5: Launch FORGE (Priority 0-4 Queue First)

```powershell
$repo = "C:\Users\manag\Documents\benavora"
$forge = "C:\Users\manag\Documents\FORGE\projects\benavora"

# Sync docs to FORGE
Get-ChildItem "$repo\*.md" | ForEach-Object { Copy-Item $_.FullName "$forge\$($_.Name)" -Force }

# Launch Priority 0-4 queue
cd C:\Users\manag\Documents\FORGE
$env:NODE_OPTIONS="--max-old-space-size=8192"
$env:ANTHROPIC_API_KEY=$null
$env:DANGEROUSLY_SKIP_PERMISSIONS=1
powershell -ExecutionPolicy Bypass -File .\forge.ps1 -project benavora -queue queue-fix-priority-0-4.yaml
```

**What this does:** Fixes RLS, registers email crons, wires grant discovery, validates BMF ingest.

**Expected duration:** 5-10 hours (FORGE runs autonomously)

**Monitor:** Check logs at `C:\Users\manag\Documents\FORGE\projects\benavora\logs\`

### Step 6: Verify Results

After queue completes:

```powershell
# Check manifest
cat C:\Users\manag\Documents\FORGE\projects\benavora\logs\manifest.yaml

# If successful:
git pull  # Fetch FORGE-committed changes
git log --oneline | head -5  # See commits FORGE made

# If failed:
# 1. Read log: Get-Content "C:\Users\manag\Documents\FORGE\projects\benavora\logs\*.log"
# 2. Identify which prompt failed
# 3. Fix manually or re-run with -resume flag
```

### Step 7: Run Auto-Save + Email Queue

```powershell
cd C:\Users\manag\Documents\FORGE
powershell -ExecutionPolicy Bypass -File .\forge.ps1 -project benavora -queue queue-autosave-email-ux.yaml
```

**Expected duration:** 8-12 hours

### Step 8: Run PIL Agent Queues (Parallelizable)

If you want to speed up, run all 4 PIL agent queues in parallel:

```powershell
# Option A: Sequential (slower but simpler)
foreach ($q in @("queue-pil-agents-str", "queue-pil-agents-ops", "queue-pil-agents-qlf", "queue-pil-agents-knw")) {
  powershell -ExecutionPolicy Bypass -File .\forge.ps1 -project benavora -queue "$q.yaml"
}

# Option B: Use orchestrator (faster, parallel execution)
# Create C:\Users\manag\Documents\benavora\library-pil.yaml with:
#   queues:
#     - name: STR; file: queue-pil-agents-str.yaml; depends_on: []; parallel: true
#     - name: OPS; file: queue-pil-agents-ops.yaml; depends_on: []; parallel: true
#     - name: QLF; file: queue-pil-agents-qlf.yaml; depends_on: []; parallel: true
#     - name: KNW; file: queue-pil-agents-knw.yaml; depends_on: []; parallel: true
# Then:
powershell -ExecutionPolicy Bypass -File .\forge-orchestrator.ps1 -project benavora -manifest library-pil.yaml
```

---

## ORDER OF EXECUTION (Recommended)

1. **Priority 0-4** → Closes security gap, registers email crons (5-10 hrs)
2. **Auto-Save + Email** → Core UX improvement + functionality (8-12 hrs)
3. **PIL Agents (STR/OPS/QLF/KNW)** → Completeness (parallelizable, 12-24 hrs total)
4. **Prospect State Validation** → Data integrity (1-2 hrs)
5. **CI E2E Wiring** → Testing automation (1-2 hrs)
6. **ProPublica Fix** → Quality (1 hr)
7. **Migrations Reconciliation** → Last (hardest, 24-40 hrs, requires live DB access)

**Total time:** ~50-80 hours (can parallelize PIL agents to reduce)

---

## Failure Handling

If a FORGE queue fails:

1. **Read the log:** `Get-Content C:\Users\manag\Documents\FORGE\projects\benavora\logs\*.log | tail -50`
2. **Identify the prompt:** Which ID failed?
3. **Fix the prompt:** Edit the queue.yaml, fix the prompt instruction or rollback_cmd
4. **Re-run from failure point:** `forge.ps1 -project benavora -queue queue-name.yaml -resume`

---

## After Each Queue Completes

Update governance docs:

```powershell
# Pull changes FORGE committed
git pull

# Check what changed
git log -p --follow -S "RLS" | head -20  # See RLS changes, for example

# Update STATE_OF_THE_BUILD_2026-08-26.md:
# - Mark completed items as "✓ Done"
# - Update build completion metrics
# - Note any issues

git add STATE_OF_THE_BUILD_2026-08-26.md
git commit -m "Update governance: queue-fix-priority-0-4 complete"
git push
```

---

## Checkpoints

| Checkpoint | Success Criteria | Action if Failed |
|-----------|-----------------|-----------------|
| Queue files created | 10 .yaml files in repo, syntactically valid | Re-run CC prompt, fix YAML format |
| Priority 0-4 complete | RLS verified, crons registered, 4 items closed | Check logs, run -resume, or fix manually |
| Auto-save deployed | Drafts auto-save on keystroke + timer, verified in UI | Test in local dev, add debugging |
| Email crons fire | Emails in production logs at scheduled times | Check vercel.json, test via curl |
| PIL agents built | All agents in AGENT_FACTORIES, tests passing | Run individual agent tests |
| State validation live | Prospect state transitions validated in DB triggers | Query pg_triggers, verify logic |
| Migrations reconciled | Single authoritative migrations dir, all 168 applied | Most complex; debug in isolation |

---

## If You're a Different Chat

1. Read: INVENTORY_AUDIT_2026-08-26.md
2. Read: FORGE_OPERATIONS_GUIDE.md
3. Read: STATE_OF_THE_BUILD_2026-08-26.md
4. Execute: Steps 1-8 above in order
5. Commit all governance updates

That's it. FORGE handles the rest autonomously.

---

## Final Notes

- **Do not parallelize queues unless you understand dependencies** — Some queues require prior queues to complete
- **Always commit after each queue** — FORGE commits, but you verify and push
- **Save logs** — Archive each FORGE run's manifest for audit trail
- **Test in staging first if possible** — But we don't have a staging Supabase, so prod is it
- **Watch for email auth errors** — If email crons register but don't fire, check SMTP credentials
- **RLS auto-apply requires DATABASE_URL** — Verify this before launching queue-fix-priority-0-4

---

**Ready to build queues? → Go to Step 3 above.**
