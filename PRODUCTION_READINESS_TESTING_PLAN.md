# Benavora Production Readiness Testing Plan
## Full Wiring Audit + E2E + Integration + Business Logic + Agentic + Tenant Isolation +
## Failure/Recovery + Security + Load/Soak + Production Readiness Review
## Prepared 2026-08-18. To be executed as a real, gated FORGE run in a fresh session.

---

## 1. Full Application Wiring Audit
Real precedent tonight: Integrations "Configure" 404'd, two "queued" actions gave no link
to their real destination - and both of those specific fixes were later found to have never
actually been committed despite being reported done. This category exists to find every
remaining instance of that pattern, and to re-verify these two specific items from scratch.

- Crawl every real route in the app (388 routes per the last build manifest). For each:
  confirm it renders without error, confirm every visible button/link on it points to a
  real, existing destination (no `href="#"`, no dead route, no 404).
- Cross-reference every nav item (sidebar, settings sub-nav, admin sub-nav) against its
  actual target - confirm every single one resolves.
- Find every "queued"/"processing"/"submitted" UI state and confirm each one has a real,
  discoverable link to where the result actually lands.
- Confirm every settings sub-page renders inside its shared layout (Billing was reported to
  break out of the shared nav - re-verify this specifically, unconfirmed whether ever fixed).
- SPECIFICALLY RE-VERIFY, since these were claimed fixed but have no commit trail:
  Integrations > State Grant Portals > Configure (404?), Grants.gov Run Now completion link,
  Scraping Targets completion link, Settings > Branding logo upload reflecting in header,
  Settings > Billing navigation.

## 2. End-to-End (E2E) Testing
Real user journeys, run against real data, not mocked:

- New org signup → onboarding → first opportunity discovered → draft generated → draft
  reviewed/exported → application tracked through pipeline stages → deadline reminder
  fires.
- AutoApply: real queue item → real session start → real form-fill → real submission
  (or safe simulated submission) → real status update reflected in UI.
- Donor Discovery: real prospect surfaced → reviewed → routed to email or AutoApply →
  confirm it actually appears in the destination.
- Password reset, magic-link login, session persistence across reload/tab-close.

## 3. Integration Testing
- Supabase (DB + Auth + Storage + Realtime where used)
- Railway worker (heartbeat, real job pickup, real completion write-back)
- Resend (real outbound email actually delivered, not just API-200)
- Stripe (if Billing is kept - real checkout/portal session, real webhook receipt)
- Google Calendar OAuth + sync
- Grants.gov, SAM.gov, USASpending, ProPublica, IRS data sources
- ScraperAPI / stealth scraper proxy rotation

## 4. Business Logic Testing
- Match/fit scoring algorithm - test against a known opportunity+org pair with a
  hand-calculable expected range.
- AutoApply eligibility logic.
- Deadline calculations and reminder timing.
- Budget reconciliation math (grant_budgets/grant_expenses/grant_reconciliation_reports).
- Confidence scoring on generated drafts.

## 5. Agentic System Testing
For every real agent (AG-05 Research, AG-08 NOFA Parser, AG-29 Knowledge Indexer, AG-36
Learning Network, AG-38 Improvements, and the rest of the registry):
- Confirm it actually runs when triggered.
- Confirm it writes real, correct data - not a silent no-op.
- Confirm failures are logged/surfaced, not swallowed silently.

## 6. Tenant Isolation Testing
- As an authenticated user of Org A, attempt to read/write Org B's data directly via API
  calls with modified IDs - confirm RLS actually blocks it, on every real table.
- Confirm the demo account's write-protection (migration 138) still holds.
- Confirm impersonation (admin/orgs) is properly scoped and audit-logged.

## 7. Failure/Recovery Testing
- Simulate Supabase slow/unavailable, Railway worker down, malformed API responses -
  confirm graceful degradation, not white screens or data corruption.

## 8. Security Audit
- Re-run adversarial injection tests across every real form/API input.
- Confirm every API route requiring auth actually rejects unauthenticated requests.
- Scan for exposed secrets/keys in client-side bundles.
- Confirm RLS is enabled with real policies on every table.

## 9. Load/Soak Testing
- Realistic concurrent-user simulation, sustained load over time, watch for memory
  growth/degradation.

## 10. Production Readiness Review
- Confirm all required env vars are correctly set in real production environments.
- Confirm error monitoring/logging, backup strategy, rate limiting.
- Final go/no-go checklist.

---

## Critical process note for this phase
Tonight's session found real, repeated cases of work being reported as "done and verified"
that turned out, on direct re-check, to never have happened at all - including this very
document, which was reported committed twice before actually landing in the repo. Every
single item in this testing plan must be verified with real, direct evidence (actual query
results, actual response codes, actual git commits) - a session's own summary claiming
success is not sufficient evidence on its own.
