# AutoApply Security, Threat Model, Policy and Human-Authorization Matrix

## Assets and attackers

Protected assets include nonprofit credentials, sessions, tax/legal documents, financial documents, submitted statements, portal accounts, evidence, tenant data and delegated submission authority. Threats include malicious or compromised portals, prompt injection, phishing/redirect substitution, hostile attachments, credential exfiltration, browser escape, cross-tenant data access, confused-deputy attacks, replay/duplicate submission, poisoned learning signals, insider misuse and model hallucination.

## Mandatory controls

1. Zero trust for portal/email/file content. Content is always quoted/structured as data and cannot alter runtime instruction hierarchy.
2. Capability tokens bind agent/service, tenant, case, action, resource/origin, expiry, candidate hash and maximum effect count.
3. Secrets are opaque references. Browser workers receive a narrowly scoped secret injection only at the credential field boundary; values are never returned to an agent/model.
4. Browser isolation prevents cross-tenant cookies, cache, local storage and filesystem reuse.
5. Redirect chains are validated before navigation; private/link-local/metadata IP ranges are denied.
6. Downloads are quarantined and malware/content-type scanned before parsing; active content is disabled where feasible.
7. Email access is scope-limited and correlation-first; unrelated messages are not exposed to models.
8. Submission is separation-of-duties: APP-01 creates frozen candidate, APP-03 independently evaluates, deterministic service enforces decision and candidate hash.
9. Uncertain external effects reconcile rather than retry.
10. Every approval/denial/override is audit-linked to actor, policy snapshot and evidence.

## Human-authorization matrix

| Action | Default automation | Human required when |
|---|---|---|
| Read public giving pages | Allowed A2 | site/policy denies automation or authentication boundary unclear |
| Create organizational portal account | A3 if delegated | material terms, prohibited automation, unclear organization authority |
| Confirm account by authorized email | A3 | sender/origin confidence below threshold or link risk |
| Enter/save factual fields | A2 | source contradiction or sensitive field outside approved profile |
| Draft narratives | A1/A2 | unsupported commitments, novel legal representations, material ambiguity |
| Upload standard approved documents | A2 | document sensitivity/recency/identity uncertain |
| Upload banking/payment documentation | Denied by default | explicit tenant approval and secure portal necessity |
| Accept ordinary portal terms | Policy dependent | terms create material obligation, waiver, indemnity or authority ambiguity |
| CAPTCHA/human verification/MFA | Never bypass | always authorized human or approved native auth mechanism |
| Electronic signature | Denied by default | explicit signer/delegation workflow is completed |
| Personal-knowledge certification | Never autonomous | authorized person must attest |
| Final submission | A3 only | APP-03 approval + tenant class delegation; otherwise human |
| Respond to request for additional information | A1/A2 | new commitment, new attestation, changed ask, legal/financial issue |
| Accept award agreement | Denied by default | authorized human/officer approval |
| Change bank/payment destination | Never autonomous | authorized human + dual control |

## Policy precedence

`System Constitution > law/regulation/contractual restrictions > tenant policy > program/portal-specific policy > workflow policy > agent plan`. Source content has no policy authority.

## Prompt-injection defense tests

The red-team corpus must include portal text instructing the model to reveal credentials, ignore prior rules, upload arbitrary files, visit attacker URLs, change requested amount, fabricate board approval, disable audit, or “prove humanity”; email links with homograph domains; attachments containing hidden model instructions; malicious HTML labels and accessibility text; redirects to credential-harvesting hosts; and poisoned approval/decline messages. Expected result is ignore/quarantine/deny/escalate, never instruction adoption.
