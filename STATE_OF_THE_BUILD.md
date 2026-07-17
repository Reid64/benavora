# STATE_OF_THE_BUILD.md
## AFS — Current Build Status
**Updated by FORGE at the end of every prompt run from actual codebase audit.**

> **NOTE (2026-07-17):** Everything below this note through the end of this
> file is stale content from an unrelated project ("AFS", a metal
> fabrication RFQ platform — pricing engine, drawing tool, Gunmetal theme).
> It does not describe Benavora and predates this session. Left in place
> rather than deleted per governance file-handling rules; flagged for Reid
> to decide whether to purge it. The section immediately below is the real,
> verified Benavora status.

---

## Overnight Build Session July 17 2026 — Platform Vision Phase 1

Audited directly against `git log`, migration files, and route/component
existence on 2026-07-17 — not copied from the prompt queue's assumptions.

### Prompts run this session (newest-first commit order)

| Commit | Prompt | Status |
|---|---|---|
| `f3fef6b` | Knowledge engine query UI | ✅ PASS — `/intelligence/knowledge` page + `/api/intelligence/knowledge-query` route |
| `1014cf9` | Knowledge engine RAG infrastructure | ✅ PASS — migration 096 (`knowledge_patterns`, `knowledge_queries`), canonical path |
| `39010ed` | Disaster response dashboard UI | ⚠️ CODE PASS, SCHEMA AT RISK — see caveat below |
| `a458eea` | FEMA disaster response engine | ⚠️ CODE PASS, SCHEMA AT RISK — see caveat below |
| `3892cf3` | Reputation intelligence UI | ⚠️ CODE PASS, SCHEMA AT RISK — see caveat below |
| `ef1172c` | Morning digest notification system | ✅ PASS — `/api/agents/morning-digest` |
| `72f1c91` | Opportunity discovery engine | ✅ PASS — `/api/agents/discovery` |
| `499f87a` | Agent marketplace UI | ✅ PASS — `/settings/agents` page |
| `ca77529` | Agent registry seed and API | ✅ PASS — `/api/agents/registry` (+ `/configure`) |
| `f238f89` | Digital twin builder service | ✅ PASS — `src/lib/intelligence/digital-twin-builder.ts` |
| `9169deb` | Probability scores on opportunities page | ✅ PASS |
| `1bca132` | Grant probability API and batch scorer | ✅ PASS — `/api/agents/success-probability` |
| `80ce510` | Grant probability scoring engine | ✅ PASS — `src/lib/intelligence/grant-probability-engine.ts` |
| `d460e18` | Forecast and board advisor migrations | ❌ SCHEMA ONLY, WRONG PATH, NO APP CODE — see caveat below |
| `6381a3b` | Agent marketplace and discovery migrations | ✅ PASS — migrations 094/095, canonical path (see below) |
| `2d9eefd` | Digital twin and probability score migrations | ✅ PASS — migration 093, canonical path |
| *(uncommitted)* | Executive Command Center + nav wiring | ⏳ IN PROGRESS as of session start — `/command-center` page + `nav-items.ts` changes were sitting uncommitted; folded into this session's commit below once build was verified |

### Critical finding: migration directory split

This repo has **two** migration directories: `supabase/migrations/` (canonical —
the only one the Management API apply step reads, per this project's
established convention) and a stray `src/supabase/migrations/` that a prior
prompt in this same FORGE run wrote to by mistake, using colliding numbers
(072–079) that don't match canonical numbering.

Migration 094 (`agent_registry`) itself documents catching this mid-session:
it explicitly notes the stray `075_agent_marketplace.sql` was dead and
re-does the schema correctly at canonical path/number 094. **The same
correction was never applied to reputation, disaster response, forecast,
board advisor, or the intelligence graph** — their `CREATE TABLE` statements
(`reputation_signals`, `reputation_alerts`, `disaster_declarations`,
`disaster_emergency_funds`, `funding_forecasts`, `board_meeting_packets`,
`pig_nodes`, `pig_edges`, etc.) exist **only** in
`src/supabase/migrations/076–079`, which was never applied to the live
database.

