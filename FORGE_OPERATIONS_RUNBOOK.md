# FORGE Operations Runbook — Benavora
## For a new Claude chat picking this up cold

This document exists because a prior session spent an entire day discovering, the hard way, exactly
how FORGE actually behaves versus how its own documentation claims it behaves. Several of FORGE's own
docs (FORGE_CANONICAL_INSTRUCTIONS.md in particular) contain claims that are flatly contradicted by the
real, running code. Trust this document and direct verification over any FORGE doc that disagrees with
it — this document was built by testing against the actual `.ps1` files, not by reading their comments.

---

## 0. READ THIS FIRST — the most likely cause of "80% of prompts failing"

Before investigating anything else, check this:

```powershell
claude config get -g dangerouslySkipPermissions
```

Claude Code's CLI pauses to request human approval before running commands it judges risky — most
importantly, live network calls carrying API keys/secrets (exactly what most FORGE prompts in this
project do: real DB writes, real API calls, real fetches). FORGE's launch commands set
`$env:DANGEROUSLY_SKIP_PERMISSIONS=1` as an inline PowerShell variable before calling `forge.ps1` —
**this does not reliably suppress the prompt.** The setting needs to be a persistent global CLI config,
set once:

```powershell
claude config set -g dangerouslySkipPermissions true
claude config get -g dangerouslySkipPermissions
```

