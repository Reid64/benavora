// Giving History Agent - extracts IRS 990-PF giving history from ProPublica
// Nonprofit Explorer by EIN. Parses per-year aggregate stats (grants paid,
// total revenue, total assets) from filings_with_data, calculates trend, and
// upserts into funder_intelligence.recent_grants.
//
// No API key required (BEHAVIORAL_CONTRACTS §19).
// Rate limit: 1 request per second, self-imposed.

import {
  AgentError,
  BaseAgent,
  type AgentExecution,
} from "@/lib/agents/base-agent";
import type { AgentType } from "@/types/agents";
import type { Json } from "@/types/database";

const PROPUBLICA_BASE = "https://projects.propublica.org/nonprofits/api/v2";
const MAX_FISCAL_YEARS = 3;
const FETCH_TIMEOUT_MS = 15_000;

export interface GivingHistoryInput {
  funderId: string;
  /** 9-digit EIN, with or without the dash (e.g. "123456789" or "12-3456789"). */
  ein: string;
}

export interface GivingHistoryFiling {
  year: number;
  totalRevenue: number;
  totalAssets: number;
  grantsPaid: number;
}

export interface GivingHistoryResult {
  funderId: string;
  ein: string;
  trend: "increasing" | "decreasing" | "stable" | "insufficient_data";
  filings: GivingHistoryFiling[];
  yearsExtracted: number;
}

export class GivingHistoryAgent extends BaseAgent<
  GivingHistoryInput,
  GivingHistoryResult
> {
  readonly agentType: AgentType = "giving_history_extractor";

  protected async execute(
    input: GivingHistoryInput,
  ): Promise<AgentExecution<GivingHistoryResult>> {
    const { funderId } = input;
    const sanitizedEin = input.ein.replace(/\D/g, "");
    if (sanitizedEin.length !== 9) {
      throw new AgentError(
        "EIN must be a 9-digit number (e.g. 12-3456789).",
        "invalid_ein",
        422,
      );
    }

    // Verify the funder belongs to this organization.
    const { data: funder, error: funderError } = await this.client
      .from("funders")
      .select("id, name")
      .eq("id", funderId)
      .eq("organization_id", this.organizationId)
      .single();

    if (funderError || !funder) {
      throw new AgentError("Funder not found.", "not_found", 404);
    }

    const orgData = await fetchProPublicaOrg(sanitizedEin);
    if (!orgData) {
      throw new AgentError(
        "No ProPublica data found for this EIN. Verify the EIN is correct and the organization filed with the IRS.",
        "not_found",
        404,
      );
    }

    const filings = (orgData.filings_with_data ?? [])
      .slice(0, MAX_FISCAL_YEARS)
      .map((f) => ({
        year: Number(f.tax_prd_yr ?? 0),
        totalRevenue: Number(f.totrevenue ?? 0),
        totalAssets: Number(f.totassetsend ?? 0),
        grantsPaid: Number(f.grantspaidtotal ?? 0),
      }))
      .filter((f) => f.year > 0);

    if (filings.length === 0) {
      throw new AgentError(
        "ProPublica returned no filing data for this EIN. The organization may not file 990-PF returns.",
        "no_filings",
        422,
      );
    }

    const trend = calculateTrend(filings);

    // Store structured giving history in recent_grants. The field is JSONB so
    // we use a discriminated object (source: "propublica") that lets FunderDetail
    // distinguish this format from website-scraped grant-recipient arrays.
    const payload: Json = {
      source: "propublica",
      ein: sanitizedEin,
      trend,
      filings: filings as unknown as Json[],
    } as unknown as Json;

    const now = new Date().toISOString();
    const { error: upsertError } = await this.client
      .from("funder_intelligence")
      .upsert(
        {
          organization_id: this.organizationId,
          funder_id: funderId,
          recent_grants: payload,
          last_scraped_at: now,
          updated_at: now,
        },
        { onConflict: "organization_id,funder_id" },
      );

    if (upsertError) {
      throw new AgentError(
        "Failed to save giving history.",
        "write_failed",
      );
    }

    const funderName = (funder.name as string | null) ?? "Unknown";
    return {
      data: {
        funderId,
        ein: sanitizedEin,
        trend,
        filings,
        yearsExtracted: filings.length,
      },
      outputSummary: `Extracted ${filings.length} year(s) of giving history for "${funderName}" (EIN ${sanitizedEin}). Trend: ${trend}.`,
      itemsFound: filings.length,
      itemsProcessed: filings.length,
      tokensUsed: 0,
    };
  }
}

// --- ProPublica API -----------------------------------------------------------

interface ProPublicaFiling {
  tax_prd_yr?: string | number | null;
  totrevenue?: string | number | null;
  totassetsend?: string | number | null;
  grantspaidtotal?: string | number | null;
}

interface ProPublicaOrgResponse {
  organization?: { name?: string; ein?: string } | null;
  filings_with_data?: ProPublicaFiling[] | null;
}

async function fetchProPublicaOrg(
  ein: string,
): Promise<ProPublicaOrgResponse | null> {
  const url = `${PROPUBLICA_BASE}/organizations/${ein}.json`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "BenavoraGivingHistoryBot/1.0" },
    });
    if (!res.ok) return null;
    return (await res.json()) as ProPublicaOrgResponse;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// --- trend calculation -------------------------------------------------------
// ProPublica returns filings most-recent-first. Comparing filings[i] (more
// recent) to filings[i+1] (less recent): if more recent > less recent the
// grants are growing over time → "increasing".

function calculateTrend(
  filings: GivingHistoryFiling[],
): "increasing" | "decreasing" | "stable" | "insufficient_data" {
  if (filings.length < 2) return "insufficient_data";
  let increases = 0;
  let decreases = 0;
  for (let i = 0; i < filings.length - 1; i++) {
    const curr = filings[i]?.grantsPaid ?? 0;
    const prev = filings[i + 1]?.grantsPaid ?? 0;
    if (curr > prev) increases++;
    else if (curr < prev) decreases++;
  }
  if (increases > decreases) return "increasing";
  if (decreases > increases) return "decreasing";
  return "stable";
}
