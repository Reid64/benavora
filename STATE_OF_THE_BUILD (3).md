# BENAVORA — State of the Build
## Last Updated: July 17, 2026
## Updated by: Reid Whitesides + Claude (senior technical advisor)
## Source: Live codebase audit + session records. Never from memory.

---

## Platform Overview

| Metric | Value |
|---|---|
| Production URL | www.benavora.com / benavora.vercel.app |
| Repository | Reid64/benavora (private) |
| Stack | Next.js 14, Supabase, Vercel Pro, Railway, TypeScript, pnpm |
| Migrations applied | 090 (097 queued for tonight) |
| Database tables | 48 confirmed + 19 queued tonight = 67 total |
| API routes | 208+ |
| Pages | 99+ |
| Build status | PASSING — clean TypeScript compile, 272 pages generated |
| Railway worker | ONLINE (tsc-alias path fix committed fbcc1d0) |
| Vercel auto-deploy | BROKEN — always run `npx vercel deploy --prod` manually |
| GitHub auto-deploy | BROKEN — same issue |

---

## Feature Completion Summary

| Category | Total | Built | Partial | In Build | Planned |
|---|---|---|---|---|---|
| Phase 1 MVP | 18 | 18 | 0 | 0 | 0 |
| Tier 1-3 Enhancements | 21 | 21 | 0 | 0 | 0 |
| Tier 4 Browser Automation | 7 | 7 | 0 | 0 | 0 |
| Tier 5 SaaS Layer | 6 | 6 | 0 | 0 | 0 |
| Tier 6 Full Autonomous | 26 | 17 | 5 | 0 | 4 |
| Platform Vision Pillars | 93 | 8 | 2 | 35 | 48 |
| Data Pipeline | 7 | 1 | 3 | 0 | 3 |
| Testing | 8 | 3 | 0 | 0 | 5 |
| **TOTAL** | **186** | **81** | **10** | **35** | **60** |

**Overall completion: ~44% of total scoped features built.**

---

## Session History

### Initial Build (June 2026) — FORGE 2.0 Phase 3
All Phase 1 MVP features (18) built and deployed. All Tier 1-3 enhancements (21) built. Browser automation (7) built. SaaS layer (6) built.

### Extended Session June 18, 2026 — Claude Code
- Research badge contrast fix
- Cross-provider validation fix (migration 014 applied)
- USASpending.gov integration
- Foundation Finder agent
- Housing-specific scrapers
- Recursive learning verified

### AutoApply Session June 18-19, 2026 — Claude Code
- FormAnalyzerAgent — 11/11 fields verified against Meade Tractor
- FormFillerAgent — real submission confirmed (43 seconds, stealth plugin working)
- StealthBrowser with humanType/humanClick/humanScroll
- 133,812 foundations imported into foundation_directory
- 54,216 foundation websites extracted from IRS 990 XML
- 298,365 nonprofit leads exported to CSV
- Marketing pages deployed (privacy, terms, for-consultants, landing)
- AutoApply database migrations 045-046 applied

### Tier 6 Build Sessions (June-July 2026) — FORGE 1.x
- SAM.gov polling client built
- ProPublica 990 batch enrichment built (never run at scale)
- CSV import wizard built
- Foundation profile builder built
- Success probability scoring built
- Competitor intelligence built
- Semantic funder matching + /research/match page built
- Outreach templates page built
- Follow-up sequences (partial — worker stub only)
- Grant financial reconciliation built (budgets + expenses + reports)
- Compliance calendar built
- Deadline prediction engine built
- Application cloning with AI adaptation built
- Funder relationship scoring built
- White-label consultant portal built
- Notification preferences built
- Board report generator built
- NAICS taxonomy seeded (20 sectors, 308 groups, 1,012 codes)
- Donor Discovery Phases 1-4 built (Places adapter, enrichment, scoring, worker handlers)

### Overnight FORGE Run July 16-17, 2026 — FORGE 1.x
**25 prompts passed, 7 failed (all [id] path Windows limitation — files already existed):**

