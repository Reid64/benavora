"use client";

// AG-30 Donor Intent Monitor UI (AUTONOMOUS_PLATFORM_VISION.md Phase 2,
// "AI Donor Intent Engine"; src/lib/agents/donor-intent-monitor-agent.ts).
// Talks to /api/intelligence/donor-intent, which wraps
// DonorIntentMonitorAgent — press/ESG/SEC/hiring/facility-expansion signal
// research for corporate prospects, grounded in live web search. Every
// color on this page is an inline hex value per BLUEPRINT_v2.md §7.5 — no
// CSS variables, no Tailwind color classes.

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, Sparkles } from "lucide-react";

type SignalType =
  | "press_release"
  | "esg_report"
  | "sec_filing"
  | "hiring_trend"
  | "facility_expansion"
  | "disaster_declaration"
  | "foundation_appointment"
  | "csr_announcement"
  | "executive_interview";

interface IntentSignal {
  id: string;
  org_id: string;
  company_name: string;
  signal_type: SignalType;
  signal_summary: string;
  signal_url: string | null;
  signal_date: string | null;
  intent_score: number | null;
  geographic_relevance: number | null;
  mission_alignment: number | null;
  recommended_action: string | null;
  recommended_deadline: string | null;
  created_at: string;
}

const SIGNAL_TYPE_LABELS: Record<SignalType, string> = {
  press_release: "Press Release",
  esg_report: "ESG Report",
  sec_filing: "SEC Filing",
  hiring_trend: "Hiring Trend",
  facility_expansion: "Facility Expansion",
  disaster_declaration: "Disaster Declaration",
  foundation_appointment: "Foundation Appointment",
  csr_announcement: "CSR Announcement",
  executive_interview: "Executive Interview",
};

function accentColor(score: number | null): string {
  if (score === null) return "#94A3B8";
  if (score >= 80) return "#DC2626";
  if (score >= 60) return "#F59E0B";
  return "#6B7280";
}

function formatDate(value: string | null): string {
  if (!value) return "Date unknown";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-US", { dateStyle: "medium" });
}

function hoursUntil(value: string | null): number | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.round((parsed.getTime() - Date.now()) / (1000 * 60 * 60));
}

function StatTile({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div
      style={{
        backgroundColor: "#F8F5EE",
        borderRadius: "14px",
        padding: "20px 24px",
        boxShadow: "0 4px 20px rgba(122,89,128,0.18)",
        flex: "1 1 200px",
      }}
    >
      <p
        style={{
          fontSize: "11px",
          fontWeight: 700,
          color: "#64748B",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          margin: "0 0 8px",
        }}
      >
        {label}
      </p>
      <p style={{ fontSize: "28px", fontWeight: 900, color, margin: 0 }}>{value}</p>
    </div>
  );
}

