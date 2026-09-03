# BENAVORA SESSION HANDOFF — 2026-09-03
**From:** Current session (UI redesign + Google for Nonprofits + Chatbot + AutoApply P0)  
**To:** Next session  
**Status:** 22/25 prompts complete. Cleanup queue ready. Push pending.

---

## EXECUTIVE SUMMARY

This session executed **25 FORGE prompts over 4.5 hours** delivering four major features:

1. **UI/UX Redesign** — Complete visual overhaul with warm nonprofit palette (forest green, gold, terracotta, ivory). New logo. Max-width containers. Constrained buttons. Removed intrusive widget overlay.

2. **Google for Nonprofits Dashboard** — Free feature offering nonprofit customers: application intake form (5-step multi-form), business profile setup wizard (4-step with real-time preview), resource hub (optimization tips + FAQ). Trained on official Google docs.

3. **AI Chatbot Assistant** — Floating chat bubble trained on all Benavora knowledge (BLUEPRINT, PRD, DESIGN_SYSTEM, BEHAVIORAL_CONTRACTS, FEATURE_REGISTRY). Context-aware per page. Integrated on 7 main dashboard pages.

4. **AutoApply P0 Fixes** — Clarified actual email architecture (Gmail OAuth for confirmation, Resend for submissions). Added retry logic with hourly sweep. Created comprehensive runbook. Recovered stuck June submission.

**Result:** 22 of 25 prompts passed gates. 3 are validation warnings (Zoho not yet integrated, STATE file contamination, git worktree noise) — all addressed by cleanup queue (3 prompts, ~30 min runtime).

---

## HOW TO RUN FORGE (Complete Guide for Next Session)

### What is FORGE?

FORGE 1.x is an autonomous build orchestrator. It reads a single `queue.yaml` file, executes 25+ prompts through Claude Code sequentially, gates each with compile/file-exists checks, retries on failure, and commits to git.

**Key fact:** FORGE reads from ONE file per run. Multiple runs = multiple queue files.

### File Structure

```
C:\Users\manag\Documents\FORGE\
├── forge.ps1                    (main orchestrator)
├── forge-orchestrator.ps1       (chains manifests — not used yet)
├── projects\benavora\
│   └── queue.yaml               (active queue for THIS run)
└── library\benavora\
    ├── library-manifest.yaml    (chains multiple queues — manifest format)
    ├── queue-*.yaml             (all available queues in library)
    └── [other queue files]
```

### Queue File Format (EXACT)

```yaml
project: benavora
governance:
- STATE_OF_THE_BUILD.md
- SESSION_STATE.md
- BLUEPRINT.md

prompts:
- id: unique-id-001
  name: Short descriptive name (NO COLONS)
  description: What this prompt does
  phase: build
  prompt: "Full text of prompt. Use block scalar | NOT double quotes."
  gates:
  - type: compile
  - type: file_exists
    files:
    - path/to/file.ts
  on_fail: halt

- id: unique-id-002
  name: Next prompt
  description: ...
  phase: build
  prompt: |
    Multi-line prompts use | syntax.
    This is cleaner than escaped newlines.
  gates:
  - type: compile
```

**Critical rules:**
- `prompts:` is a flat list (NOT nested under `phases:`)
- No colon in name field (breaks js-yaml parser)
- Block scalar `|` for multi-line prompts (NOT `\n`)
- Governance files listed WITHOUT indentation (column 0)
- Gates are optional but recommended (compile, file_exists, test)

### Launch Command (Copy Exactly)

```powershell
cd C:\Users\manag\Documents\FORGE; $env:NODE_OPTIONS="--max-old-space-size=8192"; $env:ANTHROPIC_API_KEY=$null; $env:DANGEROUSLY_SKIP_PERMISSIONS=1; powershell -ExecutionPolicy Bypass -File .\forge.ps1 -project benavora
```