PASSED:
- fix-001: IRS 990 stream parser EIN column bug fixed
- fix-002: Admin dashboard 404 fixed — /admin page built
- fix-003: Intelligence Library dedup fix applied
- fix-004: Alerts API 500 error fixed
- admin-002: Platform admin metrics API built (/api/admin/platform-metrics)
- intel-001: NIH RePORTER ingestion script built (scripts/ingest-nih-reporter.ts)
- intel-002: NSF Awards ingestion script built (scripts/ingest-nsf-awards.ts)
- intel-003: Federal Register NOFA ingestion script built
- intel-004: SAMHSA/HRSA USASpending ingestion script built
- intel-005: Intelligence Library UI overhaul + proposals API built
- t6-002: SAM.gov polling client built
- t6-003: ProPublica 990 batch enrichment built
- t6-005: CSV import wizard built
- t6-011: Semantic funder matching built
- t6-015: Compliance calendar built
- t6-016: Deadline prediction engine built
- t6-019: White-label consultant portal built
- t6-021: Notification preferences built
- t6-023: Board report generator built
- naics-001: NAICS consumer-friendly UI built (/donor-discovery/discover)
- test-001: Jest unit test foundation built
- test-002: Smoke tests + GitHub Actions daily workflow built
- research-001: Research resource registry data layer built
- research-002: Research resources enterprise 3x7 grid UI built
- final-001: Governance docs updated

FAILED (files already existed with working implementations):
- admin-001: /admin/orgs/[id]/page.tsx — already built
- t6-008: /api/foundations/[id]/profile/route.ts — already built
- t6-009: /api/opportunities/[id]/probability/route.ts — already built
- t6-014: /api/applications/[id]/budget + reconcile — already built
- t6-017: /api/applications/[id]/clone — already built
- t6-018: /api/funders/[id]/relationship — already built
- naics-002: donor-discovery/prospects/[id] routes — already built

### UI Redesign Sessions (July 16-17, 2026) — Claude Code
- FlightPathHUD: 6 colored stage cards working (inline style={{}} confirmed as only working method)
- Dashboard hero banner: "Your Task Management Area" + illustration deployed
- Dashboard layout: two-column, Today's Action Items widget, section trays
- stat cards with colored top bands deployed
- Root cause confirmed: globals.css compatibility layer overrides Tailwind color classes
- Vercel auto-deploy broken discovered — manual `npx vercel deploy --prod` required

### Governance Documentation Session — July 17, 2026
**All architecture documentation rewritten to v2.0:**
- BLUEPRINT_v2.md — master architectural blueprint
- SCHEMA_REGISTRY_v2.md — all 67 tables documented
- FEATURE_REGISTRY_v2.md — 186 features tracked
- INTERACTION_MAPS_v2.md — 60+ user flows mapped
- PRD_v2.md — all 18 pillars with user stories
- AGENTS_v2.md — 30 agents fully specified (AG-01 through AG-30)
- PLATFORM_VISION_ARCHITECTURE.md — 14 net-new pillars architected
- CORPORATE_INTELLIGENCE_ARCHITECTURE.md — full corporate intelligence engine
- STANDING_DIRECTIVES.md — 6 permanent build obligations
- TESTING_v2.md — 10 test types, GitHub Actions, pre-deploy checklist
- FORGE_CANONICAL_INSTRUCTIONS.md — updated with all lessons learned
- WORKER_ARCHITECTURE_v2.md — full nightly agent pipeline documented
- STATE_OF_THE_BUILD.md — this document

---

## Tonight's FORGE Queue (queue-night2-platform-vision.yaml)

**30 prompts targeting Platform Vision Phase 1:**

| Block | Prompts | Target |
|---|---|---|
| Block 1 | mig-001 to mig-005 | 5 database migrations (091-095) |
| Block 2 | prob-001 to prob-003 | Grant Probability Engine (Pillar 5) |
| Block 3 | twin-001 to twin-002 | Organizational Digital Twin (Pillar 6) |
| Block 4 | agents-001 to agents-002 | Agent Marketplace (Pillar 17) |
| Block 5 | disc-001 to disc-002 | Opportunity Discovery Engine (Pillar 2) |
| Block 6 | rep-001 to rep-002 | Reputation Intelligence (Pillar 15) |
| Block 7 | disaster-001 to disaster-002 | Disaster Response Engine (Pillar 10) |
| Block 8 | fke-001 to fke-002 | Funding Knowledge Engine (Pillar 18) |
| Block 9 | ecc-001 | Executive Command Center (Pillar 16) |
| Block 10 | final-002 | Governance update + deploy |