export default function DonorIntentPage() {
  const [signals, setSignals] = useState<IntentSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runNotice, setRunNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/intelligence/donor-intent", { cache: "no-store" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((payload as { error?: string }).error ?? "Could not load donor intent signals.");
        return;
      }
      setSignals((payload as { signals?: IntentSignal[] }).signals ?? []);
    } catch {
      setError("Could not reach the donor intent service.");
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      await load();
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [load]);

  async function handleRunAnalysis() {
    setRunning(true);
    setRunNotice(null);
    setError(null);
    try {
      const res = await fetch("/api/intelligence/donor-intent", { method: "POST" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((payload as { error?: string }).error ?? "Donor intent analysis failed.");
        return;
      }
      const data = payload as {
        signals?: IntentSignal[];
        itemsQueued?: number;
        errors?: string[];
      };
      setSignals(data.signals ?? []);
      if (data.errors && data.errors.length > 0) {
        setRunNotice(data.errors[0] ?? "Donor intent analysis reported an issue.");
      } else {
        setRunNotice(
          data.itemsQueued && data.itemsQueued > 0
            ? `Detected ${data.itemsQueued} donor intent signal${data.itemsQueued !== 1 ? "s" : ""}.`
            : "No new signals found — no real evidence cleared the intent threshold this run.",
        );
      }
    } catch {
      setError("Could not reach the donor intent service.");
    } finally {
      setRunning(false);
    }
  }

  const highIntentCount = signals.filter((s) => (s.intent_score ?? 0) >= 80).length;
  const actionRequiredTodayCount = signals.filter((s) => {
    const h = hoursUntil(s.recommended_deadline);
    return h !== null && h <= 24;
  }).length;
  const scored = signals.filter((s) => typeof s.intent_score === "number");
  const avgIntentScore =
    scored.length > 0
      ? Math.round(scored.reduce((sum, s) => sum + (s.intent_score ?? 0), 0) / scored.length)
      : null;

  const showEmpty = !loading && signals.length === 0;

  return (
    <div style={{ backgroundColor: "#F0EBE0", minHeight: "100vh", padding: "32px" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "16px",
          flexWrap: "wrap",
          marginBottom: "28px",
        }}
      >
        <div style={{ borderLeft: "4px solid #7A5980", paddingLeft: "16px" }}>
          <h1
            style={{
              fontSize: "28px",
              fontWeight: 800,
              color: "#2C4E3B",
              letterSpacing: "-0.02em",
              margin: 0,
            }}
          >
            Giving Signals
          </h1>
          <p style={{ fontSize: "14px", color: "#64748B", marginTop: "6px" }}>
            Predict giving announcements before they&rsquo;re public.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleRunAnalysis()}
          disabled={running}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            backgroundColor: "#7A5980",
            color: "#FFFFFF",
            fontSize: "14px",
            fontWeight: 700,
            padding: "12px 24px",
            borderRadius: "10px",
            border: "none",
            cursor: running ? "default" : "pointer",
            opacity: running ? 0.7 : 1,
            boxShadow: "0 4px 16px rgba(122,89,128,0.25)",
          }}
        >
          {running ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
          {running ? "Running Analysis..." : "Run Analysis"}
        </button>
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

      {runNotice && !error && (
        <div
          style={{
            backgroundColor: "#F0FDFA",
            border: "1px solid #99F6E4",
            borderRadius: "10px",
            padding: "12px 16px",
            marginBottom: "20px",
            fontSize: "13px",
            color: "#0F766E",
          }}
        >
          {runNotice}
        </div>
      )}

      {/* Stats row */}
      <div
        style={{
          display: "flex",
          gap: "16px",
          flexWrap: "wrap",
          marginBottom: "28px",
        }}
      >
        <StatTile label="Total Signals" value={String(signals.length)} color="#2C4E3B" />
        <StatTile label="High Intent (≥80)" value={String(highIntentCount)} color="#DC2626" />
        <StatTile
          label="Action Required Today"
          value={String(actionRequiredTodayCount)}
          color="#F59E0B"
        />
        <StatTile
          label="Avg Intent Score"
          value={avgIntentScore !== null ? String(avgIntentScore) : "—"}
          color="#4F6D8F"
        />
      </div>

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
          Loading donor intent signals...
        </div>
      ) : showEmpty ? (
        <div
          style={{
            backgroundColor: "#F8F5EE",
            borderRadius: "14px",
            padding: "56px 24px",
            textAlign: "center",
            boxShadow: "0 4px 20px rgba(122,89,128,0.18)",
          }}
        >
          <AlertTriangle size={32} color="#94A3B8" style={{ margin: "0 auto 12px" }} />
          <p style={{ fontSize: "14px", fontWeight: 700, color: "#2C4E3B", margin: 0 }}>
            No signals yet.
          </p>
          <p style={{ fontSize: "13px", color: "#64748B", marginTop: "8px" }}>
            Run Analysis to detect donor intent signals for your corporate prospects.
          </p>
        </div>
      ) : (
        <div>
          {signals.map((signal) => (
            <SignalCard key={signal.id} signal={signal} />
          ))}
        </div>
      )}
    </div>
  );
}

