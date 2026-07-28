// EA-09 Contact Extractor (CORPORATE_INTELLIGENCE_ARCHITECTURE.md §2B/§6).
//
// Fetches a corporate prospect's /contact page via StealthEngine and asks
// Claude to extract verified emails, phone, and whether the on-file address
// is corroborated by the page content. There is no separate "/footer" URL to
// fetch — a footer's contact block is part of whatever page renders it, so
// this also falls back to the homepage ("/") when /contact isn't reachable,
// since footers commonly appear there too.
//
// Trigger: post-acquisition (no upstream EA-0X dependency).
// Rate: 1 request per 2 seconds between candidate-page fetches.
//
// employee_count_estimate precedent from ea-05-career-page-analyzer.ts
// applies here too: `phone` is also a top-level corporate_prospects column,
// but canonical rule §12.2 ("All enrichment writes to `enrichment` jsonb —
// never new columns per agent") means this agent writes
// `enrichment.phone`/`enrichment.verified_emails` only and never touches the
// top-level `phone` column.

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

/** Per-spec fetch pacing: 1 request every 2 seconds. */
export const EA09_RATE_MS = 2_000;

const CANDIDATE_PATHS = ["/contact", "/"] as const;

export interface EA09Input {
  prospectId: string;
}

export interface EA09Result {
  verifiedEmails: string[];
  phone: string | null;
  addressConfirmed: boolean;
  pagesFound: number;
}

interface ExtractedContact {
  verified_emails?: unknown;
  phone?: unknown;
  address_confirmed?: unknown;
}

export class EA09ContactExtractorAgent extends BaseAgent<
  EA09Input,
  EA09Result
> {
  readonly agentType: AgentType = "ea09_contact_extractor";

  protected async execute(
    input: EA09Input,
  ): Promise<AgentExecution<EA09Result>> {
    const prospect = await fetchProspect(this.client, input.prospectId);
    if (!prospect) {
      throw new AgentError("Corporate prospect not found.", "not_found", 404);
    }

    if (!prospect.website) {
      return {
        data: { verifiedEmails: [], phone: null, addressConfirmed: false, pagesFound: 0 },
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
        if (i > 0) await sleep(EA09_RATE_MS);
        const url = candidateUrls[i];
        if (!url) continue;
        const html = await engine.fetchPage(url);
        if (html) {
          pagesFound++;
          combinedHtml += `\n\n--- ${url} ---\n${html}`;
          break; // the contact page (or homepage footer fallback) is enough context
        }
      }
    } finally {
      await engine.close();
    }

    if (pagesFound === 0) {
      return {
        data: { verifiedEmails: [], phone: null, addressConfirmed: false, pagesFound: 0 },
        outputSummary: `${prospect.legal_name}: no contact page or homepage reachable.`,
        itemsFound: candidateUrls.length,
        itemsProcessed: 0,
      };
    }

    const addressOnFile = [
      prospect.address_street,
      prospect.address_city,
      prospect.address_state,
      prospect.address_zip,
    ]
      .filter((v): v is string => Boolean(v && v.trim()))
      .join(", ");

    const prompt = `Analyze this company's contact page (and/or homepage footer) content. Extract verified contact emails, a phone number, and whether the address on file is corroborated.

Company on file: ${prospect.legal_name}
Address on file: ${addressOnFile || "(no address on file to compare against)"}

Return ONLY valid JSON: {"verified_emails": string[], "phone": string or null, "address_confirmed": boolean}
verified_emails should only include emails actually present in the page content — never invent one.
phone should be the primary contact phone number in the page content, or null if none is present.
address_confirmed should be true only if the page content includes a physical street address matching the address on file above. If no address is on file to compare against, use false.

Page content:
${truncateForClaude(combinedHtml)}`;

    const claudeResult = await callClaude({ prompt, maxTokens: 600 });
    const extracted = parseClaudeJson<ExtractedContact>(claudeResult.text, {});

    const verifiedEmails = Array.isArray(extracted.verified_emails)
      ? extracted.verified_emails.filter((v): v is string => typeof v === "string")
      : [];
    const phone = typeof extracted.phone === "string" && extracted.phone.trim() ? extracted.phone.trim() : null;
    const addressConfirmed = extracted.address_confirmed === true;

    await mergeEnrichmentPatch(this.client, prospect, {
      verified_emails: verifiedEmails,
      phone,
      address_confirmed: addressConfirmed,
    });

    return {
      data: { verifiedEmails, phone, addressConfirmed, pagesFound },
      outputSummary: `${prospect.legal_name}: ${verifiedEmails.length} verified email(s), phone=${phone ?? "none"}, address_confirmed=${addressConfirmed}.`,
      itemsFound: candidateUrls.length,
      itemsProcessed: pagesFound,
      tokensUsed: claudeResult.usage.totalTokens,
    };
  }
}
