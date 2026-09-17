// EA-07 ESG Analyzer (CORPORATE_INTELLIGENCE_ARCHITECTURE.md §2B/§6).
//
// Fetches a corporate prospect's /sustainability and /esg pages via
// StealthEngine and asks Claude to extract stated ESG initiatives and
// environmental commitments. Unlike EA-06/EA-02/EA-03, this agent's spec
// (§2C) doesn't call for a live web search — sustainability/ESG claims are
// company-published statements best read directly off the company's own
// page content, so this uses a plain callClaude like EA-01/EA-05.
//
// Trigger: POST-EA-02 — must run after EA-02 (Community Outreach Detector)
// has completed for this prospect. Enforced below by checking that
// `enrichment.community_involvement` is already present (a key EA-02 always
// writes), same gating pattern EA-03 and EA-06 use.
//
// Rate: 1 request per 3 seconds between candidate-page fetches.

import { callClaude } from "@/lib/ai/claude";
import {
  AgentError,
  BaseAgent,
  type AgentExecution,
  type BaseAgentOptions,
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
export const EA07_RATE_MS = 3_000;

const CANDIDATE_PATHS = ["/sustainability", "/esg"] as const;

export interface EA07Input {
  prospectId: string;
}

export interface EA07Result {
  blocked: boolean;
  esgInitiatives: string[];
  environmentalCommitments: string[];
  pagesFound: number;
}

interface ExtractedEsg {
  esg_initiatives?: unknown;
  environmental_commitments?: unknown;
}

export class EA07EsgAnalyzerAgent extends BaseAgent<EA07Input, EA07Result> {
  readonly agentType: AgentType = "ea07_esg_analyzer";

  constructor(options: BaseAgentOptions) {
    super({ ...options, timeoutMs: options.timeoutMs ?? 300_000 });
  }

  protected async execute(
    input: EA07Input,
  ): Promise<AgentExecution<EA07Result>> {
    const prospect = await fetchProspect(this.client, input.prospectId);
    if (!prospect) {
      throw new AgentError("Corporate prospect not found.", "not_found", 404);
    }

    const ea02Completed = Object.prototype.hasOwnProperty.call(
      prospect.enrichment ?? {},
      "community_involvement",
    );
    if (!ea02Completed) {
      return {
        data: {
          blocked: true,
          esgInitiatives: [],
          environmentalCommitments: [],
          pagesFound: 0,
        },
        outputSummary: `${prospect.legal_name}: skipped — EA-02 (Community Outreach Detector) has not run for this prospect yet.`,
        itemsFound: 0,
        itemsProcessed: 0,
      };
    }

    if (!prospect.website) {
      return {
        data: {
          blocked: false,
          esgInitiatives: [],
          environmentalCommitments: [],
          pagesFound: 0,
        },
        outputSummary: `${prospect.legal_name}: no website on file — skipped.`,
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
        if (i > 0) await sleep(EA07_RATE_MS);
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
      return {
        data: {
          blocked: false,
          esgInitiatives: [],
          environmentalCommitments: [],
          pagesFound: 0,
        },
        outputSummary: `${prospect.legal_name}: no sustainability/esg pages found.`,
        itemsFound: candidateUrls.length,
        itemsProcessed: 0,
      };
    }

    const prompt = `Analyze this company's sustainability/ESG page content. Extract stated ESG initiatives and environmental commitments.

Return ONLY valid JSON: {"esg_initiatives": string[], "environmental_commitments": string[]}
esg_initiatives should be short specific phrases describing environmental, social, or governance programs (e.g. "diversity hiring targets", "carbon-neutral by 2030 pledge").
environmental_commitments should be short specific phrases naming a concrete environmental pledge or metric (e.g. "50% renewable energy by 2027", "zero landfill waste initiative").
Only extract claims actually stated in the page content — never invent one.

Page content:
${truncateForClaude(combinedHtml)}`;

    const claudeResult = await callClaude({ prompt, maxTokens: 800 });
    const extracted = parseClaudeJson<ExtractedEsg>(claudeResult.text, {});

    const esgInitiatives = Array.isArray(extracted.esg_initiatives)
      ? extracted.esg_initiatives.filter((v): v is string => typeof v === "string")
      : [];
    const environmentalCommitments = Array.isArray(extracted.environmental_commitments)
      ? extracted.environmental_commitments.filter((v): v is string => typeof v === "string")
      : [];

    await mergeEnrichmentPatch(this.client, prospect, {
      esg_initiatives: esgInitiatives,
      environmental_commitments: environmentalCommitments,
    });

    return {
      data: { blocked: false, esgInitiatives, environmentalCommitments, pagesFound },
      outputSummary: `${prospect.legal_name}: ${esgInitiatives.length} ESG initiative(s), ${environmentalCommitments.length} environmental commitment(s) found across ${pagesFound} page(s).`,
      itemsFound: candidateUrls.length,
      itemsProcessed: pagesFound,
      tokensUsed: claudeResult.usage.totalTokens,
    };
  }
}
