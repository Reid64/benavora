"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { formatRelative } from "@/lib/utils/formatters";

// Autonomous Agent Settings (BLUEPRINT §6, AGENTS_v2.md). Reads/writes
// org_autonomous_config via /api/autonomous/config and the agent_decisions
// audit trail via /api/autonomous/decisions. organization_id is always
// derived server-side in those routes — never sent from here.

type AutonomousConfig = {
  auto_research_enabled: boolean;
  auto_score_enabled: boolean;
  auto_draft_enabled: boolean;
  auto_draft_threshold: number;
  auto_reputation_enabled: boolean;
  auto_relationship_enabled: boolean;
  auto_deadline_prediction_enabled: boolean;
  auto_followup_enabled: boolean;
  notify_on_auto_draft: boolean;
  notify_on_high_score: boolean;
  notify_digest_time: string;
  max_auto_drafts_per_night: number;
};

type BooleanConfigKey =
  | "auto_research_enabled"
  | "auto_score_enabled"
  | "auto_draft_enabled"
  | "auto_reputation_enabled"
  | "auto_relationship_enabled"
  | "auto_deadline_prediction_enabled"
  | "auto_followup_enabled";

type AgentDecision = {
  id: string;
  org_id: string;
  agent_run_id: string | null;
  agent_id: string;
  decision_type: string;
  entity_type: string | null;
  entity_id: string | null;
  reasoning: string | null;
  confidence_score: number | null;
  action_taken: string | null;
  action_payload: Record<string, unknown> | null;
  required_human_review: boolean;
  human_reviewed_at: string | null;
  human_reviewer_id: string | null;
  human_verdict: string | null;
  created_at: string;
};

const DEFAULT_CONFIG: AutonomousConfig = {
  auto_research_enabled: false,
  auto_score_enabled: false,
  auto_draft_enabled: false,
  auto_draft_threshold: 70,
  auto_reputation_enabled: false,
  auto_relationship_enabled: false,
  auto_deadline_prediction_enabled: false,
  auto_followup_enabled: false,
  notify_on_auto_draft: true,
  notify_on_high_score: true,
  notify_digest_time: "07:00",
  max_auto_drafts_per_night: 10,
};

const TOGGLE_ROWS: { key: BooleanConfigKey; label: string }[] = [
  { key: "auto_research_enabled", label: "Opportunity Discovery" },
  { key: "auto_score_enabled", label: "Probability Scoring" },
  { key: "auto_draft_enabled", label: "Draft Generation" },
  { key: "auto_reputation_enabled", label: "Reputation Intelligence" },
  { key: "auto_relationship_enabled", label: "Relationship Builder" },
  { key: "auto_deadline_prediction_enabled", label: "Deadline Prediction" },
  { key: "auto_followup_enabled", label: "Follow-Up Scheduling" },
];

const cardStyle = {
  backgroundColor: "#FFFFFF",
  borderRadius: "12px",
  boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
  padding: "24px",
};

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function thresholdColor(value: number): string {
  if (value >= 75) return "#10B981";
  if (value >= 60) return "#F59E0B";
  return "#EF4444";
}

function confidenceColor(value: number | null): string {
  if (value === null) return "#94A3B8";
  if (value >= 70) return "#10B981";
  if (value >= 40) return "#F59E0B";
  return "#EF4444";
}

