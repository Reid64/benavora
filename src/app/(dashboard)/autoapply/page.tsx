"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  ExternalLink,
  FileSearch,
  Play,
  Plus,
  RefreshCw,
  Settings,
} from "lucide-react";

import { Button, Card, EmptyState, Modal } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/hooks/useProfile";
import type { Json } from "@/types/database";
import { WorkerStatus } from "@/components/autoapply/WorkerStatus";
import { AutonomousQueueSection } from "@/components/autoapply/AutonomousQueueSection";
import { ModeSelector } from "@/components/autoapply/ModeSelector";
import { LiveSessionViewer } from "@/components/autoapply/LiveSessionViewer";
import { QueueMetrics } from "@/components/autoapply/QueueMetrics";
import { QueuePreview } from "@/components/autoapply/QueuePreview";
import { QueuePanel } from "@/components/autoapply/QueuePanel";
import { ManualQueue } from "@/components/autoapply/ManualQueue";
import { SubmissionHistory } from "@/components/autoapply/SubmissionHistory";
import { ReviewQueue } from "@/components/autoapply/ReviewQueue";
// Lazy-loaded: SuccessAnalytics statically imports the full recharts library
// (~130 kB), which alone inflated this route's first-load JS. It renders below
// the fold, so defer it to a client-only chunk fetched after initial paint.
const SuccessAnalytics = dynamic(
  () =>
    import("@/components/autoapply/SuccessAnalytics").then(
      (m) => m.SuccessAnalytics,
    ),
  {
    ssr: false,
    loading: () => (
      <div
        className="rounded-lg border border-border bg-surface shadow-sm p-5 text-sm text-navy-400"
        style={{
          backgroundColor: "#F7F5F1",
          boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
          border: "1px solid #C9BFA8",
        }}
      >
        Loading analytics…
      </div>
    ),
  },
);

// Draft & Automation section treatment — PAGE_TREATMENT_PROTOCOL_V2.md.
// Frame: Rich Gold (cards/panels). Header title text: Deep Navy (gold fails
// WCAG contrast as small text on Soft Stone or Warm Ivory — verified, not
// assumed). Distinct actions draw from the proven accent family. Real
// status colors (Worker Online/Stale/Offline in WorkerStatus.tsx, the
// Active/Idle session-state pill, per-row queue status dots) are untouched.
const FRAME_GOLD = "#C49A4F";
const FRAME_NAVY = "#2C4E3B";
const CARD_BG = "#F8F5EE";
const ACCENT_TEAL = "#2E6B66";
const ACCENT_AMBER = "#C17817";
const ACCENT_SLATE = "#4F6D8F";
const ACCENT_PLUM = "#7A5980";
const CARD_SHADOW = "0 4px 20px rgba(184,138,46,0.22)";

interface QueueRow {
  id: string;
  funder_id: string | null;
  priority: number;
  status: string;
  automation_mode: string;
  scheduled_for: string | null;
  created_at: string;
  completed_at: string | null;
  funders: { name: string; giving_portal_url: string | null } | null;
}

interface TemplateRow {
  id: string;
  funder_id: string | null;
  portal_url: string;
  field_mapping: Json | null;
  last_verified_at: string | null;
  last_used_at: string | null;
  funders: { name: string } | null;
}

interface FunderOption {
  id: string;
  name: string;
  giving_portal_url: string;
}

/** Exact hex-coded status pill for the session list — completed/failed/running
 * per the AutoApply design spec, distinct from the Badge component's palette. */
function sessionStatusHex(status: string): { bg: string; text: string; label: string } {
  switch (status) {
    case "pending":
    case "queued":
      return { bg: "#F1F5F9", text: "#475569", label: "Queued" };
    case "processing":
    case "running":
      return { bg: "#F59E0B", text: "#FFFFFF", label: "Running" };
    case "completed":
      return { bg: "#10B981", text: "#FFFFFF", label: "Completed" };
    case "failed":
      return { bg: "#DC2626", text: "#FFFFFF", label: "Failed" };
    default:
      return { bg: "#F1F5F9", text: "#475569", label: status };
  }
}

