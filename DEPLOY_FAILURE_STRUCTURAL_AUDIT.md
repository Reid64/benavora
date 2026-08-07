# Deploy Failure Structural Audit

**Date:** 2026-08-07
**Scope:** Two parts. Part 1 is a damage assessment of the overnight/morning window (2026-08-07,
~00:22–09:00 CDT) during which this repo was written to by two things at once: a Claude session
editing `FEATURE_REGISTRY_v2.md` directly, and a detached `chain-forge.ps1` run (PID 15784) executing
14 FORGE queues and auto-committing/pushing after each one. Part 2 is a real, evidence-based Vercel
deploy-failure investigation triggered by that same window, using the same root-cause categorization
method as `BUILD_FAILURE_ROOT_CAUSE_AUDIT.md` (2026-07-29, Railway-focused). Every finding below is
backed by a command actually run this session — git log/diff, Vercel CLI build logs, direct file
reads — not inferred from commit messages or governance docs.

---

## Part 1 — Damage assessment: two concurrent sessions writing to this repo

**Bottom line: no corruption, no overwritten work, no merge conflicts. One real, separate problem was
found — the chain died partway through, silently, around 09:00 — which is not what was asked but is
directly relevant to why this audit exists and is reported in full below.**

### (a) git log — clean linear history, no merges, no force-pushes, no reverted work

`git log --oneline -40` and `git log dc6efd7..HEAD` (34 commits, the full window) show a single,
linear chain with **zero merge commits** (`git log --merges` on this range returns nothing) and
**zero force-push evidence** — `git reflog show origin/main` shows every one of the 34 pushes as a
plain `update by push` (fast-forward), never `forced-update`. Commit timestamps are evenly spaced,
5–30 minutes apart, 00:22:15 through 08:59:41, consistent with one process executing prompts
sequentially — not two processes racing (no sub-minute-apart or out-of-order timestamps anywhere in
the range). Diff sizes are all plausible for real feature work (hundreds of insertions per `feat:`
commit, small doc-only diffs for `docs:`/preflight commits); the one commit with a `0 insertions(+), 0
deletions(-)` diff (`2ea9cd2`, "FORGE chain complete: queue-39-governance-doc-sync.yaml") is
`chain-forge.ps1`'s own unconditional per-queue `git commit` step running against a byte-identical
file (a CRLF/LF-only artifact of the internal `queue.yaml` copy, the same line-ending churn this repo
already warns about elsewhere) — not evidence of a botched merge.

**Conclusion: the two concurrent sessions did not collide on git history at all.** The file-editing
overlap observed earlier (before the chain launched) never resulted in a competing commit stream —
only one chain (the one launched this session, PID 15784) ever actually executed and pushed.

### (b) FEATURE_REGISTRY_v2.md — structurally clean, but 7 rows are now stale relative to the file's own later git history

Structural check: 567 lines, no duplicate numeric or lettered row IDs (`grep -oE "^\| [0-9]+ \|"` /
`^\| [A-Z]+[0-9]+ \|` both return zero duplicates), all 213 numbered table rows have the correct
6-field pipe structure, file ends cleanly (Infrastructure section, not truncated). **No corruption.**

**But real self-contradiction found, not corruption — a consistency gap, and flagged here rather than
silently fixed, per this task's explicit instruction.** The chain's own later prompts built and, in
several cases, live-verified features whose `FEATURE_REGISTRY_v2.md` row was never updated afterward
to reflect it — so the row's own text is now stale relative to that same file's git history:

