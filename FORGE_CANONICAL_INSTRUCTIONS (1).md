# FORGE — Canonical Operational Instructions v2.0
## Supersedes: FORGE_CANONICAL_INSTRUCTIONS.md v1.0
## Date: July 17, 2026
## Status: CANONICAL — Read this before writing any queue, prompt, or FORGE instruction.
## Authority: Applies to all FORGE projects. Never violate any rule in this document.

---

## 1. The Two FORGE Systems

### FORGE 1.x (Production Build Tool)
- **Location:** `C:\Users\manag\Documents\FORGE\forge.ps1`
- **Purpose:** Autonomous overnight build orchestrator for all SaaS projects
- **How it works:** Reads `queue.yaml`, feeds each prompt to Claude Code via `claude -p`, runs quality gates, auto-commits on pass
- **Queue path:** `C:\Users\manag\Documents\FORGE\projects\{project}\queue.yaml`
- **Status:** Production-ready. Used for Benavora nightly builds.

### FORGE 2.0 (Next-Generation Build System)
- **Location:** `C:\Users\manag\Documents\forge-2\`
- **Purpose:** Advanced orchestrator with enhanced capabilities being built via FORGE 1.x
- **Status:** Built — 21/21 prompts passed clean. Not yet replacing FORGE 1.x for Benavora.

### Claude Code (Execution Worker)
- Claude Code receives one prompt, executes it autonomously, writes files directly to the filesystem
- Has full filesystem access — writes every file to its correct absolute path
- Never prompts the user for input during execution
- All interactive prompts in CC must be pre-answered in the prompt text itself

### This Chat
- Where Claude designs queues, prompts, and architecture
- Never executes builds directly — always via FORGE or CC prompt

---

## 2. FORGE 1.x — Complete Operational Reference

### 2.1 Launch Command (Benavora)
```powershell
cd C:\Users\manag\Documents\FORGE; $env:NODE_OPTIONS="--max-old-space-size=8192"; $env:ANTHROPIC_API_KEY=$null; powershell -ExecutionPolicy Bypass -File .\forge.ps1 -project benavora -startFrom 0
```

**Critical flags:**
- `$env:ANTHROPIC_API_KEY=$null` — MANDATORY. Forces Claude Code onto Max subscription. Omitting this bills the API key.
- `-project benavora` — matches folder name under `C:\Users\manag\Documents\FORGE\projects\`
- `-startFrom 0` — start from prompt index 0. Change to resume from a specific prompt.
- `$env:NODE_OPTIONS="--max-old-space-size=8192"` — prevents OOM on large builds

**dangerouslySkipPermissions:** Run once separately before launching:
```powershell
claude config set -g dangerouslySkipPermissions true
```
Inline `$env:DANGEROUSLY_SKIP_PERMISSIONS=1` NEVER works in PowerShell 5. The config command is the only reliable method.

### 2.2 Queue File Format — Exact Specification

FORGE 1.x uses js-yaml to parse `queue.yaml`. The parser requires this exact format:

```yaml
project: benavora
governance:
- BLUEPRINT_v2.md
- STATE_OF_THE_BUILD.md
- SESSION_STATE.md
- SCHEMA_REGISTRY_v2.md
- STANDING_DIRECTIVES.md
- AGENTS_v2.md
prompts:
- id: fix-001
  name: Short descriptive name without colons
  prompt: "Single line double-quoted string. Use \n for newlines. Use \" for quotes."
  gates:
  - type: compile
  - type: file_exists
    files:
    - src/path/to/file.ts