function countFields(fieldMapping: Json | null): number {
  if (fieldMapping === null || fieldMapping === undefined) return 0;
  if (Array.isArray(fieldMapping)) return fieldMapping.length;
  if (typeof fieldMapping === "object") return Object.keys(fieldMapping as Record<string, unknown>).length;
  return 0;
}

function truncateUrl(url: string, max = 45): string {
  if (url.length <= max) return url;
  return url.slice(0, max) + "…";
}

function isToday(isoString: string | null): boolean {
  if (!isoString) return false;
  const d = new Date(isoString);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remSeconds}s`;
}

export default function AutoApplyPage() {
  const { profile } = useProfile();

  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [selectedQueueIds, setSelectedQueueIds] = useState<Set<string>>(new Set());

  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [reanalyzingId, setReanalyzingId] = useState<string | null>(null);

  const [addToQueueOpen, setAddToQueueOpen] = useState(false);
  const [funders, setFunders] = useState<FunderOption[]>([]);
  const [fundersLoading, setFundersLoading] = useState(false);
  const [selectedFunderIds, setSelectedFunderIds] = useState<Set<string>>(new Set());
  const [addingToQueue, setAddingToQueue] = useState(false);

  const [analyzing, setAnalyzing] = useState(false);
  const [runningSelected, setRunningSelected] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [activeQueueTab, setActiveQueueTab] = useState<"queue_panel" | "manual_queue">(
    "queue_panel",
  );
  const [manualQueueCount, setManualQueueCount] = useState(0);

  const loadQueue = useCallback(async () => {
    setQueueLoading(true);
    const supabase = createClient();
    try {
      const { data, error } = await supabase
        .from("submission_queue")
        .select("*, funders(name, giving_portal_url)")
        .order("priority", { ascending: false })
        .order("created_at", { ascending: true });
      if (error) throw error;
      setQueue((data ?? []) as unknown as QueueRow[]);
      setQueueError(null);
    } catch {
      setQueueError("Could not load the submission queue.");
    } finally {
      setQueueLoading(false);
    }
  }, []);

  const loadTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    const supabase = createClient();
    try {
      const { data, error } = await supabase
        .from("form_templates")
        .select("*, funders(name)")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      setTemplates((data ?? []) as unknown as TemplateRow[]);
      setTemplatesError(null);
    } catch {
      setTemplatesError("Could not load form templates.");
    } finally {
      setTemplatesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadQueue();
    void loadTemplates();
  }, [loadQueue, loadTemplates]);

  async function openAddToQueue() {
    setAddToQueueOpen(true);
    setSelectedFunderIds(new Set());
    setFundersLoading(true);
    const supabase = createClient();
    try {
      const { data } = await supabase
        .from("funders")
        .select("id, name, giving_portal_url")
        .not("giving_portal_url", "is", null)
        .order("name");
      setFunders(
        (
          (data ?? []) as Array<{
            id: string;
            name: string;
            giving_portal_url: string | null;
          }>
        )
          .filter((f) => f.giving_portal_url !== null)
          .map((f) => ({
            id: f.id,
            name: f.name,
            giving_portal_url: f.giving_portal_url as string,
          })),
      );
    } finally {
      setFundersLoading(false);
    }
  }

  async function handleAddToQueue() {
    if (selectedFunderIds.size === 0 || !profile) return;
    setAddingToQueue(true);
    setActionError(null);
    const supabase = createClient();
    try {
      const rows = Array.from(selectedFunderIds).map((funder_id) => ({
        organization_id: profile.organization_id,
        funder_id,
        status: "pending",
        priority: 0,
        automation_mode: "supervised",
      }));
      const { error } = await supabase.from("submission_queue").insert(rows);
      if (error) throw error;
      setAddToQueueOpen(false);
      await loadQueue();
    } catch {
      setActionError("Could not add funders to queue. Please try again.");
    } finally {
      setAddingToQueue(false);
    }
  }

  async function handleAnalyzeForms() {
    const funderIds = Array.from(selectedQueueIds)
      .map((qid) => queue.find((q) => q.id === qid)?.funder_id)
      .filter((id): id is string => id !== null && id !== undefined);
    if (funderIds.length === 0) return;
    setAnalyzing(true);
    setActionError(null);
    try {
      const res = await fetch("/api/agents/form-analyzer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ funderIds }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setActionError(err.error ?? "Could not run form analyzer.");
        return;
      }
      await loadTemplates();
    } catch {
      setActionError("Could not reach the form analyzer. Please try again.");
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleRunSelected() {
    const templateFunderIds = new Set(templates.map((t) => t.funder_id));
    const funderIds = Array.from(selectedQueueIds)
      .map((qid) => queue.find((q) => q.id === qid)?.funder_id)
      .filter(
        (id): id is string =>
          id !== null && id !== undefined && templateFunderIds.has(id),
      );
    if (funderIds.length === 0) return;
    setRunningSelected(true);
    setActionError(null);
    try {
      const res = await fetch("/api/agents/form-filler", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ funderIds }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setActionError(err.error ?? "Could not run form filler.");
        return;
      }
      await loadQueue();
    } catch {
      setActionError("Could not reach the form filler. Please try again.");
    } finally {
      setRunningSelected(false);
    }
  }

  async function handleReanalyze(template: TemplateRow) {
    if (!template.funder_id) return;
    setReanalyzingId(template.id);
    setActionError(null);
    try {
      const res = await fetch("/api/agents/form-analyzer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ funderIds: [template.funder_id] }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setActionError(err.error ?? "Could not re-analyze template.");
        return;
      }
      await loadTemplates();
    } catch {
      setActionError("Could not reach the form analyzer.");
    } finally {
      setReanalyzingId(null);
    }
  }

  function toggleQueueItem(id: string) {
    setSelectedQueueIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllQueue() {
    if (selectedQueueIds.size === queue.length && queue.length > 0) {
      setSelectedQueueIds(new Set());
    } else {
      setSelectedQueueIds(new Set(queue.map((q) => q.id)));
    }
  }

  function toggleFunder(id: string) {
    setSelectedFunderIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const templateFunderIdSet = new Set(templates.map((t) => t.funder_id));
  const selectedHaveTemplates = Array.from(selectedQueueIds).some((qid) => {
    const item = queue.find((q) => q.id === qid);
    return item?.funder_id ? templateFunderIdSet.has(item.funder_id) : false;
  });

  const allQueueSelected = queue.length > 0 && selectedQueueIds.size === queue.length;
  const allFundersSelected = funders.length > 0 && selectedFunderIds.size === funders.length;

  const runningCount = queue.filter((q) => q.status === "processing" || q.status === "running").length;
  const completedCount = queue.filter((q) => q.status === "completed").length;
  const failedCount = queue.filter((q) => q.status === "failed").length;
  const isRunning = runningCount > 0;
  const needsSparkGoodSetup = queue.some((q) => q.status === "requires_account_setup");

  // Real, derived from the same submission_queue rows already loaded above — no fabricated data.
  const sessionsToday = queue.filter((q) => isToday(q.created_at)).length;
  const resolvedCount = completedCount + failedCount;
  const successRatePct = resolvedCount > 0 ? Math.round((completedCount / resolvedCount) * 100) : null;
  const fillDurations = queue
    .filter((q) => q.status === "completed" && q.completed_at)
    .map((q) => (new Date(q.completed_at as string).getTime() - new Date(q.created_at).getTime()) / 1000)
    .filter((s) => s >= 0);
  const avgFillTimeSeconds =
    fillDurations.length > 0 ? fillDurations.reduce((a, b) => a + b, 0) / fillDurations.length : null;

  // Header-band treatment (same pattern as the dashboard's flip cards): a
  // solid-accent band carries the label in white, the tinted body (accent at
  // ~8% alpha) carries the value in the accent's own color — distinct per
  // card instead of the old thin borderTop stripe + uniform navy value.
  const statFrameStyle = (accent: string) => ({
    backgroundColor: `${accent}14`,
    borderRadius: "11px",
    border: `1px solid ${accent}33`,
    overflow: "hidden" as const,
    flex: "1",
  });
  const statBandStyle = (accent: string) => ({
    backgroundColor: accent,
    padding: "7px 16px",
    fontSize: "11px",
    fontWeight: 700 as const,
    color: "#FFFFFF",
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
  });
  const statBodyStyle = { padding: "14px 16px 18px" };
  const darkStatValueStyle = (color: string) => ({
    fontSize: "36px",
    fontWeight: 800 as const,
    color,
    marginTop: 0,
  });

  return (
    <div style={{ minHeight: "100vh", padding: "24px" }} className="space-y-8">
      <style>{`@keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.4 } }`}</style>

      {/* HEADER */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px", flexWrap: "wrap", gap: "16px" }}>
        <div style={{ borderLeft: `4px solid ${FRAME_GOLD}`, paddingLeft: "16px" }}>
          <h1 style={{ fontSize: "28px", fontWeight: 800, color: FRAME_NAVY, letterSpacing: "-0.02em" }}>
            AUTOAPPLY ENGINE
          </h1>
          <p style={{ fontSize: "14px", color: "#64748B", marginTop: "4px" }}>
            Automated form submission engine. Queue funders, analyze portal forms, and submit applications
            automatically.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          {isRunning ? (
            <span
              style={{
                backgroundColor: "#DCFCE7",
                border: "1px solid #86EFAC",
                borderRadius: "20px",
                padding: "8px 20px",
                color: "#15803D",
                fontSize: "13px",
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <span style={{ width: "8px", height: "8px", backgroundColor: "#10B981", borderRadius: "50%", animation: "pulse 2s infinite" }} />
              ACTIVE — {runningCount} SESSION{runningCount === 1 ? "" : "S"}
            </span>
          ) : (
            <span
              style={{
                backgroundColor: "rgba(44,78,59,0.06)",
                border: "1px solid rgba(44,78,59,0.15)",
                borderRadius: "20px",
                padding: "8px 20px",
                color: "#64748B",
                fontSize: "13px",
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <span style={{ width: "8px", height: "8px", backgroundColor: "#64748B", borderRadius: "50%" }} />
              IDLE
            </span>
          )}
          <WorkerStatus />
          <Link href="/autoapply/settings">
            <button
              type="button"
              style={{
                backgroundColor: "rgba(79,109,143,0.08)",
                color: ACCENT_SLATE,
                border: `1.5px solid ${ACCENT_SLATE}`,
                borderRadius: "10px",
                padding: "9px 16px",
                fontSize: "13px",
                fontWeight: 600,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <Settings className="h-3.5 w-3.5" aria-hidden />
              Settings
            </button>
          </Link>
          <button
            type="button"
            onClick={() => void openAddToQueue()}
            style={{
              backgroundColor: ACCENT_TEAL,
              color: CARD_BG,
              border: "none",
              borderRadius: "10px",
              padding: "9px 18px",
              fontSize: "13px",
              fontWeight: 700,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
            }}
            className="hover:brightness-95"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Add to Queue
          </button>
        </div>
      </div>

      {/* SPARK GOOD SETUP BANNER — shown while any queue item is blocked on the one-time Walmart account setup */}
      {needsSparkGoodSetup && (
        <div
          role="alert"
          className="flex items-center gap-3 rounded-xl px-5 py-4"
          style={{ backgroundColor: "#FEF3C7", border: "1px solid #FCD34D" }}
        >
          <span
            style={{
              width: "10px",
              height: "10px",
              borderRadius: "50%",
              backgroundColor: "#F59E0B",
              flexShrink: 0,
            }}
            aria-hidden
          />
          <span style={{ fontSize: "13px", fontWeight: 700, color: "#92400E" }}>
            One-time setup required for Walmart AutoApply. Run{" "}
            <code
              style={{
                backgroundColor: "#FDE68A",
                padding: "1px 6px",
                borderRadius: "4px",
                fontFamily: "monospace",
              }}
            >
              pnpm setup:sparkgood
            </code>{" "}
            in your terminal to complete Spark Good account verification. This takes 5 minutes and only needs to be
            done once.
          </span>
        </div>
      )}

      {/* TOP STATS ROW — real values derived from the same submission_queue rows loaded for the table below */}
      <div className="flex flex-col gap-4 sm:flex-row">
        <div style={statFrameStyle(ACCENT_TEAL)}>
          <div style={statBandStyle(ACCENT_TEAL)}>Sessions Today</div>
          <div style={statBodyStyle}>
            <p style={darkStatValueStyle(ACCENT_TEAL)}>{queueLoading ? "—" : sessionsToday}</p>
          </div>
        </div>
        <div style={statFrameStyle(ACCENT_PLUM)}>
          <div style={statBandStyle(ACCENT_PLUM)}>Success Rate</div>
          <div style={statBodyStyle}>
            <p style={darkStatValueStyle(ACCENT_PLUM)}>
              {queueLoading ? "—" : successRatePct !== null ? `${successRatePct}%` : "—"}
            </p>
          </div>
        </div>
        <div style={statFrameStyle(ACCENT_SLATE)}>
          <div style={statBandStyle(ACCENT_SLATE)}>Avg Fill Time</div>
          <div style={statBodyStyle}>
            <p style={darkStatValueStyle(ACCENT_SLATE)}>
              {queueLoading ? "—" : avgFillTimeSeconds !== null ? formatDuration(avgFillTimeSeconds) : "—"}
            </p>
          </div>
        </div>
        <div style={statFrameStyle(ACCENT_AMBER)}>
          <div style={statBandStyle(ACCENT_AMBER)}>Forms Queued</div>
          <div style={statBodyStyle}>
            <p style={darkStatValueStyle(ACCENT_AMBER)}>{queueLoading ? "—" : queue.length}</p>
          </div>
        </div>
      </div>

      {/* MAIN CONTENT — Live Session Viewer (left) + Controls (right) */}
      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="lg:flex-[65]">
          <LiveSessionViewer onStartSession={() => void openAddToQueue()} />
        </div>
        <div className="flex flex-col gap-4 lg:flex-[35]">
          {/* QUEUE — top 5 real submission_queue rows, same data already loaded for the Session List table below */}
          <div style={{ backgroundColor: FRAME_GOLD, borderRadius: "14px", boxShadow: CARD_SHADOW, padding: "3px" }}>
          <div
            style={{
              backgroundColor: CARD_BG,
              borderRadius: "11px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "16px 20px",
                borderBottom: "1px solid rgba(44,78,59,0.1)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <p style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.12em", color: "#64748B" }}>QUEUE</p>
              <span
                style={{
                  backgroundColor: "rgba(184,138,46,0.18)",
                  color: "#8A6A22",
                  borderRadius: "10px",
                  padding: "2px 10px",
                  fontSize: "12px",
                  fontWeight: 700,
                }}
              >
                {queue.length}
              </span>
            </div>
            {queueLoading ? (
              <p style={{ padding: "16px 20px", fontSize: "13px", color: "#64748B" }}>Loading…</p>
            ) : queue.length === 0 ? (
              <p style={{ padding: "16px 20px", fontSize: "13px", color: "#64748B" }}>Queue is empty.</p>
            ) : (
              queue.slice(0, 5).map((item) => {
                const dotColor =
                  item.status === "processing" || item.status === "running"
                    ? "#10B981"
                    : item.status === "pending"
                      ? "#F59E0B"
                      : "#64748B";
                return (
                  <div
                    key={item.id}
                    style={{
                      padding: "12px 20px",
                      borderBottom: "1px solid rgba(44,78,59,0.06)",
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                    }}
                  >
                    <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: dotColor, flexShrink: 0 }} />
                    <span style={{ color: FRAME_NAVY, fontSize: "13px", fontWeight: 600 }}>
                      {item.funders?.name ?? "—"}
                    </span>
                    <span style={{ color: "#64748B", fontSize: "12px", marginLeft: "auto" }}>
                      {sessionStatusHex(item.status).label}
                    </span>
                  </div>
                );
              })
            )}
          </div>
          </div>

          <div style={{ backgroundColor: FRAME_GOLD, borderRadius: "14px", boxShadow: CARD_SHADOW, padding: "3px" }}>
          <div
            style={{
              backgroundColor: CARD_BG,
              borderRadius: "11px",
              padding: "20px",
            }}
          >
            <p style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.12em", color: "#64748B", marginBottom: "16px" }}>
              CONTROLS
            </p>
            <button
              type="button"
              onClick={() => void openAddToQueue()}
              style={{
                width: "100%",
                backgroundColor: ACCENT_AMBER,
                color: CARD_BG,
                border: "none",
                borderRadius: "10px",
                padding: "12px",
                fontSize: "14px",
                fontWeight: 700,
                cursor: "pointer",
                marginBottom: "8px",
              }}
              className="hover:brightness-95"
            >
              Start Session
            </button>
            <Link href="/autoapply/controls" style={{ display: "block", marginBottom: "8px" }}>
              <button
                type="button"
                style={{
                  width: "100%",
                  backgroundColor: "rgba(245,158,11,0.12)",
                  color: "#B45309",
                  border: "1px solid rgba(245,158,11,0.4)",
                  borderRadius: "10px",
                  padding: "12px",
                  fontSize: "14px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Pause
              </button>
            </Link>
            <a href="#session-list" style={{ display: "block" }}>
              <button
                type="button"
                style={{
                  width: "100%",
                  backgroundColor: "rgba(44,78,59,0.05)",
                  color: FRAME_NAVY,
                  border: "1px solid rgba(44,78,59,0.18)",
                  borderRadius: "10px",
                  padding: "12px",
                  fontSize: "14px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                View All Sessions
              </button>
            </a>
          </div>
          </div>
        </div>
      </div>

      {actionError && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {actionError}
        </div>
      )}

      {/* MODE SELECTOR — Manual / Semi-Auto / Autonomous */}
      <ModeSelector />

      {/* AUTONOMOUS QUEUE — tonight's overnight batch count, status, ETA, progress */}
      <AutonomousQueueSection />

      {/* QUEUE METRICS — depth, processing rate, est. completion (live) */}
      <QueueMetrics />

      {/* QUEUE PREVIEW — tonight's autonomous run candidates */}
      <QueuePreview />

      {/* QUEUE PANEL / MANUAL QUEUE — tabbed view */}
      <div>
        {/* Tab navigation */}
        <div className="mb-4 flex items-center gap-1 rounded-lg border border-navy-100 bg-navy-50 p-1 w-fit">
          <button
            type="button"
            onClick={() => setActiveQueueTab("queue_panel")}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
              activeQueueTab === "queue_panel"
                ? "bg-surface text-navy-900 shadow-sm"
                : "text-navy-500 hover:text-navy-700"
            }`}
          >
            Queue Panel
          </button>
          <button
            type="button"
            onClick={() => setActiveQueueTab("manual_queue")}
            className={`flex items-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
              activeQueueTab === "manual_queue"
                ? "bg-surface text-navy-900 shadow-sm"
                : "text-navy-500 hover:text-navy-700"
            }`}
          >
            Manual Queue
            {manualQueueCount > 0 && (
              <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-amber-500 px-1.5 text-xs font-bold text-white">
                {manualQueueCount}
              </span>
            )}
          </button>
        </div>

        {activeQueueTab === "queue_panel" ? (
          <QueuePanel />
        ) : (
          <ManualQueue onCountChange={setManualQueueCount} />
        )}
      </div>

      {/* QUEUE SECTION / SESSION LIST */}
      <span id="session-list" style={{ scrollMarginTop: "24px" }} />
      <div style={{ backgroundColor: FRAME_GOLD, borderRadius: "15px", boxShadow: CARD_SHADOW, padding: "3px" }}>
      <Card
        title="Session List"
        description="Funders pending or processed by automated form submission"
        noPadding
        actions={
          selectedQueueIds.size > 0 ? (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void handleAnalyzeForms()}
                isLoading={analyzing}
                disabled={analyzing}
              >
                <FileSearch className="mr-1 h-3.5 w-3.5" />
                Analyze Forms ({selectedQueueIds.size})
              </Button>
              <Button
                size="sm"
                onClick={() => void handleRunSelected()}
                isLoading={runningSelected}
                disabled={runningSelected || !selectedHaveTemplates}
              >
                <Play className="mr-1 h-3.5 w-3.5" />
                Run Selected
              </Button>
            </div>
          ) : undefined
        }
      >
        <div className="overflow-x-auto">
          {queueError ? (
            <div className="p-5 text-sm text-red-400">{queueError}</div>
          ) : queueLoading ? (
            <div className="p-5 text-sm text-navy-400">Loading queue…</div>
          ) : queue.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={Play}
                title="Queue is empty"
                description='Click "Add to Queue" to select funders for automated submission.'
              />
            </div>
          ) : (
            <table className="min-w-full divide-y divide-navy-100 text-sm">
              <thead>
                <tr
                  className="bg-sidebar"
                  style={{ backgroundColor: FRAME_NAVY, color: "#FFFFFF" }}
                >
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={allQueueSelected}
                      onChange={toggleAllQueue}
                      className="rounded border-navy-300 text-teal-600 focus:ring-teal-500"
                      aria-label="Select all queue items"
                    />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-white">
                    Funder
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-white">
                    Portal URL
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-white">
                    Priority
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-white">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-white">
                    Scheduled
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-100 bg-surface">
                {queue.map((item) => {
                  const statusHex = sessionStatusHex(item.status);
                  const portalUrl = item.funders?.giving_portal_url ?? null;
                  return (
                    <tr key={item.id} className="hover:bg-navy-50">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedQueueIds.has(item.id)}
                          onChange={() => toggleQueueItem(item.id)}
                          className="rounded border-navy-300 text-teal-600 focus:ring-teal-500"
                          aria-label={`Select ${item.funders?.name ?? "item"}`}
                        />
                      </td>
                      <td className="px-4 py-3 font-medium text-navy-900">
                        {item.funders?.name ?? (
                          <span className="text-navy-400">—</span>
                        )}
                      </td>
                      <td className="max-w-xs px-4 py-3">
                        {portalUrl ? (
                          <a
                            href={portalUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-teal-400 hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <span className="truncate">{truncateUrl(portalUrl)}</span>
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                        ) : (
                          <span className="text-navy-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-navy-600">{item.priority}</td>
                      <td className="px-4 py-3">
                        <span
                          style={{
                            backgroundColor: statusHex.bg,
                            color: statusHex.text,
                            fontSize: "11px",
                            fontWeight: 700,
                            borderRadius: "999px",
                            padding: "3px 10px",
                            display: "inline-block",
                          }}
                        >
                          {statusHex.label}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-navy-400">
                        {item.scheduled_for
                          ? new Date(item.scheduled_for).toLocaleString()
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </Card>
      </div>

      {/* SUBMISSIONS SECTION */}
      <SubmissionHistory />

      {/* REVIEW QUEUE — failed submissions requiring human review */}
      <ReviewQueue />

      {/* TEMPLATES SECTION */}
      <div style={{ backgroundColor: FRAME_GOLD, borderRadius: "15px", boxShadow: CARD_SHADOW, padding: "3px" }}>
      <Card
        title="Form Templates"
        description="Cached portal form structures for rapid submission"
        noPadding
      >
        <div className="overflow-x-auto">
          {templatesError ? (
            <div className="p-5 text-sm text-red-400">{templatesError}</div>
          ) : templatesLoading ? (
            <div className="p-5 text-sm text-navy-400">Loading templates…</div>
          ) : templates.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={FileSearch}
                title="No templates yet"
                description='Run "Analyze Forms" on queued funders to build form templates.'
              />
            </div>
          ) : (
            <table className="min-w-full divide-y divide-navy-100 text-sm">
              <thead>
                <tr
                  className="bg-sidebar"
                  style={{ backgroundColor: FRAME_NAVY, color: "#FFFFFF" }}
                >
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wide text-white">
                    Funder
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-white">
                    Portal URL
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-white">
                    Fields
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-white">
                    Last Verified
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-white">
                    Last Used
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-100 bg-surface">
                {templates.map((tpl) => {
                  const isReanalyzing = reanalyzingId === tpl.id;
                  const fieldCount = countFields(tpl.field_mapping);
                  return (
                    <tr key={tpl.id} className="hover:bg-navy-50">
                      <td className="px-5 py-3 font-medium text-navy-900">
                        {tpl.funders?.name ?? (
                          <span className="text-navy-400">—</span>
                        )}
                      </td>
                      <td className="max-w-xs px-4 py-3">
                        <a
                          href={tpl.portal_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-teal-400 hover:underline"
                        >
                          <span className="truncate">{truncateUrl(tpl.portal_url)}</span>
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                      </td>
                      <td className="px-4 py-3 text-navy-600">{fieldCount}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-navy-400">
                        {tpl.last_verified_at
                          ? new Date(tpl.last_verified_at).toLocaleDateString()
                          : "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-navy-400">
                        {tpl.last_used_at
                          ? new Date(tpl.last_used_at).toLocaleDateString()
                          : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => void handleReanalyze(tpl)}
                          isLoading={isReanalyzing}
                          disabled={isReanalyzing || !tpl.funder_id}
                        >
                          <RefreshCw className="mr-1 h-3 w-3" />
                          Re-analyze
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </Card>
      </div>

      {/* ANALYTICS SECTION */}
      <SuccessAnalytics />

      {/* ADD TO QUEUE MODAL */}
      <Modal
        isOpen={addToQueueOpen}
        onClose={() => setAddToQueueOpen(false)}
        title="Add Funders to Queue"
        description="Select funders with giving portal URLs to queue for automated submission."
        size="lg"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setAddToQueueOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void handleAddToQueue()}
              isLoading={addingToQueue}
              disabled={addingToQueue || selectedFunderIds.size === 0}
            >
              Add{selectedFunderIds.size > 0 ? ` ${selectedFunderIds.size}` : ""} to Queue
            </Button>
          </>
        }
      >
        {fundersLoading ? (
          <p className="py-4 text-sm text-navy-400">Loading funders…</p>
        ) : funders.length === 0 ? (
          <p className="py-4 text-sm text-navy-500">
            No funders with giving portal URLs found. Add a giving portal URL to a funder profile first.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-navy-400">
              <span>
                {selectedFunderIds.size} of {funders.length} selected
              </span>
              <button
                type="button"
                onClick={() => {
                  if (allFundersSelected) {
                    setSelectedFunderIds(new Set());
                  } else {
                    setSelectedFunderIds(new Set(funders.map((f) => f.id)));
                  }
                }}
                className="text-teal-400 hover:underline"
              >
                {allFundersSelected ? "Deselect all" : "Select all"}
              </button>
            </div>
            <div className="max-h-80 divide-y divide-navy-100 overflow-y-auto rounded-lg border border-navy-200">
              {funders.map((funder) => (
                <label
                  key={funder.id}
                  className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-navy-50"
                >
                  <input
                    type="checkbox"
                    checked={selectedFunderIds.has(funder.id)}
                    onChange={() => toggleFunder(funder.id)}
                    className="rounded border-navy-300 text-teal-600 focus:ring-teal-500"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-navy-900">
                      {funder.name}
                    </p>
                    <p className="truncate text-xs text-navy-400">
                      {funder.giving_portal_url}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
