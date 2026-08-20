import { appendFindingRow } from "./evidence-lib.mjs";

appendFindingRow({
  id: "WGR-081",
  layer: "Autonomous Agents",
  severity: "P1",
  description:
    "PT-09-003 execution proof: AG-23/AG-32 canonical-number collision (src/lib/agents/" +
    "relationship-graph-builder-agent.ts, RelationshipGraphBuilderAgent) is a genuine, confirmed " +
    "single-class collision, not a naming coincidence. Direct execution shows exactly ONE real " +
    "class serves both canonical numbers, and its real agent_runs row uses agent_type=" +
    "'ag-32-relationship-graph' only -- a direct count of agent_type='ag-23' anywhere in the " +
    "database returned 0, meaning AG-23 is a registry-only row with zero backing code and zero " +
    "real run history under its own literal. FALSE-PASS CASUALTY: registry's WIRED-SCHEDULED " +
    "status for 'AG-23' is misleading -- any tooling joining agent_registry.agent_id='ag-23' " +
    "against real agent_runs history will find nothing, ever.",
  evidencePath: "test-evidence/pt-09/batch2-results/AG-23___AG-32.json, test-evidence/pt-09/execution-batch2.json",
  reproduction:
    "node --import tsx scripts/audit/pt09-003-trigger/AG-23_AG-32.mjs (against the local pt05-local-stack) -- " +
    "compares agent_runs counts for agent_type='ag-23' vs 'ag-32-relationship-graph' before/after.",
  scopeTag: "CONFIRMED-BROKEN",
});

appendFindingRow({
  id: "WGR-082",
  layer: "Autonomous Agents",
  severity: "P1",
  description:
    "PT-09-003 execution proof: AG-24 (src/app/api/intelligence/outreach/generate/route.ts) is " +
    "not agent-framework code at all -- confirmed by direct execution and source read: the route " +
    "makes zero database writes of any kind (before/after sentinel 0/0), calls Claude once, and " +
    "returns { subject, body, previewCompanyName } directly in the HTTP response for the Corporate " +
    "Outreach composer UI to display. Its writesTo entry in the registry (email_campaign_sequences/" +
    "email_sequence_steps/email_sequence_enrollments) is incorrect -- those tables belong to an " +
    "entirely separate module (src/lib/email/sequence-engine.ts) this route never calls, and do " +
    "not even exist on the local schema today. FALSE-PASS CASUALTY: registryPriorStatus " +
    "(WIRED-MANUAL-API) implies persistence this route was never designed to do.",
  evidencePath: "test-evidence/pt-09/batch2-results/AG-24.json, test-evidence/pt-09/execution-batch2.json",
  reproduction:
    "node --import tsx scripts/audit/pt09-003-trigger/AG-24.mjs (against the local pt05-local-stack, " +
    "a seeded corporate prospect) -- captures the route's real response and independently confirms " +
    "zero writes via a direct pg connection.",
  scopeTag: "CONFIRMED-BROKEN",
});

appendFindingRow({
  id: "WGR-083",
  layer: "Autonomous Agents",
  severity: "P1",
  description:
    "PT-09-003 execution proof: AG-25 Deadline Prediction (src/lib/agents/deadline-prediction-agent.ts, " +
    "ag-25-deadline-prediction) ran to completion cleanly (agent_runs written, errors=[]) but wrote " +
    "zero deadline_predictions rows. Root cause per the real code and seed data: environment.json's " +
    "3 seeded opportunities already carry real deadline values set at seed time, so this agent's own " +
    "'only predict when a deadline is missing/ambiguous' gate found nothing to predict for -- a real, " +
    "grounded null result on this seed data, not independently confirmed as broken against opportunities " +
    "with genuinely missing/ambiguous deadlines. FALSE-PASS CASUALTY: registryPriorStatus " +
    "(WIRED-SCHEDULED-GATED+QUEUE) implies real predictions are being generated nightly for gated orgs; " +
    "this run did not observe that happening.",
  evidencePath: "test-evidence/pt-09/batch2-results/AG-25__Deadline_Prediction__dual-use_number_.json, test-evidence/pt-09/execution-batch2.json",
  reproduction:
    "node --import tsx scripts/audit/pt09-003-trigger/AG-25-deadline-prediction.mjs (against the local " +
    "pt05-local-stack, test-evidence/pt-09/environment.json org).",
  scopeTag: "NEEDS-VERIFICATION",
});

