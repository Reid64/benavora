# WIRING GAP REGISTER

Central register of every wiring/integration gap found during the audit program. Every finding
row must point at real evidence under `test-evidence/` (a saved command transcript, a JSON
response body, a screenshot, a query result file, etc.) and must include a reproduction command
or step sequence a future session can re-run to confirm the finding still holds. Do not add a row
without a corresponding evidence file already committed under `test-evidence/`.

## Severity legend

| Severity | Meaning |
|---|---|
| P0 | Confirmed broken in production / live data path. Blocks a real user-facing flow or silently corrupts/loses data. Fix immediately, no exceptions. |
| P1 | Confirmed broken but scoped/contained (single feature, single org, degrades gracefully, or has a working manual workaround). Fix this cycle. |
| P2 | Real gap but low blast radius (rare code path, admin-only, cosmetic, or affects a deprecated/low-traffic feature). Fix opportunistically. |
| P3 | Unverified suspicion, code-smell, or a gap that needs a product decision before it can be classified as a bug. Track, do not fix blind. |

## Scope tags

| Tag | Meaning |
|---|---|
| CONFIRMED-BROKEN | Live-verified against real data/a real request; the gap reproduces every time. |
| UNVERIFIED | Plausible from a code read, but not yet exercised against real data/a real request. |
| PENDING-SCOPE | Real gap, but whether it's in-scope for this audit program (vs. a separate task) hasn't been decided yet. |
| CONFIRMED-OK | Investigated and found NOT to be a gap — code path verified working as designed. Kept in the register so the question isn't re-asked. |

## Findings

| ID | Layer | Severity | Finding | Evidence Path | Reproduction | Scope Tag |
|---|---|---|---|---|---|---|
