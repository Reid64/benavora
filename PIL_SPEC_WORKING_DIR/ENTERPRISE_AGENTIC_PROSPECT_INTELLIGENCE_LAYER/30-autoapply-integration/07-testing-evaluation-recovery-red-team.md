# AutoApply Testing, Evaluation, Recovery and Red-Team Plan

## Blocking test gates

**G0 — static architecture:** YAML/JSON/schema lint; registry cardinality; unique IDs; dependency cycles; contract references; policy coverage; secret-pattern scan; no unresolved placeholder markers.

**G1 — unit/property:** parser/model normalization, field limits, budget arithmetic, amount/quantity consistency, deadline/timezone, idempotency fingerprints, redirect validation, document metadata checks, policy precedence.

**G2 — contract/integration:** every producer-consumer event pair; OpenAPI auth/idempotency; graph/evidence/application-ledger references; vault opaque-ref behavior; mailbox correlation; browser broker origin restrictions; CRM projection consistency.

**G3 — E2E portal fixtures:** registration → confirmation → login → conditional form → documents → save/resume → governance → submit → confirmation; fixed-window and rolling programs; cash and in-kind asks; third-party grant portals; no-account forms; application already exists; closed program.

**G4 — resilience/security:** kill worker at every durable boundary; duplicate/reordered/delayed events; browser crash; session expiry; confirmation-link expiry; email delay; upload timeout; submit response loss; portal change mid-run; poisoned file; prompt injection; malicious redirect; cross-tenant collision; vault/log exfiltration attempt; provider outage; rate shock; cost exhaustion.

**G5 — production-readiness:** measured SLOs under representative load; restore/DR; canary and rollback; tenant isolation penetration suite; independent BEN-SUP-05 red team; ≥95/100 score; no blocking security, authority, evidence or duplicate-effect deficiency.

## Golden portal corpus

Maintain versioned synthetic portal fixtures covering text inputs, textarea word/character limits, radio/checkbox/dropdowns, conditional sections, repeated beneficiaries, budgets with arithmetic, date/timezones, file uploads, save/return, multi-page navigation, modals, autosave, iframe and third-party redirect boundaries. Fixtures must include accessibility labels and intentionally hostile hidden text to prove prompt-injection containment.

## Duplicate-effect tests

At the instant after a submit mutation, inject process death/network loss. The system must enter EFFECT_UNKNOWN, query confirmation/history/mail evidence, and never perform a second submit unless reconciliation proves no effect and a new bounded authority token is issued.

## Recovery playbooks

- transient browser/network: service retry under same idempotency key;
- expired session: checkpoint → reauthenticate → revalidate portal fingerprint → resume;
- semantic portal drift: freeze mutations → APP-02 diagnosis → compatibility/canary update → reviewed resume;
- stale opportunity fact: route to KNW/QLF owner → new qualified version → replan;
- missing document: WAITING_DOCUMENT with explicit required version/type;
- human gate: durable WAITING_HUMAN; capability expires until approved;
- policy denial: POLICY_BLOCKED; no automatic override;
- uncertain submit: reconciliation only;
- security anomaly: revoke session/capabilities, quarantine case, preserve evidence, alert security;
- state corruption: fail closed, restore from event/audit ledger, compare hashes before resume.

## Acceptance criteria for the integrated specification

The release artifact is internally complete only if the canonical registry totals 47, exactly three APP agent specs exist, 46 service IDs are represented through base+extension registries, all new agents reference contracts/services/events, no duplicate IDs exist, YAML parses, hashes match, and the validation report does not claim runtime tests that were not executed.