appendFindingRow({
  id: "WGR-084",
  layer: "Autonomous Agents",
  severity: "P1",
  description:
    "PT-09-003 execution proof: AG-26 (src/lib/agents/funding-forecast-agent.ts, ag-26-forecast) ran " +
    "to completion cleanly (agent_runs written, errors reported empty) but wrote zero funding_forecasts " +
    "rows against environment.json's seeded org/opportunities/outcomes. FALSE-PASS CASUALTY: " +
    "registryPriorStatus (WIRED-SCHEDULED, real monthly worker/scheduler.ts job CONFIRMED STARTED+firing " +
    "live per PT-08) implies a real forecast is produced monthly for every org; this direct invocation " +
    "shows the underlying forecast-generation logic can run clean and still persist nothing.",
  evidencePath: "test-evidence/pt-09/batch2-results/AG-26.json, test-evidence/pt-09/execution-batch2.json",
  reproduction:
    "node --import tsx scripts/audit/pt09-003-trigger/AG-26.mjs (against the local pt05-local-stack, " +
    "test-evidence/pt-09/environment.json org) -- compares funding_forecasts row counts before/after " +
    "via a direct pg connection.",
  scopeTag: "CONFIRMED-BROKEN",
});

appendFindingRow({
  id: "WGR-085",
  layer: "Autonomous Agents",
  severity: "P1",
  description:
    "PT-09-003 execution proof: AG-30 (src/lib/agents/donor-intent-monitor-agent.ts, ag-30-donor-intent) " +
    "ran cleanly (agent_runs completed, itemsFound=2, itemsProcessed=2, errors=[]) and made 3 real " +
    "callClaudeWithWebSearch() calls per prospect (6 total) with zero per-call failures, but wrote zero " +
    "corporate_intent_signals rows -- output_summary states plainly 'no signal reached the 60/100 intent " +
    "threshold.' Root cause per the real code: the 2 seeded synthetic company names ('Hill Country " +
    "Logistics LLC', 'Lonestar Manufacturing Co') have no real CSR/ESG/press-release web footprint to " +
    "find, so this is a real, grounded null result on synthetic test data rather than a confirmed broken " +
    "search/scoring pipeline -- but it also independently confirms the historical rotated-API-key block " +
    "(watchListRef wasBlockedOnRotatedApiKey) does NOT reproduce against the current key (zero per-call " +
    "errors). FALSE-PASS CASUALTY: registryPriorStatus (WIRED-SCHEDULED-NIGHTLY+QUEUE) implies real " +
    "intent signals are surfaced nightly; this run produced none.",
  evidencePath: "test-evidence/pt-09/batch2-results/AG-30.json, test-evidence/pt-09/execution-batch2.json",
  reproduction:
    "node --import tsx scripts/audit/pt09-003-trigger/AG-30.mjs (against the local pt05-local-stack, " +
    "test-evidence/pt-09/environment.json's 2 seeded corporateProspects).",
  scopeTag: "NEEDS-VERIFICATION",
});

appendFindingRow({
  id: "WGR-086",
  layer: "Autonomous Agents",
  severity: "P1",
  description:
    "PT-09-003 execution proof, priority suspect (learningAggregatorNowWired_correctsStaleAssumption): " +
    "AG-36 (src/lib/agents/learning-network-aggregator-agent.ts, ag-36-learning-network) is CONFIRMED " +
    "wired and, per real evidence from an earlier run captured in this same test pass, does genuinely " +
    "create real platform_learning_patterns rows with real anonymized narrative content. However, this " +
    "run's own captured invocation (agent_run_id visible in the evidence file) processed the one " +
    "remaining un-contributed outcome and only UPDATED 2 existing pattern rows (patternsCreated=0, " +
    "patternsUpdated=2) -- a real, narrow WIRED-NO-OUTPUT result for this specific run's delta, distinct " +
    "from the broader (now-corrected) 'orphaned/never-called' finding this suspect item set out to " +
    "re-test. FALSE-PASS CASUALTY: flagged because the run's own before/after delta on " +
    "platform_learning_patterns is 0, per the taxonomy's mechanical rule -- see test-evidence/pt-09/" +
    "execution-batch2.json's suspectDeepDive.learningAggregator for the full resolution and why this is " +
    "expected idempotent update-only behavior once an org's outcomes have all been contributed once.",
  evidencePath: "test-evidence/pt-09/batch2-results/AG-36.json, test-evidence/pt-09/execution-batch2.json suspectDeepDive.learningAggregator",
  reproduction:
    "node --import tsx scripts/audit/pt09-003-trigger/AG-36.mjs (against the local pt05-local-stack, " +
    "platform-level/SYSTEM_ORG_ID, real awarded outcomes from test-evidence/pt-09/environment.json's org).",
  scopeTag: "CONFIRMED-BROKEN",
});