**Pre-run requirement:** All 10 governance v2.0 docs must be copied to FORGE projects folder before launch.

---

## Known Bugs and Blockers

| Bug | Severity | Status |
|---|---|---|
| IRS 990 stream parser EIN column | HIGH | FIXED in last FORGE run (fix-001) |
| Vercel + GitHub auto-deploy broken | HIGH | WORKAROUND: `npx vercel deploy --prod` |
| Duplicate Faith Foundation orgs | MEDIUM | UNRESOLVED — manual dedup needed |
| DATAOCEAN backup never done | CRITICAL | enrichment-output/ not backed up to D:\ |
| .claude/worktrees/ in git | LOW | Add to .gitignore |
| Intelligence Library duplicates | FIXED | Dedup applied (fix-003) |
| Admin page 404 | FIXED | Built in last FORGE run (fix-002) |
| Alerts API 500 | FIXED | Fixed in last FORGE run (fix-004) |
| Follow-up sequences worker | MEDIUM | Stub only — not yet implemented |
| 2Captcha not wired to AutoApply | MEDIUM | captcha-solver.ts exists, not connected |
| Multi-channel outreach incomplete | LOW | LinkedIn/phone/mail not implemented |

---

## Data Pipeline Status

| Script | Status | Records | Notes |
|---|---|---|---|
| pnpm ingest:bmf | NEVER RUN | 0 of 1.8M | Script exists, URL fixed |
| pnpm enrich:990 | FIXED, NOT RUN | 0 matched | EIN column bug fixed in fix-001 |
| pnpm enrich:propublica-batch | BUILT, NOT RUN | 0 of 133K | Script exists, never executed |
| pnpm ingest:nih-reporter | BUILT, NOT RUN | 0 of ~2K | Script built tonight |
| pnpm ingest:nsf | BUILT, NOT RUN | 0 of ~300 | Script built tonight |
| pnpm ingest:federal-register | BUILT, NOT RUN | 0 of ~200 | Script built tonight |
| pnpm ingest:samhsa-hrsa | BUILT, NOT RUN | 0 of ~500 | Script built tonight |
| pnpm seed:dd-aliases | COMPLETE | Unknown | Chunking fix applied |
| 298K prospect CSV import | PLANNED | 0 of 298K | Source: D:\dataocean |
| DATAOCEAN backup | CRITICAL RISK | N/A | Never backed up |

---

## Infrastructure Status

| Service | Status | Notes |
|---|---|---|
| Vercel | DEPLOYED | Manual deploy required after every push |
| Railway Worker | ONLINE | tsc-alias fix committed fbcc1d0 |
| Supabase | ACTIVE | 090 migrations applied |
| GitHub | CONNECTED | Auto-deploy to Vercel broken |
| Stripe | CONFIGURED | 3 subscription tiers active |
| Resend | CONFIGURED | Transactional + campaign email |
| Google Places | CONFIGURED | Key in env vars |
| SAM.gov | CONFIGURED | Key in env vars |
| Anthropic | CONFIGURED | claude-sonnet-4-6 |

---

## Next Priorities (After Tonight's FORGE Run)

1. Run all 5 intelligence ingestion scripts to populate corpus
2. Run `pnpm enrich:propublica-batch` against all 133K foundations
3. Continue UI redesign — one component per CC session
4. Back up enrichment-output/ to DATAOCEAN (D:\) — CRITICAL
5. Fix duplicate Faith Foundation org records
6. Run `pnpm ingest:bmf` for 1.8M nonprofit import
7. Import 298K prospect CSV from D:\dataocean
8. Phase 2 Platform Vision build (nights 3-5)
