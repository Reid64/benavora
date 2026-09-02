TARRITRIX — SESSION HANDOFF

You are the lead architect for Tarritrix, a programmatic local-SEO SaaS platform for storm-driven trades (roofing/PDR). Three-layer build: this chat (Claude.ai) = planning/architecture/design review; Claude Code (CC) = implementation; FORGE 1.0 (PowerShell orchestrator) = autonomous queue execution against the live repo. Repo: C:\Users\manag\Documents\Tarritrix. Reid is solo founder, self-identifies as junior dev, expects you as master architect and active team member — brutal honesty, no sycophancy, always lead with a recommendation before asking a question, never more than one clarifying round without attempting an answer, one CC/PS prompt per response (never stack), scope discipline against ADHD-driven scope creep.

THERE ARE TWO PARALLEL TRACKS. DO NOT CONFLATE THEM.

TRACK A — REAL BACKEND (live repo, FORGE-executed)
FORGE has been running autonomously since ~1PM 2026-08-02. Real work landed: Google Entity Graph schema + Entity Resolution Agent (first piece of GOOGLE_OPERATIONS_CENTER_MASTER_SPEC.md, in project knowledge), GOC-0 reconciliation complete, five real operator dashboard panels (Penalty Mitigation Shield, AI/Voice Optimization, Content Pipeline Kanban, Governance and Approvals, Directories and Citations), Master Admin Console E2E test coverage, RLS Batch 4 written (24 tables, not yet applied — confirm live before trusting), Portal Map Stacking API. Check STATE_OF_THE_BUILD.md's latest session log first — it should have a fresh entry summarizing all of this, appended just before this handoff.

Known non-issue: ~20 Vercel failure emails are git-triggered auto-deploy hitting a known Stripe module-scope env-read bug (root cause confirmed 2026-08-01). CLI-triggered deploys via the deploy_verify gate (built 2026-08-01) are landing clean — verified via `vercel ls --prod` showing an unbroken string of ● Ready. queue-23's fix-001 (lazy Stripe init) is the still-pending permanent fix. Don't re-diagnose this from scratch — it's understood, just not yet silenced.

Standing rules already hard-won this session, do not relitigate:
- Never use --no-verify in any commit — it caused a real governance-lint deadlock once already.
- Always git push after every commit (mandated in CLAUDE.md).
- Live-verify before writing SQL/assigning IDs — never trust a document's assumed table names or agent numbers; read AGENTS.md/SCHEMA_REGISTRY.md live first.
- Write-first prompt shape for FORGE queues: instruction + content immediately, no narrative preamble in the prompt body (narrative goes in queue-level YAML comments) — a 34-line preamble once caused a build agent to reason itself out of ever writing output.
- Two CC/FORGE sessions must never run concurrently against the same Tarritrix directory.
- Test suite is guarded against writing to production Supabase (tests/helpers/supabase-test-client.ts hard-throws on the prod project ref) — a dedicated test Supabase project is still not provisioned; this is Reid's task, deliberately deferred to a session where he's present.

TRACK B — UI/UX DASHBOARD PROTOTYPE (browser HTML artifacts, NOT committed to the repo, pure design/spec work)
This has been through 7 major iterations (v1–v7), each correcting a real, specific failure the prior one had — read this history before assuming you understand the target, guessing wrong here has cost real time repeatedly:
- v1–v2: too list-heavy, no real chart variety, invented a "Tarritrix design language" that turned out to belong to a different project (Benavora) — do not assume any specific color palette is locked; ask.
- v3–v4: added real chart primitives (gauges, donuts, treemaps, heatmaps, threshold-bar-charts) after Reid supplied ~19 reference dashboard images and asked for a deep visual audit against them.
- v5: Command Center over-dense with non-operational content (LLM cost, directory treemap) — corrected to operational-only (alerts/cadence/approvals), analytics split into a separate concept.
- v6: a total shell rewrite (flat top-tab nav → left-nav) that discarded ALL prior real content and replaced it with flat tables. Reid called this "the most horrible example" provided — the lesson: a shell/IA change must PORT existing approved content into new homes, never discard and rebuild from scratch.
- v7 (CURRENT): the correct synthesis. Enterprise 12-group left nav per a detailed functional-navigation spec Reid provided (also in project knowledge — look for the Command Center enterprise nav spec and the Social Media Management Integration spec). Groups: Command, Portfolio, Strategy, Production, Automation, Google, Social, Authority, Intelligence, Performance, Operations, Administration. All prior real content ported into correct homes. Command's 10 submenus fully real (Executive Overview = the analytics/KPI layer, separate from Operations Overview). Google group = full GSC (11 sections matching the REAL Search Console report taxonomy — note Mobile Usability was correctly removed, Google retired that report Dec 2023) + full GBP (10 sections matching the REAL Business Profile Performance API field list Reid supplied verbatim). Storm Intelligence, Production's 5 sections (Content Studio houses the module-canvas/governance-approval workflow), Agent Control (full 6-tab orchestration center: Activity/Queue/Coordination Graph/Execution Replay/Logs/Prompt Inspection) — all real, all tested.

A programmatic audit (not eyeballed — actually crawled via headless browser) found: 22 of 55 nav destinations real, 33 honest placeholders (correctly labeled, no fabricated content), and 7 dead buttons in "finished" sections (Approval Queue's 3 Approve buttons, Add Location, Add Service, 2× Create New Page) — none wired to handlers. Client Portal and Master Admin (both fully built in earlier versions) currently have NO entry point in v7's shell — needs a header-level role toggle, not yet built.

MANDATORY PROCESS GOING FORWARD (Reid's explicit instruction, do not skip):
Build page by page, section by section. Before building any new section: ask what's needed, get a real answer, confirm understanding, THEN build — and once built and approved, that page is LOCKED, never silently altered or regressed in a later pass (v6 violated this once already by discarding v5's real work). Always test HTML artifacts programmatically (headless browser click-through, not just visual inspection) before presenting — this has caught multiple real bugs (broken apostrophe escapes crashing the whole script, functions referencing data before it's declared, accidental duplicate consts) that would otherwise have shipped silently. Never present a prototype claiming it works without having actually run it.

IMMEDIATE NEXT STEPS, in order:
1. Fix the 7 dead buttons found in the v7 audit.
2. Resolve the Portfolio→Clients vs. Command→Client Portfolio redundancy (one's placeholder, one's built, same job) before building the placeholder one.
3. Add the Client Portal / Master Admin role-toggle entry point.
4. Continue building the 33 remaining placeholder sections — Social (12th group, full spec already provided), Strategy, and Authority are the most-discussed candidates for next, but confirm priority with Reid rather than assuming.
5. GBP mobile photo-upload workflow (crew captures job-site photos, 1-2 tap upload, GPS/current-job routing, review queue before publish) was discussed conceptually but never built into any dashboard — still open.
6. Separately: the FORGE run from Track A may still be executing — check its status before starting anything that touches the live repo, and never run two sessions against Tarritrix concurrently.

Ask Reid what he wants to tackle first before doing anything else.
