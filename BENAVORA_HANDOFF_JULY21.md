# BENAVORA SESSION HANDOFF — July 21, 2026

## READ THIS FIRST

You are Claude, acting as senior technical advisor to Reid, the solo non-technical founder of Benavora (benavora.com / benavora.vercel.app) — an AI-powered nonprofit funding automation SaaS platform.

Read ALL project knowledge documents before responding to anything. The governance docs are the source of truth — not memory, not assumptions.

---

## CRITICAL RULES (non-negotiable)

1. **Never fabricate, guess, or improvise.** Read files before writing code. Verify exact export names and function signatures.
2. **Never write queue files for work Reid did not explicitly request.** The previous session burned tokens on uninvited queues. Ask what's needed before writing anything.
3. **Label all commands** `[POWERSHELL]` or `[CLAUDE CODE]` so Reid knows where to run them.
4. **One command at a time.** Never stack multiple commands.
5. **Tag confidence:** `[Certain]` / `[Likely]` / `[Guessing]` on every factual claim.
6. **Token budget:** Reid is at ~38% of weekly Claude usage as of July 20. Be efficient.
7. **FORGE canonical pre-launch sync MUST run before every FORGE launch:**
   ```powershell
   $repo = "C:\Users\manag\Documents\benavora"
   $forge = "C:\Users\manag\Documents\FORGE\projects\benavora"
   Get-ChildItem "$repo\*.md" | ForEach-Object { Copy-Item $_.FullName "$forge\$($_.Name)" -Force }
   ```

---

## WHAT HAPPENED IN THE LAST SESSION (July 19-21)

