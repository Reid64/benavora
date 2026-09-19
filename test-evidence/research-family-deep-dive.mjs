#!/usr/bin/env node
// AR-17.3 research-family companion script.
//
// READ-ONLY, same safety convention as scripts/audit/output-quality-sampler.mjs
// (AR-17.1): GET-only against PostgREST, never calls Claude, never executes an
// agent, never writes. Reuses assessAgent()/OUTPUT_LOCATIONS from the base
// sampler unchanged; the only thing this file adds is (a) a fixed target list
// for the research/discovery/enrichment family AR-17.3 covers, run at a wider
// sample cap, and (b) two field-level corrections to registry entries that were
// confirmed live-broken during this pass (documented inline below, not silently
// patched in output-quality-locations.mjs itself, which this script does not
// modify):
//
//   - state_portal's primaryColumn ("eligibility") points at a DB column that
//     does not exist on `opportunities` (confirmed via a live schema probe --
//     the real columns are `eligibility_requirements` and `eligibility_score`,
//     never a bare `eligibility`). src/lib/agents/state-portal.ts never writes
//     eligibility_requirements at all; scraped eligibility text is folded into
//     the `description` column as a "Eligibility: ..." substring instead. This
//     script re-points the assessment at `description` so it returns real data
//     instead of an HTTP 400.
//   - sam_gov_research's agentFilter ("source=eq.sam.gov") does not match any
//     row -- the live `source` value sam-gov.ts actually writes is `sam_gov`
//     (underscore, no dot), confirmed by a live breakdown of opportunities.source
//     values (100 real rows exist under `sam_gov`). This script corrects the
//     filter so the agent is assessed against its real output instead of
//     reporting a false INSUFFICIENT_SAMPLE/n=0.
//
// Run: node test-evidence/research-family-deep-dive.mjs [--json]
// Output: JSON array of assessAgent() results to stdout.

import { OUTPUT_LOCATIONS } from "../scripts/audit/output-quality-locations.mjs";
import { assessAgent } from "../scripts/audit/output-quality-sampler.mjs";

const REGISTRY_CORRECTIONS = {
  state_portal: { primaryColumn: "description", valueType: "text" },
  sam_gov_research: { agentFilter: "source=eq.sam_gov" },
};

const TARGETS = [
  "ea01_giving_detector", "ea02_community_outreach_detector", "ea03_sponsorship_detector",
  "ea04_foundation_detector", "ea05_career_page_analyzer", "ea06_press_release_analyzer",
  "ea07_esg_analyzer", "ea08_executive_biography_analyzer", "ea09_contact_extractor",
  "ea10_social_media_analyzer", "cold_outreach", "giving_history_extractor", "funder_intel",
  "corporate_research", "foundation_research", "local_sponsorship", "government_research",
  "custom_api_research", "custom_scrape_research", "grants_gov_research", "foundation_research_finder",
  "hud_monitor", "government_research_housing_scrapers", "government_research_nofa_parser",
  "sam_gov_research", "simpler_grants_research", "state_portal_housing_scrapers", "state_portal",
  "state_portal_tdhca", "government_research_usaspending", "ag-29-knowledge-indexer",
  "competitor_intelligence",
];

async function main() {
  const asJson = process.argv.includes("--json");
  console.error("READ-ONLY: GET-only against PostgREST. No Claude calls, no agent execution, no writes.\n");

  const results = [];
  for (const agentType of TARGETS) {
    const entries = OUTPUT_LOCATIONS.filter((e) => e.agentType === agentType);
    if (entries.length === 0) {
      results.push({ agentType, status: "NOT_IN_REGISTRY" });
      continue;
    }
    for (const baseEntry of entries) {
      const entry = { ...baseEntry, ...(REGISTRY_CORRECTIONS[agentType] ?? {}) };
      try {
        const r = await assessAgent(entry, { sampleSize: 300 });
        results.push(r);
      } catch (err) {
        results.push({ agentType, modulePath: entry.modulePath, status: "SCRIPT_ERROR", reason: err.message });
      }
    }
  }

  if (asJson) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    for (const r of results) {
      console.log(`${r.agentType}: ${r.status}${r.n_total !== undefined ? ` n_total=${r.n_total}` : ""}`);
    }
  }
}

main().catch((err) => {
  console.error("FATAL:", err.stack || err.message);
  process.exit(1);
});
