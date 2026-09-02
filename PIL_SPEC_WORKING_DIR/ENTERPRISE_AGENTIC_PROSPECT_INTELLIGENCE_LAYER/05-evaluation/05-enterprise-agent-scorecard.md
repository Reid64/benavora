# Enterprise Agent Scorecard

**Version:** 1.0.0  
**Passing score:** 95/100 plus every blocking gate  
**Rule:** Points are awarded only for inspected implementation and executed evidence. Specification language alone earns no implementation score.

| Category | Points | Blocking condition |
|---|---:|---|
| Genuine goal ownership and durable lifecycle | 12 | No durable goal or restart-safe state |
| Observation, planning, evaluation, and adaptive replanning | 14 | Single-pass workflow or no demonstrated replan |
| Specialized reasoning boundary and non-agent separation | 6 | Deterministic automation mislabeled as agent |
| Typed tools, delegation, authority, and recursion control | 10 | Untyped delegation or authority escalation possible |
| Evidence, provenance, contradiction, freshness, and critic independence | 14 | Consequential unsupported claim or self-certification |
| Security, privacy, policy, and tenant isolation | 14 | Any cross-tenant access or prohibited-data path |
| Distributed reliability, idempotency, concurrency, and recovery | 10 | Duplicate external effect or unrecoverable ordinary worker loss |
| Cost, rate, model, token, and marginal-value control | 6 | Hard budget can be exceeded or no stopping economics |
| Schemas, APIs, events, persistence, and compatibility | 5 | Core contracts unvalidated or incompatible |
| Observability, audit, explainability, and operator control | 4 | Consequential decision cannot be reconstructed |
| Evaluation quality, adversarial testing, and calibration | 4 | No domain gold set or policy/security adversarial tests |
| Maintainability, documentation, and runbooks | 1 | No owner/runbook for critical failure |
| **Total** | **100** | |

## Scoring levels

- `0`: absent or contradicted.
- `0.25`: described but not implemented or tested.
- `0.50`: implemented happy path with weak evidence.
- `0.75`: implemented and tested, with material edge-case gaps.
- `1.00`: implemented, independently verified, production evidence attached.

Multiply the category weight by the level and round only the final total to one decimal.

## Mandatory evidence bundle

- commit/revision identifier;
- requirement traceability;
- schema and compatibility results;
- unit/integration/end-to-end results;
- agentic replan trace;
- policy and tenant-isolation results;
- interruption, duplicate, concurrency, and recovery results;
- critic independence demonstration;
- cost/budget enforcement result;
- load profile and measured results;
- unresolved defects, skips, assumptions, and residual risks.

## Verdict

- `PRODUCTION_READY`: score ≥95, all blocking gates pass, no critical unresolved defect.
- `CONDITIONALLY_READY`: score ≥90, no security/privacy/tenant failure, limited declared conditions remain.
- `NOT_READY`: score <90 or any blocking condition fails.

