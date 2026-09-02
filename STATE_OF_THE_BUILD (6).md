# BENAVORA — STATE OF THE BUILD
**Last Updated:** July 21, 2026  
**Updated By:** Reid + Claude Session (July 19-20 2026)  
**Build Mode:** FORGE Orchestrator Library — autonomous overnight builds

---

## Platform Overview
Benavora is an AI-powered nonprofit funding automation SaaS platform. Stack: Next.js 14, TypeScript, pnpm, Supabase, Vercel Pro, Railway worker, Claude API.

- **Repo:** `C:\Users\manag\Documents\benavora` / GitHub: Reid64/benavora
- **Live URL:** benavora.com (Vercel Pro) + benavora.vercel.app
- **Supabase project:** `vbjplpquqxxfbpazyalt`
- **Railway worker:** `bd9f0c6b-fe01-4f31-9ef7-5fe9d7d0b127`
- **Primary test tenant:** Faith Foundation (`b1ab7402-dfc2-4712-869f-70ea3566cc1d`)

---

## Codebase Metrics (as of July 20, 2026)
- Total source files: ~600+ ts/tsx
- Total lines: ~150,000+
- Database tables: 60+ (see SCHEMA_REGISTRY_v2.md)
- API routes: 100+
- Dashboard pages: 40+
- Agent files: 30 (18 original + 12 Phase 2-5)
- FORGE library queues: 34 files
- Orchestrator runs completed: 3 full runs (July 18, 19, 20)

---

## FORGE Orchestrator Infrastructure (COMPLETE)
- `forge-orchestrator.ps1` — reads library-manifest.yaml, runs all pending queues sequentially
- `library-manifest.yaml` — 34 queue files across all build phases
- `INSTRUCTIONAL_DOC_FOR_ANY_CHAT_ON_ORCHESTRATOR_LIBRARY_USE_WITH_FORGE.md` — canonical guide
- Stdout pipe fix applied: forge.ps1 output streams live to orchestrator log
- OutOfMemoryException fix applied: manifest read uses UTF-8 FileStream
- FileShare::ReadWrite fix applied: temp file accessible while forge.ps1 writes

**Canonical orchestrator launch:**
```powershell
$repo = "C:\Users\manag\Documents\benavora"; $forge = "C:\Users\manag\Documents\FORGE\projects\benavora"; Get-ChildItem "$repo\*.md" | ForEach-Object { Copy-Item $_.FullName "$forge\$($_.Name)" -Force }; cd C:\Users\manag\Documents\FORGE; $env:NODE_OPTIONS="--max-old-space-size=8192"; $env:ANTHROPIC_API_KEY=$null; $env:DANGEROUSLY_SKIP_PERMISSIONS=1; powershell -ExecutionPolicy Bypass -File .\forge-orchestrator.ps1 -project benavora
```

---

## Database — Live Tables (applied July 20, 2026)
All 60+ tables now exist in the live Supabase project. Key tables applied in July sessions:
- `autonomous_triggers`, `agent_queue`, `agent_decisions`, `org_autonomous_config`
- `fundability_scores`, `fundability_deficiencies`
- `corporate_intent_signals`, `community_need_signals`
- `platform_learning_patterns`, `org_learning_contributions`
- `simulation_scenarios`, `improvement_proposals`, `agent_performance_metrics`
- `strategic_recommendations`, `submission_variables`, `roi_insights`
- `corporate_relationships`, `outreach_campaigns`, `outreach_prospects`
- `email_suppressions`, `sending_domains`
- `schoolfunder_students`, `schoolfunder_volunteer_hours`, `schoolfunder_donations` (NOTE: SchoolFunder tables built but should be removed from Benavora — belongs in Faith Foundation standalone app)

See SCHEMA_REGISTRY_v2.md for full table documentation.

---

## Autonomous Agent Pipeline (COMPLETE — Enterprise Grade)

