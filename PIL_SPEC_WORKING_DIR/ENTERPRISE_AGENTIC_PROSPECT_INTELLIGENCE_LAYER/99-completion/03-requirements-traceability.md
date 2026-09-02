# Completion Traceability

| Requirement | Design artifact | Verification required before production |
|---|---|---|
| Explicit agent/service classification | Constitution, service registry, all agent §2/§8 | Registry lint; runtime capability inspection |
| Domain boundaries and ownership | 01-remaining-fleet-ownership-matrix.md; each agent §1–§2 | Cross-contract boundary tests |
| Versioned schemas/contracts | Shared contracts; each agent §3/§9 | JSON Schema/OpenAPI compatibility |
| Workflow/state machines | Each agent §10; runtime architecture | Durable workflow/restart tests |
| Events | Each agent §11; shared event envelope | Producer/consumer compatibility |
| API contracts | Runtime architecture; implementation artifacts | Auth/idempotency/version tests |
| Security/threat model | Constitution §7; each agent §12 | Adversarial/red-team tests |
| Tenant isolation | Constitution; each agent §12 | Cross-tenant negative suite |
| Secrets | Constitution; downstream handoff | Secret-leak/static/runtime tests |
| Policy-as-code | Policy architecture; service registry | Deny/obligation/precedence tests |
| Autonomy/human approval | Constitution; each agent §13 | Authority escalation negative tests |
| Evidence/provenance | Constitution; shared contracts; each agent §6 | Lineage completeness/critic tests |
| Idempotency/duplicates | Constitution; each agent §11 | duplicate/concurrency tests |
| Failure/recovery | runtime architecture; each agent §15 | kill/restart/DLQ tests |
| Observability/SLOs | each agent §16 | measured load/SLO evidence |
| Audit logging | constitution; audit service | reconstructability/tamper tests |
| Cost/concurrency | each agent §14 | hard-budget race tests |
| Prompt injection | each agent §12 | malicious source/document suite |
| Testing/evaluation | each agent §17/§18; scorecard | executed evidence bundle |
| Rollout/rollback | configuration/kill-switch service; agent §17 | canary/rollback drills |
