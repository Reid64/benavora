// EA-06 Press Release Analyzer (CORPORATE_INTELLIGENCE_ARCHITECTURE.md §2B/§6).
//
// Fetches a corporate prospect's /news and /press pages via StealthEngine
// (same fetch layer every other EA-0X agent uses), then grounds a single
// Claude call with live web search (callClaudeWithWebSearch) over both the
// fetched pages and recent news so donation announcements and leadership
// changes aren't guessed from training-data recall alone (same rationale
// EA-02/EA-03 already use this helper for).
//
// Trigger: POST-EA-02 — must run after EA-02 (Community Outreach Detector)
// has completed for this prospect. Enforced below by checking that
// `enrichment.community_involvement` is already present (a key EA-02 always
// writes, even when no about page is found) rather than assuming ordering
// from the caller; if it's missing, this agent skips rather than guessing at
// EA-02's not-yet-computed output. Same pattern EA-03 uses to gate on EA-01.
//
// Rate: 1 request per 3 seconds between candidate-page fetches.

import { callClaudeWithWebSearch } from "@/lib/ai/claude";
import {
  AgentError,
  BaseAgent,
  type AgentExecution,
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
export const EA06_RATE_MS = 3_000;

const CANDIDATE_PATHS = ["/news", "/press"] as const;

export interface EA06Input {
  prospectId: string;
}

export interface DonationRecord {
  year?: number;
  type?: string;
  recipient?: string;
  amount?: string;
}

export interface EA06Result {
  blocked: boolean;
  donationHistory: DonationRecord[];
  recentGifts: string[];
  executiveChanges: string[];
}

interface ExtractedPressRelease {
  donation_history?: unknown;
  recent_gifts?: unknown;
  executive_changes?: unknown;
}

export class EA06PressReleaseAnalyzerAgent extends BaseAgent<
  EA06Input,
  EA06Result
> {
  readonly agentType: AgentType = "ea06_press_release_analyzer";

  protected async execute(
    input: EA06Input,
  ): Promise<AgentExecution<EA06Result>> {
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
          donationHistory: [],
          recentGifts: [],
          executiveChanges: [],
        },
        outputSummary: `${prospect.legal_name}: skipped — EA-02 (Community Outreach Detector) has not run for this prospect yet.`,
        itemsFound: 0,
        itemsProcessed: 0,
      };
    }

    let pressPageText = "";
    if (prospect.website) {
      const candidateUrls = buildCandidateUrls(prospect.website, CANDIDATE_PATHS);
      const engine = new StealthEngine();
      try {
        await engine.init();
        for (let i = 0; i < candidateUrls.length; i++) {
          if (i > 0) await sleep(EA06_RATE_MS);
          const url = candidateUrls[i];
          if (!url) continue;
          const html = await engine.fetchPage(url);
          if (html) pressPageText += `\n\n--- ${url} ---\n${html}`;
        }
      } finally {
        await engine.close();
      }
    }

    const prompt = `Search the web for recent news about "${prospect.legal_name}" and review any news/press page content provided below to identify donation announcements, recent charitable gifts, and executive leadership changes.

Return ONLY valid JSON: {"donation_history": [{"year": number or null, "type": string or null, "recipient": string or null, "amount": string or null}], "recent_gifts": string[], "executive_changes": string[]}
donation_history should capture specific award/gift records mentioned in press coverage (type e.g. cash_grant, in_kind_donation, sponsorship, scholarship).
recent_gifts should be short human-readable descriptions of any donation announced in roughly the last 2 years.
executive_changes should be short descriptions of leadership changes (new hire, departure, promotion) found in press coverage.

Press page content (may be empty if none was found):
${truncateForClaude(pressPageText || "(no news/press page fetched)")}`;

    const claudeResult = await callClaudeWithWebSearch({
      prompt,
      maxTokens: 1200,
      maxSearches: 4,
    });
    const extracted = parseClaudeJson<ExtractedPressRelease>(claudeResult.text, {});

    const donationHistory: DonationRecord[] = Array.isArray(extracted.donation_history)
      ? extracted.donation_history
          .filter((v): v is Record<string, unknown> => typeof v === "object" && v !== null)
          .map((v) => ({
            ...(typeof v.year === "number" ? { year: v.year } : {}),
            ...(typeof v.type === "string" ? { type: v.type } : {}),
            ...(typeof v.recipient === "string" ? { recipient: v.recipient } : {}),
            ...(typeof v.amount === "string" ? { amount: v.amount } : {}),
          }))
      : [];
    const recentGifts = Array.isArray(extracted.recent_gifts)
      ? extracted.recent_gifts.filter((v): v is string => typeof v === "string")
      : [];
    const executiveChanges = Array.isArray(extracted.executive_changes)
      ? extracted.executive_changes.filter((v): v is string => typeof v === "string")
      : [];

    await mergeEnrichmentPatch(this.client, prospect, {
      donation_history: donationHistory,
      recent_gifts: recentGifts,
      executive_changes: executiveChanges,
    });

    return {
      data: { blocked: false, donationHistory, recentGifts, executiveChanges },
      outputSummary: `${prospect.legal_name}: ${donationHistory.length} donation record(s), ${recentGifts.length} recent gift(s), ${executiveChanges.length} executive change(s) found (web search used: ${claudeResult.usedWebSearch}).`,
      itemsFound: 1,
      itemsProcessed: donationHistory.length + recentGifts.length + executiveChanges.length,
      tokensUsed: claudeResult.usage.totalTokens,
    };
  }
}
