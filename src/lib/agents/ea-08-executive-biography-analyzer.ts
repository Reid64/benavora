// EA-08 Executive Biography Analyzer (CORPORATE_INTELLIGENCE_ARCHITECTURE.md §2B/§6).
//
// Fetches a corporate prospect's /leadership and /about/team pages via
// StealthEngine and asks Claude to extract decision-maker names/titles,
// board memberships, and LinkedIn profile URLs.
//
// Trigger: post-acquisition (same as EA-01/EA-05/EA-09 — no upstream EA-0X
// dependency). Rate: 1 request per 3 seconds between candidate-page fetches.
//
// Unlike EA-01/EA-05 (which only patch enrichment when they find something,
// or on the deliberate zero-pages-found branch for EA-01), this agent always
// writes a patch once it has a website to try — including an explicit empty
// result when no leadership pages are found — because EA-10 (Social Media
// Analyzer) gates on `enrichment.decision_maker_names` being present to know
// EA-08 has already run for this prospect. A silent "nothing to patch" here
// would leave EA-10 blocked forever for prospects with no leadership page.

import { callClaude } from "@/lib/ai/claude";
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
export const EA08_RATE_MS = 3_000;

const CANDIDATE_PATHS = ["/leadership", "/about/team"] as const;

export interface EA08Input {
  prospectId: string;
}

export interface EA08Result {
  decisionMakerNames: string[];
  decisionMakerTitles: string[];
  boardMembers: string[];
  linkedinProfiles: string[];
  pagesFound: number;
}

interface ExtractedExecutiveBio {
  decision_maker_names?: unknown;
  decision_maker_titles?: unknown;
  board_members?: unknown;
  linkedin_profiles?: unknown;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export class EA08ExecutiveBiographyAnalyzerAgent extends BaseAgent<
  EA08Input,
  EA08Result
> {
  readonly agentType: AgentType = "ea08_executive_biography_analyzer";

  constructor(options: BaseAgentOptions) {
    super({ ...options, timeoutMs: options.timeoutMs ?? AGENT_TIMEOUT_MULTI_STEP_MS });
  }

  protected async execute(
    input: EA08Input,
  ): Promise<AgentExecution<EA08Result>> {
    const prospect = await fetchProspect(this.client, input.prospectId);
    if (!prospect) {
      throw new AgentError("Corporate prospect not found.", "not_found", 404);
    }

    const emptyResult: EA08Result = {
      decisionMakerNames: [],
      decisionMakerTitles: [],
      boardMembers: [],
      linkedinProfiles: [],
      pagesFound: 0,
    };

    if (!prospect.website) {
      // No website at all -- mark EA-08 as "ran, found nothing" so EA-10's
      // gate still unblocks rather than waiting forever on a prospect that
      // will never grow a leadership page.
      await mergeEnrichmentPatch(this.client, prospect, {
        decision_maker_names: [],
        decision_maker_titles: [],
        board_members: [],
        linkedin_profiles: [],
      });
      return {
        data: emptyResult,
        outputSummary: `${prospect.legal_name}: no website on file — recorded empty result.`,
        itemsFound: 0,
        itemsProcessed: 0,
      };
    }

    const candidateUrls = buildCandidateUrls(prospect.website, CANDIDATE_PATHS);
    const engine = new StealthEngine();
    let combinedHtml = "";
    let pagesFound = 0;

    try {
      await engine.init();
      for (let i = 0; i < candidateUrls.length; i++) {
        if (i > 0) await sleep(EA08_RATE_MS);
        const url = candidateUrls[i];
        if (!url) continue;
        const html = await engine.fetchPage(url);
        if (html) {
          pagesFound++;
          combinedHtml += `\n\n--- ${url} ---\n${html}`;
        }
      }
    } finally {
      await engine.close();
    }

    if (pagesFound === 0) {
      await mergeEnrichmentPatch(this.client, prospect, {
        decision_maker_names: [],
        decision_maker_titles: [],
        board_members: [],
        linkedin_profiles: [],
      });
      return {
        data: { ...emptyResult, pagesFound: 0 },
        outputSummary: `${prospect.legal_name}: no leadership/team pages found.`,
        itemsFound: candidateUrls.length,
        itemsProcessed: 0,
      };
    }

    const prompt = `Analyze this company's leadership/team page content. Extract decision-maker names, titles, board memberships, and LinkedIn profile URLs.

Return ONLY valid JSON: {"decision_maker_names": string[], "decision_maker_titles": string[], "board_members": string[], "linkedin_profiles": string[]}
decision_maker_names and decision_maker_titles must be parallel arrays (same length, same order) — one title per name.
board_members should list any named board of directors/advisors members mentioned.
linkedin_profiles should be full LinkedIn profile URLs if present in the page content; otherwise leave empty.
Only extract people actually named in the page content — never invent one.

Page content:
${truncateForClaude(combinedHtml)}`;

    const claudeResult = await callClaude({ prompt, maxTokens: 1000 });
    const extracted = parseClaudeJson<ExtractedExecutiveBio>(claudeResult.text, {});

    const decisionMakerNames = stringArray(extracted.decision_maker_names);
    const decisionMakerTitles = stringArray(extracted.decision_maker_titles);
    const boardMembers = stringArray(extracted.board_members);
    const linkedinProfiles = stringArray(extracted.linkedin_profiles);

    await mergeEnrichmentPatch(this.client, prospect, {
      decision_maker_names: decisionMakerNames,
      decision_maker_titles: decisionMakerTitles,
      board_members: boardMembers,
      linkedin_profiles: linkedinProfiles,
    });

    return {
      data: {
        decisionMakerNames,
        decisionMakerTitles,
        boardMembers,
        linkedinProfiles,
        pagesFound,
      },
      outputSummary: `${prospect.legal_name}: ${decisionMakerNames.length} decision-maker(s), ${boardMembers.length} board member(s) found across ${pagesFound} page(s).`,
      itemsFound: candidateUrls.length,
      itemsProcessed: pagesFound,
      tokensUsed: claudeResult.usage.totalTokens,
    };
  }
}
