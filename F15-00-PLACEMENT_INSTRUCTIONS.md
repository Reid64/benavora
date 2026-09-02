# F15-00 QUEUE PLACEMENT INSTRUCTIONS

## Files to Download and Place

You have three files ready for download:

1. **F15-00-BASELINE_EVIDENCE.md** — Complete baseline evidence document (observational findings)
2. **F15-00-queue.yaml** — FORGE 1.0 executable queue (implementation prompt)
3. **F15-00-PLACEMENT_INSTRUCTIONS.md** — This file (for reference)

---

## PLACEMENT LOCATIONS

### File 1: F15-00-queue.yaml (The Executable Queue)

**Destination:**
```
C:\Users\manag\Documents\FORGE\projects\tarritrix\F15-00-queue-20260901.yaml
```

**Steps:**
1. Download `F15-00-queue.yaml` from this chat
2. Rename to `F15-00-queue-20260901.yaml` (timestamped format)
3. Place in `C:\Users\manag\Documents\FORGE\projects\tarritrix\`
4. Verify file exists:
   ```powershell
   Test-Path "C:\Users\manag\Documents\FORGE\projects\tarritrix\F15-00-queue-20260901.yaml"
   # Should return: True
   ```

**Verification:**
```powershell
# Check file size (should be ~10KB)
(Get-Item "C:\Users\manag\Documents\FORGE\projects\tarritrix\F15-00-queue-20260901.yaml").Length

# Check YAML is valid (basic)
Get-Content "C:\Users\manag\Documents\FORGE\projects\tarritrix\F15-00-queue-20260901.yaml" | Select-Object -First 10
# Should show: project: tarritrix, github_repo: Reid64/tarritrix, etc.
```

### File 2: F15-00-BASELINE_EVIDENCE.md (Reference Document)

**Destination:**
```
C:\Users\manag\Documents\Tarritrix\docs\F15-00-BASELINE_EVIDENCE.md
```

**Alternative Destinations (if preferred):**
- `C:\Users\manag\Documents\FORGE\projects\tarritrix\docs/F15-00-BASELINE_EVIDENCE.md`
- Project root: `C:\Users\manag\Documents\Tarritrix\F15-00-BASELINE_EVIDENCE.md`

**Purpose:** Reference document for F15-00 findings. Not executed by FORGE, but required for continuity.

---

## REGISTRY / MANIFEST ENTRY

The FORGE system may use a manifest to track queued work. If a manifest exists at:
```
C:\Users\manag\Documents\FORGE\projects\tarritrix\manifest.yaml
```

or similar, add this entry:

```yaml
- unit_id: F15-00
  queue_file: F15-00-queue-20260901.yaml
  name: Repository Freeze / Baseline Evidence
  version: 0.16
  phase: observational
  status: registered
  created_date: 2026-09-01
  scheduled: false
  authority:
    corpus: v0.16
    directive_sections: 1-38
  prerequisites_met:
  - v0.16 corpus discoverable
  - FORGE 1.0 mechanics verified
  - Project governance files intact
  acceptance_gate: block
  next_unit: F15-01
```

If no manifest exists, this is not required. FORGE will discover the queue file directly.

---

## EXECUTION CHECKLIST

After placing files:

**Step 1: Verify Files Exist**
```powershell
$forgeRoot = "C:\Users\manag\Documents\FORGE\projects\tarritrix"
Test-Path "$forgeRoot\F15-00-queue-20260901.yaml"
# Should return: True
```

**Step 2: Validate YAML Format**
```powershell
# Optional: use a YAML linter
Get-Content "$forgeRoot\F15-00-queue-20260901.yaml" | % { Write-Output $_ } | head -20
# Should parse correctly (no JavaScript errors)
```

**Step 3: Copy to queue.yaml (FORGE Picks Up This File)**
```powershell
Copy-Item "C:\Users\manag\Documents\FORGE\projects\tarritrix\F15-00-queue-20260901.yaml" `
          "C:\Users\manag\Documents\FORGE\projects\tarritrix\queue.yaml" `
          -Force

Test-Path "C:\Users\manag\Documents\FORGE\projects\tarritrix\queue.yaml"
# Should return: True
```

**Step 4: Invoke FORGE**
```powershell
cd C:\Users\manag\Documents\FORGE

$env:NODE_OPTIONS="--max-old-space-size=8192"
$env:ANTHROPIC_API_KEY=$null
$env:DANGEROUSLY_SKIP_PERMISSIONS=1

