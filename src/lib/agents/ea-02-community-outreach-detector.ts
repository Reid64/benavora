// EA-02 Community Outreach Detector (CORPORATE_INTELLIGENCE_ARCHITECTURE.md §2B/§6).
//
// Fetches a corporate prospect's about page via StealthEngine, then grounds
// a single Claude call with live web search (callClaudeWithWebSearch,
// src/lib/ai/claude.ts) over both the fetched page and recent news so
// "community involvement" isn't guessed from Claude's training-data recall
// alone (same rationale AG-30/AG-35 already use this helper for).
//
// Trigger: post-acquisition. Rate: 1 request per 3 seconds between
// candidate-page fetches. No queue/dispatcher wiring exists yet — see
// ea-01-giving-detector.ts header for the same caveat.

import { callClaudeWithWebSearch } from "@/lib/ai/claude";
import {
  AgentError,
  BaseAgent,
  type AgentExecution,
  type BaseAgentOptions,
  AGENT_TIMEOUT_MULTI_STEP_MS,
} from "@/lib/agents/base-agent";
import { StealthEngine } from "@/lib/scraper/stealth-engine";
import type { AgentType } from "@/types/agents";
import {
  buildCandidateUrls,
  fetchProspect,
  mergeEnrichmentPatch,
  parseClaudeJson,
  sleep,
  truncateForClaude,
} from "@/lib/agents/corporate-enrichment-shared";

/** Per-spec fetch pacing: 1 request every 3 seconds. */
export const EA02_RATE_MS = 3_000;

const CANDIDATE_PATHS = ["/about", "/about-us"] as const;

export interface EA02Input {
  prospectId: string;
}

export interface EA02Result {
  communityInvolvement: string[];
  localCausesSupported: string[];
  habitatPartner: boolean;
  unitedWayPartner: boolean;
}

interface ExtractedOutreach {
  community_involvement?: unknown;
  local_causes_supported?: unknown;
  habitat_partner?: unknown;
  united_way_partner?: unknown;
}

export class EA02CommunityOutreachDetectorAgent extends BaseAgent<
  EA02Input,
  EA02Result
> {
  readonly agentType: AgentType = "ea02_community_outreach_detector";

  constructor(options: BaseAgentOptions) {
    super({ ...options, timeoutMs: options.timeoutMs ?? AGENT_TIMEOUT_MULTI_STEP_MS });
  }

  protected async execute(
    input: EA02Input,
  ): Promise<AgentExecution<EA02Result>> {
    const prospect = await fetchProspect(this.client, input.prospectId);
    if (!prospect) {
      throw new AgentError("Corporate prospect not found.", "not_found", 404);
    }

    let aboutPageText = "";
    if (prospect.website) {
      const candidateUrls = buildCandidateUrls(prospect.website, CANDIDATE_PATHS);
      const engine = new StealthEngine();
      try {
        await engine.init();
        for (let i = 0; i < candidateUrls.length; i++) {
          if (i > 0) await sleep(EA02_RATE_MS);
          const url = candidateUrls[i];
          if (!url) continue;
          const html = await engine.fetchPage(url);
          if (html) {
            aboutPageText += `\n\n--- ${url} ---\n${html}`;
            break; // one working about page is enough context for extraction
          }
        }
      } finally {
        await engine.close();
      }
    }

    const prompt = `Determine this company's community involvement based on its about page (if provided below) and current web search results for recent news.
Company: ${prospect.legal_name}

Return ONLY valid JSON: {"community_involvement": string[], "local_causes_supported": string[], "habitat_partner": boolean, "united_way_partner": boolean}
community_involvement lists specific programs/activities (e.g. "employee volunteer days", "local food bank partnership").
local_causes_supported lists specific named causes/organizations, not generic categories.
habitat_partner: true only if there is specific evidence of a Habitat for Humanity partnership.
united_way_partner: true only if there is specific evidence of a United Way partnership.

About page content (may be empty if none was found):
${truncateForClaude(aboutPageText || "(no about page fetched)")}`;

    const claudeResult = await callClaudeWithWebSearch({
      prompt,
      maxTokens: 900,
      maxSearches: 3,
    });
    const extracted = parseClaudeJson<ExtractedOutreach>(claudeResult.text, {});

    const communityInvolvement = Array.isArray(extracted.community_involvement)
      ? extracted.community_involvement.filter((v): v is string => typeof v === "string")
      : [];
    const localCausesSupported = Array.isArray(extracted.local_causes_supported)
      ? extracted.local_causes_supported.filter((v): v is string => typeof v === "string")
      : [];
    const habitatPartner = extracted.habitat_partner === true;
    const unitedWayPartner = extracted.united_way_partner === true;

    await mergeEnrichmentPatch(this.client, prospect, {
      community_involvement: communityInvolvement,
      local_causes_supported: localCausesSupported,
      habitat_partner: habitatPartner,
      united_way_partner: unitedWayPartner,
    });

    return {
      data: {
        communityInvolvement,
        localCausesSupported,
        habitatPartner,
        unitedWayPartner,
      },
      outputSummary: `${prospect.legal_name}: ${communityInvolvement.length} involvement signal(s), ${localCausesSupported.length} cause(s) found (web search used: ${claudeResult.usedWebSearch}).`,
      itemsFound: 1,
      itemsProcessed: communityInvolvement.length + localCausesSupported.length,
      tokensUsed: claudeResult.usage.totalTokens,
    };
  }
}
