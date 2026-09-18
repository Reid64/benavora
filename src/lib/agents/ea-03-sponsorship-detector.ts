// EA-03 Sponsorship Detector (CORPORATE_INTELLIGENCE_ARCHITECTURE.md §2B/§6).
//
// Trigger: POST-EA-01 — must run after EA-01 (Corporate Giving Detector) has
// completed for this prospect. Enforced below by checking that
// `enrichment.has_giving_program` is already present (the key EA-01 always
// writes, even when no giving pages are found) rather than assuming ordering
// from the caller; if it's missing, this agent skips rather than guessing at
// EA-01's not-yet-computed output.
//
// Searches "{company} sponsor" via a web-search-grounded Claude call
// (callClaudeWithWebSearch) and parses the prospect's own /sponsor and
// /sponsorship pages via StealthEngine (same fetch layer every other EA-0X
// agent uses). Rate: 1 request per 5 seconds between candidate-page fetches.

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

/** Per-spec fetch pacing: 1 request every 5 seconds. */
export const EA03_RATE_MS = 5_000;

const CANDIDATE_PATHS = ["/sponsor", "/sponsorship"] as const;

export interface EA03Input {
  prospectId: string;
}

export interface SponsorshipActivity {
  name: string;
  year?: number;
  type?: string;
}

export interface EA03Result {
  blocked: boolean;
  sponsorshipActivity: SponsorshipActivity[];
  marketingBudgetEstimate: string | null;
}

interface ExtractedSponsorship {
  sponsorship_activity?: unknown;
  marketing_budget_estimate?: unknown;
}

export class EA03SponsorshipDetectorAgent extends BaseAgent<
  EA03Input,
  EA03Result
> {
  readonly agentType: AgentType = "ea03_sponsorship_detector";

  constructor(options: BaseAgentOptions) {
    super({ ...options, timeoutMs: options.timeoutMs ?? AGENT_TIMEOUT_MULTI_STEP_MS });
  }

  protected async execute(
    input: EA03Input,
  ): Promise<AgentExecution<EA03Result>> {
    const prospect = await fetchProspect(this.client, input.prospectId);
    if (!prospect) {
      throw new AgentError("Corporate prospect not found.", "not_found", 404);
    }

    const eligibilityChecked = Object.prototype.hasOwnProperty.call(
      prospect.enrichment ?? {},
      "has_giving_program",
    );
    if (!eligibilityChecked) {
      return {
        data: { blocked: true, sponsorshipActivity: [], marketingBudgetEstimate: null },
        outputSummary: `${prospect.legal_name}: skipped — EA-01 (Corporate Giving Detector) has not run for this prospect yet.`,
        itemsFound: 0,
        itemsProcessed: 0,
      };
    }

    let sponsorPageText = "";
    if (prospect.website) {
      const candidateUrls = buildCandidateUrls(prospect.website, CANDIDATE_PATHS);
      const engine = new StealthEngine();
      try {
        await engine.init();
        for (let i = 0; i < candidateUrls.length; i++) {
          if (i > 0) await sleep(EA03_RATE_MS);
          const url = candidateUrls[i];
          if (!url) continue;
          const html = await engine.fetchPage(url);
          if (html) sponsorPageText += `\n\n--- ${url} ---\n${html}`;
        }
      } finally {
        await engine.close();
      }
    }

    const prompt = `Search the web for "${prospect.legal_name} sponsor" and review any sponsor/sponsorship page content provided below to determine this company's sponsorship activity and estimated marketing budget.

Return ONLY valid JSON: {"sponsorship_activity": [{"name": string, "year": number or null, "type": string or null}], "marketing_budget_estimate": string or null}
type should be one of: event, team, nonprofit, community, other.
marketing_budget_estimate should be one of: "<100K", "100K-1M", "1M-10M", "10M+", or null if there is no basis to estimate.

Sponsor page content (may be empty if none was found):
${truncateForClaude(sponsorPageText || "(no sponsor page fetched)")}`;

    const claudeResult = await callClaudeWithWebSearch({
      prompt,
      maxTokens: 900,
      maxSearches: 4,
    });
    const extracted = parseClaudeJson<ExtractedSponsorship>(claudeResult.text, {});

    const sponsorshipActivity: SponsorshipActivity[] = Array.isArray(
      extracted.sponsorship_activity,
    )
      ? extracted.sponsorship_activity
          .filter(
            (v): v is Record<string, unknown> =>
              typeof v === "object" && v !== null && typeof (v as Record<string, unknown>).name === "string",
          )
          .map((v) => ({
            name: v.name as string,
            ...(typeof v.year === "number" ? { year: v.year } : {}),
            ...(typeof v.type === "string" ? { type: v.type } : {}),
          }))
      : [];
    const marketingBudgetEstimate =
      typeof extracted.marketing_budget_estimate === "string"
        ? extracted.marketing_budget_estimate
        : null;

    await mergeEnrichmentPatch(this.client, prospect, {
      sponsorship_activity: sponsorshipActivity,
      marketing_budget_estimate: marketingBudgetEstimate,
    });

    return {
      data: { blocked: false, sponsorshipActivity, marketingBudgetEstimate },
      outputSummary: `${prospect.legal_name}: ${sponsorshipActivity.length} sponsorship record(s) found, budget estimate=${marketingBudgetEstimate ?? "unknown"}.`,
      itemsFound: 1,
      itemsProcessed: sponsorshipActivity.length,
      tokensUsed: claudeResult.usage.totalTokens,
    };
  }
}
