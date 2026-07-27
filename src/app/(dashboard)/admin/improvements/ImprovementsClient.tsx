"use client";

// AG-38 Self-Improvement Agent review UI (AUTONOMOUS_PLATFORM_VISION.md
// Phase 4, "Autonomous Continuous Improvement Engine";
// src/lib/agents/self-improvement-agent.ts). Talks to
// /api/admin/improvements, which reads improvement_proposals and
// agent_performance_metrics (migration 087_continuous_improvement.sql) —
// both platform-wide tables, not org-scoped. Every color on this page is an
// inline hex value per BLUEPRINT_v2.md §7.5 — no CSS variables, no Tailwind
// color classes. Canvas per this task's spec: #D6E4F0.

import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import {
  CheckCircle2,
  Loader2,
  ShieldAlert,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";

import { useProfile } from "@/lib/hooks/useProfile";
import { formatDate, humanizeEnum } from "@/lib/utils/formatters";

type ProposalStatus = "proposed" | "approved" | "rejected" | "implemented" | "rolled_back";
type RiskLevel = "low" | "medium" | "high";

interface Proposal {
  id: string;
  proposal_type: string;
  title: string;
  description: string;
  evidence: string;
  expected_impact: string;
  risk_level: RiskLevel | null;
  status: ProposalStatus;
  confidence_score: number | null;
  proposed_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  implemented_at: string | null;
}

interface Stats {
  totalProposed: number;
  awaitingReview: number;
  approvedThisMonth: number;
  implemented: number;
}

interface AgentMetric {
  agentId: string;
  runsTotal: number;
  successRate: number | null;
  avgConfidence: number | null;
  decisionsPerRun: number | null;
  reviewRate: number | null;
}

const RISK_COLOR: Record<RiskLevel, string> = {
  low: "#10B981",
  medium: "#F59E0B",
  high: "#DC2626",
};

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "proposed", label: "Awaiting Review" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "implemented", label: "Implemented" },
];

function successRateColor(rate: number | null): string {
  if (rate === null) return "#94A3B8";
  if (rate >= 0.9) return "#10B981";
  if (rate >= 0.7) return "#F59E0B";
  return "#EF4444";
}

function pct(value: number | null, digits = 0): string {
  return value === null ? "—" : `${(value * 100).toFixed(digits)}%`;
}

const statCardStyle = (accent: string): CSSProperties => ({
  backgroundColor: "#FFFFFF",
  borderRadius: "16px",
  padding: "20px 24px",
  boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
  borderTop: `8px solid ${accent}`,
});

const statLabelStyle: CSSProperties = {
  fontSize: "11px",
  fontWeight: 700,
  color: "#64748B",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  margin: 0,
};

const statValueStyle: CSSProperties = {
  fontSize: "32px",
  fontWeight: 900,
  color: "#0F172A",
  margin: "6px 0 0",
};

function StatCard({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div style={statCardStyle(accent)}>
      <p style={statLabelStyle}>{label}</p>
      <p style={statValueStyle}>{value}</p>
    </div>
  );
}