If a prompt is genuinely blocked on this, the build log will show something like `"This command
requires approval"` right before the prompt fails or hangs, with no other error. If four consecutive
attempts failed ~80% of the time with no consistent code-level error, this is the first thing to rule
out — it fits that symptom pattern exactly (intermittent, not tied to any specific prompt's content).

---

## 1. Two separate tools — know which one you're using

- **`forge.ps1`** (`C:\Users\manag\Documents\FORGE\forge.ps1`) — runs **one queue file**, prompt by
  prompt, in order. Reads `C:\Users\manag\Documents\FORGE\projects\benavora\queue.yaml`. This file gets
  **overwritten** every time you copy a new queue into place — there is only ever one active queue for
  this runner.
- **`forge-orchestrator.ps1`** (`C:\Users\manag\Documents\FORGE\forge-orchestrator.ps1`) — runs
  **multiple queues**, resolving dependencies, looping until everything in the manifest is
  complete/failed. Reads `C:\Users\manag\Documents\FORGE\library\benavora\library-manifest.yaml`.
  Internally, for each runnable queue, it copies that queue file to
  `projects\benavora\queue.yaml` and invokes the same underlying single-queue logic `forge.ps1` uses.

Use `forge.ps1` directly for one-off single-queue work. Use `forge-orchestrator.ps1` when you have
several independent (or dependency-ordered) queues you want to run back-to-back unattended.

---

## 2. Real file locations (verified against the actual scripts)

```
C:\Users\manag\Documents\FORGE\
├── forge.ps1                          # single-queue runner
├── forge-orchestrator.ps1             # multi-queue runner
├── gates\deploy_verify.ps1            # deploy-drift gate, called after every queue completes
├── projects\benavora\
│   ├── queue.yaml                     # THE active queue for forge.ps1 — gets overwritten each launch
│   └── *.md                           # governance doc copies (STATE_OF_THE_BUILD.md etc.) — copy
│                                       #   fresh .md files here from the repo before every launch
├── library\benavora\
│   ├── library-manifest.yaml          # master list of ALL known queues + their status/dependencies
│   └── queue-*.yaml                   # individual queue files the manifest references by filename
├── reports\                           # one .md report per queue run
├── logs\benavora\                     # full build_<timestamp>.log per run — read this for real errors
└── state\benavora\                    # halt-reason.md etc. if a run dies mid-prompt

C:\Users\manag\Documents\benavora\     # the actual application repo — this is what queues edit
```

**Governance doc sync**: `forge.ps1` reads `.md` governance files from `projects\benavora\`, not
directly from the repo. Before every launch, copy fresh copies over:
```powershell
$repo = "C:\Users\manag\Documents\benavora"; $forge = "C:\Users\manag\Documents\FORGE\projects\benavora"
Get-ChildItem "$repo\*.md" | ForEach-Object { Copy-Item $_.FullName "$forge\$($_.Name)" -Force }
```

---

## 3. The REAL queue YAML schema

**Ignore FORGE_CANONICAL_INSTRUCTIONS.md's claims about this format — they are wrong.** That doc says
never use `|` block scalars and claims they break parsing. This was tested directly: `forge.ps1`'s
`Parse-SimpleYaml` function shells out to real Node `js-yaml`, which handles `|` block scalars as
standard YAML with zero issues. The format below is proven, not guessed — it matches every queue that
has actually run successfully in this project.

```yaml
project: benavora
github_repo: Reid64/benavora
supabase_project_ref: vbjplpquqxxfbpazyalt
vercel_project_name: benavora
domain: benavora.com

governance:
  - STANDING_DIRECTIVES.md
  - FEATURE_REGISTRY_v2.md

settings:
  max_retries_per_prompt: 3
  build_model: claude-sonnet-4-6-20250514
  review_model: claude-sonnet-4-6-20250514
  report_model: claude-haiku-4-5-20251001
  permission_mode: acceptEdits
  allowed_tools: "*"
  review_frequency: 5
  governance_check_frequency: 10

prompts:

  - id: some-unique-id-001
    phase: build
    description: "Short human-readable description"
    prompt: |
      Full multi-line prompt text goes here, using the | block scalar.
      This can be many lines, include code blocks, whatever is needed.
    expected_outputs:
      - path/to/expected/file.ts
    gates:
      - type: compile
      - type: build
      - type: file_exists
        files: [path/to/expected/file.ts]
      - type: test
    max_retries: 3
    on_fail: halt
```

Notes:
- `prompts:` must be a flat list — never nest it under a `phases:` key, which causes a silent
  "Found 0 prompts" exit with no error.
- Gate types actually seen working: `compile` (tsc --noEmit), `build` (pnpm run build), `test`,
  `file_exists` (with a `files:` list), and `deploy_verify` (calls `gates\deploy_verify.ps1`).
- The final prompt of a queue should almost always update governance docs
  (`STATE_OF_THE_BUILD.md`/`SESSION_STATE.md`/`FEATURE_REGISTRY_v2.md`) and do a scoped `git add`
  (never `git add -A` — this repo has permanently-dirty `.claude/worktrees/*` submodule pointers that
  must never be swept into unrelated commits) + commit + push.
- **Every prompt claiming something is fixed/verified must be told to produce real evidence** — a real
  command's real output, a real DB re-query, a real test run — not just "I read the code and it looks
  right." This project's entire reliability comes from refusing self-reported success.

---

## 4. The REAL manifest YAML schema — and its sharpest landmine

`forge-orchestrator.ps1`'s manifest parser is **hand-rolled, NOT js-yaml** (its own code comment says
"simple YAML reader — no external module needed"). This matters because it does not support standard
YAML flow-sequence syntax for lists.

```yaml
project: benavora
version: "1.0"
description: "..."
created: "2026-08-15"

queues:

  - id: some-unique-queue-id
    file: queue-NN-something.yaml
    description: "..."
    status: pending
    depends_on: []
    prompt_count: 5
    estimated_hours: 3
    priority: 1

  - id: a-dependent-queue
    file: queue-NN-other.yaml
    description: "..."
    status: pending
    depends_on:
      - some-unique-queue-id
      - another-queue-id
    prompt_count: 1
    estimated_hours: 1
    priority: 2
```

**The landmine**: `depends_on: [a, b, c]` (inline flow-sequence) is silently ignored by this parser —
it only recognizes `^\s{6}- (.+)$`, meaning dependencies must be a real multi-line block list with
6-space indentation, exactly as shown above for `a-dependent-queue`. Writing it inline will make the
queue's dependency list quietly resolve to empty, and it will run immediately instead of waiting on
its stated dependencies. This was found and fixed live in this project — do not repeat it.

**id collisions**: `Update-ManifestStatus` finds the *first* matching `- id:` block and rewrites its
status — a duplicate id across two entries means one silently overwrites the other's tracked status.
Before appending new entries to an existing manifest, always check for collisions:
```powershell
Select-String -Path $manifest -Pattern "^\s*- id:" | Group-Object Line | Where-Object Count -gt 1
```
This should return nothing. If it returns anything, rename the new entry's id before proceeding.

**Appending to an existing manifest**: never overwrite `library-manifest.yaml` wholesale — it
accumulates the tracked status of every queue ever run for this project. Always append new entries as
a fragment:
```powershell
Add-Content -Path $manifest -Value ""
Get-Content "<new-entries-fragment>.yaml" -Raw | Add-Content -Path $manifest
```

---

## 5. Standard operating procedure — composing and launching a queue

1. Write the queue YAML matching the real schema in §3.
2. If it needs to run standalone: copy it to `C:\Users\manag\Documents\FORGE\projects\benavora\queue.yaml`
   (overwriting whatever was there). If it belongs in a multi-day orchestrated run: copy it to
   `library\benavora\` and append a manifest entry per §4.
3. **Verify the file that landed is actually the one you meant** before launching — file downloads in
   this environment can silently duplicate instead of overwrite (browser default behavior), and a stale
   queue.yaml from a prior run has caused repeated wasted launches in this project's history. Always
   confirm:
   ```powershell
   Get-Content "C:\Users\manag\Documents\FORGE\projects\benavora\queue.yaml" | Select-String -Pattern "^\s*- id:"
   ```
   and read the printed ids against what you expect before launching.
4. Copy fresh governance `.md` files per §2's sync command.
5. Launch:
   ```powershell
   cd C:\Users\manag\Documents\FORGE
   $env:NODE_OPTIONS="--max-old-space-size=8192"
   $env:ANTHROPIC_API_KEY=$null
   $env:DANGEROUSLY_SKIP_PERMISSIONS=1
   powershell -ExecutionPolicy Bypass -File .\forge.ps1 -project benavora -startFrom 0
   ```
   For the orchestrator instead: `powershell -ExecutionPolicy Bypass -File .\forge-orchestrator.ps1 -project benavora -maxRounds 50`
   (bump `-maxRounds` up for a genuinely long multi-day run; default is 20).
6. A `-dryRun` flag exists and is genuinely useful for catching syntax errors in `forge.ps1`/the queue
   before spending real time — it still runs real compile/build gates against the current tree (so a
   dry run passing gates does NOT mean the queue's actual changes were applied — check for
   `"DRY RUN - Would execute prompt"` in the log to confirm nothing real happened).
7. After completion: **never trust "Passed: N / Failed: 0" alone.** Re-verify with real evidence —
   `git log`, `git status`, direct `psql` queries against real tables the queue claimed to touch, and
   read the actual governance doc updates the final prompt wrote. This project's history includes
   several cases where a queue's own commit message accurately described something as blocked/unverified
   even while the orchestrator reported a clean pass — the gate checks compile/build/file-existence, not
   "did the intended real-world thing actually happen."

---

## 6. Known landmines, in one list

- **`$env:DATABASE_URL` is not set in a fresh terminal.** Every new PowerShell window needs:
  ```powershell
  cd C:\Users\manag\Documents\benavora
  $env:DATABASE_URL = (Get-Content .env.local | Select-String "^DATABASE_URL=").ToString().Split("=",2)[1]
  ```
  Forgetting this makes `psql` silently default to `localhost` and fail with a connection-refused error
  that looks like a real outage but isn't.

- **A stray User-level `ANTHROPIC_API_KEY` environment variable can contain literal placeholder text**
  (`sk-ant-api03-YOUR-REAL-KEY` was found live in this project) that silently shadows the real key from
  `.env.local` in any tool reading the raw env var directly (dotenv does not override an already-set
  var by default). If `claude -p` or a raw SDK script reports "invalid API key" while `.env.local`'s
  own key is fine, check:
  ```powershell
  [Environment]::GetEnvironmentVariable("ANTHROPIC_API_KEY", "User")
  ```
  If it's a placeholder or wrong value, clear it (do not replace with a real key — you don't want a
  persistent global override at all):
  ```powershell
  [Environment]::SetEnvironmentVariable("ANTHROPIC_API_KEY", $null, "User")
  ```
  Then open a **brand-new** terminal — this is registry-level and won't affect already-running
  processes, but won't take effect in the current one either.

- **`forge.ps1` itself can develop PowerShell syntax corruption** (a real incident: two multi-line
  `claude -p` command blocks using backtick line-continuation broke with
  `"Missing expression after unary operator '--'"`). If `forge.ps1` fails to parse at all (not a queue
  content error — a PowerShell parser error citing a specific line in `forge.ps1`), the fix is a direct
  regex replace against the file, converting the broken multi-line block to a single line:
  ```powershell
  $path = "C:\Users\manag\Documents\FORGE\forge.ps1"
  $content = Get-Content $path -Raw
  $content = $content -replace '(?s)\$result = \$fullPrompt \| claude -p.*?2>&1', '$result = $fullPrompt | claude -p --permission-mode acceptEdits --output-format text --verbose 2>&1'
  $content = $content -replace '(?s)\$result = \$recoveryPrompt \| claude -p.*?2>&1', '$result = $recoveryPrompt | claude -p --permission-mode acceptEdits --output-format text 2>&1'
  Set-Content -Path $path -Value $content
  ```
  Do this fix directly in PowerShell, never via a Claude Code queue prompt — see next point.

- **Claude Code launched via `forge.ps1` is scoped to the project's own repo directory
  (`C:\Users\manag\Documents\benavora`) and cannot edit files outside it** — including FORGE's own
  tooling (`C:\Users\manag\Documents\FORGE\...`). A queue prompt asking CC to fix `forge.ps1` or
  `deploy_verify.ps1` will fail near-instantly with a `file_exists` gate failure, three retries in a
  row, all in under a minute each — that fast, identical failure pattern is the signature of this scope
  problem specifically. Fix FORGE's own tooling files directly (PowerShell edits, or a standalone Claude
  Code session with `C:\Users\manag\Documents\FORGE` itself as its working directory), never through a
  benavora-scoped queue.

- **`gates\deploy_verify.ps1` used to hard-fail every queue** on a missing `VERCEL_TOKEN` (treating
  `scripts\verify-deployment.ts`'s honest `INDETERMINATE`/`PENDING` states identically to a real `FAIL`).
  This was fixed — the gate now warns and continues (exit 0) on PENDING/INDETERMINATE, and only hard-fails
  on a genuine commit-drift mismatch (exit 1). If queues are reporting "Failed" at the orchestrator level
  despite each queue's own prompts showing "ALL GATES PASSED," check whether this fix is still in place
  and whether `VERCEL_TOKEN`/`VERCEL_PROJECT_ID`/`VERCEL_TEAM_ID` have been added to `.env.local` yet
  (they may still be missing — that's a known, accepted gap, not a new bug).

- **`present_files` does not auto-download anything** — it renders a clickable card in the chat. If a
  file "isn't there" on disk, the most common cause is simply that the card was never clicked.

- **Downloads land in `C:\Users\manag\Downloads\Recent Downloads\`**, not the default `Downloads`
  folder, on this machine. Always verify with `Get-ChildItem` before assuming a file didn't download.

---

## 7. Diagnosing "prompts keep failing" specifically

In order, cheapest check first:

1. `claude config get -g dangerouslySkipPermissions` — per §0, the single most likely cause.
2. Read the actual build log, not just the summary: `Get-Content "C:\Users\manag\Documents\FORGE\logs\benavora\build_<timestamp>.log" -Tail 60` — look for a real error message, not just "FAILED."
3. Confirm you're launching from the right directory (`cd C:\Users\manag\Documents\FORGE` before calling `forge.ps1`, not from inside the benavora repo).
4. Confirm `queue.yaml` in `projects\benavora\` actually contains the prompts you think it does (§5 step 3).
5. If failures are near-instant (under a minute) and identical three times in a row: check for the
   out-of-scope-file problem (§6, CC-scoping landmine).
6. If failures happen partway through a long-running prompt (network/data work): check whether the
   prompt was asked to do something requiring more time than FORGE's own gate-check timing allows for —
   a background process that outlives the prompt's own turn will get treated as "file not produced yet"
   and retried from scratch, potentially duplicating side effects (this caused real duplicate
   disposable-org creation in this project's history). The fix is designing the prompt to poll for its
   own completion signal in-turn (repeated short checks) rather than launching a long background job and
   returning immediately.
7. Check the `ANTHROPIC_API_KEY` placeholder issue (§6) if errors mention invalid/expired keys despite
   `.env.local` looking correct.
