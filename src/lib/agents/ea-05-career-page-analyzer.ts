// EA-05 Career Page Analyzer (CORPORATE_INTELLIGENCE_ARCHITECTURE.md §2B/§6).
//
// Fetches a corporate prospect's /careers and /jobs pages via StealthEngine
// (same fetch layer as every other EA-0X agent) and asks Claude to infer a
// headcount bracket and cultural signals from the listings/copy.
//
// employee_count_estimate is also a real top-level corporate_prospects
// column, but canonical rule §12.2 ("All enrichment writes to `enrichment`
// jsonb — never new columns per agent") and the task's explicit instruction
// to write to `enrichment` jsonb both point the same way — this agent writes
// enrichment.employee_count_estimate only and never touches the top-level
// column.
//
// Trigger: post-acquisition. Rate: 1 request per 3 seconds between
// candidate-page fetches.

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
export const EA05_RATE_MS = 3_000;

const CANDIDATE_PATHS = ["/careers", "/jobs"] as const;

export interface EA05Input {
  prospectId: string;
}

export interface EA05Result {
  employeeCountEstimate: string | null;
  companyCultureSignals: string[];
  pagesFound: number;
}

interface ExtractedCareer {
  employee_count_estimate?: unknown;
  company_culture_signals?: unknown;
}

const VALID_ESTIMATES = ["1-10", "11-50", "51-200", "201-500", "500+"] as const;

export class EA05CareerPageAnalyzerAgent extends BaseAgent<
  EA05Input,
  EA05Result
> {
  readonly agentType: AgentType = "ea05_career_page_analyzer";

  constructor(options: BaseAgentOptions) {
    super({ ...options, timeoutMs: options.timeoutMs ?? 300_000 });
  }

  protected async execute(
    input: EA05Input,
  ): Promise<AgentExecution<EA05Result>> {
    const prospect = await fetchProspect(this.client, input.prospectId);
    if (!prospect) {
      throw new AgentError("Corporate prospect not found.", "not_found", 404);
    }

    if (!prospect.website) {
      return {
        data: { employeeCountEstimate: null, companyCultureSignals: [], pagesFound: 0 },
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
        if (i > 0) await sleep(EA05_RATE_MS);
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
        data: { employeeCountEstimate: null, companyCultureSignals: [], pagesFound: 0 },
        outputSummary: `${prospect.legal_name}: no careers/jobs pages found.`,
        itemsFound: candidateUrls.length,
        itemsProcessed: 0,
      };
    }

    const prompt = `Analyze this company's careers/jobs page content. Estimate headcount and identify culture signals.

Return ONLY valid JSON: {"employee_count_estimate": one of "1-10","11-50","51-200","201-500","500+" or null, "company_culture_signals": string[]}
Base the headcount estimate on the number/breadth of open roles, office locations mentioned, or explicit statements — never guess without evidence; use null if there's no basis.
company_culture_signals should be short specific phrases (e.g. "remote-friendly", "tuition reimbursement", "volunteer time off").

Page content:
${truncateForClaude(combinedHtml)}`;

    const claudeResult = await callClaude({ prompt, maxTokens: 700 });
    const extracted = parseClaudeJson<ExtractedCareer>(claudeResult.text, {});

    const employeeCountEstimate =
      typeof extracted.employee_count_estimate === "string" &&
      (VALID_ESTIMATES as readonly string[]).includes(extracted.employee_count_estimate)
        ? extracted.employee_count_estimate
        : null;
    const companyCultureSignals = Array.isArray(extracted.company_culture_signals)
      ? extracted.company_culture_signals.filter((v): v is string => typeof v === "string")
      : [];

    await mergeEnrichmentPatch(this.client, prospect, {
      employee_count_estimate: employeeCountEstimate,
      company_culture_signals: companyCultureSignals,
    });

    return {
      data: { employeeCountEstimate, companyCultureSignals, pagesFound },
      outputSummary: `${prospect.legal_name}: employee_count_estimate=${employeeCountEstimate ?? "unknown"}, ${companyCultureSignals.length} culture signal(s) found across ${pagesFound} page(s).`,
      itemsFound: candidateUrls.length,
      itemsProcessed: pagesFound,
      tokensUsed: claudeResult.usage.totalTokens,
    };
  }
}
