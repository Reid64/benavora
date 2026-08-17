"use client";

// Corporate Intent Intelligence dashboard — real-time AI-detected corporate
// giving signals surfaced inside the Donor Discovery section. Talks to
// /api/intelligence/donor-intent, which wraps DonorIntentMonitorAgent (AG-30,
// src/lib/agents/donor-intent-monitor-agent.ts) and reads/writes
// corporate_intent_signals (migration 093_donor_intent_engine.sql — see that
// file for the exact column set: no prospect_id/company_id FK exists, only a
// free-text company_name, so "View Company" below resolves a website via a
// best-effort corporate_prospects.legal_name lookup rather than a route that
// doesn't exist in this app).
//
// Every color on this page is an inline hex value per BLUEPRINT_v2.md §7.5 —
// no CSS variables, no Tailwind color classes. Canvas is #D6E4F0 per the
// locked design system (BLUEPRINT_v2.md §7.1); signal cards use a dark
// #0D1526 surface per this feature's own build spec, distinct from the
// light-card convention used elsewhere in Donor Discovery.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Radar, Sparkles } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { canEdit, useProfile } from "@/lib/hooks/useProfile";

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

/** Badge colors requested per signal type; the five types not named in the
 * spec (sec_filing, hiring_trend already named — disaster_declaration,
 * foundation_appointment, executive_interview weren't) fall back to the
 * spec's own "Press Release" gray rather than inventing new hexes. */
const SIGNAL_TYPE_COLOR: Record<SignalType, string> = {
  csr_announcement: "#10B981",
  esg_report: "#0EA5E9",
  press_release: "#6B7280",
  facility_expansion: "#8B5CF6",
  hiring_trend: "#F59E0B",
  sec_filing: "#6B7280",
  disaster_declaration: "#6B7280",
  foundation_appointment: "#6B7280",
  executive_interview: "#6B7280",
};

const HIGH_INTENT_THRESHOLD = 80;
const MID_INTENT_THRESHOLD = 60;
const DEADLINE_SOON_HOURS = 48;
const LOOKBACK_DAYS = 30;

// Research & Discovery section accent, per PAGE_TREATMENT_PROTOCOL.md and
// governance/DESIGN_SYSTEM.md's Section Accent Colors — same value already
// applied to /research, /opportunities, and /donor-discovery.
const SECTION_ACCENT = "#0284C7";
// Fixed bright teal — reserved for primary action buttons across every
// section, per PAGE_TREATMENT_PROTOCOL.md. Dark text for contrast, matching
// the precedent set on /research and /opportunities.
const CTA_TEAL_BG = "#22D3EE";
const CTA_TEAL_TEXT = "#0A1628";

function accentColor(score: number | null): string {
  if (score === null) return "#6B7280";
  if (score >= HIGH_INTENT_THRESHOLD) return "#DC2626";
  if (score >= MID_INTENT_THRESHOLD) return "#F59E0B";
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

function isDueTodayOrPast(value: string | null): boolean {
  if (!value) return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);
  return parsed.getTime() <= todayEnd.getTime();
}

function metricColor(value: number): string {
  if (value >= 70) return "#10B981";
  if (value >= 40) return "#F59E0B";
  return "#EF4444";
}

