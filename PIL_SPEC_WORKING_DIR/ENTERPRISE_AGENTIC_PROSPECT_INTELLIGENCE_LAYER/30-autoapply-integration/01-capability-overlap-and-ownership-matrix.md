# AutoApply Capability Overlap, Ownership, Agent-vs-Service Matrix

**Contract version:** 1.0.0

| Capability | Existing PIL owner | New reasoning owner | Deterministic executor | System of record | Autonomy / human gate | New agent? |
|---|---|---|---|---|---|---|
| Corporate prospect discovery | BEN-DIS-04/06/07 | — | PIL-SVC-10/11/12 | PIL-SVC-21/22 | A2 | No |
| Corporate/entity/portal identity | BEN-KNW-02 | — | PIL-SVC-19/20 | PIL-SVC-21 | A3 merge gates | No |
| Opportunity evidence verification | BEN-KNW-03/04 | — | PIL-SVC-22 | PIL-SVC-22 | A3; abstain on conflict | No |
| Mission/eligibility qualification | BEN-QLF-01/02/04 | — | rule adapters | PIL-SVC-21 | A2/A3 | No |
| Timing/readiness | BEN-QLF-05 | — | scheduler/deadline service | PIL-SVC-21 | A2 | No |
| Ask type/amount/quantity strategy | BEN-STR-02 | — | model gateway/calculators | PIL-SVC-21 | A2 | No |
| Application intake/reasoning | — | BEN-APP-01 | PIL-SVC-31/39 | PIL-SVC-39 | A2/A3 | Yes |
| Portal page extraction | — | BEN-APP-01 consumes | PIL-SVC-32 | evidence ledger + case ledger | A2 | No |
| Account registration | — | BEN-APP-01 plans | PIL-SVC-34 | PIL-SVC-39 + vault ref | A3; terms gate | No |
| Credential storage/rotation | — | — | PIL-SVC-33 | vault | deterministic | No |
| Confirmation email correlation | — | BEN-APP-01 consumes | PIL-SVC-35 | PIL-SVC-39 | A2/A3; strict scope | No |
| Session/auth lifecycle | — | BEN-APP-01 consumes | PIL-SVC-34 | PIL-SVC-39 | A2/A3; MFA human | No |
| Form semantic modeling | — | BEN-APP-01 | PIL-SVC-32/24 | PIL-SVC-39 | A2; evidence required | No separate agent |
| Field-by-field application plan | BEN-STR-02 provides ask | BEN-APP-01 | PIL-SVC-24 | PIL-SVC-39 | A2 | Yes, APP-01 |
| Fact retrieval | BEN-KNW-03 verifies | BEN-APP-01 requests | PIL-SVC-21/22/37 | graph/evidence | A2 | No |
| Narrative drafting | BEN-STR-02 constraints | BEN-APP-01 | PIL-SVC-24 | PIL-SVC-39 | A1/A2; factual provenance | No separate agent |
| Document selection/assembly | BEN-KNW-03 verifies source identity | BEN-APP-01 | PIL-SVC-36/37 | document catalog/case ledger | A2; sensitive docs gated | No |
| Browser field entry/upload/save | — | BEN-APP-01 directs | PIL-SVC-31/38 | PIL-SVC-39 | A2/A3 | No |
| Portal-side validation repair | — | BEN-APP-01 normal path | PIL-SVC-31/32 | PIL-SVC-39 | A2 | No |
| Semantic drift / ambiguous portal exception | BEN-KNW-04 may verify changed facts | BEN-APP-02 | PIL-SVC-31/32/41 | PIL-SVC-39 | A2/A3; escalation | Yes |
| Worker/session failure | BEN-SUP-06 fleet recovery | BEN-APP-02 only if semantic application state implicated | PIL-SVC-06/07/40 | workflow/case ledger | deterministic first | No duplicate agent |
| Pre-submit factual/completeness validation | BEN-KNW-03 + QLF | BEN-APP-03 independent | PIL-SVC-42 | PIL-SVC-39 | A2 | Yes, APP-03 |
| Attestation/signature/terms authority | — | BEN-APP-03 | PIL-SVC-04/43 | policy/audit ledger | human when required | Yes, APP-03 |
| Final submit action | — | BEN-APP-03 authorizes; APP-01 requests | PIL-SVC-31/38 | PIL-SVC-39 | A3 only with delegation | No separate agent |
| Confirmation capture | — | BEN-APP-01 evaluates | PIL-SVC-38/35 | PIL-SVC-39/22 | A2 | No |
| CRM synchronization | — | — | PIL-SVC-17/44 | projection only | deterministic | No |
| Communications classification/correlation | STR-04 may own strategic next action | BEN-APP-01 owns case response planning | PIL-SVC-45 | PIL-SVC-39 | A1/A2; human for commitments | No |
| Award/fulfillment tracking | — | BEN-APP-01 plans obligations | PIL-SVC-46 | PIL-SVC-39 | A1/A2 | No |
| Outcome learning | BEN-OPS-01 | — | PIL-SVC-28/30 | learning registry | gated/canary | No |
| Independent red-team criticism | BEN-SUP-05 | APP-03 may request | PIL-SVC-28 | audit/eval | independent context | No |

## Boundary rules

1. APP-01 cannot approve its own submission.
2. APP-02 cannot change tenant policy, fabricate facts, silently reinterpret a human-only certification, or force submission.
3. APP-03 cannot edit application content while reviewing it; it returns typed findings to APP-01 and requires a new immutable candidate version.
4. BEN-SUP-06 handles infrastructure/fleet recovery; APP-02 handles application-semantic/portal-path diagnosis. If both apply, BEN-SUP-06 coordinates recovery while APP-02 supplies the domain repair plan.
5. BEN-OPS-01 alone owns system-learning adoption. APP agents emit evidence-backed outcomes but cannot directly alter prompts, thresholds or policies.
