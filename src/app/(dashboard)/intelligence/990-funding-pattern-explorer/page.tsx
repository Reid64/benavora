"use client";

// 990 Funding Pattern Explorer — force-directed graph of a foundation's real
// 990-PF filing metrics, fetched live from ProPublica via the two exports in
// src/lib/sources/propublica-990-client.ts (fetchProPublicaFinancials,
// fetchLatestFilingGivingSignal — no second ProPublica client).
//
// IMPORTANT — what this graph does and does not show: it was built to graph
// a foundation's real grantee relationships (which organizations it actually
// funded). ProPublica's public API does not expose that. Verified live
// against /nonprofits/api/v2/organizations/{ein}.json for both foundations
// below on 2026-09-07 — the real response only carries aggregate 990-PF
// filing totals (contrpdpbks, distribamt, totfuncexpns, grscontrgifts,
// totrevenue, totassetsend, etc.), never an itemized recipient/grantee list.
// This is also independently confirmed elsewhere in this codebase, e.g.
// src/lib/donor-discovery/adapters/bmf-directory.ts's header comment on
// 990pf_grants_data. So this page graphs the foundation against its own
// real filing-metric breakdown instead of fabricating grantee nodes — see
// the banner below and the API route's GRANTEE_DATA_NOTE for the full
// disclosure shown to the user.

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ExternalLink, Loader2, Network } from "lucide-react";

import FinancialFlowGraphViz, {
  type FlowEdge,
  type FlowNode,
} from "@/components/intelligence/FinancialFlowGraphViz";

const FOUNDATIONS = [
  { key: "dell", label: "Michael & Susan Dell Foundation" },
  { key: "walmart", label: "Wal-mart Foundation" },
] as const;

interface ExplorerResponse {
  ein: string;
  name: string;
  taxYear: number | null;
  formType: number | null;
  nodes: FlowNode[];
  edges: FlowEdge[];
  granteeDataAvailable: boolean;
  dataNote: string;
  sourceUrl: string;
}

export default function FundingPatternExplorerPage() {
  const [foundationKey, setFoundationKey] = useState<(typeof FOUNDATIONS)[number]["key"]>(
    FOUNDATIONS[0].key,
  );
  const [data, setData] = useState<ExplorerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (key: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/intelligence/990-funding-pattern-explorer?foundation=${encodeURIComponent(key)}`,
        { cache: "no-store" },
      );
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((payload as { error?: string }).error ?? "Could not load 990 filing data.");
        setData(null);
        return;
      }
      setData(payload as ExplorerResponse);
    } catch {
      setError("Could not reach the ProPublica lookup service.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(foundationKey);
  }, [foundationKey, load]);

  return (
    <div style={{ backgroundColor: "#F0EBE0", minHeight: "100vh", padding: "32px" }}>
      <div style={{ borderLeft: "4px solid #0EA5E9", paddingLeft: "16px", marginBottom: "24px" }}>
        <h1
          style={{
            fontSize: "28px",
            fontWeight: 800,
            color: "#2C4E3B",
            letterSpacing: "-0.02em",
            margin: 0,
          }}
        >
          990 Funding Pattern Explorer
        </h1>
        <p style={{ fontSize: "14px", color: "#64748B", marginTop: "6px" }}>
          Real 990-PF filing data fetched live from ProPublica's Nonprofit Explorer API.
        </p>
      </div>

      <div style={{ display: "inline-flex", gap: "8px", marginBottom: "20px" }}>
        {FOUNDATIONS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFoundationKey(f.key)}
            style={{
              fontSize: "13px",
              fontWeight: 700,
              padding: "10px 18px",
              borderRadius: "9px",
              border: "1px solid #E2E8F0",
              cursor: "pointer",
              backgroundColor: foundationKey === f.key ? "#0EA5E9" : "#FFFFFF",
              color: foundationKey === f.key ? "#FFFFFF" : "#2C4E3B",
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "10px",
          backgroundColor: "#FFFBEB",
          border: "1px solid #FDE68A",
          borderRadius: "10px",
          padding: "14px 16px",
          marginBottom: "24px",
          fontSize: "13px",
          color: "#92400E",
          lineHeight: 1.5,
        }}
      >
        <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: "1px" }} />
        <div>
          {data?.dataNote ??
            "ProPublica's API returns only aggregate 990-PF filing totals — it does not expose itemized grantee/recipient-level data. This tool shows a foundation's own real filing metrics, not grantee relationships."}
          {data?.sourceUrl && (
            <>
              {" "}
              <a
                href={data.sourceUrl}
                target="_blank"
                rel="noreferrer"
                style={{ color: "#92400E", fontWeight: 700, textDecoration: "underline" }}
              >
                View the real ProPublica record
                <ExternalLink size={12} style={{ display: "inline", marginLeft: "3px" }} />
              </a>
            </>
          )}
        </div>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            backgroundColor: "#FEF2F2",
            border: "1px solid #FECACA",
            borderRadius: "10px",
            padding: "12px 16px",
            marginBottom: "20px",
            fontSize: "13px",
            color: "#B91C1C",
          }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "10px",
            padding: "64px 0",
            color: "#64748B",
            fontSize: "14px",
          }}
        >
          <Loader2 size={18} className="animate-spin" />
          Fetching real 990 filing data from ProPublica...
        </div>
      ) : data ? (
        <>
          <div
            style={{
              display: "flex",
              gap: "16px",
              flexWrap: "wrap",
              marginBottom: "20px",
              fontSize: "13px",
              color: "#64748B",
            }}
          >
            <span>
              EIN: <strong style={{ color: "#0F172A" }}>{data.ein}</strong>
            </span>
            {data.taxYear && (
              <span>
                Latest filing tax year: <strong style={{ color: "#0F172A" }}>{data.taxYear}</strong>
              </span>
            )}
            {data.formType === 2 && (
              <span>
                Form type: <strong style={{ color: "#0F172A" }}>990-PF</strong>
              </span>
            )}
          </div>
          <FinancialFlowGraphViz nodes={data.nodes} edges={data.edges} />
        </>
      ) : (
        <div
          style={{
            backgroundColor: "#FFFFFF",
            borderRadius: "14px",
            padding: "56px 24px",
            textAlign: "center",
            boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
          }}
        >
          <Network size={32} color="#94A3B8" style={{ margin: "0 auto 12px" }} />
          <p style={{ fontSize: "14px", fontWeight: 700, color: "#2C4E3B", margin: 0 }}>
            No data loaded.
          </p>
        </div>
      )}
    </div>
  );
}