export default function ImprovementsClient() {
  const { profile, loading: profileLoading } = useProfile();
  const canView = profile?.role === "owner" || profile?.role === "admin";

  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [agentMetrics, setAgentMetrics] = useState<AgentMetric[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<Set<string>>(new Set());

  const load = useCallback(async (status: string) => {
    setError(null);
    try {
      const url = status
        ? `/api/admin/improvements?status=${encodeURIComponent(status)}`
        : "/api/admin/improvements";
      const res = await fetch(url, { cache: "no-store" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((payload as { error?: string }).error ?? "Could not load improvement proposals.");
        return;
      }
      const data = payload as { proposals: Proposal[]; stats: Stats; agentMetrics: AgentMetric[] };
      setProposals(data.proposals ?? []);
      setStats(data.stats ?? null);
      setAgentMetrics(data.agentMetrics ?? []);
    } catch {
      setError("Could not reach the server. Please try again.");
    }
  }, []);

  useEffect(() => {
    if (profileLoading || !canView) {
      setLoading(false);
      return;
    }
    let active = true;
    (async () => {
      setLoading(true);
      await load(statusFilter);
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [profileLoading, canView, statusFilter, load]);

  async function handleReview(id: string, status: "approved" | "rejected") {
    setActingOn((prev) => new Set(prev).add(id));
    setError(null);
    try {
      const res = await fetch(`/api/admin/improvements/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((payload as { error?: string }).error ?? "Could not update this proposal.");
        return;
      }
      await load(statusFilter);
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setActingOn((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  if (profileLoading || loading) {
    return (
      <div
        style={{
          backgroundColor: "#D6E4F0",
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "10px",
          color: "#64748B",
          fontSize: "14px",
        }}
      >
        <Loader2 size={18} className="animate-spin" />
        Loading improvement proposals...
      </div>
    );
  }

  if (!canView) {
    return (
      <div style={{ backgroundColor: "#D6E4F0", minHeight: "100vh", padding: "32px" }}>
        <div
          style={{
            backgroundColor: "#FFFFFF",
            borderRadius: "14px",
            padding: "56px 24px",
            textAlign: "center",
            boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
          }}
        >
          <ShieldAlert size={32} color="#94A3B8" style={{ margin: "0 auto 12px" }} />
          <p style={{ fontSize: "14px", fontWeight: 700, color: "#1A2B3C", margin: 0 }}>
            Admins only
          </p>
          <p style={{ fontSize: "13px", color: "#64748B", marginTop: "8px" }}>
            Only owners and admins can review platform improvement proposals.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ backgroundColor: "#D6E4F0", minHeight: "100vh", padding: "32px" }}>
      {/* Header */}
      <div style={{ marginBottom: "28px" }}>
        <h1
          style={{
            fontSize: "28px",
            fontWeight: 800,
            color: "#0F172A",
            letterSpacing: "-0.02em",
            margin: 0,
          }}
        >
          Platform Improvement Proposals
        </h1>
        <p style={{ fontSize: "14px", color: "#64748B", marginTop: "6px" }}>
          AI-generated optimization recommendations pending your review.
        </p>
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

      {/* Stats row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: "16px",
          marginBottom: "24px",
        }}
      >
        <StatCard label="Total Proposed" value={stats?.totalProposed ?? 0} accent="#0077B6" />
        <StatCard label="Awaiting Review" value={stats?.awaitingReview ?? 0} accent="#F59E0B" />
        <StatCard label="Approved This Month" value={stats?.approvedThisMonth ?? 0} accent="#10B981" />
        <StatCard label="Implemented" value={stats?.implemented ?? 0} accent="#6B48CC" />
      </div>

      {/* Agent Performance */}
      <div
        style={{
          backgroundColor: "#FFFFFF",
          borderRadius: "16px",
          padding: "24px",
          marginBottom: "24px",
          boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
        }}
      >
        <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#1A2B3C", margin: "0 0 4px" }}>
          Agent Performance
        </h2>
        <p style={{ fontSize: "12px", color: "#64748B", margin: "0 0 16px" }}>
          Trailing 7 days, aggregated from agent_performance_metrics.
        </p>

        {agentMetrics.length === 0 ? (
          <p style={{ fontSize: "13px", color: "#94A3B8", padding: "16px 0" }}>
            No agent activity recorded in the last 7 days.
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead>
                <tr>
                  {["Agent", "Success Rate", "Avg Confidence", "Decisions/Run", "Review Rate"].map(
                    (col) => (
                      <th
                        key={col}
                        style={{
                          textAlign: "left",
                          padding: "8px 12px",
                          fontSize: "11px",
                          fontWeight: 700,
                          color: "#64748B",
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                          borderBottom: "1px solid #E2E8F0",
                        }}
                      >
                        {col}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {agentMetrics.map((row) => {
                  const barColor = successRateColor(row.successRate);
                  const barWidth = row.successRate === null ? 0 : Math.round(row.successRate * 100);
                  return (
                    <tr key={row.agentId}>
                      <td
                        style={{
                          padding: "12px",
                          fontWeight: 700,
                          color: "#0F172A",
                          borderBottom: "1px solid #F1F5F9",
                        }}
                      >
                        {row.agentId}
                      </td>
                      <td style={{ padding: "12px", borderBottom: "1px solid #F1F5F9" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <div
                            style={{
                              width: "80px",
                              height: "8px",
                              borderRadius: "4px",
                              backgroundColor: "#E2E8F0",
                              overflow: "hidden",
                            }}
                          >
                            <div
                              style={{
                                width: `${barWidth}%`,
                                height: "100%",
                                backgroundColor: barColor,
                                borderRadius: "4px",
                              }}
                            />
                          </div>
                          <span style={{ fontWeight: 700, color: barColor }}>
                            {pct(row.successRate)}
                          </span>
                        </div>
                      </td>
                      <td style={{ padding: "12px", color: "#334155", borderBottom: "1px solid #F1F5F9" }}>
                        {row.avgConfidence === null ? "—" : row.avgConfidence}
                      </td>
                      <td style={{ padding: "12px", color: "#334155", borderBottom: "1px solid #F1F5F9" }}>
                        {row.decisionsPerRun === null ? "—" : row.decisionsPerRun}
                      </td>
                      <td style={{ padding: "12px", color: "#334155", borderBottom: "1px solid #F1F5F9" }}>
                        {pct(row.reviewRate)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Status filter */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap" }}>
        {STATUS_FILTERS.map((f) => {
          const active = statusFilter === f.value;
          return (
            <button
              key={f.value}
              type="button"
              onClick={() => setStatusFilter(f.value)}
              style={{
                fontSize: "12px",
                fontWeight: 700,
                padding: "7px 14px",
                borderRadius: "999px",
                border: active ? "1px solid #0077B6" : "1px solid #B8C9D9",
                backgroundColor: active ? "#0077B6" : "#FFFFFF",
                color: active ? "#FFFFFF" : "#334155",
                cursor: "pointer",
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* Proposals list */}
      {proposals.length === 0 ? (
        <div
          style={{
            backgroundColor: "#FFFFFF",
            borderRadius: "14px",
            padding: "56px 24px",
            textAlign: "center",
            boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
          }}
        >
          <Sparkles size={32} color="#94A3B8" style={{ margin: "0 auto 12px" }} />
          <p style={{ fontSize: "14px", fontWeight: 700, color: "#1A2B3C", margin: 0 }}>
            No proposals match this filter.
          </p>
          <p style={{ fontSize: "13px", color: "#64748B", marginTop: "8px" }}>
            AG-38 runs nightly and proposes improvements backed by evidence from agent_runs.
          </p>
        </div>
      ) : (
        proposals.map((proposal) => (
          <ProposalCard
            key={proposal.id}
            proposal={proposal}
            acting={actingOn.has(proposal.id)}
            onReview={handleReview}
          />
        ))
      )}
    </div>
  );
}

function ProposalCard({
  proposal,
  acting,
  onReview,
}: {
  proposal: Proposal;
  acting: boolean;
  onReview: (id: string, status: "approved" | "rejected") => void | Promise<void>;
}) {
  const riskColor = proposal.risk_level ? RISK_COLOR[proposal.risk_level] : "#6B7280";
  const isImplemented = proposal.status === "implemented";
  const isPending = proposal.status === "proposed";

  return (
    <div
      style={{
        backgroundColor: "#FFFFFF",
        borderRadius: "12px",
        borderLeft: `6px solid ${riskColor}`,
        padding: "24px",
        marginBottom: "12px",
        boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", marginBottom: "12px" }}>
        <span
          style={{
            fontSize: "11px",
            fontWeight: 700,
            color: "#FFFFFF",
            backgroundColor: "#0077B6",
            borderRadius: "999px",
            padding: "3px 12px",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          {humanizeEnum(proposal.proposal_type)}
        </span>
        <span
          style={{
            fontSize: "11px",
            fontWeight: 700,
            color: "#FFFFFF",
            backgroundColor: riskColor,
            borderRadius: "999px",
            padding: "3px 12px",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          {proposal.risk_level ?? "unknown"} risk
        </span>
        {proposal.confidence_score !== null && (
          <span style={{ fontSize: "12px", fontWeight: 700, color: "#334155" }}>
            {proposal.confidence_score}% confidence
          </span>
        )}
      </div>

      <h3 style={{ fontSize: "16px", fontWeight: 700, color: "#1A2B3C", margin: "0 0 8px" }}>
        {proposal.title}
      </h3>

      <p style={{ fontSize: "14px", color: "#374151", lineHeight: 1.6, margin: "0 0 12px" }}>
        {proposal.description}
      </p>

      <p style={{ fontSize: "13px", fontStyle: "italic", color: "#6B7280", lineHeight: 1.5, margin: "0 0 12px" }}>
        Evidence: {proposal.evidence}
      </p>

      <div
        style={{
          backgroundColor: "#ECFDF5",
          border: "1px solid #A7F3D0",
          borderRadius: "10px",
          padding: "12px 16px",
          marginBottom: "16px",
        }}
      >
        <p
          style={{
            fontSize: "11px",
            fontWeight: 700,
            color: "#065F46",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            margin: "0 0 4px",
          }}
        >
          Expected Impact
        </p>
        <p style={{ fontSize: "13px", color: "#047857", margin: 0 }}>{proposal.expected_impact}</p>
      </div>

      {isImplemented ? (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", fontWeight: 700, color: "#10B981" }}>
          <CheckCircle2 size={16} />
          Implemented {formatDate(proposal.implemented_at)}
        </div>
      ) : isPending ? (
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button
            type="button"
            disabled={acting}
            onClick={() => void onReview(proposal.id, "approved")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              backgroundColor: "#10B981",
              color: "#FFFFFF",
              fontSize: "13px",
              fontWeight: 700,
              padding: "8px 16px",
              borderRadius: "8px",
              border: "none",
              cursor: acting ? "default" : "pointer",
              opacity: acting ? 0.6 : 1,
            }}
          >
            <ThumbsUp size={14} />
            Approve
          </button>
          <button
            type="button"
            disabled={acting}
            onClick={() => void onReview(proposal.id, "rejected")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              backgroundColor: "#EF4444",
              color: "#FFFFFF",
              fontSize: "13px",
              fontWeight: 700,
              padding: "8px 16px",
              borderRadius: "8px",
              border: "none",
              cursor: acting ? "default" : "pointer",
              opacity: acting ? 0.6 : 1,
            }}
          >
            <ThumbsDown size={14} />
            Reject
          </button>
        </div>
      ) : (
        <p style={{ fontSize: "12px", color: "#64748B", margin: 0 }}>
          {humanizeEnum(proposal.status)}
          {proposal.reviewed_at ? ` · reviewed ${formatDate(proposal.reviewed_at)}` : ""}
        </p>
      )}
    </div>
  );
}
