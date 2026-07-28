// EA-10 Social Media Analyzer (CORPORATE_INTELLIGENCE_ARCHITECTURE.md §2B/§6).
//
// Unlike EA-01/EA-02/EA-05/EA-07/EA-08/EA-09, this agent has no reliable
// same-origin URL to fetch: corporate_prospects does not yet store the
// company's own LinkedIn/Facebook page URLs (no adapter in this codebase
// populates `enrichment.social_media_urls`, per
// CORPORATE_INTELLIGENCE_ARCHITECTURE.md §2A "Digital Presence"). So this
// agent grounds a single Claude call with live web search
// (callClaudeWithWebSearch) to search for and read the company's LinkedIn
// company page and public Facebook page — the same "search since we don't
// have a direct URL" approach EA-03 already uses for sponsor pages.
//
// Trigger: POST-EA-08 — must run after EA-08 (Executive Biography Analyzer)
// has completed for this prospect. Enforced below by checking that
// `enrichment.decision_maker_names` is already present (a key EA-08 always
// writes, including the empty-result case) — same gating pattern EA-03/EA-06
// use for their own upstream dependency.
//
// Two of this agent's three output fields — community_involvement (also
// written by EA-02) and employee_count_estimate (also written by EA-05) —
// overlap with earlier agents' fields. Per canonical rule §12.8
// ("Re-enrichment never overwrites manually verified fields"), this agent
// never blindly replaces those: community_involvement is merged (deduped
// union) with whatever EA-02 already found, and employee_count_estimate is
// only written if EA-05 hasn't already set one (career-page evidence is
// treated as the higher-confidence source over a social-media guess).
//
// Rate: 1 request per 5 seconds. There is no same-origin candidate-page loop
// to pace here (a single web-search-grounded Claude call, not a fetch loop),
// so this constant documents the pacing a batch/queue runner processing many
// prospects must apply between prospects — same convention EA-04 uses for
// its own no-internal-loop rate constant.

import { callClaudeWithWebSearch } from "@/lib/ai/claude";
import {
  AgentError,
  BaseAgent,
  type AgentExecution,
} from "@/lib/agents/base-agent";
import type { AgentType } from "@/types/agents";
import {
  fetchProspect,
  mergeEnrichmentPatch,
  parseClaudeJson,
} from "@/lib/agents/corporate-enrichment-shared";

/** Per-spec pacing for a batch runner: 1 request every 5 seconds. */
export const EA10_RATE_MS = 5_000;

const VALID_ESTIMATES = ["1-10", "11-50", "51-200", "201-500", "500+"] as const;

export interface EA10Input {
  prospectId: string;
}

export interface EA10Result {
  blocked: boolean;
  communityInvolvement: string[];
  recentDonations: string[];
  employeeCountEstimate: string | null;
}

interface ExtractedSocialMedia {
  community_involvement?: unknown;
  recent_donations?: unknown;
  employee_count_estimate?: unknown;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export class EA10SocialMediaAnalyzerAgent extends BaseAgent<
  EA10Input,
  EA10Result
> {
  readonly agentType: AgentType = "ea10_social_media_analyzer";

  protected async execute(
    input: EA10Input,
  ): Promise<AgentExecution<EA10Result>> {
    const prospect = await fetchProspect(this.client, input.prospectId);
    if (!prospect) {
      throw new AgentError("Corporate prospect not found.", "not_found", 404);
    }

    const ea08Completed = Object.prototype.hasOwnProperty.call(
      prospect.enrichment ?? {},
      "decision_maker_names",
    );
    if (!ea08Completed) {
      return {
        data: {
          blocked: true,
          communityInvolvement: [],
          recentDonations: [],
          employeeCountEstimate: null,
        },
        outputSummary: `${prospect.legal_name}: skipped — EA-08 (Executive Biography Analyzer) has not run for this prospect yet.`,
        itemsFound: 0,
        itemsProcessed: 0,
      };
    }

    const prompt = `Search the web for "${prospect.legal_name}" LinkedIn company page and public Facebook page. Review both to identify community involvement, recent donation announcements, and an employee headcount estimate.

Return ONLY valid JSON: {"community_involvement": string[], "recent_donations": string[], "employee_count_estimate": one of "1-10","11-50","51-200","201-500","500+" or null}
community_involvement lists specific programs/activities mentioned on LinkedIn or Facebook (e.g. "sponsored local food drive", "employee volunteer day post").
recent_donations lists specific donation/charitable-gift announcements found in posts.
employee_count_estimate should come from LinkedIn's stated headcount range if shown; use null if there's no basis.
Only extract what is actually stated on these pages — never invent a claim.

Company: ${prospect.legal_name}`;

    const claudeResult = await callClaudeWithWebSearch({
      prompt,
      maxTokens: 900,
      maxSearches: 4,
    });
    const extracted = parseClaudeJson<ExtractedSocialMedia>(claudeResult.text, {});

    const newCommunityInvolvement = stringArray(extracted.community_involvement);
    const recentDonations = stringArray(extracted.recent_donations);
    const rawEstimate = extracted.employee_count_estimate;
    const newEmployeeCountEstimate =
      typeof rawEstimate === "string" && (VALID_ESTIMATES as readonly string[]).includes(rawEstimate)
        ? rawEstimate
        : null;

    // Merge with EA-02's existing community_involvement rather than replacing it.
    const existingCommunityInvolvement = stringArray(
      (prospect.enrichment ?? {}).community_involvement,
    );
    const communityInvolvement = Array.from(
      new Set([...existingCommunityInvolvement, ...newCommunityInvolvement]),
    );

    // Prefer EA-05's career-page-derived estimate (higher-confidence source)
    // over a social-media guess if one already exists.
    const existingEmployeeCountEstimate =
      typeof (prospect.enrichment ?? {}).employee_count_estimate === "string"
        ? ((prospect.enrichment ?? {}).employee_count_estimate as string)
        : null;
    const employeeCountEstimate = existingEmployeeCountEstimate ?? newEmployeeCountEstimate;

    await mergeEnrichmentPatch(this.client, prospect, {
      community_involvement: communityInvolvement,
      recent_donations: recentDonations,
      employee_count_estimate: employeeCountEstimate,
    });

    return {
      data: {
        blocked: false,
        communityInvolvement,
        recentDonations,
        employeeCountEstimate,
      },
      outputSummary: `${prospect.legal_name}: ${newCommunityInvolvement.length} new involvement signal(s), ${recentDonations.length} recent donation(s) found (web search used: ${claudeResult.usedWebSearch}).`,
      itemsFound: 1,
      itemsProcessed: newCommunityInvolvement.length + recentDonations.length,
      tokensUsed: claudeResult.usage.totalTokens,
    };
  }
}
