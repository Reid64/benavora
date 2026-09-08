import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import {
  fetchLatestFilingGivingSignal,
  fetchProPublicaFinancials,
} from "@/lib/sources/propublica-990-client";

// GET /api/intelligence/990-funding-pattern-explorer?foundation=dell|walmart
//
// Backs the 990 Funding Pattern Explorer tool
// (src/app/(dashboard)/intelligence/990-funding-pattern-explorer/page.tsx —
// see that file's header comment for the full account of why this renders a
// foundation's own filing breakdown rather than a foundation-to-grantee
// graph). Uses only the two exports already in
// src/lib/sources/propublica-990-client.ts (fetchProPublicaFinancials,
// fetchLatestFilingGivingSignal) — no second ProPublica client.
//
// The two supported foundations resolve to real, ProPublica-confirmed EINs
// (looked up live via /nonprofits/api/v2/search.json on 2026-09-07, not
// guessed): Michael & Susan Dell Foundation = 36-4336415, Wal-mart
// Foundation = 20-5639919 ("Wal-mart Foundation" is ProPublica's own record
// name for the real Walmart Foundation entity).

const KNOWN_FOUNDATIONS: Record<string, { ein: string; name: string }> = {
  dell: { ein: "364336415", name: "Michael & Susan Dell Foundation" },
  walmart: { ein: "205639919", name: "Wal-mart Foundation" },
};

const GRANTEE_DATA_NOTE =
  "ProPublica's Nonprofit Explorer API (/organizations/{ein}.json) returns only aggregate 990-PF filing totals for this foundation — contributions received, contributions paid, qualifying distributions, functional expenses, revenue, and assets. It does not include an itemized list of the organizations this foundation actually paid grants to (no Schedule I / Part XV recipient-level data is exposed by this endpoint). Confirmed by a live call against this exact endpoint for both foundations on 2026-09-07. This graph shows the real financial categories from the foundation's most recent filing; it does not represent, and should not be read as, specific grantee organizations.";

interface FlowNode {
  id: string;
  label: string;
  kind: "foundation" | "metric";
}

interface FlowEdge {
  id: string;
  sourceId: string;
  targetId: string;
  label: string;
  value: number;
}

export async function GET(request: Request) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;

  const { searchParams } = new URL(request.url);
  const key = (searchParams.get("foundation") ?? "").toLowerCase();
  const known = KNOWN_FOUNDATIONS[key];
  if (!known) {
    return NextResponse.json(
      {
        error: `foundation must be one of: ${Object.keys(KNOWN_FOUNDATIONS).join(", ")}`,
        code: "invalid_foundation",
      },
      { status: 400 },
    );
  }

  const [financials, givingSignal] = await Promise.all([
    fetchProPublicaFinancials(known.ein),
    fetchLatestFilingGivingSignal(known.ein),
  ]);

  if (!financials && !givingSignal) {
    return NextResponse.json(
      { error: "No ProPublica record found for this foundation's EIN.", code: "not_found" },
      { status: 404 },
    );
  }

  const foundationNodeId = "foundation";
  const nodes: FlowNode[] = [
    { id: foundationNodeId, label: known.name, kind: "foundation" },
  ];
  const edges: FlowEdge[] = [];

  function addMetric(id: string, label: string, value: number | null | undefined) {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return;
    nodes.push({ id, label, kind: "metric" });
    edges.push({
      id: `${foundationNodeId}-${id}`,
      sourceId: foundationNodeId,
      targetId: id,
      label,
      value,
    });
  }

  addMetric("total-assets", "Total Assets", financials?.totalAssets);
  addMetric("total-revenue", "Total Revenue", financials?.totalRevenue);
  addMetric(
    "contributions-paid",
    "Contributions Paid",
    givingSignal?.contributionsPaidPerBooks,
  );
  addMetric(
    "qualifying-distributions",
    "Qualifying Distributions",
    givingSignal?.qualifyingDistributions,
  );
  addMetric(
    "total-functional-expenses",
    "Total Functional Expenses",
    givingSignal?.totalFunctionalExpenses,
  );

  return NextResponse.json({
    ein: known.ein,
    name: known.name,
    taxYear: givingSignal?.taxYear ?? null,
    formType: givingSignal?.formType ?? null,
    nodes,
    edges,
    granteeDataAvailable: false,
    dataNote: GRANTEE_DATA_NOTE,
    sourceUrl: `https://projects.propublica.org/nonprofits/organizations/${known.ein}`,
  });
}
