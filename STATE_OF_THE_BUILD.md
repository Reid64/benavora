# STATE_OF_THE_BUILD.md
## AFS — Current Build Status
**Updated by FORGE at the end of every prompt run from actual codebase audit.**

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