powershell -ExecutionPolicy Bypass -File .\forge.ps1 -project tarritrix -startFrom 0
```

FORGE will:
1. Read `queue.yaml`
2. Parse the `f15-00-001` prompt
3. Feed it to Claude Code
4. Enforce gates (compile, file_exists)
5. Commit on pass
6. Report execution state

---

## WHAT HAPPENS DURING EXECUTION

**Expected Duration:** ~45 minutes

**What Claude Code Will Do (via FORGE):**
1. Read all governance docs (BLUEPRINT.md, AGENTS.md, etc.)
2. Run verification commands (git status, pnpm verify, schema check)
3. Inventory all tables, agents, routes, migrations
4. Create `F15-00-BASELINE_EVIDENCE_REPOSITORY_REPORT.md`
5. Update `STATE_OF_THE_BUILD.md` with F15-00 baseline entry
6. Commit changes to git
7. Report back with baseline evidence

**Expected Outputs:**
- `F15-00-BASELINE_EVIDENCE_REPOSITORY_REPORT.md` (in project root)
- Updated `STATE_OF_THE_BUILD.md` (new entry under ACTIVE BUILD DAG)
- Git commit with message: `[F15-00] Repository baseline evidence complete...`

**Success Criteria (All MUST Pass):**
- ✅ All 6 governance documents verified
- ✅ 94 tables exist (0 drift)
- ✅ 8 Phase 1 agents found (A-01 through A-08)
- ✅ TypeScript 0 errors
- ✅ verify:fast clean
- ✅ F15-00-BASELINE_EVIDENCE_REPOSITORY_REPORT.md created
- ✅ STATE_OF_THE_BUILD.md updated
- ✅ Git status clean

**If Any Gate Fails:**
- FORGE stops at the failing gate
- Writes failure to `LESSONS_LEARNED.md`
- Reports error details
- Will not proceed to F15-01

---

## POST-EXECUTION: REVIEWING RESULTS

After FORGE completes (success or failure):

**Step 1: Check Execution Log**
```powershell
Get-Content "C:\Users\manag\Documents\FORGE\forge_execution.log" | tail -50
# (or whatever log file FORGE writes)
```

**Step 2: Verify Git Commit**
```powershell
cd C:\Users\manag\Documents\Tarritrix
git log --oneline | head -5
# Should show: [F15-00] Repository baseline evidence complete...
```

**Step 3: Review Baseline Evidence Report**
```powershell
cat "C:\Users\manag\Documents\Tarritrix\F15-00-BASELINE_EVIDENCE_REPOSITORY_REPORT.md" | head -50
```

**Step 4: Check STATE_OF_THE_BUILD.md Updated**
```powershell
grep -A 5 "F15-00 BASELINE FREEZE" "C:\Users\manag\Documents\Tarritrix\STATE_OF_THE_BUILD.md"
```

---

## PROCEEDING TO F15-01

**Prerequisites Before F15-01:**

F15-01 can only begin if ALL of these are true:
- [ ] F15-00 executed successfully (all gates passed)
- [ ] F15-00-BASELINE_EVIDENCE_REPOSITORY_REPORT.md created
- [ ] STATE_OF_THE_BUILD.md has F15-00 baseline entry
- [ ] Git commit logged
- [ ] FORGE reports F15-00 acceptance (not blocked)

**If All Prerequisites Met:**
1. Claude will generate `F15-01-queue-20260901.yaml` (Trusted ExecutionContext)
2. Place it in the FORGE queue directory
3. Copy to `queue.yaml`
4. Invoke FORGE again with F15-01 queue
5. Continue the multi-day autonomous build

**If Any Prerequisite Missing:**
1. Review FORGE execution log for failures
2. Address failures (usually governance doc issues or git state)
3. Re-run F15-00 (FORGE can resume from failure point)
4. Confirm all criteria met before proceeding

---

## ESTIMATED SCHEDULE

**F15-00:** ~45 minutes (observational, no code changes)  
**F15-01:** ~2-3 hours (trusted context schema, RLS)  
**F15-02:** ~3-4 hours (contracts, registries)  
**F15-03:** ~4-5 hours (mission/plan runtime)  
**F15-04:** ~5-6 hours (durable workflow)  
**F15-05:** ~4-5 hours (policy/evidence/approval)  
**...continued through F15-18**

Total autonomous build time: **Estimated 60-80 hours** across multiple days.

---

## TROUBLESHOOTING

### YAML Parse Failure
**Symptom:** `0 prompts found` in FORGE output  
**Cause:** Block scalar (`|`) instead of quoted string with `\n`  
**Fix:** Ensure all prompt content is double-quoted with `\n` escapes, never `|` block scalar

### File Not Found
**Symptom:** FORGE cannot locate queue.yaml  
**Cause:** File placed in wrong directory or not copied to queue.yaml  
**Fix:** Verify file at `C:\Users\manag\Documents\FORGE\projects\tarritrix\queue.yaml` exists

### Gate Failure (compile or file_exists)
**Symptom:** FORGE reports "gate failed: compile" or "gate failed: file_exists"  
**Cause:** Expected files not created by Claude Code OR TypeScript errors  
**Fix:** Review execution log, check if governance docs are readable, retry F15-00

### Git Conflict
**Symptom:** FORGE reports "git commit failed"  
**Cause:** Uncommitted changes in working tree before F15-00 starts  
**Fix:** Run `git status` and `git add -A && git commit -m "pre-F15-00 state"` before invoking FORGE

---

## CRITICAL NOTES

1. **Do Not Modify Queue Files:** After placing, do not edit the .yaml file. If changes needed, create a new timestamped version.

2. **Do Not Skip F15-00:** F15-00 is purely observational, but it establishes the baseline. Skipping it makes F15-01+ results unreliable.

3. **One Unit At A Time:** Do not enqueue F15-00 through F15-18 at once. Execute F15-00, verify success, then proceed to F15-01. Each unit depends on the previous unit's acceptance.

4. **Preserve Baseline Failures:** F15-00 documents known failures (CRON-01, A-09, P11.9 auth). These are expected and preserved. Do not fix them during F15-00.

5. **Archive Copies:** Keep timestamped queue files (F15-00-queue-20260901.yaml) as archives. The `queue.yaml` copy is ephemeral and may be overwritten by the next unit.

---

## NEXT STEPS

1. **Download** the three files from this chat
2. **Place** `F15-00-queue-20260901.yaml` in `C:\Users\manag\Documents\FORGE\projects\tarritrix\`
3. **Verify** file exists using PowerShell
4. **Copy** to `queue.yaml` for FORGE to pick up
5. **Invoke** FORGE with the command above
6. **Wait** for execution (~45 minutes)
7. **Review** results and verify all success criteria
8. **Proceed** to F15-01 when ready

---

**Questions or Issues:** Review this document and the F15-00-BASELINE_EVIDENCE.md for context. Both are self-contained and don't require Claude.