function SignalCard({ signal }: { signal: IntentSignal }) {
  const accent = accentColor(signal.intent_score);
  const deadlineHours = hoursUntil(signal.recommended_deadline);
  const deadlineSoon = deadlineHours !== null && deadlineHours <= 48;

  return (
    <div
      style={{
        display: "flex",
        backgroundColor: "#F8F5EE",
        borderRadius: "12px",
        overflow: "hidden",
        marginBottom: "16px",
        boxShadow: "0 4px 20px rgba(122,89,128,0.18)",
      }}
    >
      <div style={{ width: "6px", flexShrink: 0, backgroundColor: accent }} aria-hidden />
      <div style={{ flex: 1, padding: "20px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "16px",
            marginBottom: "10px",
          }}
        >
          <div>
            <h3 style={{ fontSize: "16px", fontWeight: 700, color: "#2C4E3B", margin: "0 0 6px" }}>
              {signal.company_name}
            </h3>
            <span
              style={{
                fontSize: "11px",
                fontWeight: 700,
                color: "#FFFFFF",
                backgroundColor: "#2C4E3B",
                borderRadius: "999px",
                padding: "3px 12px",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              {SIGNAL_TYPE_LABELS[signal.signal_type]}
            </span>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <p style={{ fontSize: "32px", fontWeight: 900, color: accent, margin: 0, lineHeight: 1 }}>
              {signal.intent_score ?? "—"}
            </p>
            <p
              style={{
                fontSize: "10px",
                fontWeight: 700,
                color: "#94A3B8",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                margin: "2px 0 0",
              }}
            >
              Intent Score
            </p>
          </div>
        </div>

        <p style={{ fontSize: "14px", color: "#374151", lineHeight: 1.6, margin: "0 0 12px" }}>
          {signal.signal_summary}
        </p>

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "14px" }}>
          {signal.geographic_relevance !== null && (
            <span
              style={{
                fontSize: "11px",
                fontWeight: 700,
                color: "#7A5980",
                backgroundColor: "#F5F3FF",
                borderRadius: "999px",
                padding: "3px 12px",
              }}
            >
              Geographic Fit: {signal.geographic_relevance}
            </span>
          )}
          {signal.mission_alignment !== null && (
            <span
              style={{
                fontSize: "11px",
                fontWeight: 700,
                color: "#7A5980",
                backgroundColor: "#F5F3FF",
                borderRadius: "999px",
                padding: "3px 12px",
              }}
            >
              Mission Alignment: {signal.mission_alignment}
            </span>
          )}
          <span
            style={{
              fontSize: "11px",
              fontWeight: 600,
              color: "#94A3B8",
              padding: "3px 0",
            }}
          >
            {signal.signal_date ? `Signal dated ${formatDate(signal.signal_date)}` : `Recorded ${formatDate(signal.created_at)}`}
          </span>
        </div>

        {signal.recommended_action && (
          <div
            style={{
              backgroundColor: "#FFFBEB",
              border: "1px solid #FDE68A",
              borderRadius: "10px",
              padding: "14px 16px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
                marginBottom: "6px",
              }}
            >
              <p
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  color: "#92400E",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  margin: 0,
                }}
              >
                Recommended Action
              </p>
              {signal.recommended_deadline && (
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: 700,
                    color: "#FFFFFF",
                    backgroundColor: deadlineSoon ? "#DC2626" : "#94A3B8",
                    borderRadius: "999px",
                    padding: "3px 10px",
                    whiteSpace: "nowrap",
                  }}
                >
                  {deadlineHours !== null && deadlineHours > 0
                    ? `Due in ${deadlineHours}h`
                    : deadlineHours !== null && deadlineHours <= 0
                      ? "Overdue"
                      : `Due ${formatDate(signal.recommended_deadline)}`}
                </span>
              )}
            </div>
            <p style={{ fontSize: "13px", color: "#78350F", margin: 0, lineHeight: 1.5 }}>
              {signal.recommended_action}
            </p>
            {signal.signal_url && (
              <a
                href={signal.signal_url}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: "inline-block",
                  marginTop: "10px",
                  fontSize: "12px",
                  fontWeight: 700,
                  color: "#7A5980",
                }}
              >
                View source →
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
