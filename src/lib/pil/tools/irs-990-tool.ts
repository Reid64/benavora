import { createHash } from "crypto";

import { createAdminClient } from "@/lib/supabase/admin";
import { causeOf } from "@/lib/agents/base-agent";
import type { AgentContext } from "@/lib/pil/agent-runner";
import type { Tool, ToolResult } from "@/lib/pil/tools";

// T-990 (Form 990 Parser). Two-source waterfall: the platform's own
// `foundation_directory` IRS BMF import (fast, no external call, but a
// bulk-CSV import so it only carries the BMF's summary columns -- see
// src/types/database.ts's foundation_directory Row) first, then
// ProPublica's Nonprofit Explorer API for the underlying 990 filing detail.
// ProPublica's v2 org-detail endpoint returns per-filing financial totals
// (assets/revenue/expenses) but not a line-item officer-compensation table --
// that requires parsing the full 990 XML, out of scope for this tool -- so
// `officers` is populated only when ProPublica happens to expose it and is
// an empty array otherwise, never a thrown error.
//
// Same NOT-NULL evidence_id constraint as web-crawler.ts applies to
// pil_source_snapshots -- see that file's comment. This tool likewise
// returns snapshot fields under `data.snapshot` instead of writing to
// pil_source_snapshots itself.

const TOOL_NAME = "irs_990_lookup";
const FETCH_TIMEOUT_MS = 30_000;
const COST_PER_LOOKUP_USD = 0.002;
const PROPUBLICA_BASE = "https://projects.propublica.org/nonprofits/api/v2/organizations";

interface FoundationDirectoryRow {
  ein: string;
  name: string;
  dba: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  ntee_code: string | null;
  foundation_type: string | null;
  revenue_amount: number | null;
  asset_amount: number | null;
  giving_total: number | null;
  website: string | null;
  email: string | null;
  phone: string | null;
}

interface ProPublicaOfficer {
  name?: string;
  title?: string;
  compensation?: number;
}

interface ProPublicaFiling {
  tax_prd_yr?: number;
  totassetsend?: number;
  totrevenue?: number;
  totfuncexpns?: number;
  totgftgrntsrcvd509?: number;
}

interface ProPublicaResponse {
  organization?: {
    name?: string;
    address?: string;
    city?: string;
    state?: string;
    zipcode?: string;
    ntee_code?: string;
    mission?: string;
  };
  filings_with_data?: ProPublicaFiling[];
  officers?: ProPublicaOfficer[];
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: { "User-Agent": "BenavoraPIL/1.0" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function lookupFoundationDirectory(ein: string): Promise<FoundationDirectoryRow | null> {
  const { data, error } = await createAdminClient()
    .from("foundation_directory")
    .select("ein, name, dba, city, state, zip, ntee_code, foundation_type, revenue_amount, asset_amount, giving_total, website, email, phone")
    .eq("ein", ein)
    .maybeSingle();
  if (error) {
    console.error(`[lookupFoundationDirectory] query failed for ein=${ein}: ${causeOf(error)}`);
    // Best-effort: this is the first of a two-source waterfall (falls
    // through to ProPublica below), so a transient failure here should not
    // block the lookup -- it just means we skip straight to ProPublica.
    return null;
  }
  if (!data) return null;
  return data as FoundationDirectoryRow;
}

async function lookupProPublica(ein: string): Promise<ProPublicaResponse | null> {
  const normalizedEin = ein.replace(/-/g, "");
  try {
    const response = await fetchWithTimeout(`${PROPUBLICA_BASE}/${normalizedEin}.json`, FETCH_TIMEOUT_MS);
    if (!response.ok) return null;
    return (await response.json()) as ProPublicaResponse;
  } catch {
    return null;
  }
}

export const irs990Tool: Tool = {
  name: TOOL_NAME,
  description:
    "Looks up an organization's IRS 990 data: platform foundation_directory (IRS BMF) first, then ProPublica Nonprofit Explorer for filing detail.",

  async execute(params: Record<string, unknown>, context: AgentContext): Promise<ToolResult> {
    if (!context.tools.includes(TOOL_NAME)) {
      return {
        success: false,
        data: null,
        cost_usd: 0,
        error: `Tool "${TOOL_NAME}" is not in the permitted tool set for agent ${context.agentCode}`,
      };
    }

    const ein = params.ein;
    if (typeof ein !== "string" || ein.length === 0) {
      return { success: false, data: null, cost_usd: 0, error: "irs_990_lookup requires a string `ein` param" };
    }
    const year = typeof params.year === "number" ? params.year : undefined;

    const [bmf, proPublica] = await Promise.all([lookupFoundationDirectory(ein), lookupProPublica(ein)]);

    if (!bmf && !proPublica) {
      return {
        success: false,
        data: null,
        cost_usd: COST_PER_LOOKUP_USD,
        error: `No IRS 990 data found for EIN ${ein} in foundation_directory or ProPublica`,
      };
    }

    const filings = proPublica?.filings_with_data ?? [];
    const filing = year
      ? filings.find((f) => f.tax_prd_yr === year) ?? filings[0]
      : filings[0];

    const capturedAt = new Date().toISOString();
    const rawSnapshot = JSON.stringify({ bmf, proPublicaOrganization: proPublica?.organization, filing });
    const contentHash = createHash("sha256").update(rawSnapshot, "utf8").digest("hex");

    return {
      success: true,
      data: {
        ein,
        org_name: proPublica?.organization?.name ?? bmf?.name ?? null,
        address: {
          street: proPublica?.organization?.address ?? null,
          city: proPublica?.organization?.city ?? bmf?.city ?? null,
          state: proPublica?.organization?.state ?? bmf?.state ?? null,
          zip: proPublica?.organization?.zipcode ?? bmf?.zip ?? null,
        },
        total_assets: filing?.totassetsend ?? bmf?.asset_amount ?? null,
        total_revenue: filing?.totrevenue ?? bmf?.revenue_amount ?? null,
        total_grants_paid: filing?.totgftgrntsrcvd509 ?? bmf?.giving_total ?? null,
        mission: proPublica?.organization?.mission ?? null,
        officers: (proPublica?.officers ?? []).map((o) => ({
          name: o.name ?? null,
          title: o.title ?? null,
          compensation: o.compensation ?? null,
        })),
        filing_year: filing?.tax_prd_yr ?? null,
        source: bmf && proPublica ? "foundation_directory+propublica" : bmf ? "foundation_directory" : "propublica",
        snapshot: {
          source_url: `${PROPUBLICA_BASE}/${ein.replace(/-/g, "")}.json`,
          snapshot_storage_path: `pil-990-snapshots/${contentHash}.json`,
          content_hash: contentHash,
          http_status: proPublica ? 200 : null,
          captured_at: capturedAt,
        },
      },
      cost_usd: COST_PER_LOOKUP_USD,
    };
  },
};

export default irs990Tool;
