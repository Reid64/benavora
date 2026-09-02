# Existing-Agent Integration Specifications

## BEN-DIS-04 Corporate Giving Discovery
Emit `ContributionOpportunityCandidate.v2` with contribution modality (cash, sponsorship, product, material, vehicle, equipment, service, software, logistics, facility/land, volunteer or mixed), application-path evidence, portal origin/vendor, window/deadline and automation-permission evidence when observable. Discovery must not create portal accounts or submit forms.

## BEN-KNW-02 Entity Resolution
Resolve parent/brand/subsidiary/foundation/portal relationships and persist portal identity without conflating third-party vendors with the funder. Account namespace keys use resolved portal identity + tenant organization.

## BEN-KNW-03 Evidence and Provenance Verification
Expose an application-safe verified fact bundle and evidence refs. It remains authoritative for factual verification. APP-01 must request re-verification when a required answer is unsupported/stale/contradicted.

## BEN-KNW-04 Contradiction and Freshness Investigator
Consume `PortalSemanticDriftDetected` when changed portal content alters factual program requirements; distinguish UI-only change from changed program truth.

## BEN-QLF-02 Funding Eligibility
Extend decision output with application-specific prerequisites, exclusions, registrations, geographic rules, contribution-type compatibility and evidence effective dates.

## BEN-QLF-04 Opportunity Qualification
Emit the canonical handoff gate. No AutoApply case begins without an accepted qualification decision, except an explicit research-only dry run that cannot mutate external systems.

## BEN-QLF-05 Timing and Readiness
Supply application window, deadline timezone, readiness blockers and recheck triggers. AutoApply returns newly discovered prerequisites rather than bypassing them.

## BEN-STR-02 Best First Ask
Supply request type, amount/range/quantity/scope, intended use, fallback asks and rationale. APP-01 may format this strategy to portal constraints but may not materially change the ask without a new STR-02 decision.

## BEN-STR-04 Next-Best-Action
Consume decline, additional-information, follow-up, renewal and reapplication events when strategy is needed. Mechanical reminders remain services.

## BEN-SUP-01 Chief Prospect Intelligence Orchestrator
Recognize AutoApply as a downstream domain. It routes qualified opportunity handoff and receives terminal/outcome signals without micromanaging browser steps.

## BEN-SUP-05 Critic/Red Team
Add application-specific independent audits: fabricated answer detection, evidence gaps, hostile-source instruction adoption, duplicate submission, authority escalation, cross-tenant leakage and outcome-learning contamination.

## BEN-SUP-06 Recovery Investigator
Own fleet/infrastructure-wide recovery. When an incident is semantic to the application/portal, delegate diagnosis to BEN-APP-02 and retain supervisory incident coordination.

## BEN-OPS-01 Fleet Performance and Learning
Consume `ApplicationOutcomeLearningSignal.v1`. Signals enter quarantine; causal attribution and cohort sufficiency are evaluated before proposing changes. No single portal event may rewrite global policy or strategy thresholds.