### Phase 1 Agents (Original 18 — All Upgraded to Autonomous + Enterprise Hardened)
| Agent | ID | Lines | Status | Agentic Level |
|---|---|---|---|---|
| OpportunityDiscovery | AG-02 | 1,035 | BUILT | Fully Agentic (perception-decision-execution loop) |
| EligibilityScoring | AG-03 (was AG-02) | 426 | BUILT | Autonomous |
| ProbabilityScoring | AG-03 | 1,200+ | BUILT | Fully Agentic (self-calibrating) |
| DraftGeneration | AG-05 | 1,577 | BUILT | Fully Agentic (5-phase pipeline) |
| RelationshipBuilder | AG-06 | 1,100+ | BUILT | Fully Agentic (multi-hop traversal) |
| DeadlinePrediction | AG-07 | 1,035+ | BUILT | Fully Agentic (pattern learning) |
| FollowUpGenerator | AG-08 | 387 | BUILT | Autonomous |
| EligibilityScoring | AG-09 | 426 | BUILT | Autonomous |
| DeadlineExtraction | AG-10 | 253 | BUILT | Autonomous |
| ComplianceCheck | AG-11 | 271 | BUILT | Autonomous |
| FitAnalysis | AG-12 | 460 | BUILT | Autonomous |
| BudgetBuilder | AG-13 | 393 | BUILT | Autonomous |
| RenewalTracker | AG-14 | 235 | BUILT | Autonomous |
| OutcomeAnalyzer | AG-15 | 241 | BUILT | Autonomous |
| DocumentExpiry | AG-16 | 155 | BUILT | Autonomous |
| KnowledgeGap | AG-17 | 173 | BUILT | Autonomous |
| SearchProfileOptimizer | AG-18 | 227 | BUILT | Autonomous |
| AutonomousDigest | Digest | 300+ | BUILT | Fully Agentic (intelligent curation) |

### Phase 2-5 Agents (New — Enterprise Hardened)
| Agent | ID | Lines | Status |
|---|---|---|---|
| FundabilityScorer | AG-29 | 612 | BUILT — enterprise hardened |
| DonorIntentMonitor | AG-30 | 524 | BUILT — enterprise hardened |
| CommunityNeedPredictor | AG-35 | 410 | BUILT — enterprise hardened |
| LearningNetworkAggregator | AG-36 | 1,742 | BUILT — enterprise hardened |
| SimulationAgent | AG-37 | 506 | BUILT — enterprise hardened |
| SelfImprovementAgent | AG-38 | 777 | BUILT — enterprise hardened |
| ROIOptimizer | AG-39 | 404 | BUILT — enterprise hardened |
| StrategicAdvisor | AG-40 | 760 | BUILT — enterprise hardened |

### Autonomous Hard Limits (Permanent — Enforced in Code)
- `NEVER_SUBMIT_EXTERNALLY` (does not apply to AutoApply — that system has its own approval gate)
- `NEVER_SEND_EMAIL_WITHOUT_APPROVAL`
- `NEVER_DELETE_USER_DATA`
- `NEVER_MODIFY_GOVERNANCE_FILES`
- `MAX_DRAFTS_PER_NIGHT_DEFAULT = 10`
- `MIN_CONFIDENCE_TO_ACT = 60`

### Nightly Schedule (worker/autonomous-orchestrator.ts)
- 1:00 AM CST: OpportunityDiscovery (per org)
- 1:30 AM CST: EligibilityScoring (per org)
- 2:00 AM CST: ProbabilityScoring (per org)
- 2:30 AM CST: FundabilityScorer AG-29 (per org)
- 3:00 AM CST: AutoApply autonomous batch (Enterprise orgs only)
- 3:30 AM CST: DonorIntentMonitor AG-30 (per org)
- 4:00 AM CST: SelfImprovementAgent AG-38 (platform-level, once)
- 4:30 AM CST: CommunityNeedPredictor AG-35 (per org)
- 5:00 AM CST: StrategicAdvisor AG-40 (per org)
- 5:30 AM CST: AutonomousDigest (per org)
- 6:00 AM CST: LearningNetworkAggregator AG-36 (Sundays only, platform-level)

---