| Row | Current status text | What actually happened afterward, and when |
|---|---|---|
| #98 Relationship Memory | Still reads **NOT-BUILT** ("`relationship_memory` confirmed absent from production") | Built and live-verified: `81a9388 fix(schema): create missing relationship_memory/relationship_recommendations tables` (02:17) and `732328b test(agents): live-verify relationship_memory holds real AG-18/AG-19 written rows` (02:29). Row #98 has not been touched since the earlier reconciliation commit (`49a8768`, 00:52) that set it to NOT-BUILT — confirmed by walking every commit's diff of this file; only that one commit ever touched row #98's line. |
| #100 Relationship Builder | Still reads **BUILT (unwired)** | `64f9c81 feat(relationship): /funders/[id]/relationship UI wires AG-19 RelationshipBuilderAgent to a real, manual trigger path` (06:23) and `4aaf0ea test(relationship): live-verify AG-19 runs end-to-end via new UI-triggered path` (06:53) gave AG-19 a real, verified call site. The adjacent row #101 (Relationship Builder UI) *was* correctly updated to BUILT and describes this wiring — row #100, the underlying capability's own row, was not. |
| #157 Registry Seed Data | Still reads **NOT-BUILT** ("16 agents seeded" claim false, zero rows) | `69578b4 feat(agents): real agent_registry seed script, replaces dead never-executed seed array` (02:46) built exactly this. Row #159 (Agent Marketplace UI) was correctly updated afterward and explicitly says so ("closing the prior NOT-BUILT correction below"); row #157 itself was never touched again. |
| #92 Corporate Giving DNA | Still reads **PLANNED** | `f03ec99 feat(corporate-intelligence): Corporate Giving DNA per-company profile page (row #92)` (07:19) — never touched in the registry at all (confirmed: row #92 does not appear in the list of rows any commit in this window diffed). |
| #99 Signal Monitoring | Still reads **PLANNED** | `10bf2f6 feat(relationship): Signal Monitoring — news + 990 watching only, LinkedIn explicitly deferred pending sign-off (registry #99)` (06:10) — never touched in the registry. |
| #116 One-Click Proposal Package | Still reads **PLANNED** | `a471198 feat(proposal-factory): One-Click Proposal Package orchestration (row #116), honest partial-failure handling` (08:25) — never touched in the registry. |
| #120 Corporate Outreach UI | Still reads **PLANNED** | `ce0d2fd feat(outreach): true per-prospect batch personalization in Corporate Outreach composer (row #120)` (07:10) — never touched in the registry. |
| #160 Agent Log Viewer | Still reads **PLANNED** | `2ed3983 feat(agents): build Agent Log Viewer, real per-agent agent_runs history` (03:06) — never touched in the registry. |

For contrast, rows the chain *did* correctly close the loop on: #85, #86, #97, #101, #133, #141, #142,
#144, #145, #146, #159 all show current, internally-consistent BUILT status matching their commits.
**Root cause: inconsistent, not systemic — some `verify`-phase prompts in each queue update the
registry row as their last step, some don't.** This is a real, fixable documentation gap, not repo
corruption and not evidence of the two sessions overwriting each other — **left unfixed here per this
task's instruction not to silently correct it; flagging for a follow-up doc-sync pass** (queue-39's
own governance-sync pattern, run again, would catch and fix all 8 rows above in one pass).

### (c) Queue files 26–39 — all present once, valid, no duplicates

