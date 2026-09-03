"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import {
  AlertCircle,
  Building2,
  Compass,
  DollarSign,
  Heart,
  Loader2,
  Printer,
  Sparkles,
  Target,
  Users,
} from "lucide-react";

import { humanizeEnum } from "@/lib/utils/formatters";
import type { ImpactReportData } from "@/lib/reports/impact-report";

// Impact Report — organization impact report for donors and funders at
// /reports/impact, backed by GET/PUT /api/reports/impact and
// POST /api/reports/impact/enhance. Inline style={{}} with hardcoded hex
// only per BLUEPRINT_v2.md §7.5. Canvas #D6E4F0, matching board-report and
// funding-summary. See src/lib/reports/impact-report.ts header for why
// "admin vs program ratio" isn't shown (no live expense-category data
// source) and why "Stories of Impact" persists to platform_config rather
// than a dedicated table.

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

const cardStyle: CSSProperties = {
  backgroundColor: "#FFFFFF",
  borderRadius: "14px",
  padding: "24px",
  boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
};

const sectionTitleStyle: CSSProperties = {
  fontSize: "16px",
  fontWeight: 700,
  color: "#0F172A",
  margin: 0,
};

const PARTNER_INITIAL_COLORS = ["#3D6B50", "#6B48CC", "#10B981", "#F59E0B", "#C49A4F", "#EF4444"];

function initialAvatarColor(name: string): string {
  const sum = name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return PARTNER_INITIAL_COLORS[sum % PARTNER_INITIAL_COLORS.length]!;
}

function extractImpactMetricEntries(metrics: unknown): { label: string; value: string }[] {
  if (!metrics) return [];
  if (Array.isArray(metrics)) {
    return metrics
      .filter((m): m is string => typeof m === "string")
      .map((m) => ({ label: m, value: "" }));
  }
  if (typeof metrics === "object") {
    return Object.entries(metrics as Record<string, unknown>)
      .filter(([, v]) => typeof v === "string" || typeof v === "number")
      .map(([k, v]) => ({ label: humanizeEnum(k), value: String(v) }));
  }
  return [];
}

