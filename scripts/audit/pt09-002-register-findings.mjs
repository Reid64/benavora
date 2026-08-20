import { appendFindingRow } from "./evidence-lib.mjs";

appendFindingRow({
  id: "WGR-077",
  layer: "Autonomous Agents",
  severity: "P1",
  description:
    "PT-09-002 execution proof: AG-05 (ag-05-research family; representative member tested: " +
    "src/lib/agents/research/corporate-giving.ts, CorporateGivingResearchAgent) ran end-to-end " +
    "against a real local Supabase target with a real Claude-capable BaseAgent invocation -- a " +
    "real agent_runs row was written and the run resolved cleanly (data: opportunitiesFound=0, " +
    "opportunitiesCreated=0, fundersCreated=0) -- but ZERO real business-table rows (opportunities, " +
    "funders) were written. This is the WIRED-NO-OUTPUT class: the agent looks like it ran " +
    "successfully (no thrown error, a clean agent_runs completion) but produced no actual output. " +
    "Plausible root cause per the run's own triggerLog: the agent's real dependency on scraping " +
    "live Google search results is vulnerable to a CAPTCHA/bot-block or a run with zero qualifying " +
    "candidate pages. Only 1 of the ~10 files in the ag-05-research family was directly executed " +
    "(corporate-giving.ts); this finding speaks only to that one member. Several documented " +
    "siblings (grants_gov_research, simpler_grants_research, state_portal, custom_api_research) " +
    "already carry their own distinct, previously-documented breakage per " +
    "test-evidence/pt-09/agent-inventory.json / STATE_OF_THE_BUILD.md's 2026-08-04 entry, not " +
    "re-verified or exercised by this test. FALSE-PASS CASUALTY: registryPriorStatus for this " +
    "agent's registered trigger path (WIRED-MANUAL-API, src/app/api/agents/research/route.ts) " +
    "implies a working manual API surface; this execution proof shows the underlying agent can " +
    "run clean and still write nothing.",
  evidencePath: "test-evidence/pt-09/batch1-results/AG-05.json, test-evidence/pt-09/execution-batch1.json",
  reproduction:
    "node --import tsx scripts/audit/pt09-002-trigger/AG-05.mjs (against the local pt05-local-stack, " +
    "test-evidence/pt-09/environment.json org) -- compares agent_runs/opportunities/funders row " +
    "counts before and after via a direct pg connection, independent of the agent's own client.",
  scopeTag: "CONFIRMED-BROKEN",
});

appendFindingRow({
  id: "WGR-078",
  layer: "Autonomous Agents",
  severity: "P1",
  description:
    "PT-09-002 execution proof: AG-13 (ag-13-foundation-enrichment, src/lib/scraper/" +
    "foundation-scraper.ts, enrichSingleFoundation()) ran to completion cleanly (no throw) and " +
    "returned enriched=false, strategy=\"none\" -- none of the 3 waterfall enrichment strategies " +
    "patched foundation_directory. Root-caused per-strategy, not left ambiguous: Strategy 1 (IRS " +
    "990 XML) was not meaningfully exercised because the local seed row's ein is null (a seed-data " +
    "limitation, not a code defect -- real BMF-imported foundation_directory rows in production do " +
    "carry an EIN). Strategy 2 (Google search fallback) WAS exercised for real and hit a genuine, " +
    "reproducible, non-seed-specific wall on all 3 attempts: \"CAPTCHA detected (recaptcha_v2) -- " +
    "no TWOCAPTCHA_API_KEY configured, skipping page.\" This is confirmed non-functional as " +
    "currently deployed whenever Google serves a CAPTCHA challenge, independent of which foundation " +
    "is being enriched. Strategy 3 (contact-page extraction) never ran since it requires a website, " +
    "which neither Strategy 1 nor 2 produced. Net: a genuine \"ran clean, wrote nothing\" result " +
    "for a real, currently-scheduled production job (foundation-enrichment-weekly, worker/" +
    "scheduler.ts, Sunday 3AM, gated on ENABLE_SCRAPER=true), with Strategy 2's CAPTCHA/no-solver-" +
    "key wall as the most actionable, generalizable cause. FALSE-PASS CASUALTY: registryPriorStatus " +
    "describes this job as WIRED-SCHEDULED-ENV-GATED (i.e. actively scheduled in production); this " +
    "proof shows a real invocation of its core enrichment function writes nothing whenever the " +
    "Google-fallback strategy is needed and no CAPTCHA solver key is configured.",
  evidencePath: "test-evidence/pt-09/batch1-results/AG-13.json, test-evidence/pt-09/execution-batch1.json",
  reproduction:
    "node --import tsx scripts/audit/pt09-002-trigger/AG-13.mjs (against the local pt05-local-stack, " +
    "test-evidence/pt-09/environment.json foundationDirectory seed row) -- captures per-strategy " +
    "console output and before/after foundation_directory row content via a direct pg connection.",
  scopeTag: "CONFIRMED-BROKEN",
});