## AutoApply System (COMPLETE — Production Grade)
- **StealthBrowser** (`src/lib/autoapply/stealth-browser.ts`) — playwright-extra with stealth plugin, canvas fingerprint randomization, WebGL spoofing, AudioContext noise, 20 Chrome UA rotation pool, human behavior helpers
- **FormAnalyzerAgent** (`src/lib/agents/form-analyzer.ts`) — markup stabilization wait, 11/11 fields verified
- **FormFillerAgent** (`src/lib/agents/form-filler.ts`) — successfully submitted to Meade Tractor in 43 seconds
- **QueueProcessor** (`worker/queue-processor.ts`) — polls `submission_queue` table
- **AutoApplyAutonomousOrchestrator** (`worker/autoapply-autonomous-orchestrator.ts`) — nightly batch at 3:00 AM CST for Enterprise orgs
- **Portal Adapters** (`src/lib/autoapply/portal-adapters.ts`) — CyberGrants, Benevity, Generic
- **2Captcha integration** — for CAPTCHA solving (requires TWOCAPTCHA_API_KEY in env)
- **Walmart Spark Good** — queued for Faith Foundation, processed by Railway worker (status: skipped — likely org readiness gate)
- **DdRequestProcessor bug** — null composite dequeue bug fixed July 20

**IMPORTANT:** AutoApply does NOT violate NEVER_SUBMIT_EXTERNALLY. That hard limit governs the autonomous agent pipeline. AutoApply is a separate purpose-built submission system with its own Enterprise-tier approval gate.

---

## Intelligence Library (PARTIALLY COMPLETE — Enterprise Rebuild Running)
- **Current state:** 113 records, functional UI, draft agent wired
- **Known issues:** filters broken (amount filter uses string comparison not numeric), NIH/NSF/USASpending buttons are dead links not filter toggles, category page links navigate to blank pages, sparse data
- **Enterprise rebuild queued:** `queue-intelligence-library-enterprise.yaml` (5 prompts) — running tonight
  - Schema upgrade: funder_type, ntee_major, persuasive_elements, winning_phrases, full_text_search_vector columns
  - Federal import: USASpending.gov, NIH Reporter, NSF Awards, Grants.gov (400+ records)
  - Foundation import: ProPublica 990, 150 foundation records, 50 corporate (300+ records)
  - Complete UI rebuild: fixed filters, working search, narrative overlay, winning phrases panels
  - Pattern extraction engine: multi-factor matching, Claude synthesis, full intelligence injection into drafts
- **Target after rebuild:** 700+ records, all filters working, NIH/NSF buttons functional

---

## Donor Discovery (SHELL — Enterprise Rebuild Running)
- **Current state:** UI exists but nothing functional. Discover flow does nothing when Continue clicked. Back button broken (circle-with-X). Industry categories sparse or empty.
- **Enterprise rebuild queued:** `queue-donor-discovery-enterprise.yaml` (5 prompts) — pending
  - Audit of broken pieces
  - 500+ company database: Google Places API + 500 hardcoded national companies with CSR programs, portal types, employee matching data
  - Complete UI rebuild: 12 industry selector cards, geography, radius, advanced filters, prospect cards with AutoApply buttons
  - Intent signal seeding: 15 Bay Area signals for Faith Foundation
  - Full integration test

---

## Data Assets
- **IRS BMF:** ~1.97M nonprofit records in `nonprofits` table
- **ProPublica enriched:** ~551K records enriched (as of July 19)
- **990 XML enrichment:** 12 ZIPs processed, 18,021 records updated per ZIP
- **Foundation directory:** 133,812 private foundations in `foundation_directory`
- **Corporate prospects:** sparse (enterprise rebuild pending)
- **Intelligence Library:** 113 records (enterprise rebuild running tonight)
- **Platform Learning Patterns:** table created July 20, seeding pending

---

## UI / Dashboard Status
**Fintech premium aesthetic:** Medium gray canvas #D6E4F0, dark cards #0D1526, white text #FFFFFF, Plus Jakarta Sans / Sora fonts, inline style={{}} hex values throughout.

