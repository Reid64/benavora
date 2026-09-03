"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import {
  AlertCircle,
  Bot,
  Calendar,
  Clock,
  Loader2,
  Printer,
  Sparkles,
  Trophy,
} from "lucide-react";

import { humanizeEnum } from "@/lib/utils/formatters";
import type { BoardReportPageData } from "@/lib/reports/board-report-page";

// Board Report — auto-generated, printable board-ready funding report at
// /reports/board-report, backed by GET /api/reports/board-report/detail and
// POST /api/reports/board-report/executive-summary. Inline style={{}} with
// hardcoded hex only per BLUEPRINT_v2.md §7.5. Canvas #F0EBE0 (Soft Stone)
// per the v2 design system; frame accent Plum #7A5980 (Intelligence &
// Reports section). URGENCY_COLORS and the probability-score badge
// thresholds below are real semantic data and are preserved untouched.
//
// Print handling: DashboardShell always renders the sidebar/header outside
// this page, so hiding them for print requires a body-level class toggled
// here (see globals.css ".report-print-mode" rule) rather than a
// page-scoped print:hidden, which can only hide elements inside this file.

function defaultFiscalYearDates(): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end.getFullYear(), 0, 1);
  return {
    start: start.toISOString().split("T")[0]!,
    end: end.toISOString().split("T")[0]!,
  };
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const cardStyle: CSSProperties = {
  backgroundColor: "#F8F5EE",
  borderRadius: "14px",
  padding: "24px",
  boxShadow: "0 4px 20px rgba(122,89,128,0.18)",
};

const sectionTitleStyle: CSSProperties = {
  fontSize: "16px",
  fontWeight: 700,
  color: "#2C4E3B",
  margin: 0,
};

const URGENCY_COLORS: Record<string, string> = {
  immediate: "#EF4444",
  urgent: "#F59E0B",
};