appendFindingRow({
  id: "WGR-079",
  layer: "Autonomous Agents",
  severity: "P1",
  description:
    "PT-09-002 execution proof: AG-14 (ag-14-donor-discovery, worker/dd-request-processor.ts, " +
    "DdRequestProcessor) -- two real, distinct findings from directly exercising this class against " +
    "a schema mirrored from real production. (1) dequeue() -- the method the real continuous-poll " +
    "loop() calls every 15s in production, confirmed STARTED per test-evidence/pt-08/boot-" +
    "inventory.json -- depends on the RPC donor_discovery_claim_request, which does NOT exist in " +
    "production (migration 070, which defines it, was never applied). dequeue()'s own error " +
    "handling (worker/dd-request-processor.ts ~line 268-271) treats this exactly like an empty " +
    "queue: a server console.error line only, never a database record. A real queued request is " +
    "left sitting in status='queued' forever with zero visible sign anything is wrong anywhere in " +
    "the product -- this is the ERROR-SWALLOWED variant of the taxonomy: the real cause is " +
    "invisible to anyone not tailing server logs at the exact moment of the RPC failure. (2) " +
    "Bypassing dequeue() and calling processItem() directly on a second probe row reaches further " +
    "but immediately fails at the taxonomy_ids -> donor_discovery_taxonomy lookup, because that " +
    "table ALSO does not exist in production (migration 067 is explicitly documented as file-only, " +
    "never applied). This second failure IS recorded to the DB (the harness replicated loop()'s " +
    "real catch/update-to-failed behavior) -- see the result's sampleWrittenRow. Net: zero rows " +
    "landed in donor_discovery_directory or donor_discovery_prospects via either path. In real, " +
    "unmodified production, this continuous poll loop can never successfully claim or process a " +
    "single real request, and does so silently. FALSE-PASS CASUALTY: registryPriorStatus describes " +
    "this as WIRED-EVENT-CONTINUOUS-POLL, CONFIRMED STARTED -- true for the process itself, but the " +
    "per-item work it exists to do cannot succeed even once against the real, live production " +
    "schema.",
  evidencePath: "test-evidence/pt-09/batch1-results/AG-14.json, test-evidence/pt-09/execution-batch1.json",
  reproduction:
    "node --import tsx scripts/audit/pt09-002-trigger/AG-14.mjs -- inserts a real donor_discovery_" +
    "requests row against the local pt05-local-stack, calls DdRequestProcessor's real dequeue() " +
    "and (bracket-accessed) processItem() directly, and independently re-queries donor_discovery_" +
    "requests/directory/prospects via a direct pg connection.",
  scopeTag: "CONFIRMED-BROKEN",
});

appendFindingRow({
  id: "WGR-080",
  layer: "Autonomous Agents",
  severity: "P1",
  description:
    "PT-09-002 execution proof: AG-18 (ag-18-reputation, src/lib/intelligence/reputation-agent.ts, " +
    "ReputationIntelligenceAgent.runForFunder()) completed cleanly (agent_runs output: success=true, " +
    "itemsFound=1, itemsProcessed=0, itemsQueued=0, decisions=[], errors=[]) but zero reputation_" +
    "signals rows were written. Root-caused, not left ambiguous: a follow-up direct call to " +
    "DuckDuckGo's Instant-Answer API (the exact query searchDuckDuckGo() builds internally) for a " +
    "very well-known, real, litigation-heavy entity (\"Wells Fargo\") independently returned " +
    "RelatedTopics: [] -- 0 results. The response body's own meta fields (production_state: " +
    "\"offline\", src_url: \"Hello there\", description: \"testing\") indicate DuckDuckGo's free " +
    "Instant-Answer endpoint is a curated near-empty test/answer index, NOT a general web search " +
    "API -- it will structurally return 0 results for the overwhelming majority of real " +
    "risk-keyword queries regardless of which entity is searched. This means " +
    "checkEntityReputation()'s search step (and therefore this agent's reputation-monitoring " +
    "capability as a whole) is very likely non-functional against real-world signal detection as " +
    "currently implemented, independent of Claude classification quality -- Claude was never " +
    "reached this run since searchDuckDuckGo() returning [] short-circuits before any " +
    "classification call. FALSE-PASS CASUALTY: registryPriorStatus describes this as WIRED-" +
    "SCHEDULED-GATED (nightly 2AM pipeline, gated on auto_reputation_enabled); this proof shows " +
    "the underlying search dependency is structurally near-useless for the feature's actual " +
    "purpose, so even orgs with the autonomy toggle enabled are unlikely to ever receive a real " +
    "reputation signal from this path.",
  evidencePath: "test-evidence/pt-09/batch1-results/AG-18.json, test-evidence/pt-09/execution-batch1.json",
  reproduction:
    "node --import tsx scripts/audit/pt09-002-trigger/AG-18.mjs (against the local pt05-local-stack, " +
    "a seeded funder from test-evidence/pt-09/environment.json) -- independently re-verifiable by a " +
    "direct fetch to https://api.duckduckgo.com/?q=<any real risk-keyword query>&format=json and " +
    "inspecting RelatedTopics.length.",
  scopeTag: "CONFIRMED-BROKEN",
});

console.log("Appended WGR-077 through WGR-080 to WIRING_GAP_REGISTER.md");
