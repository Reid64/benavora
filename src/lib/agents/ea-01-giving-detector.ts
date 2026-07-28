// EA-01 Corporate Giving Detector (CORPORATE_INTELLIGENCE_ARCHITECTURE.md §2B/§6).
//
// Fetches a corporate prospect's /giving, /csr, and /community pages via
// StealthEngine (src/lib/scraper/stealth-engine.ts — same engine
// foundation-scraper.ts and nonprofit-scraper.ts already use for all page
// fetches, per project convention: reuse the fetch layer, never build a
// second one) and asks Claude to extract whether the company runs a
// corporate giving program.
//
// Trigger: post-acquisition — intended to run once a corporate_prospects row
// has been inserted by an acquisition adapter (CORPORATE_INTELLIGENCE_ARCHITECTURE.md
// §1). No queue/dispatcher wiring exists yet (§9's corporate_enrichment_queue
// table is not part of this build) — this agent is invoked directly with a
// prospectId, the same way CorporateScraperAgent and other BaseAgent
// subclasses are invoked from a route or script today.
// Rate: 1 request per 3 seconds between candidate-page fetches.

import { callClaude } from "@/lib/ai/claude";
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
export const EA01_RATE_MS = 3_000;

const CANDIDATE_PATHS = ["/giving", "/csr", "/community"] as const;

export interface EA01Input {
  prospectId: string;
}

export interface EA01Result {
  hasGivingProgram: boolean | null;
  givingPortalUrl: string | null;
  knownDonationTypes: string[];
  pagesFound: number;
}

interface ExtractedGiving {
  has_giving_program?: unknown;
  giving_portal_url?: unknown;
  known_donation_types?: unknown;
}

export class EA01GivingDetectorAgent extends BaseAgent<EA01Input, EA01Result> {
  readonly agentType: AgentType = "ea01_giving_detector";

  protected async execute(
    input: EA01Input,
  ): Promise<AgentExecution<EA01Result>> {
    const prospect = await fetchProspect(this.client, input.prospectId);
    if (!prospect) {
      throw new AgentError("Corporate prospect not found.", "not_found", 404);
    }

    if (!prospect.website) {
      return {
        data: {
          hasGivingProgram: null,
          givingPortalUrl: null,
          knownDonationTypes: [],
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
    let firstFoundUrl: string | null = null;

    try {
      await engine.init();
      for (let i = 0; i < candidateUrls.length; i++) {
        if (i > 0) await sleep(EA01_RATE_MS);
        const url = candidateUrls[i];
        if (!url) continue;
        const html = await engine.fetchPage(url);
        if (html) {
          pagesFound++;
          firstFoundUrl = firstFoundUrl ?? url;
          combinedHtml += `\n\n--- ${url} ---\n${html}`;
        }
      }
    } finally {
      await engine.close();
    }

    if (pagesFound === 0) {
      const patch = { has_giving_program: false };
      await mergeEnrichmentPatch(this.client, prospect, patch);
      return {
        data: {
          hasGivingProgram: false,
          givingPortalUrl: null,
          knownDonationTypes: [],
          pagesFound: 0,
        },
        outputSummary: `${prospect.legal_name}: no giving/csr/community pages found.`,
        itemsFound: candidateUrls.length,
        itemsProcessed: 0,
      };
    }

    const prompt = `Analyze this company's giving/CSR/community pages. Determine whether it runs a corporate giving program.
Return ONLY valid JSON: {"has_giving_program": boolean, "giving_portal_url": string or null, "known_donation_types": string[]}
known_donation_types should be drawn from: cash_grants, in_kind_donations, sponsorships, matching_gifts, scholarships, volunteer_grants, equipment_donations.

Page content:
${truncateForClaude(combinedHtml)}`;

    const claudeResult = await callClaude({ prompt, maxTokens: 800 });
    const extracted = parseClaudeJson<ExtractedGiving>(claudeResult.text, {});

    const hasGivingProgram =
      typeof extracted.has_giving_program === "boolean"
        ? extracted.has_giving_program
        : pagesFound > 0;
    const givingPortalUrl =
      typeof extracted.giving_portal_url === "string" && extracted.giving_portal_url.trim()
        ? extracted.giving_portal_url.trim()
        : firstFoundUrl;
    const knownDonationTypes = Array.isArray(extracted.known_donation_types)
      ? extracted.known_donation_types.filter((v): v is string => typeof v === "string")
      : [];

    await mergeEnrichmentPatch(this.client, prospect, {
      has_giving_program: hasGivingProgram,
      giving_portal_url: givingPortalUrl,
      known_donation_types: knownDonationTypes,
    });

    return {
      data: { hasGivingProgram, givingPortalUrl, knownDonationTypes, pagesFound },
      outputSummary: `${prospect.legal_name}: has_giving_program=${hasGivingProgram}, ${knownDonationTypes.length} donation type(s) found across ${pagesFound} page(s).`,
      itemsFound: candidateUrls.length,
      itemsProcessed: pagesFound,
      tokensUsed: claudeResult.usage.totalTokens,
    };
  }
}