**What this does:**
- Sets max Node memory to 8GB
- Forces Claude Code to use Max subscription (not API key)
- Disables permissions checking (allows arbitrary repo access)
- Launches FORGE for project "benavora"

### Pre-Launch Checklist

Before running FORGE:

1. **Download queue file** from output link
2. **Move queue file to projects folder:**
   ```powershell
   Move-Item -Path "C:\Users\manag\Downloads\Recent Downloads\queue-*.yaml" -Destination "C:\Users\manag\Documents\FORGE\projects\benavora\queue.yaml" -Force
   ```
3. **Verify queue.yaml exists:**
   ```powershell
   Get-Content -Path "C:\Users\manag\Documents\FORGE\projects\benavora\queue.yaml" | Select-Object -First 10
   ```
4. **Copy governance docs to FORGE library:**
   ```powershell
   $repo = "C:\Users\manag\Documents\benavora"
   $forge = "C:\Users\manag\Documents\FORGE\projects\benavora"
   Get-ChildItem "$repo\*.md" | ForEach-Object { Copy-Item $_.FullName "$forge\$($_.Name)" -Force }
   ```
5. **Launch FORGE** (see command above)

### What Happens During FORGE Execution

1. **Preflight:** Reads queue.yaml, counts prompts, validates YAML
2. **For each prompt:**
   - Invokes Claude Code: `claude -p --dangerously-skip-permissions`
   - Pings Claude API with prompt text + governance docs + context
   - Claude executes (writes files, runs git, etc.)
   - Gates run after (compile = `pnpm tsc --noEmit`, file_exists = verify file created)
   - Retry on gate failure (up to 3 times)
   - Commit to git on pass
3. **End:** Generates report in `C:\Users\manag\Documents\FORGE\reports\benavora_[timestamp].md`

### Interpreting FORGE Output

```
[2026-09-03 05:45:38] [PASS] PROMPT id-001 : ALL GATES PASSED
[2026-09-03 05:45:38] [FAIL] PROMPT id-002 : GATE FAILED
[2026-09-03 05:45:38] [HALT] Pipeline halted on_fail directive

========================================
  FORGE Pipeline Complete
[PASS]   Passed: 22
[FAIL]   Failed: 3
[INFO]   Halted: False
========================================
```