All 14 files (`queue-26-relationship-memory-fix.yaml` through `queue-39-governance-doc-sync.yaml`)
exist exactly once in `C:\Users\manag\Documents\FORGE\projects\benavora\`, each parses as valid YAML
(re-verified this session via `js-yaml`), and a `grep` for every `- id:` across all 14 files found
**zero duplicate prompt IDs**. No `queue-26b`, no `-v2` variant, no alternate competing version from
the other session was found anywhere on disk. Clean.

### (d) Suspiciously small/empty commits

Covered under (a) — exactly one 0/0-diff commit, explained (line-ending-only churn in the chain
script's own unconditional per-queue commit, not a botched auto-merge). No other anomalies found.

### Extra finding, not asked for but load-bearing for interpreting everything else: the chain died at 09:00, unattended, and never restarted

`Get-Process -Id 15784` returns nothing — the launched chain process is no longer running, and no
`powershell.exe`/`node.exe` process of any kind is currently alive on this machine. The chain's own
log (`chain_benavora_2026-08-07_01-49-35.log`) and the stdout redirect
(`chain_benavora_launch_stdout3.log`) both stop mid-prompt at **09:00:20**, on `q33-005` ("Live-verify
the One-Click Package and Gap Analyzer trio"), the final `verify` prompt of queue-33 — no PASS/FAIL
gate line, no "queue complete," nothing after. Queues 34–39 (Board Advisor/Command Center,
Reputation/Graph UI, Knowledge/RAG/Forecast/Trend, Speculative Phase 3-5, Testing/Hardening — the
majority of the originally-launched work) **never ran**. Seven uncommitted scratch files
(`scripts/.tmp-q33-*.mjs`/`.json`/`.txt`) are still sitting in the working tree, left by the
in-progress verify prompt at the moment it was killed.

**Likely cause, not certain but well-correlated:** Windows `Application` event log shows
`Microsoft-Windows-RestartManager` warnings at 09:08:30 and 09:48:28 attempting to close/restart
several unrelated user applications (Excel, Word, SDXHelper) — the signature of a Windows Update
preparing to apply a patch, which forcibly terminates running user-session processes. `(Get-CimInstance
Win32_OperatingSystem).LastBootUpTime` still shows 2026-07-22 (no actual reboot has happened), so this
wasn't a full restart — more likely a session-level process purge tied to the same update cycle. This
is an OS-level interruption, not a bug in the chain, and not related to the two-concurrent-sessions
question this Part 1 was asked to investigate — but it means **the "let it run for days" chain from the
prior task is not currently running**, and 6 of its 14 queues (43% of the planned work) are still
outstanding. Relaunching was not done here since it wasn't part of Step 1's ask — flagging for a
deliberate decision on whether/how to resume, separate from this audit.

---

## Part 2 — Vercel deploy failure investigation

### (a) Config files, read in full

**`vercel.json`** — no `build`/`installCommand` overrides (defaults to `next build`/`pnpm install`),
no `ignoreCommand`, no ESLint/type-check bypass flags. Defines per-route `functions.maxDuration`
(60s default agents routes, 300s for AI/reputation/simulate/onboarding, 120s cron), 6 `crons`, and 3
security headers. Nothing here disables or weakens the build's own lint/type gate.

**`railway.json`** — `worker/Dockerfile`, `watchPatterns` scoped to `worker/**` plus a handful of
`src/lib/` paths the worker actually imports (autoapply, supabase, donor-discovery, one enrichment
file, env.ts, types), `restartPolicyType: ON_FAILURE` with 10 retries. Unrelated to the Vercel failure
below — Railway watches a narrower path set specifically so it doesn't rebuild on every Next.js-only
change, and none of this session's chain commits touched worker code.

**`package.json`** — `"build": "next build"` (plain, no custom pre-build step), `"engines": {"node":
">=18.18.0"}` (no upper bound), Next.js `^14.2.13` / React `^18.3.1` / TypeScript `^5.6.2`, 54
`dependencies` + 23 `devDependencies`. No `postinstall`/`prepare` script anywhere — confirmed by
direct grep, not just absence-of-mention. Notably, `playwright`/`playwright-extra`/
`puppeteer-extra-plugin-stealth`/`camoufox-js`/`@sparticuz/chromium-min` are all in `dependencies`
(not `devDependencies`), but a repo-wide grep of `src/app/api/` found **zero** static or dynamic
imports of any of them — they're pure dead weight for the Vercel bundle (used only by `worker/` and
test files), inflating install size but not implicated in the actual failure found below.

### (b) Structural comparison against Tarritrix and afs-website

| | benavora | Tarritrix | afs-website |
|---|---|---|---|
| `.husky` / git hooks | **none** (`.git/hooks/` has no active, non-`.sample` hooks) | Real: `pre-commit` runs `pnpm verify:fast` (`tsc --noEmit && vitest run` + 10 custom `verify-*.ts` scripts); separate `commit-msg` hook | **none** |
| CI-on-push (`.github/workflows`) | Both workflows (`daily-tests.yml`, `deploy-check.yml`) are `schedule`/`workflow_dispatch` only — **neither runs on `push` or `pull_request`** | n/a (not checked — out of this task's scope) | No `.github/workflows` directory at all |
| A workflow that would have caught this class of bug | **Yes — already exists, unused.** `deploy-check.yml` runs `pnpm build` (the exact failing step) end-to-end, but is `workflow_dispatch`-only | `verify:ci` (not `verify:fast`) includes `pnpm build`; used for actual CI, not local pre-commit | none |
| `vercel.json` build override | none (default `next build`) | not checked | `buildCommand: "pnpm run build"` (equivalent — explicit, but same command) |

**Real, useful nuance, not glossed over: Tarritrix's pre-commit hook would *not* have caught this
specific bug either.** `verify:fast` runs `tsc --noEmit` (a type-checker, doesn't run ESLint) plus
project-specific content-linters — it does not run `pnpm build` or `eslint` directly; only
Tarritrix's separate `verify:ci` (CI-only, not a local hook) does. So the presence/absence of a husky
hook is not, by itself, the deciding factor for *this* failure — what actually matters, isolated
below in (c)/(d), is that **nothing in benavora's pipeline, local or remote, ever runs the equivalent
of `next build`'s lint pass before code reaches production.** `afs-website` has neither hooks nor
workflows either, matching benavora, not Tarritrix — this appears to be a Tarritrix-specific hardening
pass (it has its own `AUDIT_2026-05-14.md`/`BEHAVIORAL_CONTRACTS.md`), not something all of Reid's
other projects have and benavora uniquely lacks.

### (c) Real Vercel deployment history and root-cause categorization

**Data-access note:** the connected Vercel MCP is authenticated to an unrelated account
("steveharyckis-projects") — `list_deployments` returned `403 Forbidden` against benavora's real team
(`reids-projects-b3405b97`). Fell back to the Vercel CLI (`vercel ls` / `vercel inspect --logs`),
which **is** correctly authenticated (`vercel whoami` → `reid-9664`) — same working-path substitution
this project's prior sessions have used for MCP-account mismatches elsewhere (Supabase had the
identical problem).

**Real counts, pulled via `vercel ls benavora --scope reids-projects-b3405b97`, most-recent-first:**
- **25 consecutive `Error` Production deployments**, spanning roughly 00:59–08:59 (the entire
  duration this window's commits were pushed), each taking almost exactly **2 minutes** — a signature
  of a consistent, deterministic failure (not flaky/random), not the ~3-5 minute duration of the
  `Ready` deployments before and after this window.
- Immediately before that (9h+ ago at the time of checking, i.e. before this session's chain started
  its later commits): a clean run of `Ready` deployments, several per hour, most 2–5 minutes.
- Further back (3–4 days ago, sampled): **100% `Ready`**, no errors found in that sample at all.
- **The failure streak is bounded exactly to this session's chain-execution window** — it starts, has
  never recovered, and (per Part 1) the chain that would have kept pushing into it has since died.

**Root cause, confirmed by reading two build logs directly (most recent deployment, commit `ac12b0a`,
and the earliest failing one in the streak) — identical in both:**

```
./src/app/(dashboard)/agents/marketplace/[agentId]/page.tsx
47:7  Error: 'errorBoxStyle' is assigned a value but never used. Allowed unused vars must match /^_/u.  @typescript-eslint/no-unused-vars
...
Error: Command "pnpm run build" exited with 1
```

This is a genuine ESLint `no-unused-vars` violation — Next.js 14's production `next build` runs
ESLint as a build-blocking step by default, and this repo's `pnpm run build` does not skip it. The
line is still present in the current working tree (`grep -n errorBoxStyle` confirms it, unchanged).
It was introduced by `b1a91dd`/`2ed3983` (queue-27, Agent Marketplace UI, ~02:58–03:06) and has never
been fixed since — every one of the ~25 subsequent commits re-triggered a fresh Vercel deploy of
still-broken code, each failing at the identical line, for the identical reason.

**Categorized per `BUILD_FAILURE_ROOT_CAUSE_AUDIT.md`'s scheme:** closest to category **(a)
compile error**, but more precisely a **lint error, not a TypeScript type error** — worth stating as
its own sub-case, because it explains why the FORGE chain's own build gates never caught it: every
`build` phase in queue-26 through queue-38 gates on `type: compile`, which this project's convention
(confirmed by reading multiple queue files) runs as `pnpm tsc --noEmit` — `tsc` does not run ESLint,
so a real, build-blocking `next build` failure can pass every one of the chain's own 58 prompt gates
cleanly and still break every subsequent production deploy. Zero deployments this session failed for
categories (b) env/key, (c) dependency install, or (d) infrastructure/billing.

### (d) Structural vs. volume — the real answer, not defaulted to either

**Both, in a specific, evidenced division — not a coin flip between the two framings offered.**

- **The root cause of the failure is a genuine code defect**, not a Vercel/Railway config difference
  between benavora and Reid's other projects. `vercel.json` is clean; the build command is the
  unmodified default; nothing in the config disables or weakens lint. A single unused-variable line
  is why every one of these 25 deploys failed.
- **The reason one bug became 25 failed production deployments instead of 1 is squarely volume/process**,
  and specific to how this session's FORGE chain operates: every commit auto-triggers its own full
  Vercel production deployment (confirmed — docs-only and code commits alike each produced a distinct
  deployment, matching the identical finding in `BUILD_FAILURE_ROOT_CAUSE_AUDIT.md`'s prior Vercel
  section), and the chain pushed 34 commits in ~8.5 hours unattended, with no gate anywhere in that
  pipeline capable of catching a lint-only failure before it reached Vercel.
- **The structural gap that let this happen, stated precisely:** not "benavora is missing something
  its sibling projects all have" (afs-website lacks the same protections and is not obviously worse
  off) — it's that **benavora has a correctly-written fix for exactly this already sitting unused in
  the repo** (`deploy-check.yml` runs the exact failing command, `pnpm build`) and it is wired to
  `workflow_dispatch` only. Per the prior audit, this and the sibling `daily-tests.yml` workflow were
  deliberately detached from `on: push` on 2026-07-17 (commit `8b8c991`) for an unrelated reason (very
  likely to stop redundant/costly runs on every commit) — a reasonable tradeoff at the time that, in
  this specific incident, removed the one gate that would have stopped a real bug from being deployed
  broken 25 times in a row.

**Plain recommendation, not implemented here (out of this task's scope — reporting, not fixing):** (1)
fix the one real line (`errorBoxStyle`, unused) to stop the current bleed; (2) re-point
`deploy-check.yml`'s trigger to `on: push: branches: [main]` — it already does exactly the right
check, it just isn't running when it matters; (3) separately, consider having FORGE's own `type:
compile` gate run `pnpm build` (or at minimum `pnpm lint`) instead of/in addition to bare `tsc
--noEmit` for any prompt touching `src/app/`, since that's the actual gap that let this reach Vercel
at all.