function MetricTile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent: string }) {
  return (
    <div style={{ ...cardStyle, padding: "18px 20px", borderTop: `4px solid ${accent}`, borderRadius: "12px" }}>
      <p style={{ fontSize: "11px", fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.08em", margin: 0 }}>
        {label}
      </p>
      <p style={{ fontSize: "24px", fontWeight: 900, color: "#0F172A", margin: "6px 0 0" }}>{value}</p>
      {sub && <p style={{ fontSize: "12px", color: "#64748B", margin: "4px 0 0" }}>{sub}</p>}
    </div>
  );
}

export default function BoardReportPage() {
  const defaults = defaultFiscalYearDates();
  const [startDate, setStartDate] = useState(defaults.start);
  const [endDate, setEndDate] = useState(defaults.end);
  const [data, setData] = useState<BoardReportPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [execSummary, setExecSummary] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const load = useCallback(async (from: string, to: string) => {
    setLoading(true);
    setError(null);
    setExecSummary(null);
    try {
      const params = new URLSearchParams({ dateFrom: from, dateTo: to });
      const res = await fetch(`/api/reports/board-report/detail?${params.toString()}`, { cache: "no-store" });
      const body = (await res.json()) as BoardReportPageData & { error?: string };
      if (!res.ok) {
        setError((body as unknown as { error?: string }).error ?? "Failed to load board report.");
        return;
      }
      setData(body);
    } catch {
      setError("Network error loading board report.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(startDate, endDate);
    // Only run on mount with the default fiscal-year range — subsequent
    // loads are user-triggered via handleApplyRange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.body.classList.add("report-print-mode");
    return () => document.body.classList.remove("report-print-mode");
  }, []);

  function handleApplyRange() {
    if (!startDate || !endDate || startDate > endDate) return;
    void load(startDate, endDate);
  }

  async function handleGenerateSummary() {
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const res = await fetch("/api/reports/board-report/executive-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dateFrom: startDate, dateTo: endDate }),
      });
      const body = (await res.json()) as { summary?: string; error?: string };
      if (!res.ok) {
        setSummaryError(body.error ?? "Executive summary generation failed.");
        return;
      }
      setExecSummary(body.summary ?? null);
    } catch {
      setSummaryError("Network error generating executive summary.");
    } finally {
      setSummaryLoading(false);
    }
  }

  function handlePrint() {
    window.print();
  }

  const winRate = useMemo(() => {
    if (!data) return null;
    const { awards, denials } = data.core.executive;
    return awards + denials > 0 ? Math.round((awards / (awards + denials)) * 100) : null;
  }, [data]);

  return (
    <div style={{ backgroundColor: "#F0EBE0", minHeight: "100%", padding: "32px" }}>
      {/* Controls — hidden on print */}
      <div
        className="print:hidden"
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "16px",
          marginBottom: "28px",
        }}
      >
        <div>
          <h1 style={{ fontSize: "28px", fontWeight: 800, color: "#2C4E3B", letterSpacing: "-0.02em", margin: 0, borderLeft: "4px solid #7A5980", paddingLeft: "16px" }}>
            Board Report
          </h1>
          <p style={{ fontSize: "14px", color: "#64748B", marginTop: "6px" }}>
            Auto-generated, board-ready funding report with an AI-written executive summary.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", backgroundColor: "#F8F5EE", borderRadius: "10px", padding: "6px 10px", boxShadow: "0 2px 8px rgba(122,89,128,0.14)" }}>
            <Calendar size={14} color="#7A5980" />
            <input
              type="date"
              value={startDate}
              max={endDate}
              onChange={(e) => setStartDate(e.target.value)}
              style={{ border: "none", fontSize: "13px", color: "#0F172A", outline: "none" }}
            />
            <span style={{ color: "#64748B", fontSize: "12px" }}>to</span>
            <input
              type="date"
              value={endDate}
              min={startDate}
              onChange={(e) => setEndDate(e.target.value)}
              style={{ border: "none", fontSize: "13px", color: "#0F172A", outline: "none" }}
            />
          </div>
          <button
            onClick={handleApplyRange}
            disabled={loading}
            style={{
              padding: "10px 16px",
              borderRadius: "8px",
              border: "1px solid #B8C9D9",
              backgroundColor: "#FFFFFF",
              color: "#0F172A",
              fontSize: "13px",
              fontWeight: 700,
              cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.6 : 1,
            }}
          >
            Apply
          </button>
          <button
            onClick={handlePrint}
            disabled={!data}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "10px 16px",
              borderRadius: "8px",
              border: "none",
              backgroundColor: "#7A5980",
              color: "#FFFFFF",
              fontSize: "13px",
              fontWeight: 700,
              cursor: data ? "pointer" : "not-allowed",
              opacity: data ? 1 : 0.5,
            }}
          >
            <Printer size={14} />
            Print / Export PDF
          </button>
        </div>
      </div>

      {loading && (
        <div style={{ ...cardStyle, display: "flex", alignItems: "center", gap: "10px" }}>
          <Loader2 size={16} className="animate-spin" color="#7A5980" />
          <span style={{ fontSize: "14px", color: "#64748B" }}>Aggregating board report data...</span>
        </div>
      )}

      {!loading && error && (
        <div style={{ ...cardStyle, borderLeft: "4px solid #EF4444", display: "flex", gap: "10px", alignItems: "flex-start" }}>
          <AlertCircle size={16} color="#EF4444" style={{ marginTop: "2px", flexShrink: 0 }} />
          <p style={{ fontSize: "14px", color: "#B91C1C", margin: 0 }}>{error}</p>
        </div>
      )}

      {!loading && !error && data && (
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          {/* Print-only header */}
          <div className="hidden print:block" style={{ marginBottom: "8px" }}>
            <h1 style={{ fontSize: "24px", fontWeight: 800, color: "#0F172A", margin: 0 }}>
              {data.core.organization.name} — Board Report
            </h1>
            <p style={{ fontSize: "13px", color: "#64748B", margin: "4px 0 0" }}>
              {formatDate(startDate)} – {formatDate(endDate)}
            </p>
          </div>

          {/* 1. Executive Summary */}
          <div style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px", flexWrap: "wrap", gap: "10px" }}>
              <h2 style={sectionTitleStyle}>Executive Summary</h2>
              <button
                onClick={handleGenerateSummary}
                disabled={summaryLoading}
                className="print:hidden"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 14px",
                  borderRadius: "8px",
                  border: "none",
                  backgroundColor: "#7A5980",
                  color: "#FFFFFF",
                  fontSize: "12px",
                  fontWeight: 700,
                  cursor: summaryLoading ? "not-allowed" : "pointer",
                  opacity: summaryLoading ? 0.7 : 1,
                }}
              >
                {summaryLoading ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                {summaryLoading ? "Writing..." : "Generate Executive Summary"}
              </button>
            </div>
            {summaryError && (
              <p style={{ fontSize: "12px", color: "#B91C1C", marginBottom: "10px" }}>{summaryError}</p>
            )}
            {execSummary ? (
              <p style={{ fontSize: "14px", lineHeight: 1.7, color: "#334155", margin: 0 }}>{execSummary}</p>
            ) : (
              <p style={{ fontSize: "13px", color: "#94A3B8", margin: 0, fontStyle: "italic" }}>
                Click &quot;Generate Executive Summary&quot; for a 200-word, board-appropriate narrative covering this
                period&apos;s performance.
              </p>
            )}
          </div>

          {/* 2. Pipeline Overview */}
          <div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: "14px",
              }}
            >
              <MetricTile label="Total Opportunities" value={data.core.executive.totalOpportunities.toLocaleString()} accent="#4F6D8F" />
              <MetricTile label="Applications Submitted" value={data.core.executive.applicationsSubmitted.toLocaleString()} sub={formatCurrency(data.core.executive.totalRequested) + " requested"} accent="#7A5980" />
              <MetricTile label="Awards" value={data.core.executive.awards.toLocaleString()} sub={formatCurrency(data.core.executive.totalAwarded)} accent="#10B981" />
              <MetricTile label="Win Rate" value={winRate !== null ? `${winRate}%` : "—"} sub={`${data.core.executive.awards} awarded / ${data.core.executive.denials} denied`} accent="#4F6D8F" />
            </div>
            {data.core.pipeline.length > 0 && (
              <div style={{ ...cardStyle, marginTop: "14px" }}>
                <h3 style={{ fontSize: "13px", fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "12px" }}>
                  Pipeline by Stage
                </h3>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
                  {data.core.pipeline.map((p) => (
                    <div
                      key={p.stage}
                      style={{
                        padding: "8px 14px",
                        borderRadius: "8px",
                        backgroundColor: "#F1F5F9",
                        fontSize: "13px",
                        color: "#0F172A",
                      }}
                    >
                      <span style={{ fontWeight: 700 }}>{p.count}</span>{" "}
                      <span style={{ color: "#64748B" }}>{humanizeEnum(p.stage)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 3. Key Wins This Quarter */}
          <div style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
              <Trophy size={16} color="#F59E0B" />
              <h2 style={sectionTitleStyle}>Key Wins This Period</h2>
            </div>
            {data.keyWins.length === 0 ? (
              <p style={{ fontSize: "13px", color: "#64748B", margin: 0 }}>No awards recorded in this period.</p>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "10px" }}>
                {data.keyWins.map((win, i) => (
                  <li
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "10px 14px",
                      backgroundColor: "#F0FDF4",
                      borderRadius: "10px",
                      border: "1px solid rgba(16,185,129,0.25)",
                    }}
                  >
                    <div>
                      <p style={{ fontSize: "13px", fontWeight: 700, color: "#0F172A", margin: 0 }}>{win.opportunityName}</p>
                      <p style={{ fontSize: "12px", color: "#64748B", margin: "2px 0 0" }}>
                        {win.funderName ? `${win.funderName} · ` : ""}
                        {win.category ? humanizeEnum(win.category) : ""} · {formatDate(win.recordedAt)}
                      </p>
                    </div>
                    <span style={{ fontSize: "15px", fontWeight: 800, color: "#10B981" }}>{formatCurrency(win.awardedAmount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 4. Upcoming Deadlines (next 60 days) */}
          <div style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
              <Clock size={16} color="#7A5980" />
              <h2 style={sectionTitleStyle}>Upcoming Deadlines (Next 60 Days)</h2>
            </div>
            {data.upcomingDeadlines.length === 0 ? (
              <p style={{ fontSize: "13px", color: "#64748B", margin: 0 }}>No deadlines in the next 60 days.</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #E2E8F0", textAlign: "left" }}>
                    <th style={{ padding: "8px 4px", color: "#64748B", fontWeight: 600 }}>Opportunity</th>
                    <th style={{ padding: "8px 4px", color: "#64748B", fontWeight: 600 }}>Funder</th>
                    <th style={{ padding: "8px 4px", color: "#64748B", fontWeight: 600, textAlign: "right" }}>Amount</th>
                    <th style={{ padding: "8px 4px", color: "#64748B", fontWeight: 600, textAlign: "right" }}>Probability</th>
                    <th style={{ padding: "8px 4px", color: "#64748B", fontWeight: 600, textAlign: "right" }}>Deadline</th>
                  </tr>
                </thead>
                <tbody>
                  {data.upcomingDeadlines.map((d) => (
                    <tr key={d.opportunityId} style={{ borderBottom: "1px solid #F1F5F9" }}>
                      <td style={{ padding: "10px 4px", color: "#0F172A", fontWeight: 600 }}>{d.name}</td>
                      <td style={{ padding: "10px 4px", color: "#64748B" }}>{d.funderName ?? "—"}</td>
                      <td style={{ padding: "10px 4px", textAlign: "right", color: "#0F172A" }}>
                        {d.amountMax !== null ? formatCurrency(d.amountMax) : "—"}
                      </td>
                      <td style={{ padding: "10px 4px", textAlign: "right" }}>
                        {d.probabilityScore !== null ? (
                          <span
                            style={{
                              padding: "2px 8px",
                              borderRadius: "9999px",
                              fontSize: "11px",
                              fontWeight: 700,
                              backgroundColor:
                                d.probabilityScore >= 70 ? "#DCFCE7" : d.probabilityScore >= 40 ? "#FEF3C7" : "#FEE2E2",
                              color: d.probabilityScore >= 70 ? "#15803D" : d.probabilityScore >= 40 ? "#92400E" : "#B91C1C",
                            }}
                          >
                            {d.probabilityScore}%
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td style={{ padding: "10px 4px", textAlign: "right", color: "#0F172A", fontWeight: 600 }}>
                        {formatDate(d.deadline)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* 5. AI Platform Activity */}
          <div style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
              <Bot size={16} color="#7A5980" />
              <h2 style={sectionTitleStyle}>AI Platform Activity</h2>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "12px" }}>
              <div style={{ padding: "14px", borderRadius: "10px", backgroundColor: "#F5F3FF" }}>
                <p style={{ fontSize: "22px", fontWeight: 800, color: "#7A5980", margin: 0 }}>{data.aiActivity.agentRuns}</p>
                <p style={{ fontSize: "12px", color: "#64748B", margin: "2px 0 0" }}>Agent Runs</p>
              </div>
              <div style={{ padding: "14px", borderRadius: "10px", backgroundColor: "#F5F3FF" }}>
                <p style={{ fontSize: "22px", fontWeight: 800, color: "#7A5980", margin: 0 }}>{data.aiActivity.draftsGenerated}</p>
                <p style={{ fontSize: "12px", color: "#64748B", margin: "2px 0 0" }}>Drafts Generated</p>
              </div>
              <div style={{ padding: "14px", borderRadius: "10px", backgroundColor: "#ECFDF5" }}>
                <p style={{ fontSize: "22px", fontWeight: 800, color: "#10B981", margin: 0 }}>{data.aiActivity.opportunitiesDiscovered}</p>
                <p style={{ fontSize: "12px", color: "#64748B", margin: "2px 0 0" }}>Opportunities Discovered</p>
              </div>
            </div>
            {data.core.agentActivity.length > 0 && (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px", marginTop: "16px" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #E2E8F0", textAlign: "left" }}>
                    <th style={{ padding: "6px 4px", color: "#64748B", fontWeight: 600 }}>Agent</th>
                    <th style={{ padding: "6px 4px", color: "#64748B", fontWeight: 600, textAlign: "right" }}>Runs</th>
                    <th style={{ padding: "6px 4px", color: "#64748B", fontWeight: 600, textAlign: "right" }}>Success Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {data.core.agentActivity.map((a) => (
                    <tr key={a.agentType} style={{ borderBottom: "1px solid #F1F5F9" }}>
                      <td style={{ padding: "8px 4px", color: "#0F172A" }}>{humanizeEnum(a.agentType)}</td>
                      <td style={{ padding: "8px 4px", textAlign: "right", color: "#0F172A" }}>{a.runs}</td>
                      <td style={{ padding: "8px 4px", textAlign: "right", color: "#0F172A" }}>{a.successRate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* 6. Recommended Board Actions */}
          <div style={cardStyle}>
            <h2 style={{ ...sectionTitleStyle, marginBottom: "14px" }}>Recommended Board Actions</h2>
            {data.recommendedActions.length === 0 ? (
              <p style={{ fontSize: "13px", color: "#64748B", margin: 0 }}>
                No immediate or urgent recommendations at this time.
              </p>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "10px" }}>
                {data.recommendedActions.map((a) => (
                  <li
                    key={a.id}
                    style={{
                      padding: "12px 14px",
                      borderRadius: "10px",
                      backgroundColor: "#FFFBEB",
                      borderLeft: `4px solid ${URGENCY_COLORS[a.urgency] ?? "#94A3B8"}`,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                      <span
                        style={{
                          fontSize: "10px",
                          fontWeight: 800,
                          textTransform: "uppercase",
                          letterSpacing: "0.06em",
                          color: URGENCY_COLORS[a.urgency] ?? "#64748B",
                        }}
                      >
                        {a.urgency}
                      </span>
                      <span style={{ fontSize: "11px", color: "#94A3B8" }}>{humanizeEnum(a.category)}</span>
                    </div>
                    <p style={{ fontSize: "13px", fontWeight: 700, color: "#0F172A", margin: 0 }}>{a.title}</p>
                    <p style={{ fontSize: "12px", color: "#475569", margin: "4px 0 0", lineHeight: 1.6 }}>{a.recommendation}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