appendFindingRow({
  id: "WGR-087",
  layer: "Autonomous Agents",
  severity: "P1",
  description:
    "PT-09-003 execution proof: AG-40 (src/lib/agents/strategic-advisor-agent.ts, ag-40-strategic-advisor) " +
    "independently reproduces WIRING_GAP_REGISTER.md WGR-059 live: loadOrgProfile()'s select of " +
    "'name, service_area, service_areas' against organizations (which has only the singular service_area " +
    "column, confirmed via a direct information_schema.columns query) fails PostgREST-side on every call, " +
    "silently falling back to { name: 'this organization', service_area: null, service_areas: null }. " +
    "This run additionally wrote zero strategic_recommendations rows (unlike the WGR-059-era run that " +
    "still produced a degraded-but-real row), a distinct empty-output finding on top of the pre-existing " +
    "quality defect. FALSE-PASS CASUALTY: registryPriorStatus (WIRED-SCHEDULED-GATED+QUEUE) implies real " +
    "recommendations are generated nightly; this run produced none, on top of the org-blindness defect.",
  evidencePath: "test-evidence/pt-09/batch2-results/AG-40.json, test-evidence/pt-09/execution-batch2.json",
  reproduction:
    "node --import tsx scripts/audit/pt09-003-trigger/AG-40.mjs (against the local pt05-local-stack, " +
    "test-evidence/pt-09/environment.json org) -- independently re-confirms WGR-059 via a direct " +
    "information_schema.columns query before invoking the agent.",
  scopeTag: "CONFIRMED-BROKEN",
});

appendFindingRow({
  id: "WGR-088",
  layer: "Autonomous Agents",
  severity: "P1",
  description:
    "PT-09-003 execution proof: AG-42 (src/lib/agents/change-monitor-agent.ts, ag-42-change-monitor) " +
    "ran cleanly (agent_runs completed) but wrote zero corporate_monitoring_events rows. Root cause, " +
    "directly observed: this agent's real StealthEngine-driven website check attempted to navigate to " +
    "the 2 seeded corporate_prospects' website URLs (https://lonestar-mfg.example, " +
    "https://hillcountry-logistics.example) and every attempt failed with net::ERR_NAME_NOT_RESOLVED " +
    "(3 retries each) -- these are placeholder .example domains from seed data, not real reachable " +
    "websites, so this is a seed-data limitation for the corporate-prospects half of the scan; the " +
    "foundation_directory half was not independently isolated in this run. FALSE-PASS CASUALTY: " +
    "registryPriorStatus (WIRED-SCHEDULED, CONFIRMED STARTED+firing live per PT-08) implies real " +
    "monitoring happens daily; this run's real network attempts against realistic-shaped seed URLs all " +
    "failed at DNS resolution before any content diff could occur.",
  evidencePath: "test-evidence/pt-09/batch2-results/AG-42.json, test-evidence/pt-09/execution-batch2.json",
  reproduction:
    "node --import tsx scripts/audit/pt09-003-trigger/AG-42.mjs (against the local pt05-local-stack, " +
    "platform-level/SYSTEM_ORG_ID, real headless-browser navigation attempts to seeded prospect website URLs).",
  scopeTag: "NEEDS-VERIFICATION",
});

appendFindingRow({
  id: "WGR-089",
  layer: "Autonomous Agents",
  severity: "P1",
  description:
    "PT-09-003 execution proof: AG-43 (src/lib/agents/funder-signal-monitor-agent.ts, " +
    "ag-43-funder-signals, watchListRef ag43ExistsButUnregistered) ran cleanly (agent_runs completed) " +
    "but wrote zero funder_relationship_signals rows against environment.json's 3 seeded funders -- " +
    "likely the same class of 'real web search against synthetic test funder names finds nothing real " +
    "to cite' result AG-30 hit, though not independently isolated per-call in this run. Independently " +
    "confirms the registry-completeness gap this session's pt09-001 pass first found: this real, " +
    "working agent class has zero agent_registry row (scripts/seed-agent-registry.ts's ROSTER stops at " +
    "ag-42-change-monitor), so it is invisible to any registry-driven tooling even though its code runs " +
    "for real. Flagged as a false-pass casualty per the taxonomy's mechanical WIRED-NO-OUTPUT rule, " +
    "though there is no registry row for this agent to have made a false claim in the first place -- " +
    "the caveat here is scoped to the unregistered-agent gap itself, not a misleading registry status.",
  evidencePath: "test-evidence/pt-09/batch2-results/AG-43__beyond_registered_1-42_range___NOT_in_registry_.json, test-evidence/pt-09/execution-batch2.json",
  reproduction:
    "node --import tsx scripts/audit/pt09-003-trigger/AG-43.mjs (against the local pt05-local-stack, " +
    "test-evidence/pt-09/environment.json's 3 seeded funders).",
  scopeTag: "NEEDS-VERIFICATION",
});

console.log("Appended WGR-081 through WGR-089 to WIRING_GAP_REGISTER.md");
