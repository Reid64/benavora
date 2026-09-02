# Benavora — STATE OF THE BUILD (2026-08-26)

**Last Updated:** 2026-08-26, 22:15 UTC  
**Source:** Comprehensive codebase audit (INVENTORY_AUDIT_2026-08-26.md)  
**Verdict:** Operational but incomplete. 14 backlog items require build/fix before production release.

---

## System Status Summary

| Component | Status | Notes |
|-----------|--------|-------|
| **API Layer (Vercel)** | ✓ Operational | 50+ endpoints, average 100-300ms response time |
| **Database (Supabase)** | ⚠ Partial | 100 of 168 migrations applied; 68 pending (PIL-related) |
| **Background Worker (Railway)** | ✓ Healthy | Verified 2026-07-27; 20 concurrent capacity |
| **External Integrations** | ⚠ Degraded | SAM.gov fixed, Grants.gov OK, IRS BMF active, NewsAPI OK, ProPublica silent-fails |
| **PIL Agents** | ⚠ Partial | 38 of 48 implemented; STR, OPS, QLF, KNW families incomplete |
| **Auto-Save** | ✗ Missing | No keystroke/timer auto-save anywhere (UX blocker) |
| **Email System** | ⚠ Broken | 3 engines exist but crons not registered in vercel.json |
| **RLS / Security** | ✗ Critical | suppression_list anon-writable; no RLS on sales_* tables |

---

## Build Completion Metrics

- **Frontend Routes:** 20 defined; all 20 implemented (100%)
- **API Endpoints:** 50+ defined; 48 implemented, 2 stubs (96%)
- **Database Tables:** 40 defined; 32 in prod (80%), 8 pending migrations
- **UI Components:** 82 components, ~95% complete (minor wiring gaps)
- **PIL Agents:** 48 defined; 38 implemented (79%), 10 unbuilt
- **Unit Tests:** 580/581 passing (99.8%)
- **E2E Tests:** 24 Playwright specs written, not wired to CI (0% automation)

---

## Critical Backlog (14 Items, Priority Order)

### 🔴 P0 — Security / Compliance (Must Fix Before Prod)

1. **RLS on sales_campaigns/sales_campaign_steps/sales_sends** — Anon can write. Violates CAN-SPAM compliance.
2. **Suppress anon write to suppression_list** — Anon-writable opt-out table allows re-contacting suppressed users.

### 🟠 P1 — Feature Blockers (Breaks Core Workflows)

3. **Register 6 email cron routes in vercel.json** — Email dispatch crons exist but not wired; emails never fire.
4. **Auto-save for draft composition** — Users lose work on browser close (UX blocker).
5. **Auto-save for all user content** — Applications, notes, templates have no auto-persist.
6. **Fix Grant Discovery API wiring** — UI hardcodes .limit(1000), bypasses real /api/grants endpoint.

### 🟡 P2 — Data Integrity / Stability

7. **Add state validation to donor_discovery_prospects.pipeline_stage** — No guards; prospects can enter invalid states.
8. **Apply 68 pending schema migrations** — Tables pil_prospect_dossiers, pil_feature_flags missing; feature flags broken.

### 🔵 P3 — Completeness (Build + Deploy)

9. **Complete PIL agents: STR family** — Strategy agents (4 agents) unbuilt.
10. **Complete PIL agents: OPS family** — Operations agent (1 agent) unbuilt.
11. **Complete PIL agents: QLF family** — Qualification agents (4 agents) partial.
12. **Complete PIL agents: KNW family** — Knowledge Integrity agents (1 agent) partial.

### 💙 P4 — Quality / Testing

13. **Wire Playwright e2e tests to GitHub Actions CI** — 24 tests written, zero CI automation.
14. **Fix ProPublica search.json error handling** — Silent failures; no logging.

---

## Architecture Status

### Database Schema
- **Root migrations:** 166 files, last applied: 100
- **Src migrations:** 57 files, some live in prod (agent_queue, agent_decisions)
- **Collision tables:** 14 tables defined in both dirs with different schemas
- **Duplicate migration numbers:** 7 found (002, 022, 052-055, 058)
- **Status:** Two migration directories need reconciliation

### API Design
- **Routes:** All defined; wiring gaps in UI (Grant Discovery bypass)
- **Authentication:** OAuth implemented; state validation unclear (requires review)
- **RLS:** Partially applied (applications table OK; sales_* tables missing)
- **Rate Limiting:** Not implemented

### Frontend Architecture
- **Design System:** Locked (color palette, inline hex values only)
- **Component Library:** 82 components, no storybook or shared-component docs
- **Styling:** Inline `style={{}}` only (globals.css `!important` rules override all else)
- **State Management:** Mix of useState + server-side (not consistent)

### PIL (Prospect Intelligence Layer)
- **Agent Count:** 38 of 48 implemented (79%)
- **Missing Families:** STR (4 agents), OPS (1), QLF partial (4), KNW partial (1)
- **Execution:** Chain-it pattern (single session, multi-prompt) — works, no async persistence
- **Testing:** Unit tests for 2 Discovery agents; others untested

---

## Known Issues & Risks

| Issue | Risk | Mitigation |
|-------|------|-----------|
| Email crons not registered | Emails never fire | Register in vercel.json + test in prod |
| No auto-save | Users lose work | Build keystroke/timer → POST auto-save endpoint |
| RLS missing on sales tables | CAN-SPAM violation | Add RLS via migration, apply live |
| 68 unapplied migrations | Feature flags broken | Apply migrations via psql or supabase CLI |
| Two migration dirs | Drift risk; hard to debug | Reconcile into single authoritative dir |
| ProPublica silent fails | Enrichment gaps; no visibility | Add error logging + retry logic |
| Playwright not in CI | Quality regression undetected | Wire to GitHub Actions `.github/workflows/e2e.yml` |

---

## Deployment Status

- **Vercel:** Manual deploy required (`npx vercel deploy --prod`); GitHub auto-deploy broken
- **Railway Worker:** Healthy; PROXY_LIST empty (acceptable at current volume)
- **Database:** Supabase on free tier; migrations applied manually (no automatic sync)
- **Environment:** All secrets present except: *(verify below)*

---

## Next Steps (For Next Chat)

1. **Build 7 queue.yaml files** from backlog items (described in NEXT_CHAT_ACTIONS.md)
2. **Launch FORGE** with orchestrator (parallel queues, depends-on logic)
3. **Deploy & verify** each queue's changes in staging, then production
4. **Update this doc** after each major phase completes

---

## File Locations

- **Audit Results:** `INVENTORY_AUDIT_2026-08-26.md`
- **FORGE Guide:** `FORGE_OPERATIONS_GUIDE.md`
- **Next Actions:** `NEXT_CHAT_ACTIONS.md`
- **Backlog Detail:** `BACKLOG_DETAIL_2026-08-26.md`
- **Governance Docs:** `AGENTS.md`, `BEHAVIORAL_CONTRACTS.md`, `BLUEPRINT.md`, etc.
