# Release 43 Chain-It Implementation Directive

Execute in strict dependency order. A phase may not promote if its blocking acceptance tests lack evidence.

1. Registry/contract reconciliation: adopt v3 agent registry; register SVC-31..46; compile schemas and events.
2. Persistence/security substrate: application ledger, tenant partitions/RLS, vault namespaces, audit/evidence links, idempotency/effect reconciliation.
3. Browser/mail/document deterministic services: sandbox, origin policy, portal model, mailbox scope, document catalog/validation.
4. APP-01 implementation in dry-run mode: portal modeling and candidate construction only; no external mutation.
5. Reversible mutations: account/draft/save/upload under A2/A3 policy; execute G1–G4 relevant suites.
6. APP-02 exception path: drift canaries, semantic diagnosis, quarantine/recovery and SUP-06 integration.
7. APP-03 governance: frozen candidate, independent context, authority registry, one-time submit token; no submit enabled yet.
8. Submission shadow mode: compare APP-03 decisions to human reviewers; calibrate false-approval/abstention.
9. Controlled submission canary: small allowlisted portal/tenant cohort with human co-approval and effect reconciliation.
10. Communications/fulfillment/outcome learning: correlate responses; quarantine learning signals; BEN-OPS-01 evaluation.
11. G0–G5 full release evidence, rollback drill, independent score. Only then may a production-ready declaration be considered.