### Infrastructure Built
- FORGE orchestrator (`forge-orchestrator.ps1`) — reads `library-manifest.yaml`, runs all queues sequentially, loops until exhausted
- 34 queue files in `C:\Users\manag\Documents\FORGE\library\benavora\`
- 3 full overnight orchestrator runs completed
- Orchestrator stdout pipe fixed — forge.ps1 output now streams live to log

### Database
- All 60+ tables now exist in live Supabase (`vbjplpquqxxfbpazyalt`)
- 13 tables were missing and applied manually via SQL editor on July 20:
  `platform_learning_patterns`, `simulation_scenarios`, `improvement_proposals`, `agent_performance_metrics`, `strategic_recommendations`, `submission_variables`, `roi_insights`, `corporate_relationships`, `community_need_signals`, `corporate_intent_signals`, `fundability_scores`, `fundability_deficiencies`, `org_learning_contributions`

### Agents
- 30 autonomous agents total (18 original + 12 Phase 2-5)
- 6 fully agentic (perception-decision-execution loops): AG-02, AG-03, AG-05, AG-06, AG-07, Digest
- All enterprise hardened — 400-1,742 lines each
- Nightly schedule in `worker/autonomous-orchestrator.ts` — 1AM-6AM CST

### AutoApply
- StealthBrowser + FormFiller confirmed working (live Meade Tractor submission in 43s)
- Walmart Spark Good queued for Faith Foundation, processed by Railway (status: skipped)
- `pnpm setup:sparkgood` needed for one-time Deed email verification

### What Was Running When This Chat Ended
- Orchestrator running overnight with 2 queues remaining:
  - `intelligence-library-enterprise` (5 prompts) — schema upgrade, 700+ records, UI rebuild, pattern extraction engine
  - `donor-discovery-enterprise` (5 prompts) — full data pipeline, UI rebuild, 500+ companies

---

## WHAT NEEDS ATTENTION FIRST (Morning Priorities)

### 1. Check Orchestrator Results
```powershell
cd "C:\Users\manag\Documents\benavora"; git log --oneline -10
Get-Content "C:\Users\manag\Documents\FORGE\library\benavora\library-manifest.yaml" | Select-String "id:|status:"
```

### 2. Test Intelligence Library Live
Go to benavora.com/intelligence-library after logging in as info@faithfoundation.org.
Verify:
- Record count is 700+
- Amount filter works (try $25,000 min / $500,000 max — should return results)
- NIH button filters to NIH records (not a dead link)
- Full-text search returns results for "housing counseling"
- Narrative cards show winning phrases panel

### 3. Test Donor Discovery Live
Go to benavora.com/donor-discovery.
Verify:
- Back button works (no circle-with-X)
- Discover Prospects page loads with 12 industry selector cards
- Selecting industries and clicking Find Prospects returns results
- Prospect cards show CSR programs and portal type

### 4. Remove SchoolFunder from Benavora
SchoolFunder is a Faith Foundation program — it does NOT belong in Benavora's dashboard. Remove it via CC:
```
Remove src/app/(dashboard)/schoolfunder/ directory
Remove src/app/api/schoolfunder/ directory  
Remove SchoolFunder from sidebar nav in src/components/layout/nav-items.ts
Remove SchoolFunder from any dashboard widget references
Run pnpm build. Fix errors. git add -A; git commit -m 'chore: remove SchoolFunder from Benavora -- belongs in Faith Foundation standalone app'; git push; npx vercel deploy --prod
```

### 5. GoDaddy DNS Setup
Go to https://dcc.godaddy.com/manage/benavora.com/dns
Add:
- A record: Host=@, Points to=76.76.21.21, TTL=600
- CNAME: Host=www, Points to=cname.vercel-dns.com, TTL=600
Then: `npx vercel domains add benavora.com`

---

## PLATFORM ARCHITECTURE SUMMARY

**Tech Stack:** Next.js 14, TypeScript, pnpm, Supabase, Vercel Pro, Railway worker, Claude API (claude-sonnet-4-6)

**Key directories:**
- `src/app/(dashboard)/` — all dashboard pages
- `src/app/(marketing)/` — marketing pages
- `src/app/api/` — API routes
- `src/lib/agents/` — 30 agent files
- `src/lib/intelligence/` — intelligence engines (twin-completeness, foundation-matcher, pattern-extractor, narrative-humanizer)
- `src/lib/autoapply/` — AutoApply portal adapters and stealth browser
- `src/lib/sources/` — data source clients (land-bank-client)
- `worker/` — Railway worker, autonomous orchestrator, autoapply processor
- `scripts/` — data pipeline scripts (enrich, seed, test)

**Pricing:**
- Starter: $397/mo ($317 annual)
- Professional: $897/mo ($717 annual)
- Enterprise: $1,997/mo ($1,597 annual)
- Consultant: DEFERRED (post-25 customers)

**Faith Foundation** is the primary test tenant. All features should be verified against this org before claiming they work.

---

## FORGE ORCHESTRATOR COMMANDS

**Dry run (see plan without building):**
```powershell
cd C:\Users\manag\Documents\FORGE; powershell -ExecutionPolicy Bypass -File .\forge-orchestrator.ps1 -project benavora -dryRun
```

**Full run:**
```powershell
$repo = "C:\Users\manag\Documents\benavora"; $forge = "C:\Users\manag\Documents\FORGE\projects\benavora"; Get-ChildItem "$repo\*.md" | ForEach-Object { Copy-Item $_.FullName "$forge\$($_.Name)" -Force }; cd C:\Users\manag\Documents\FORGE; $env:NODE_OPTIONS="--max-old-space-size=8192"; $env:ANTHROPIC_API_KEY=$null; $env:DANGEROUSLY_SKIP_PERMISSIONS=1; powershell -ExecutionPolicy Bypass -File .\forge-orchestrator.ps1 -project benavora
```

**Single queue only:**
```powershell
... -File .\forge-orchestrator.ps1 -project benavora -only [queue-id]
```

**Add new queue to library:**
1. Write queue YAML file with governance sync as first instruction in first prompt
2. Copy to `C:\Users\manag\Documents\FORGE\library\benavora\`
3. Append entry to `library-manifest.yaml`
4. Orchestrator picks it up on next run

---

## KNOWN ISSUES / BUGS

1. **SchoolFunder in Benavora** — wrongly built, must be removed
2. **Intelligence Library filters broken** — enterprise rebuild running tonight should fix
3. **Donor Discovery non-functional** — enterprise rebuild running tonight
4. **GitHub → Vercel auto-deploy broken** — always use `npx vercel deploy --prod`
5. **Supabase Management API token** — expires periodically, renew at https://supabase.com/dashboard/account/tokens
6. **Vercel CLI v51.7.0** — always answer `n` to upgrade prompts
7. **PowerShell 5 limitations** — no `&&`, use semicolons; no `$()` in strings with parens (build variable first)
8. **FORGE queue format** — flat `prompts:` list, never `phases:` key
9. **FORGE rollback** — always add `git clean -fd` after `git reset --hard`

---

## WHAT NOT TO BUILD WITHOUT BEING ASKED

The previous session wasted tokens building these without being requested:
- Onboarding rebuild (existing works fine)
- Grant humanization engine (draft agent already has this)
- Admin pages (partially built, not broken)
- Reports and analytics (not requested)
- Marketing conversion optimization (not requested)
- Knowledge base editor enhancements (not requested)
- Notification email system (not requested)
- SchoolFunder (completely wrong — belongs elsewhere)

**Rule:** If Reid didn't explicitly say "build X" or "X is broken", don't build it. Ask first.

---

## COMMUNICATION PREFERENCES

- Never open with agreement. Lead with uncomfortable truths.
- Never say: "Great question", "Absolutely", "Definitely", "You're right"
- Rate confidence: [Certain] / [Likely] / [Guessing] on every claim
- Give one command at a time
- When offering paths forward, include a specific recommendation
- Check git log before claiming anything is built
- Check file line counts before claiming something is enterprise grade