async function patchConfig(
  patch: Partial<AutonomousConfig>,
): Promise<AutonomousConfig | null> {
  try {
    const res = await fetch("/api/autonomous/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { config: AutonomousConfig };
    return body.config;
  } catch {
    return null;
  }
}

export default function AutonomousAgentSettingsPage() {
  const [config, setConfig] = useState<AutonomousConfig>(DEFAULT_CONFIG);
  const [configLoading, setConfigLoading] = useState(true);
  const [configLoadError, setConfigLoadError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);

  const thresholdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxDraftsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/autonomous/config");
        if (!res.ok) {
          if (!cancelled) {
            setConfigLoadError("Could not load autonomous agent settings.");
          }
          return;
        }
        const body = (await res.json()) as { config: AutonomousConfig };
        if (!cancelled) setConfig(body.config);
      } catch {
        if (!cancelled) {
          setConfigLoadError("Could not load autonomous agent settings.");
        }
      } finally {
        if (!cancelled) setConfigLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleToggle = useCallback(
    async (key: BooleanConfigKey) => {
      setToggleError(null);
      const nextValue = !config[key];
      setConfig((prev) => ({ ...prev, [key]: nextValue }));
      setSavingKey(key);
      const updated = await patchConfig({ [key]: nextValue });
      setSavingKey(null);
      if (!updated) {
        setConfig((prev) => ({ ...prev, [key]: !nextValue }));
        setToggleError("Could not save your change. Please try again.");
        return;
      }
      setConfig(updated);
    },
    [config],
  );

  const handleThresholdChange = useCallback((value: number) => {
    setConfig((prev) => ({ ...prev, auto_draft_threshold: value }));
    if (thresholdTimer.current) clearTimeout(thresholdTimer.current);
    thresholdTimer.current = setTimeout(() => {
      void patchConfig({ auto_draft_threshold: value });
    }, 500);
  }, []);

  const handleMaxDraftsChange = useCallback((value: number) => {
    setConfig((prev) => ({ ...prev, max_auto_drafts_per_night: value }));
    if (maxDraftsTimer.current) clearTimeout(maxDraftsTimer.current);
    maxDraftsTimer.current = setTimeout(() => {
      void patchConfig({ max_auto_drafts_per_night: value });
    }, 500);
  }, []);

  return (
    <div style={{ backgroundColor: "#D6E4F0", minHeight: "100vh", padding: "32px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "20px", maxWidth: "960px" }}>
        <AutonomyCard
          config={config}
          loading={configLoading}
          loadError={configLoadError}
          savingKey={savingKey}
          toggleError={toggleError}
          onToggle={handleToggle}
        />
        <ThresholdCard config={config} onThresholdChange={handleThresholdChange} onMaxDraftsChange={handleMaxDraftsChange} />
        <DecisionLogCard />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section 1 — Autonomous Pipeline Control
// ---------------------------------------------------------------------------

function AutonomyCard({
  config,
  loading,
  loadError,
  savingKey,
  toggleError,
  onToggle,
}: {
  config: AutonomousConfig;
  loading: boolean;
  loadError: string | null;
  savingKey: string | null;
  toggleError: string | null;
  onToggle: (key: BooleanConfigKey) => void;
}) {
  return (
    <div style={cardStyle}>
      <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#1A2B3C", margin: 0 }}>
        Autonomous Agent Settings
      </h1>
      <p style={{ fontSize: "13px", color: "#6B7280", margin: "6px 0 0 0" }}>
        Configure which AI agents operate autonomously overnight. All autonomous
        actions require human review before external submission.
      </p>

      {loadError && (
        <div
          role="alert"
          style={{
            marginTop: "16px",
            backgroundColor: "#FEF2F2",
            border: "1px solid #FECACA",
            borderRadius: "8px",
            padding: "12px 16px",
            fontSize: "13px",
            color: "#B91C1C",
          }}
        >
          {loadError}
        </div>
      )}

      {toggleError && (
        <div
          role="alert"
          style={{
            marginTop: "16px",
            backgroundColor: "#FEF2F2",
            border: "1px solid #FECACA",
            borderRadius: "8px",
            padding: "12px 16px",
            fontSize: "13px",
            color: "#B91C1C",
          }}
        >
          {toggleError}
        </div>
      )}

      <div style={{ marginTop: "12px" }}>
        {loading ? (
          <div style={{ fontSize: "13px", color: "#6B7280", padding: "14px 0" }}>
            Loading settings…
          </div>
        ) : (
          TOGGLE_ROWS.map((row, index) => (
            <div
              key={row.key}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "14px 0",
                borderBottom:
                  index === TOGGLE_ROWS.length - 1 ? "none" : "1px solid #E5E7EB",
              }}
            >
              <span style={{ fontSize: "14px", color: "#0F172A", fontWeight: 500 }}>
                {row.label}
              </span>
              <ToggleSwitch
                checked={config[row.key]}
                disabled={savingKey === row.key}
                onChange={() => onToggle(row.key)}
                label={`Toggle ${row.label}`}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ToggleSwitch({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      style={{
        width: "44px",
        height: "24px",
        borderRadius: "12px",
        backgroundColor: checked ? "#0EA5E9" : "#D1D5DB",
        border: "none",
        position: "relative",
        cursor: disabled ? "wait" : "pointer",
        opacity: disabled ? 0.6 : 1,
        transition: "background-color 0.15s ease",
        flexShrink: 0,
        padding: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: "2px",
          left: checked ? "22px" : "2px",
          width: "20px",
          height: "20px",
          borderRadius: "50%",
          backgroundColor: "#FFFFFF",
          boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
          transition: "left 0.15s ease",
        }}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Section 2 — Draft Threshold
// ---------------------------------------------------------------------------

function ThresholdCard({
  config,
  onThresholdChange,
  onMaxDraftsChange,
}: {
  config: AutonomousConfig;
  onThresholdChange: (value: number) => void;
  onMaxDraftsChange: (value: number) => void;
}) {
  const color = thresholdColor(config.auto_draft_threshold);

  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <label
          htmlFor="draft-threshold"
          style={{ fontSize: "14px", fontWeight: 600, color: "#0F172A" }}
        >
          Generate drafts for opportunities scoring above {config.auto_draft_threshold}%
        </label>
        <span
          style={{
            width: "12px",
            height: "12px",
            borderRadius: "50%",
            backgroundColor: color,
            flexShrink: 0,
          }}
        />
      </div>

      <input
        id="draft-threshold"
        type="range"
        min={50}
        max={95}
        value={config.auto_draft_threshold}
        onChange={(e) => onThresholdChange(Number(e.target.value))}
        style={{ width: "100%", marginTop: "16px", accentColor: color }}
      />
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: "11px",
          color: "#94A3B8",
          marginTop: "4px",
        }}
      >
        <span>50%</span>
        <span>95%</span>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: "24px",
          paddingTop: "20px",
          borderTop: "1px solid #E5E7EB",
        }}
      >
        <label htmlFor="max-drafts" style={{ fontSize: "14px", fontWeight: 600, color: "#0F172A" }}>
          Max auto-drafts per night
        </label>
        <input
          id="max-drafts"
          type="number"
          min={1}
          max={50}
          value={config.max_auto_drafts_per_night}
          onChange={(e) => {
            const value = Number(e.target.value);
            if (Number.isFinite(value)) {
              onMaxDraftsChange(Math.min(50, Math.max(1, value)));
            }
          }}
          style={{
            width: "72px",
            padding: "8px 10px",
            borderRadius: "8px",
            border: "1px solid #D1D5DB",
            fontSize: "14px",
            color: "#0F172A",
            textAlign: "center",
          }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section 3 — Decision Log
// ---------------------------------------------------------------------------

function DecisionLogCard() {
  const [decisions, setDecisions] = useState<AgentDecision[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [requiresReviewOnly, setRequiresReviewOnly] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [actioningId, setActioningId] = useState<string | null>(null);

  const fetchDecisions = useCallback(
    async (opts: { requiresReview: boolean; cursor: string | null }) => {
      const params = new URLSearchParams();
      if (opts.requiresReview) params.set("requiresReview", "true");
      if (opts.cursor) params.set("cursor", opts.cursor);
      const query = params.toString();
      const res = await fetch(`/api/autonomous/decisions${query ? `?${query}` : ""}`);
      if (!res.ok) return null;
      const body = (await res.json()) as { decisions: AgentDecision[] };
      return body.decisions;
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    (async () => {
      const result = await fetchDecisions({ requiresReview: requiresReviewOnly, cursor: null });
      if (cancelled) return;
      if (result === null) {
        setLoadError("Could not load the decision log.");
        setLoading(false);
        return;
      }
      setDecisions(result);
      setHasMore(result.length === 50);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [requiresReviewOnly, fetchDecisions]);

  async function handleLoadMore() {
    const cursor = decisions[decisions.length - 1]?.created_at;
    if (!cursor) return;
    setLoadingMore(true);
    setLoadError(null);
    const result = await fetchDecisions({ requiresReview: requiresReviewOnly, cursor });
    setLoadingMore(false);
    if (result === null) {
      setLoadError("Could not load more decisions.");
      return;
    }
    setDecisions((prev) => [...prev, ...result]);
    setHasMore(result.length === 50);
  }

  async function handleVerdict(decision: AgentDecision, verdict: "approved" | "rejected") {
    setActionError(null);
    setActioningId(decision.id);
    setDecisions((prev) => prev.filter((d) => d.id !== decision.id));
    try {
      const res = await fetch("/api/autonomous/decisions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: decision.id, verdict }),
      });
      if (!res.ok) {
        setDecisions((prev) => [decision, ...prev]);
        setActionError("Could not update the decision. Please try again.");
      }
    } catch {
      setDecisions((prev) => [decision, ...prev]);
      setActionError("Could not update the decision. Please try again.");
    } finally {
      setActioningId(null);
    }
  }

  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#1A2B3C", margin: 0 }}>
          Autonomous Decision Log
        </h2>
        <button
          type="button"
          onClick={() => setRequiresReviewOnly((prev) => !prev)}
          style={{
            fontSize: "12px",
            fontWeight: 600,
            padding: "8px 14px",
            borderRadius: "999px",
            border: "1px solid #D1D5DB",
            backgroundColor: requiresReviewOnly ? "#1A2B3C" : "#FFFFFF",
            color: requiresReviewOnly ? "#FFFFFF" : "#334155",
            cursor: "pointer",
          }}
        >
          {requiresReviewOnly ? "Requires Review Only" : "Show All"}
        </button>
      </div>

      {loadError && (
        <div
          role="alert"
          style={{
            marginTop: "16px",
            backgroundColor: "#FEF2F2",
            border: "1px solid #FECACA",
            borderRadius: "8px",
            padding: "12px 16px",
            fontSize: "13px",
            color: "#B91C1C",
          }}
        >
          {loadError}
        </div>
      )}
      {actionError && (
        <div
          role="alert"
          style={{
            marginTop: "16px",
            backgroundColor: "#FEF2F2",
            border: "1px solid #FECACA",
            borderRadius: "8px",
            padding: "12px 16px",
            fontSize: "13px",
            color: "#B91C1C",
          }}
        >
          {actionError}
        </div>
      )}

      <div style={{ marginTop: "16px", overflowX: "auto" }}>
        {loading ? (
          <div style={{ fontSize: "13px", color: "#6B7280", padding: "14px 0" }}>
            Loading decisions…
          </div>
        ) : decisions.length === 0 ? (
          <div style={{ fontSize: "13px", color: "#6B7280", padding: "14px 0" }}>
            No autonomous decisions to show.
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Agent ID", "Decision Type", "Reasoning", "Confidence", "Time", "Status", ""].map(
                  (col) => (
                    <th
                      key={col}
                      style={{
                        textAlign: "left",
                        fontSize: "11px",
                        fontWeight: 700,
                        color: "#94A3B8",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        padding: "0 12px 10px 0",
                        borderBottom: "1px solid #E5E7EB",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {col}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {decisions.map((decision) => {
                const isPending =
                  decision.required_human_review && decision.human_reviewed_at === null;
                const conf = confidenceColor(decision.confidence_score);
                return (
                  <tr key={decision.id}>
                    <td style={cellStyle}>
                      <span style={{ fontFamily: "monospace", fontSize: "12px", color: "#334155" }}>
                        {decision.agent_id}
                      </span>
                    </td>
                    <td style={cellStyle}>
                      <span style={{ fontSize: "13px", color: "#334155" }}>
                        {decision.decision_type}
                      </span>
                    </td>
                    <td style={{ ...cellStyle, maxWidth: "280px" }}>
                      <span
                        title={decision.reasoning ?? ""}
                        style={{ fontSize: "13px", color: "#64748B" }}
                      >
                        {decision.reasoning ? truncate(decision.reasoning, 80) : "—"}
                      </span>
                    </td>
                    <td style={cellStyle}>
                      {decision.confidence_score !== null ? (
                        <span
                          style={{
                            fontSize: "11px",
                            fontWeight: 700,
                            color: "#FFFFFF",
                            backgroundColor: conf,
                            borderRadius: "999px",
                            padding: "2px 10px",
                          }}
                        >
                          {decision.confidence_score}%
                        </span>
                      ) : (
                        <span style={{ fontSize: "12px", color: "#94A3B8" }}>—</span>
                      )}
                    </td>
                    <td style={cellStyle}>
                      <span style={{ fontSize: "12px", color: "#94A3B8", whiteSpace: "nowrap" }}>
                        {formatRelative(decision.created_at)}
                      </span>
                    </td>
                    <td style={cellStyle}>
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: 700,
                          color: "#FFFFFF",
                          backgroundColor: isPending ? "#F59E0B" : "#10B981",
                          borderRadius: "999px",
                          padding: "2px 10px",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {isPending ? "Pending Review" : "Reviewed"}
                      </span>
                    </td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>
                      {isPending && (
                        <div style={{ display: "flex", gap: "6px", justifyContent: "flex-end" }}>
                          <button
                            type="button"
                            disabled={actioningId === decision.id}
                            onClick={() => void handleVerdict(decision, "approved")}
                            style={{
                              fontSize: "11px",
                              fontWeight: 600,
                              color: "#FFFFFF",
                              backgroundColor: "#10B981",
                              border: "none",
                              borderRadius: "6px",
                              padding: "6px 10px",
                              cursor: actioningId === decision.id ? "wait" : "pointer",
                              opacity: actioningId === decision.id ? 0.6 : 1,
                            }}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            disabled={actioningId === decision.id}
                            onClick={() => void handleVerdict(decision, "rejected")}
                            style={{
                              fontSize: "11px",
                              fontWeight: 600,
                              color: "#FFFFFF",
                              backgroundColor: "#EF4444",
                              border: "none",
                              borderRadius: "6px",
                              padding: "6px 10px",
                              cursor: actioningId === decision.id ? "wait" : "pointer",
                              opacity: actioningId === decision.id ? 0.6 : 1,
                            }}
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {hasMore && !loading && (
        <div style={{ marginTop: "16px", display: "flex", justifyContent: "center" }}>
          <button
            type="button"
            disabled={loadingMore}
            onClick={() => void handleLoadMore()}
            style={{
              fontSize: "13px",
              fontWeight: 600,
              color: "#0077B6",
              backgroundColor: "#FFFFFF",
              border: "1px solid #0077B6",
              borderRadius: "8px",
              padding: "8px 20px",
              cursor: loadingMore ? "wait" : "pointer",
              opacity: loadingMore ? 0.6 : 1,
            }}
          >
            {loadingMore ? "Loading…" : "Load More"}
          </button>
        </div>
      )}
    </div>
  );
}

const cellStyle = {
  padding: "10px 12px 10px 0",
  borderBottom: "1px solid #F1F5F9",
  verticalAlign: "top" as const,
};