function StatCard({
  label,
  value,
  color,
  pulse,
}: {
  label: string;
  value: string;
  color: string;
  pulse?: boolean;
}) {
  return (
    <div
      style={{
        backgroundColor: "#0D1526",
        borderRadius: "14px",
        padding: "20px 24px",
        boxShadow: "0 4px 20px rgba(0,0,0,0.25)",
        flex: "1 1 220px",
        position: "relative",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <p
          style={{
            fontSize: "11px",
            fontWeight: 700,
            color: "#8BA8C8",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            margin: 0,
          }}
        >
          {label}
        </p>
        {pulse && (
          <span
            aria-label="Attention required"
            style={{
              display: "inline-block",
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              backgroundColor: "#DC2626",
              boxShadow: "0 0 0 rgba(220,38,38,0.6)",
              animation: "intentPulse 1.6s infinite",
            }}
          />
        )}
      </div>
      <p style={{ fontSize: "28px", fontWeight: 900, color, margin: "8px 0 0" }}>{value}</p>
      <style>{`
        @keyframes intentPulse {
          0% { box-shadow: 0 0 0 0 rgba(220,38,38,0.6); }
          70% { box-shadow: 0 0 0 8px rgba(220,38,38,0); }
          100% { box-shadow: 0 0 0 0 rgba(220,38,38,0); }
        }
      `}</style>
    </div>
  );
}

function MetricBadge({ label, value }: { label: string; value: number }) {
  const color = metricColor(value);
  return (
    <span
      style={{
        fontSize: "11px",
        fontWeight: 700,
        color,
        backgroundColor: `${color}1A`,
        borderRadius: "999px",
        padding: "3px 12px",
      }}
    >
      {label}: {value}%
    </span>
  );
}

function SignalCard({
  signal,
  companyUrl,
}: {
  signal: IntentSignal;
  companyUrl: string | null;
}) {
  const accent = accentColor(signal.intent_score);
  const typeColor = SIGNAL_TYPE_COLOR[signal.signal_type];
  const deadlineHours = hoursUntil(signal.recommended_deadline);
  const actNow = deadlineHours !== null && deadlineHours <= DEADLINE_SOON_HOURS;

  return (
    <div
      style={{
        display: "flex",
        backgroundColor: "#0D1526",
        borderRadius: "14px",
        overflow: "hidden",
        marginBottom: "12px",
        boxShadow: "0 4px 20px rgba(0,0,0,0.25)",
      }}
    >
      <div style={{ width: "6px", flexShrink: 0, backgroundColor: accent }} aria-hidden />
      <div style={{ flex: 1, padding: "24px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "16px",
            marginBottom: "10px",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <h3 style={{ fontSize: "18px", fontWeight: 700, color: "#FFFFFF", margin: 0 }}>
              {signal.company_name}
            </h3>
            <span
              style={{
                fontSize: "11px",
                fontWeight: 700,
                color: "#FFFFFF",
                backgroundColor: typeColor,
                borderRadius: "999px",
                padding: "3px 12px",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                whiteSpace: "nowrap",
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
                color: "#8BA8C8",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                margin: "2px 0 0",
              }}
            >
              Intent Score
            </p>
          </div>
        </div>

        <p style={{ fontSize: "14px", color: "#8BA8C8", lineHeight: 1.6, margin: "0 0 14px" }}>
          {signal.signal_summary}
        </p>

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "14px" }}>
          {signal.geographic_relevance !== null && (
            <MetricBadge label="Geographic Relevance" value={signal.geographic_relevance} />
          )}
          {signal.mission_alignment !== null && (
            <MetricBadge label="Mission Alignment" value={signal.mission_alignment} />
          )}
          <span style={{ fontSize: "11px", fontWeight: 600, color: "#5C7695", padding: "3px 0" }}>
            {signal.signal_date
              ? `Signal dated ${formatDate(signal.signal_date)}`
              : `Recorded ${formatDate(signal.created_at)}`}
          </span>
        </div>

        {signal.recommended_action && (
          <div
            style={{
              backgroundColor: "rgba(245,158,11,0.1)",
              border: "1px solid rgba(245,158,11,0.3)",
              borderRadius: "10px",
              padding: "14px 16px",
              marginBottom: "14px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
                marginBottom: "6px",
                flexWrap: "wrap",
              }}
            >
              <p
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  color: "#F59E0B",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  margin: 0,
                }}
              >
                Recommended Action
              </p>
              {actNow && (
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: 700,
                    color: "#FFFFFF",
                    backgroundColor: "#DC2626",
                    borderRadius: "999px",
                    padding: "3px 10px",
                    whiteSpace: "nowrap",
                  }}
                >
                  ACT NOW — {deadlineHours !== null && deadlineHours > 0 ? `${deadlineHours}h remaining` : "overdue"}
                </span>
              )}
            </div>
            <p style={{ fontSize: "13px", color: "#FCD34D", margin: 0, lineHeight: 1.5 }}>
              {signal.recommended_action}
            </p>
          </div>
        )}

        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <Link
            href={`/donor-discovery/outreach?prospectId=${encodeURIComponent(signal.company_name)}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              backgroundColor: "#0077B6",
              color: "#FFFFFF",
              fontSize: "12px",
              fontWeight: 700,
              padding: "8px 16px",
              borderRadius: "8px",
              textDecoration: "none",
            }}
          >
            Draft Outreach Email
          </Link>
          {companyUrl ? (
            <a
              href={companyUrl}
              target="_blank"
              rel="noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                backgroundColor: "transparent",
                color: "#8BA8C8",
                fontSize: "12px",
                fontWeight: 700,
                padding: "8px 16px",
                borderRadius: "8px",
                border: "1px solid #243B55",
                textDecoration: "none",
              }}
            >
              View Company
            </a>
          ) : (
            signal.signal_url && (
              <a
                href={signal.signal_url}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  backgroundColor: "transparent",
                  color: "#8BA8C8",
                  fontSize: "12px",
                  fontWeight: 700,
                  padding: "8px 16px",
                  borderRadius: "8px",
                  border: "1px solid #243B55",
                  textDecoration: "none",
                }}
              >
                View Source
              </a>
            )
          )}
        </div>
      </div>
    </div>
  );
}

export default function IntentSignalsPage() {
  const { profile } = useProfile();
  const [signals, setSignals] = useState<IntentSignal[]>([]);
  const [companyUrls, setCompanyUrls] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runNotice, setRunNotice] = useState<string | null>(null);

  const resolveCompanyUrls = useCallback(async (rows: IntentSignal[]) => {
    const names = Array.from(new Set(rows.map((s) => s.company_name))).filter(Boolean);
    if (names.length === 0) {
      setCompanyUrls(new Map());
      return;
    }
    const supabase = createClient();
    const { data } = await supabase
      .from("corporate_prospects")
      .select("legal_name, website")
      .in("legal_name", names);
    const map = new Map<string, string>();
    for (const row of (data ?? []) as Array<{ legal_name: string; website: string | null }>) {
      if (row.website) map.set(row.legal_name, row.website);
    }
    setCompanyUrls(map);
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/intelligence/donor-intent", { cache: "no-store" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((payload as { error?: string }).error ?? "Could not load intent signals.");
        return;
      }
      const rows = (payload as { signals?: IntentSignal[] }).signals ?? [];
      setSignals(rows);
      await resolveCompanyUrls(rows);
    } catch {
      setError("Could not reach the donor intent service.");
    }
  }, [resolveCompanyUrls]);

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
        setError((payload as { error?: string }).error ?? "Signal analysis failed.");
        return;
      }
      const data = payload as { signals?: IntentSignal[]; itemsQueued?: number; errors?: string[] };
      const rows = data.signals ?? [];
      setSignals(rows);
      await resolveCompanyUrls(rows);
      if (data.errors && data.errors.length > 0) {
        setRunNotice(data.errors[0] ?? "Signal analysis reported an issue.");
      } else {
        setRunNotice(
          data.itemsQueued && data.itemsQueued > 0
            ? `Detected ${data.itemsQueued} intent signal${data.itemsQueued !== 1 ? "s" : ""}.`
            : "No new signals found — no real evidence cleared the intent threshold this run.",
        );
      }
    } catch {
      setError("Could not reach the donor intent service.");
    } finally {
      setRunning(false);
    }
  }

  const stats = useMemo(() => {
    const cutoff = Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
    const last30d = signals.filter((s) => new Date(s.created_at).getTime() >= cutoff);
    const highIntent = signals.filter((s) => (s.intent_score ?? 0) >= HIGH_INTENT_THRESHOLD);
    const actionRequiredToday = signals.filter((s) => isDueTodayOrPast(s.recommended_deadline));
    const companiesMonitored = new Set(signals.map((s) => s.company_name)).size;
    return {
      totalLast30d: last30d.length,
      highIntentCount: highIntent.length,
      actionRequiredTodayCount: actionRequiredToday.length,
      companiesMonitored,
    };
  }, [signals]);

  const showEmpty = !loading && signals.length === 0;
  const canRun = canEdit(profile?.role);

  return (
    <div style={{ backgroundColor: "#D6E4F0", minHeight: "100vh", padding: "32px", borderRadius: "16px" }}>
      <Link
        href="/donor-discovery"
        className="inline-flex items-center gap-1.5 text-sm text-navy-500 transition hover:text-navy-700"
        style={{ marginBottom: "16px" }}
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to Donor Discovery
      </Link>
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
        <div style={{ borderLeft: `4px solid ${SECTION_ACCENT}`, paddingLeft: "16px" }}>
          <h1
            style={{
              fontSize: "28px",
              fontWeight: 800,
              color: SECTION_ACCENT,
              letterSpacing: "-0.02em",
              margin: 0,
            }}
          >
            Corporate Intent Signals
          </h1>
          <p style={{ fontSize: "14px", color: "#64748B", marginTop: "6px" }}>
            AI-detected corporate giving indicators — act before the window closes.
          </p>
        </div>
        {canRun && (
          <button
            type="button"
            onClick={() => void handleRunAnalysis()}
            disabled={running}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              backgroundColor: CTA_TEAL_BG,
              color: CTA_TEAL_TEXT,
              fontSize: "14px",
              fontWeight: 700,
              padding: "12px 24px",
              borderRadius: "10px",
              border: "none",
              cursor: running ? "default" : "pointer",
              opacity: running ? 0.7 : 1,
              boxShadow: "0 4px 16px rgba(34,211,238,0.3)",
            }}
          >
            {running ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {running ? "Running Signal Analysis..." : "Run Signal Analysis"}
          </button>
        )}
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

      <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", marginBottom: "28px" }}>
        <StatCard
          label="Total Signals (30d)"
          value={loading ? "—" : String(stats.totalLast30d)}
          color={SECTION_ACCENT}
        />
        <StatCard
          label="High Intent (≥80)"
          value={loading ? "—" : String(stats.highIntentCount)}
          color="#DC2626"
          pulse={!loading && stats.highIntentCount > 0}
        />
        <StatCard
          label="Action Required Today"
          value={loading ? "—" : String(stats.actionRequiredTodayCount)}
          color="#F59E0B"
        />
        <StatCard
          label="Companies Monitored"
          value={loading ? "—" : String(stats.companiesMonitored)}
          color={SECTION_ACCENT}
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
          Loading intent signals...
        </div>
      ) : showEmpty ? (
        <div
          style={{
            backgroundColor: "#0D1526",
            borderRadius: "14px",
            padding: "64px 24px",
            textAlign: "center",
            boxShadow: "0 4px 20px rgba(0,0,0,0.25)",
          }}
        >
          <div
            style={{
              width: "64px",
              height: "64px",
              borderRadius: "50%",
              backgroundColor: `${SECTION_ACCENT}26`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 16px",
            }}
            aria-hidden
          >
            <Radar size={30} color={SECTION_ACCENT} />
          </div>
          <p style={{ fontSize: "16px", fontWeight: 700, color: "#FFFFFF", margin: 0 }}>
            No intent signals yet
          </p>
          <p
            style={{
              fontSize: "13px",
              color: "#8BA8C8",
              marginTop: "8px",
              maxWidth: "420px",
              marginLeft: "auto",
              marginRight: "auto",
            }}
          >
            {canRun
              ? "Run a signal analysis to detect real-time corporate giving indicators — press releases, ESG reports, SEC filings, and more — across the companies you're monitoring."
              : "Ask an editor to run signal analysis to populate this feed."}
          </p>
          {canRun && (
            <button
              type="button"
              onClick={() => void handleRunAnalysis()}
              disabled={running}
              style={{
                marginTop: "24px",
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                backgroundColor: CTA_TEAL_BG,
                color: CTA_TEAL_TEXT,
                fontSize: "13px",
                fontWeight: 700,
                padding: "10px 24px",
                borderRadius: "10px",
                border: "none",
                cursor: running ? "default" : "pointer",
                opacity: running ? 0.7 : 1,
              }}
            >
              {running ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              {running ? "Running Signal Analysis..." : "Run Signal Analysis"}
            </button>
          )}
        </div>
      ) : (
        <div>
          {signals.map((signal) => (
            <SignalCard
              key={signal.id}
              signal={signal}
              companyUrl={companyUrls.get(signal.company_name) ?? null}
            />
          ))}
        </div>
      )}
    </div>
  );
}
