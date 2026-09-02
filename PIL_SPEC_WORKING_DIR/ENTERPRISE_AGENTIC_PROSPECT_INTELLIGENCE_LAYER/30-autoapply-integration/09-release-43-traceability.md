# Release 43 AutoApply Requirements Traceability

| Requirement | Architecture/contract | Agent/service owner | Verification |
|---|---|---|---|
| Reuse existing PIL intelligence | 00 gap; 01 ownership | DIS/KNW/QLF/STR | ownership lint + E2E handoff |
| Exact new-agent justification | 00 gap | APP-01/02/03 | agent qualification review |
| Account registration | 02 architecture | APP-01 + SVC-34 | duplicate/account saga tests |
| Email confirmation | 02, 05 | SVC-35 | sender/origin/correlation tests |
| Secrets/session | 05 | SVC-33/34 | no-secret leak + isolation tests |
| Form interpretation | 03 ApplicationModel | APP-01 + SVC-32 | golden portal corpus |
| Field provenance | 03 AnswerProvenance | APP-01 + KNW-03 | provenance completeness tests |
| Document assembly | 02 | SVC-36/37 | identity/version/malware/size tests |
| Browser automation | 02, 05 | SVC-31/38 | origin, sandbox, mutation tests |
| CAPTCHA/human verification | 05 | SVC-29 | negative no-bypass tests |
| Submission governance | 03, 05 | APP-03 | false-approval adversarial suite |
| Duplicate prevention | 00 §11 | SVC-40 | effect-unknown kill tests |
| Portal drift/recovery | 02, 07 | APP-02 + SVC-41 | drift/semantic recovery corpus |
| CRM sync | 02 | SVC-44/17 | projection consistency tests |
| Communications | 02 | SVC-45 + APP-01 | correlation/authority tests |
| Fulfillment/reporting | 02 | SVC-46 | lifecycle tests |
| Outcome learning | 03 | BEN-OPS-01 | quarantine/canary/rollback tests |
| Tenant isolation | 05 | SVC-02 + all | cross-tenant negative suite |
| Prompt injection | 05, 07 | all | malicious portal/email/file corpus |
| Audit/evidence | 02 | SVC-22/23/39 | reconstructability/tamper tests |
| Production truthfulness | 00, 07 | release governance | no runtime claim without G0–G5 |