export default function ImpactReportPage() {
  const [data, setData] = useState<ImpactReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [stories, setStories] = useState<string[]>(["", ""]);
  const [savingStories, setSavingStories] = useState(false);
  const [storiesSaved, setStoriesSaved] = useState(false);

  const [narrative, setNarrative] = useState<string | null>(null);
  const [enhancing, setEnhancing] = useState(false);
  const [enhanceError, setEnhanceError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/reports/impact", { cache: "no-store" });
        const body = (await res.json()) as ImpactReportData & { error?: string };
        if (!res.ok) {
          setError((body as unknown as { error?: string }).error ?? "Failed to load impact report.");
          return;
        }
        setData(body);
        setStories([body.stories[0] ?? "", body.stories[1] ?? ""]);
      } catch {
        setError("Network error loading impact report.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    document.body.classList.add("report-print-mode");
    return () => document.body.classList.remove("report-print-mode");
  }, []);

  async function handleSaveStories() {
    setSavingStories(true);
    setStoriesSaved(false);
    try {
      const cleaned = stories.map((s) => s.trim()).filter(Boolean);
      const res = await fetch("/api/reports/impact", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stories: cleaned }),
      });
      if (res.ok) setStoriesSaved(true);
    } finally {
      setSavingStories(false);
    }
  }

  async function handleEnhance() {
    setEnhancing(true);
    setEnhanceError(null);
    try {
      const res = await fetch("/api/reports/impact/enhance", { method: "POST" });
      const body = (await res.json()) as { narrative?: string; error?: string };
      if (!res.ok) {
        setEnhanceError(body.error ?? "AI enhancement failed.");
        return;
      }
      setNarrative(body.narrative ?? null);
    } catch {
      setEnhanceError("Network error enhancing impact report.");
    } finally {
      setEnhancing(false);
    }
  }

  function handlePrint() {
    window.print();
  }

  return (
    <div style={{ backgroundColor: "#D6E4F0", minHeight: "100%", padding: "32px" }}>
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
          <h1 style={{ fontSize: "28px", fontWeight: 800, color: "#0F172A", letterSpacing: "-0.02em", margin: 0 }}>
            Impact Report
          </h1>
          <p style={{ fontSize: "14px", color: "#64748B", marginTop: "6px" }}>
            Organization impact report for donors and funders — mission, programs, stewardship, and stories.
          </p>
        </div>
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
            backgroundColor: "#3D6B50",
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

      {loading && (
        <div style={{ ...cardStyle, display: "flex", alignItems: "center", gap: "10px" }}>
          <Loader2 size={16} className="animate-spin" color="#3D6B50" />
          <span style={{ fontSize: "14px", color: "#64748B" }}>Loading impact report...</span>
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
              {data.organization.name} — Impact Report
            </h1>
          </div>

          {/* AI-enhanced narrative, when generated, replaces the manual sections for reading/printing */}
          <div className="print:hidden" style={{ ...cardStyle, background: "linear-gradient(135deg, #2C4E3B 0%, #3D6B50 100%)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <Sparkles size={18} color="#FFFFFF" />
                <div>
                  <p style={{ fontSize: "14px", fontWeight: 700, color: "#FFFFFF", margin: 0 }}>Publication-Ready Narrative</p>
                  <p style={{ fontSize: "12px", color: "rgba(255,255,255,0.75)", margin: "2px 0 0" }}>
                    Turn the sections below into polished prose for donors and funders.
                  </p>
                </div>
              </div>
              <button
                onClick={handleEnhance}
                disabled={enhancing}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "10px 16px",
                  borderRadius: "8px",
                  border: "none",
                  backgroundColor: "#FFFFFF",
                  color: "#2C4E3B",
                  fontSize: "13px",
                  fontWeight: 700,
                  cursor: enhancing ? "not-allowed" : "pointer",
                  opacity: enhancing ? 0.7 : 1,
                }}
              >
                {enhancing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                {enhancing ? "Enhancing..." : "Enhance with AI"}
              </button>
            </div>
            {enhanceError && (
              <p style={{ fontSize: "12px", color: "#FECACA", marginTop: "12px" }}>{enhanceError}</p>
            )}
            {narrative && (
              <div style={{ marginTop: "16px", backgroundColor: "rgba(255,255,255,0.08)", borderRadius: "10px", padding: "16px" }}>
                <p style={{ fontSize: "13px", lineHeight: 1.8, color: "#FFFFFF", whiteSpace: "pre-wrap", margin: 0 }}>
                  {narrative}
                </p>
              </div>
            )}
          </div>

          {/* Print-only narrative (shown instead of the raw sections when generated) */}
          {narrative && (
            <div className="hidden print:block" style={cardStyle}>
              <p style={{ fontSize: "13px", lineHeight: 1.8, color: "#334155", whiteSpace: "pre-wrap", margin: 0 }}>
                {narrative}
              </p>
            </div>
          )}

          {/* 1. Mission Statement */}
          <div style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
              <Compass size={16} color="#3D6B50" />
              <h2 style={sectionTitleStyle}>Mission</h2>
            </div>
            {data.organization.missionStatement ? (
              <p style={{ fontSize: "15px", lineHeight: 1.7, color: "#334155", fontStyle: "italic", margin: 0 }}>
                &ldquo;{data.organization.missionStatement}&rdquo;
              </p>
            ) : (
              <p style={{ fontSize: "13px", color: "#94A3B8", margin: 0 }}>
                No mission statement on file. Add one in Knowledge Base &rarr; Profile.
              </p>
            )}
            {(data.organization.serviceArea || data.organization.targetPopulation) && (
              <p style={{ fontSize: "12px", color: "#64748B", marginTop: "10px" }}>
                {data.organization.serviceArea ? `Serving ${data.organization.serviceArea}` : ""}
                {data.organization.serviceArea && data.organization.targetPopulation ? " · " : ""}
                {data.organization.targetPopulation ?? ""}
              </p>
            )}
          </div>

          {/* 2. Programs at a Glance */}
          <div style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
              <Target size={16} color="#6B48CC" />
              <h2 style={sectionTitleStyle}>Programs at a Glance</h2>
            </div>
            {data.programs.length === 0 ? (
              <p style={{ fontSize: "13px", color: "#94A3B8", margin: 0 }}>
                No programs on file yet. Add programs in Knowledge Base &rarr; Profile.
              </p>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "14px" }}>
                {data.programs.map((p) => (
                  <div key={p.id} style={{ padding: "16px", borderRadius: "10px", backgroundColor: "#F8FAFC", border: "1px solid #E2E8F0" }}>
                    <p style={{ fontSize: "14px", fontWeight: 700, color: "#0F172A", margin: 0 }}>{p.name}</p>
                    {p.description && (
                      <p style={{ fontSize: "12px", color: "#64748B", margin: "6px 0 0", lineHeight: 1.6 }}>{p.description}</p>
                    )}
                    <div style={{ display: "flex", gap: "14px", marginTop: "10px", flexWrap: "wrap" }}>
                      {p.beneficiariesServed !== null && (
                        <span style={{ fontSize: "12px", color: "#3D6B50", fontWeight: 700 }}>
                          {p.beneficiariesServed.toLocaleString()} served
                        </span>
                      )}
                      {p.budget !== null && (
                        <span style={{ fontSize: "12px", color: "#10B981", fontWeight: 700 }}>{formatCurrency(p.budget)}</span>
                      )}
                      {p.status && <span style={{ fontSize: "11px", color: "#94A3B8" }}>{humanizeEnum(p.status)}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 3. Financial Stewardship */}
          <div style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
              <DollarSign size={16} color="#10B981" />
              <h2 style={sectionTitleStyle}>Financial Stewardship</h2>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px", marginBottom: data.financial.byCategory.length > 0 ? "18px" : 0 }}>
              <div style={{ padding: "14px", borderRadius: "10px", backgroundColor: "#F0FDF4" }}>
                <p style={{ fontSize: "20px", fontWeight: 800, color: "#10B981", margin: 0 }}>
                  {data.financial.annualBudget !== null ? formatCurrency(data.financial.annualBudget) : "—"}
                </p>
                <p style={{ fontSize: "12px", color: "#64748B", margin: "2px 0 0" }}>Annual Operating Budget</p>
              </div>
              <div style={{ padding: "14px", borderRadius: "10px", backgroundColor: "#F0F9FF" }}>
                <p style={{ fontSize: "20px", fontWeight: 800, color: "#3D6B50", margin: 0 }}>
                  {formatCurrency(data.financial.totalAwarded)}
                </p>
                <p style={{ fontSize: "12px", color: "#64748B", margin: "2px 0 0" }}>
                  Grant Revenue Secured ({data.financial.awardedCount} award{data.financial.awardedCount === 1 ? "" : "s"})
                </p>
              </div>
              <div style={{ padding: "14px", borderRadius: "10px", backgroundColor: "#F5F3FF" }}>
                <p style={{ fontSize: "20px", fontWeight: 800, color: "#6B48CC", margin: 0 }}>
                  {formatCurrency(data.financial.totalRequested)}
                </p>
                <p style={{ fontSize: "12px", color: "#64748B", margin: "2px 0 0" }}>Total Requested (all-time)</p>
              </div>
            </div>
            {data.financial.byCategory.length > 0 && (
              <>
                <p style={{ fontSize: "12px", fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "8px" }}>
                  Revenue by Funding Category
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {data.financial.byCategory.map((c) => {
                    const max = data.financial.byCategory[0]!.awarded || 1;
                    const pct = Math.max(4, Math.round((c.awarded / max) * 100));
                    return (
                      <div key={c.category} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <span style={{ fontSize: "12px", color: "#334155", width: "160px", flexShrink: 0 }}>{humanizeEnum(c.category)}</span>
                        <div style={{ flex: 1, height: "10px", borderRadius: "6px", backgroundColor: "#F1F5F9", overflow: "hidden" }}>
                          <div style={{ width: `${pct}%`, height: "100%", backgroundColor: "#10B981", borderRadius: "6px" }} />
                        </div>
                        <span style={{ fontSize: "12px", fontWeight: 700, color: "#0F172A", width: "90px", textAlign: "right" }}>
                          {formatCurrency(c.awarded)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* 4. Community Impact Metrics */}
          <div style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
              <Users size={16} color="#F59E0B" />
              <h2 style={sectionTitleStyle}>Community Impact Metrics</h2>
            </div>
            {data.communityMetrics.length === 0 ? (
              <p style={{ fontSize: "13px", color: "#94A3B8", margin: 0 }}>
                No program impact metrics on file yet. Add them per-program in Knowledge Base &rarr; Profile.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                {data.communityMetrics.map((m) => {
                  const entries = extractImpactMetricEntries(m.metrics);
                  if (entries.length === 0) return null;
                  return (
                    <div key={m.programName}>
                      <p style={{ fontSize: "12px", fontWeight: 700, color: "#64748B", marginBottom: "8px" }}>{m.programName}</p>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                        {entries.map((e, i) => (
                          <div
                            key={i}
                            style={{
                              padding: "8px 12px",
                              borderRadius: "8px",
                              backgroundColor: "#FFFBEB",
                              fontSize: "12px",
                              color: "#92400E",
                              fontWeight: 600,
                            }}
                          >
                            {e.value ? `${e.value} — ${e.label}` : e.label}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 5. Stories of Impact */}
          <div style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
              <Heart size={16} color="#EF4444" />
              <h2 style={sectionTitleStyle}>Stories of Impact</h2>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {[0, 1].map((i) => (
                <textarea
                  key={i}
                  value={stories[i] ?? ""}
                  onChange={(e) => {
                    const next = [...stories];
                    next[i] = e.target.value;
                    setStories(next);
                    setStoriesSaved(false);
                  }}
                  placeholder={`Story ${i + 1} — share a specific person or family your organization helped this year...`}
                  className="print:hidden"
                  rows={3}
                  style={{
                    width: "100%",
                    padding: "12px",
                    borderRadius: "8px",
                    border: "1px solid #E2E8F0",
                    fontSize: "13px",
                    color: "#0F172A",
                    resize: "vertical",
                    fontFamily: "inherit",
                  }}
                />
              ))}
              {stories.some((s) => s.trim().length > 0) && (
                <div className="hidden print:block" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {stories.filter((s) => s.trim()).map((s, i) => (
                    <p key={i} style={{ fontSize: "13px", lineHeight: 1.7, color: "#334155", margin: 0, fontStyle: "italic" }}>
                      &ldquo;{s}&rdquo;
                    </p>
                  ))}
                </div>
              )}
              <div className="print:hidden" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <button
                  onClick={handleSaveStories}
                  disabled={savingStories}
                  style={{
                    padding: "9px 16px",
                    borderRadius: "8px",
                    border: "none",
                    backgroundColor: "#3D6B50",
                    color: "#FFFFFF",
                    fontSize: "13px",
                    fontWeight: 700,
                    cursor: savingStories ? "not-allowed" : "pointer",
                    opacity: savingStories ? 0.7 : 1,
                  }}
                >
                  {savingStories ? "Saving..." : "Save Stories"}
                </button>
                {storiesSaved && <span style={{ fontSize: "12px", color: "#10B981", fontWeight: 600 }}>Saved</span>}
              </div>
            </div>
          </div>

          {/* 6. Partners and Funders */}
          <div style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
              <Building2 size={16} color="#C49A4F" />
              <h2 style={sectionTitleStyle}>Partners &amp; Funders</h2>
            </div>
            {data.partners.length === 0 ? (
              <p style={{ fontSize: "13px", color: "#94A3B8", margin: 0 }}>
                No funders with recorded awards yet.
              </p>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
                {data.partners.map((p) => (
                  <div
                    key={p.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      padding: "10px 14px",
                      borderRadius: "10px",
                      backgroundColor: "#F8FAFC",
                      border: "1px solid #E2E8F0",
                    }}
                  >
                    <div
                      style={{
                        width: "32px",
                        height: "32px",
                        borderRadius: "8px",
                        backgroundColor: initialAvatarColor(p.name),
                        color: "#FFFFFF",
                        fontSize: "13px",
                        fontWeight: 800,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      {p.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p style={{ fontSize: "13px", fontWeight: 700, color: "#0F172A", margin: 0 }}>{p.name}</p>
                      <p style={{ fontSize: "11px", color: "#64748B", margin: 0 }}>{humanizeEnum(p.category)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 7. Looking Ahead */}
          <div style={cardStyle}>
            <h2 style={{ ...sectionTitleStyle, marginBottom: "14px" }}>Looking Ahead</h2>
            {data.lookingAhead.length === 0 ? (
              <p style={{ fontSize: "13px", color: "#94A3B8", margin: 0 }}>
                No forward-looking goals on file. Add vision or sustainability entries in Knowledge Base.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {data.lookingAhead.map((g) => (
                  <div key={g.id} style={{ padding: "12px 14px", borderRadius: "10px", backgroundColor: "#F0F9FF", borderLeft: "4px solid #3D6B50" }}>
                    <p style={{ fontSize: "13px", fontWeight: 700, color: "#0F172A", margin: 0 }}>{g.title}</p>
                    <p style={{ fontSize: "12px", color: "#475569", margin: "4px 0 0", lineHeight: 1.6 }}>{g.content}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