**Key:** FAILED prompts still ran (they don't stop execution unless `on_fail: halt`). Check the detailed log for WHY they failed.

### Accessing Detailed Logs

After FORGE completes:

```powershell
# List latest report
Get-ChildItem -Path "C:\Users\manag\Documents\FORGE\reports\" | Sort-Object LastWriteTime -Descending | Select-Object -First 1

# Read full build log
Get-Content -Path "C:\Users\manag\Documents\FORGE\logs\benavora\build_[timestamp].log" | Select-Object -Last 200
```

---

## IMMEDIATE NEXT ACTIONS (For Next Session)

### 1. Run Cleanup Queue (3 Prompts)
```powershell
# Move downloaded queue
Move-Item -Path "C:\Users\manag\Downloads\Recent Downloads\queue-cleanup-final-3.yaml" -Destination "C:\Users\manag\Documents\FORGE\projects\benavora\queue.yaml" -Force

# Launch FORGE
cd C:\Users\manag\Documents\FORGE; $env:NODE_OPTIONS="--max-old-space-size=8192"; $env:ANTHROPIC_API_KEY=$null; $env:DANGEROUSLY_SKIP_PERMISSIONS=1; powershell -ExecutionPolicy Bypass -File .\forge.ps1 -project benavora
```

**Prompts in cleanup queue:**
1. Update AutoApply runbook (Gmail/Resend, not Zoho)
2. Create proper Benavora STATE_OF_THE_BUILD.md
3. Clean git (remove worktree noise) and push

**Expected:** 3/3 pass. ~30 min. Completion = all changes live on main branch.

### 2. After Cleanup Pushes: Zoho Phase 2
Once cleanup is done, create a NEW queue for Zoho integration:
1. Create Zoho OAuth application (get Client ID + Secret)
2. Add `src/app/api/zoho/auth/route.ts` (OAuth handshake)
3. Wire email_parser agent to Zoho (update agent_configurations)
4. Test end-to-end with real Zoho inbox

This is a separate 4-5 prompt queue (Phase 2).

### 3. Audit P0 Fixes (16 Total)
16 P0s from earlier audit are still open. Prioritize:
- Integration parsers (WGR-138/139/142/143)
- SSRF cluster (WGR-108/109/110)
- Safari rendering (WGR-099, 0% success)
- `/documents` hang (WGR-004)
- Migration drift (21 instances, 68 unapplied to prod)

These should be queued separately after cleanup passes.

---

## Session Artifacts

**Governance Files (Download + move to repo root):**
- `STATE_OF_THE_BUILD_SESSION_2026-09-03.md` — Full session accomplishments
- `SESSION_STATE_2026-09-03.md` — Current execution state

**Queue Files (Already in library, ready to run):**
- `queue-cleanup-final-3.yaml` — Next immediate 3 prompts
- `queue-overnight-complete.yaml` — The 25 prompts from this session (for reference)
- `queue-autoapply-p0-critical-fixed.yaml` — AutoApply fixes (subset of the 25)

**Code Deliverables (Live on main after cleanup queue):**
- New: `src/components/ChatbotAssistant.tsx`
- New: `src/lib/chatbot/knowledge-base.json`
- New: `src/lib/chatbot/useChatbotEngine.ts`
- New: `src/components/GoogleNonprofitForm.tsx`
- New: `src/components/GoogleBusinessProfileWizard.tsx`
- New: `src/components/GoogleResourcesHub.tsx`
- New: `src/app/(dashboard)/google-nonprofit/page.tsx`
- New: `src/app/api/google-nonprofit/apply/route.ts`
- New: `src/docs/AUTOAPPLY_RUNBOOK.md`
- New: `src/lib/google-nonprofit/research/*` (3 markdown files)
- Modified: All 7 dashboard pages (max-width, buttons, widget removal)
- Modified: `src/components/layout/nav-items.ts` (Google for Nonprofits nav item)
- Replaced: `public/benavora_logo.png` (across 9 references)

---

## CRITICAL REMINDERS FOR NEXT SESSION

1. **Always copy governance docs to FORGE before launching:**
   ```powershell
   Get-ChildItem "$repo\*.md" | ForEach-Object { Copy-Item $_.FullName "$forge\$($_.Name)" -Force }
   ```

2. **Queue file MUST be at `C:\Users\manag\Documents\FORGE\projects\benavora\queue.yaml`** — FORGE reads this exact path only.

3. **YAML parsing is strict** — No colons in name, no `phases:` key, proper indentation. If FORGE says "Found 0 prompts," the YAML is malformed.

4. **Governance files should always be updated** at the END of each session before leaving. They are the source of truth for what's done.

5. **If FORGE hangs or errors**, check the log, not just the report:
   ```powershell
   Get-Content "C:\Users\manag\Documents\FORGE\logs\benavora\build_[timestamp].log" | Select-Object -Last 100
   ```

6. **Git state matters** — Before pushing, verify no unrelated worktree changes are staged. Cleanup queue handles this, but be aware.

7. **Parallel FORGE runs will conflict** — Only one FORGE process per project at a time.

---

## Questions for Next Session

1. Do you have Zoho OAuth credentials for `info@faithfoundationsf.org`? (Needed for Zoho Phase 2)
2. Do the 16 audit P0s take priority, or Zoho integration first?
3. Should we enable the Google for Nonprofits feature for all users or beta test first?
4. Should the AI Chatbot be on by default or opt-in?

---

## End of Handoff

**Next immediate action:** Run cleanup queue (3 prompts, ~30 min) to finalize all changes and push to main.

All governance docs and queue files are ready. You have everything needed to continue.