```

### 2.3 Queue Format — Critical Rules

| Rule | Detail |
|---|---|
| Prompt content | Double-quoted single-line strings with `\n` for newlines. NEVER `\|` block scalars — breaks FORGE and produces 0 prompts found. |
| `phases:` key | NEVER use — causes silent "Found 0 prompts" exit. Always use flat `prompts:` list. |
| Governance list items | NO indentation (`- BLUEPRINT_v2.md` not `  - BLUEPRINT_v2.md`) |
| Prompt list items | NO indentation (`- id:` not `  - id:`) |
| Name field | NEVER include a colon followed by a space — js-yaml reads it as a nested mapping |
| Gates | ALWAYS present on every prompt — mandatory |
| Prompt length | Under 200 words per prompt. Over 200 words causes recovery agent to complete in seconds with no files created. |

### 2.4 Available Gate Types

| Gate | Command | Pass Condition |
|---|---|---|
| `compile` | `pnpm tsc --noEmit` | Exit code 0, zero TypeScript errors |
| `build` | `pnpm run build` | Exit code 0 |
| `lint` | ESLint | Exit code 0 |
| `test` | Playwright specs | Exit code 0 or SKIP if no specs |
| `file_exists` | Checks file paths exist | All listed files present |

**Rules:**
- `compile` gate is mandatory on every prompt that writes TypeScript
- `file_exists` gate is mandatory on every prompt that creates new files
- A prompt without gates passes unconditionally regardless of what was built

### 2.5 The [id] Path Problem — Windows

**Critical Windows limitation:** FORGE 1.x cannot create files with `[id]` in the path. PowerShell treats brackets as wildcards and `Set-Content` fails silently or with an error.

**Workaround:** Pre-create stub files using `[IO.File]::WriteAllText()` with `-LiteralPath` before the FORGE run:

```powershell
$files = @(
  "src\app\api\opportunities\[id]\probability\route.ts",
  "src\app\api\applications\[id]\budget\route.ts"
)
$base = "C:\Users\manag\Documents\benavora"
foreach ($f in $files) {
  $full = Join-Path $base $f
  $dir = Split-Path $full
  if (!(Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  if (!(Test-Path -LiteralPath $full)) { [IO.File]::WriteAllText($full, "export {}") }
  Write-Host "Created: $f"
}
```

Then FORGE prompts write the full implementation into the pre-created stub files.

**Important:** When CC checks if a stub file is empty vs already implemented, it may find existing working code. In that case, treat as already done — never overwrite working implementations.

### 2.6 Governance Document Locations

Two locations — both required:

| Location | Purpose |
|---|---|
| `C:\Users\manag\Documents\benavora\` | Permanent git-tracked record. CC and Vercel reference these. |
| `C:\Users\manag\Documents\FORGE\projects\benavora\` | Runtime context injection. FORGE reads these and injects into every prompt. |

**Governance doc update command (run at end of every session):**
```powershell
$docs = @("BLUEPRINT_v2.md","SCHEMA_REGISTRY_v2.md","FEATURE_REGISTRY_v2.md","INTERACTION_MAPS_v2.md","PRD_v2.md","AGENTS_v2.md","PLATFORM_VISION_ARCHITECTURE.md","CORPORATE_INTELLIGENCE_ARCHITECTURE.md","STANDING_DIRECTIVES.md","TESTING_v2.md","FORGE_CANONICAL_INSTRUCTIONS.md","WORKER_ARCHITECTURE_v2.md")
$src = "C:\Users\manag\Downloads\Recent Downloads"
$repo = "C:\Users\manag\Documents\benavora"
$forge = "C:\Users\manag\Documents\FORGE\projects\benavora"
foreach ($f in $docs) { Copy-Item "$src\$f" "$repo\$f" -Force; Copy-Item "$src\$f" "$forge\$f" -Force }
Copy-Item "$src\queue.yaml" "$forge\queue.yaml" -Force
cd $repo; git add -A; git commit -m "docs: governance update"; git push origin main
```

`queue.yaml` goes to FORGE folder ONLY — never to the repo.

### 2.7 Post-Run Deployment

**GitHub → Vercel auto-deploy is broken.** Every FORGE run must be followed by a manual deploy:

```powershell
cd "C:\Users\manag\Documents\benavora"; npx vercel deploy --prod
```

This is mandatory after every FORGE run that produces code changes. Without it, production stays on the old build.

### 2.8 Git Cleanup After Rollback

After `git reset --hard` always also run:
```powershell
git clean -fd
```
`git reset --hard` does not remove untracked files. `git clean -fd` removes them. Both are required for a complete rollback.

---

## 3. Prompt Engineering Rules — Non-Negotiable

### 3.1 Prompt Density
Every prompt must contain full inline implementations:
- Full function bodies — never signatures only
- Full SQL with all columns, indexes, constraints — never partial DDL
- Absolute file paths — never relative
- Explicit git commands — CC does not auto-commit

Never produce:
- Stubs ("implement as described")
- Read-and-fill instructions ("read the file and add the missing function")
- Compressed summaries
- Shell implementations that pass trivial checks

A prompt that produces real work takes 7-15 minutes to execute. A prompt completing under 3 minutes produced shallow work.

### 3.2 The Read-First Rule
Every prompt that modifies an existing file must start with:
```
Read [filename] completely before writing a single line.
```

Violating this is the single most common cause of broken implementations. CC must verify exact export names, interfaces, and function signatures before use. Never guess.

### 3.3 Commit Discipline
Every prompt must end with explicit git commands:
```
git add -A; git commit -m "feat: [description]"; git push origin main
```

CC does not auto-commit. If the commit command is missing from the prompt, nothing gets pushed.

### 3.4 Governance Update Mandate
Every prompt must end with:
```
Update STATE_OF_THE_BUILD.md: add note "[feature] built [date]."
```

Governance docs must be updated from actual command output — never from memory.

### 3.5 The 200-Word Limit
Prompts over 200 words cause the recovery agent to complete in seconds with zero files created. This is FORGE 1.x's primary failure mode. When a feature requires more than 200 words to specify, split it into multiple prompts.

---

## 4. Claude Code Direct Session Rules

When running CC directly (not via FORGE):

### 4.1 Launch
CC runs in the Claude.ai interface. Always include the project root path in the prompt:
```
Working directory: C:\Users\manag\Documents\benavora
```

### 4.2 Permission
`dangerouslySkipPermissions` must be set globally before launch:
```powershell
claude config set -g dangerouslySkipPermissions true
```

### 4.3 One File Per Session
For UI changes: one component per CC session. Read → rewrite → verify visually → commit. Never batch UI changes across multiple components in one session.

### 4.4 Never Trust CC's Deployment Claims
CC's deployment confirmation claims have been wrong repeatedly. Always verify via:
```powershell
cd "C:\Users\manag\Documents\benavora"; git log --oneline -3
```
Then check if Vercel deployed by searching for the specific change in the browser's DevTools Network → Response tab.

---

## 5. Benavora-Specific Rules

### 5.1 Design System
All colors, backgrounds, shadows, and borders use inline `style={{}}` with hardcoded hex values in JSX. Never CSS variables or Tailwind color classes. The compatibility layer in `globals.css` overrides class-based colors with `!important`.

### 5.2 AI Routes
All routes calling Anthropic must include:
```typescript
export const maxDuration = 300;
```
Default 60-second Vercel timeout causes 504 errors on AI completions.

### 5.3 Supabase Management API
- Endpoint: `POST https://api.supabase.com/v1/projects/vbjplpquqxxfbpazyalt/database/query`
- Token: `Bearer sbp_a63596024b79b5964d2dc2971ac9d4cc77a112c1`
- Rejects non-ASCII characters in SQL — use ASCII only
- Split large SQL into separate statements
- `list_migrations` and `execute_sql` MCP tools return permission errors — use REST API

### 5.4 PowerShell 5 Patterns
```powershell
# File write — never corrupts encoding
[IO.File]::WriteAllText($path, $content)

# File read
[IO.File]::ReadAllText($path)

# Create file in path with brackets
[IO.File]::WriteAllText($full, "export {}")

# Test path with brackets
Test-Path -LiteralPath $full

# Chain commands (no && in PS5)
git add -A; git commit -m "msg"; git push

# Secret injection (never via pipeline — appends newline)
[IO.File]::WriteAllText("C:\tmp\val.txt", "myvalue")
cmd /c "vercel env add KEY production < C:\tmp\val.txt"
```

### 5.5 Vercel CLI
- Version 51.7.0+ hangs if prompted for upgrade — always answer `n`
- Each `vercel env add` must run individually and be verified via `vercel env ls`
- Sensitive env vars (`--sensitive`) are write-only — blank on `env pull`

---

## 6. What Claude Must Never Do

- Never ask Reid to place files manually
- Never produce stubs or skeleton implementations
- Never write prompts without gates
- Never use `|` block scalar format in queue YAML
- Never use `phases:` key — always flat `prompts:` list
- Never update governance docs from memory — from actual command output only
- Never stack multiple CC prompts in one response — one at a time
- Never give options without a specific recommendation
- Never start a response with agreement or sycophancy
- Never skip the compile gate on prompts that write TypeScript
- Never put file creation inside a prompt that also needs `[id]` in the path
- Never trust CC's deployment confirmation — always verify via git log + browser
- Never run `npm install` inside FORGE prompts — pre-install dependencies before launch
- Never use `&&` in PowerShell 5 — use semicolons
- Never write Tailwind color classes for UI styling — inline style={{}} only
- Never omit `export const maxDuration = 300` on AI routes

---

## 7. Quick Reference Checklist — Before Writing Any Queue

- [ ] Every prompt has `gates:` with minimum `compile` and `file_exists`
- [ ] Prompt content is double-quoted single-line strings with `\n` escapes
- [ ] No `phases:` key — flat `prompts:` list only
- [ ] Governance list items have NO indentation
- [ ] No colons followed by spaces in name fields
- [ ] Every prompt under 200 words
- [ ] Every prompt that modifies existing files starts with "Read [file] completely"
- [ ] Every prompt ends with explicit git add + commit + push
- [ ] Every prompt ends with governance update mandate
- [ ] Files with `[id]` in path are pre-created via PowerShell before FORGE runs
- [ ] `$env:ANTHROPIC_API_KEY=$null` in FORGE launch command
- [ ] `npx vercel deploy --prod` queued to run after FORGE completes
- [ ] Governance docs copied to both repo AND FORGE projects folder
- [ ] Stale v1 governance docs deleted from repo when v2 docs replace them
- [ ] `dangerouslySkipPermissions` set via `claude config set -g` not inline env var

---

## 8. Project Registry

| Project | Repo Path | FORGE Folder | Production URL |
|---|---|---|---|
| Benavora | `C:\Users\manag\Documents\benavora` | `C:\Users\manag\Documents\FORGE\projects\benavora` | www.benavora.com |
| Tarritrix | `C:\Users\manag\Documents\tarritrix` | `C:\Users\manag\Documents\FORGE\projects\tarritrix` | TBD |
| FORGE 2.0 | `C:\Users\manag\Documents\forge-2` | `C:\Users\manag\Documents\FORGE\projects\forge-2` | N/A |

---

## 9. Lessons Learned — Failure History

| Failure | Root Cause | Fix |
|---|---|---|
| FORGE finds 0 prompts | Used `phases:` key instead of `prompts:` | Always use flat `prompts:` list |
| Prompt produces no files | Prompt over 200 words | Keep every prompt under 200 words |
| CC doesn't commit | No git commands in prompt | Always include explicit git add + commit + push |
| Vercel not updated | GitHub auto-deploy broken | Always run `npx vercel deploy --prod` manually |
| `[id]` path file creation fails | PowerShell bracket wildcard issue | Pre-create with `[IO.File]::WriteAllText()` |
| Encoding corruption | PowerShell pipeline appends newline | Use `[IO.File]::WriteAllText()` for all file writes |
| UI changes not visible | Tailwind color classes overridden by compatibility layer | Inline `style={{}}` only |
| Sensitive env vars blank | Vercel write-only for sensitive vars | Rotate with new values via `cmd` stdin redirect |
| dangerouslySkipPermissions fails | Inline env var doesn't work in PS5 | `claude config set -g dangerouslySkipPermissions true` |
| Git rollback incomplete | `git reset --hard` leaves untracked files | Also run `git clean -fd` |
| CC overwrites working code | Didn't read file before writing | Always read file completely before modifying |
| FORGE injects stale context | Governance docs only in repo, not FORGE folder | Copy docs to both locations |
| CC deployment claims wrong | CC reports success but nothing deployed | Always verify via git log + browser DevTools |
| IRS 990 0 matches | EIN column at position 1, parser reading position 0 | Fix: trim headers + use positional index |
| ProPublica 0% hit rate | Wrong endpoint format for EIN lookup | Use `/organizations/EIN.json` format |
| Supabase API rejects SQL | Non-ASCII characters in SQL string | ASCII only in all Management API SQL |
| FORGE reads wrong queue | `-queue` parameter doesn't exist | Always copy to `queue.yaml` exact filename |
| Vercel CLI hangs | Prompts for upgrade interactively | Always answer `n` to upgrade prompts |