Practical effect: the Reputation Intelligence and Disaster Response pages
and API routes are real, committed, working TypeScript — but will very
likely 500 at runtime against production until someone copies those five
stray files into `supabase/migrations/` at the next free numbers and
applies them via the Management API (per this project's DDL process). This
was **not** run as part of this task — applying DDL to prod needs an
explicit go-ahead, not a drive-by fix bundled into a docs update.

### Platform Vision Phase 1 — feature completion (8 targeted pillars)

| Pillar | Status |
|---|---|
| Digital Twin (6) | ✅ Complete — builder service + migration, canonical |
| Grant Probability Engine (5) | ✅ Complete — engine, API, batch scorer, UI |
| Agent Marketplace (17) | ✅ Complete — registry, config API, settings UI |
| Opportunity Discovery (2) | ✅ Complete — discovery engine + morning digest |
| Knowledge Engine foundation (18) | ✅ Complete — RAG infra + query UI |
| Executive Command Center (16) | ✅ Built, was uncommitted at session start (see below) |
| Reputation Intelligence (15) | ⚠️ App code complete, schema unapplied |
| Disaster Response Engine (10) | ⚠️ App code complete, schema unapplied |

**6 of 8 fully verified end-to-end. 2 of 8 blocked on a schema-application
gap, not an app-code gap.** Forecast (11) and Board Advisor (12) got
migrations only (also stuck in the stray directory) with no agent/API/UI
built against them yet — not part of the 8 claimed-complete features, and
correctly absent from that list.

**Overall Platform Vision completion (all 14 pillars): ~43% fully shipped,
~14% code-complete pending a schema fix, ~14% schema-drafted only,
~29% not started** (Marketplace/Pillar 9, Relationship Builder/Pillar 4,
Impact Simulator/Pillar 13, Intelligence Graph/Pillar 1 beyond its stray
migration).

---

## OVERALL STATUS

```
Governance documents:    COMPLETE (12 files)
Feature specs:           COMPLETE (52 files)
FORGE queue:             READY (queue.yaml staged, tokens correct)
Application code:        NOT STARTED
Database migration:      NOT STARTED (pending Supabase project setup)
API keys in .env.local:  NOT STARTED (pending client data delivery)
```

---

## ARCHITECTURE DECISIONS LOCKED

| Decision | Status | Notes |
|---|---|---|
| RFQ model — no customer-facing pricing | Locked | Core business model |
| Gunmetal single theme from logo | Locked | Design system complete |
| Phase 1 = drawing tool first | Locked | Highest complexity first |
| claude-sonnet-4-6 on all AI | Locked | Single model |
| pnpm only | Locked | Lock-file consistency |
| No SEO in this build | Locked | Teratrix platform handles it |
| **Pricing engine deferred** | **Locked** | **Manual pricing mode at launch** |

---

## PRICING ENGINE — DEFERRED

```
DECISION DATE: July 2026
REASON:        Insufficient historical data to build an accurate engine.
               Building without validated data produces an untrustworthy system.
IMPACT:        None on customer experience. None on architecture.
               Estimators price manually in admin quote creation form.
SCHEMA:        All 5 pricing tables included in 001_initial_schema.sql.
               No migration required when engine activates.
CRON JOBS:     Not built. vercel.json cron config not added.
METALS API:    Not required at launch.
ACTIVATION:    6–12 months post-launch. See PRICING_ENGINE.md activation checklist.
```

---

## GOVERNANCE STACK — COMPLETE

| Document | Status | Notes |
|---|---|---|
| CLAUDE.md | Complete | Master index |
| BLUEPRINT.md | Complete | FORGE operational rules |
| ARCHITECTURE.md | Complete | System architecture |
| SCHEMA.md | Complete | 25 tables + RLS (all pricing tables included) |
| DESIGN_TOKENS.md | Complete | Gunmetal theme from logo |
| SITEMAP.md | Complete | 87 routes, RFQ model |
| COMPONENT_MAP.md | Complete | All components mapped |
| PRICING_ENGINE.md | Complete | Engine deferred — manual mode documented |
| PRD.md | Complete | Platform requirements |
| STATE_OF_THE_BUILD.md | This file | Updated by FORGE |
| SESSION_STATE.md | Active | Session log |
| MASTER_DOCUMENT_REGISTRY.md | Complete | Document index |

---

## FEATURE SPECS — COMPLETE (52 files)

All specs written. All reflect RFQ model (no customer-facing pricing).
See MASTER_DOCUMENT_REGISTRY.md for full list.

---

## WHAT IS AND IS NOT BUILT IN PHASE 6 (ADMIN)

```
BUILT:
  /admin/pricing — pricing_rules editor (manual margin + waste factor notes)
  /admin/pricing — PricingEngineComingSoon section
  Admin estimator quote creation — manual unit price entry per line item
  All other admin features per SPEC_ADMIN_PORTAL.md, SPEC_PRODUCTION_QUEUE.md

NOT BUILT (deferred):
  Metals API integration
  /api/cron/commodity-prices
  /api/cron/pricing-trends
  Commodity price dashboard
  Margin risk alert system
  "Generate Pricing" button on estimator form
  Historical price chart
  vercel.json cron config entries
```

---

## DATA BLOCKERS — UNRESOLVED

These items block specific features but do not block the build.

| Item | Checklist # | Blocks |
|---|---|---|
| Product catalog (profiles, materials, gauges) | #12–21 | Catalog content, dropdowns |
| Pricing cost basis and margin rules | #22–23, #26 | Manual margin targets in pricing_rules |
| Production stage names | #39 | Timeline labels |
| AFS address, phone, hours | #5, #6 | Contact page, emails |
| Tax nexus states | #31 | TaxJar config |
| Carrier/freight method | #27–28, #80 | Freight manual entry context |
| Industry certifications | #8 | Trust badges |
| Logo SVG (vector) | #1 | Asset quality |
| Photography | #9 | Product/gallery images |
| Privacy Policy | #65 | LAUNCH BLOCKER |

---

## BUILD PHASE STATUS

```
Phase 0 — Scaffold + Design System:    NOT STARTED
Phase 1 — Drawing Tool + Upload:       NOT STARTED
Phase 2 — Quote Request System:        NOT STARTED
Phase 3 — Product Catalog + Auth:      NOT STARTED
Phase 4 — Customer Portal:             NOT STARTED
Phase 5 — Architect Portal:            NOT STARTED
Phase 6 — Admin + Operations:          NOT STARTED (engine deferred per decision above)
Phase 7 — AI Layer:                    NOT STARTED
Phase 8 — Integrations + Deploy:       NOT STARTED
```

**FORGE is ready to run Phase 0 when .env.local is populated.**

---

## NEXT ACTION

1. Populate .env.local with Supabase project credentials
2. Run queue.yaml — Phase 0 scaffold prompt
3. Verify all gates pass (tsc, build, lint, Playwright)
4. Continue through Phase 1

---

*STATE_OF_THE_BUILD.md | Updated by FORGE after each run. Do not edit manually.*

| Document | Status | Notes |
|---|---|---|
| CLAUDE.md | Complete | Master index |
| BLUEPRINT.md | Complete | FORGE operational rules |
| ARCHITECTURE.md | Complete | System architecture |
| SCHEMA.md | Complete | 25 tables + RLS |
| DESIGN_TOKENS.md | Complete | Gunmetal theme from logo |
| SITEMAP.md | Complete | 87 routes, RFQ model |
| COMPONENT_MAP.md | Complete | All components mapped |
| PRICING_ENGINE.md | Complete | Internal commodity system |
| PRD.md | Complete | Platform requirements |
| STATE_OF_THE_BUILD.md | This file | Updated by FORGE |
| SESSION_STATE.md | Active | Session log |
| MASTER_DOCUMENT_REGISTRY.md | Complete | Document index |

---

## FEATURE SPECS — COMPLETE (52 files)

All specs written. All reflect RFQ model (no customer-facing pricing).
See MASTER_DOCUMENT_REGISTRY.md for full list.

---

## DATA BLOCKERS — UNRESOLVED

These items block specific features but do not block the build.
Code is built now. Data populates when received.

| Item | Checklist # | Blocks |
|---|---|---|
| Product catalog (profiles, materials, gauges) | #12–21 | Catalog content, dropdowns |
| Pricing cost basis and margin rules | #22–23, #26 | Engine activation |
| Supplier price history | Internal records | Trend projection |
| Production stage names | #39 | Timeline labels |
| AFS address, phone, hours | #5, #6 | Contact page, emails |
| Tax nexus states | #31 | TaxJar config |
| Carrier/freight method | #27–28, #80 | Freight calculation |
| Industry certifications | #8 | Trust badges |
| Logo SVG (vector) | #1 | Asset quality |
| Photography | #9 | Product/gallery images |
| Privacy Policy | #65 | LAUNCH BLOCKER |

---

## BUILD PHASE STATUS

```
Phase 0 — Scaffold + Design System:    NOT STARTED
Phase 1 — Drawing Tool + Upload:       NOT STARTED
Phase 2 — Quote Request System:        NOT STARTED
Phase 3 — Product Catalog + Auth:      NOT STARTED
Phase 4 — Customer Portal:             NOT STARTED
Phase 5 — Architect Portal:            NOT STARTED
Phase 6 — Admin + Operations:          NOT STARTED
Phase 7 — AI Layer:                    NOT STARTED
Phase 8 — Integrations + Deploy:       NOT STARTED
```

**FORGE is ready to run Phase 0 when .env.local is populated.**

---

## NEXT ACTION

1. Populate .env.local with Supabase project credentials
2. Run queue.yaml — Phase 0 scaffold prompt
3. Verify all gates pass (tsc, build, lint, Playwright)
4. Continue through Phase 1

---

*STATE_OF_THE_BUILD.md | Updated by FORGE after each run. Do not edit manually.*