| Page | Status |
|---|---|
| /dashboard | BUILT — FlightPathHUD, metric cards, activity feed, quick actions |
| /opportunities | BUILT — filters, probability badges, deadline colors |
| /opportunities/[id] | BUILT — probability circle, eligibility bars, fundability panel |
| /applications | BUILT — pipeline stage tabs, AI draft badges |
| /draft-generator | BUILT — stats, queue, autonomous review |
| /draft-generator/autonomous | BUILT — pending review drafts, humanization scores |
| /intelligence | BUILT — module grid with completeness |
| /intelligence/twin | BUILT — completeness circle, 10-section grid, auto-populate |
| /intelligence/reputation | BUILT — severity filter, alert cards |
| /intelligence/recommendations | BUILT |
| /intelligence/strategic-advisor | BUILT — 581 lines |
| /intelligence/donor-intent | BUILT — 520 lines |
| /intelligence/community-need | BUILT — 539 lines |
| /intelligence/fundability | BUILT |
| /intelligence-library | PARTIAL — filters broken, sparse data, enterprise rebuild running |
| /donor-discovery | SHELL — enterprise rebuild pending |
| /autoapply | BUILT — 851 lines |
| /autoapply/test-results | BUILT |
| /reports/simulate | BUILT — 906 lines |
| /reports/roi | BUILT — 622 lines |
| /reports/funding-summary | BUILT |
| /reports/board-report | BUILT |
| /reports/impact | BUILT |
| /admin/improvements | BUILT — 610 lines |
| /admin/monitor | BUILT |
| /admin/orgs | BUILT |
| /admin/sales-outreach | BUILT |
| /admin/system | BUILT |
| /command-center | BUILT — platform-owner scoped, all-org data |
| /settings/billing | REDIRECT to /billing |
| /billing | BUILT |
| /knowledge-base | BUILT |
| /knowledge-base/edit | BUILT — 10-section editor, auto-save, AI suggestions |
| /activity | BUILT |
| /schoolfunder | BUILT BUT WRONG — must be removed from Benavora |

---

## Marketing Site
- Dark mode marketing page live at benavora.com
- Pricing: Starter $397/mo, Professional $897/mo, Enterprise $1,997/mo
- Consultant tier: removed (post-launch, planned after 25 customers)
- /pricing page: BUILT
- /privacy, /terms, /for-consultants: BUILT
- Testimonials: converted to "illustrative outcomes" (no fabricated quotes)
- Google for Nonprofits $10K/mo Ad Grant qualification strategy active

---

## Faith Foundation (Primary Test Tenant)
- Org ID: `b1ab7402-dfc2-4712-869f-70ea3566cc1d`
- Login: `info@faithfoundation.org`
- Autonomous config: enabled (research, scoring, reputation, relationship, deadline, followup)
- Auto-draft: disabled (requires human approval)
- KB profile: seeded from known data
- Pipeline test: run July 20 via `scripts/ff-agent-test.ts`
- Walmart AutoApply: queued and processed (status: skipped — needs account setup)
- Land bank opportunities: California authorities seeded
- Intent signals: 15 signals seeded for Bay Area corporate prospects

---

## PENDING / What Remains
**Critical:**
- Intelligence Library enterprise rebuild (running tonight) — fix filters, add 700+ records
- Donor Discovery enterprise rebuild (running tonight) — full UI and data rebuild
- Remove SchoolFunder from Benavora dashboard (belongs in Faith Foundation standalone app)
- Walmart Spark Good account setup (`pnpm setup:sparkgood`) for AutoApply to work
- GoDaddy DNS: CNAME www → cname.vercel-dns.com, A @ → 76.76.21.21

**Important:**
- GitHub 2FA required by August 15, 2026
- DATAOCEAN backup of enrichment-output/ folder to D:\
- Platform learning patterns seeding (table exists, seed script pending)
- Real customer testimonials on marketing page

**Post-Launch (25+ customers):**
- Consultant tier ($4,997 base + $497/client/month)
- Phase 3-5 platform vision (Corporate Relationship Graph, Global Learning Network, etc.)

---

## Supabase Management API
- Token as of July 19: `sbp_7f7e9e00a8995735b2803a5f2dc1bf82097895d2` (may expire)
- Pattern for large SQL: write JSON to file, use curl with cmd stdin redirect
- SQL editor direct: https://supabase.com/dashboard/project/vbjplpquqxxfbpazyalt/sql/new

---

## Vercel
- Project ID: `prj_7pn7UmQQsiEjTIHH58cfUU84p6xc`
- Team: `team_LakHkpsa9gL4kTe1WZIHBJaR`
- Deploy command: `npx vercel deploy --prod` (answer n to upgrade prompts)
- GitHub → Vercel auto-deploy: BROKEN — always use manual deploy command
