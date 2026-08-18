"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { formatDate, formatRelative } from "@/lib/utils/formatters";

// Agent Log Viewer (FEATURE_REGISTRY_v2.md #160, q27-003) - a click-through
// detail view extending the Agent Marketplace (q27-002). Queries real
// agent_runs history for one agent via /api/agents/registry/[agentId]/runs;
// organization_id is always derived server-side there, never sent from here.
//
// Many agents in agent_registry are seeded under a synthetic slug (plain
// functions or multi-source API routes with no single logged agent_type) or
// are real AutonomousAgent subclasses never auto-invoked in production
// (AGENT_VERIFICATION_LOG.md's orphaned-wiring findings) - both cases
// correctly return zero rows here. That is rendered as a plain, honest empty
// state, not a fabricated "0 runs, healthy" implication.

interface AgentRun {
  id: string;
  status: string | null;
  output_summary: string | null;
  items_found: number | null;
  items_processed: number | null;
  error_message: string | null;
  tokens_used: number | null;
  duration_ms: number | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

interface RunsResponse {
  agent: { agent_id: string; name: string };
  runs: AgentRun[];
}

const PAGE_SIZE = 50;

const cardStyle = {
  backgroundColor: "#F8F5EE",
  borderRadius: "12px",
  boxShadow: "0 2px 8px rgba(184,138,46,0.16)",
  padding: "20px",
};

const errorBoxStyle = {
  backgroundColor: "#FEF2F2",
  border: "1px solid #FECACA",
  borderRadius: "8px",
  padding: "12px 16px",
  fontSize: "13px",
  color: "#B91C1C",
};

function statusBadgeColors(status: string | null): { bg: string; fg: string } {
  switch (status) {
    case "completed":
      return { bg: "#F0FDF4", fg: "#16A34A" };
    case "failed":
      return { bg: "#FEF2F2", fg: "#B91C1C" };
    case "running":
      return { bg: "#FBF1DE", fg: "#B88A2E" };
    case "pending":
      return { bg: "#F1F5F9", fg: "#64748B" };
    default:
      return { bg: "#F1F5F9", fg: "#94A3B8" };
  }
}

function formatDuration(ms: number | null): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTokens(tokens: number | null): string {
  if (tokens === null || tokens === undefined) return "—";
  return tokens.toLocaleString("en-US");
}

async function fetchRuns(
  agentId: string,
  cursor: string | null,
): Promise<{ ok: true; data: RunsResponse } | { ok: false; status: number; message: string }> {
  try {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (cursor) params.set("cursor", cursor);
    const res = await fetch(`/api/agents/registry/${encodeURIComponent(agentId)}/runs?${params.toString()}`);
    if (!res.ok) {
      if (res.status === 401) {
        return { ok: false, status: 401, message: "You must be signed in to view this agent's run history." };
      }
      if (res.status === 403) {
        return { ok: false, status: 403, message: "You don't have permission to view this agent's run history." };
      }
      if (res.status === 404) {
        return { ok: false, status: 404, message: "This agent was not found in the registry." };
      }
      return { ok: false, status: res.status, message: "Could not load this agent's run history. Please try again." };
    }
    const body = (await res.json()) as RunsResponse;
    return { ok: true, data: body };
  } catch {
    return { ok: false, status: 0, message: "Could not load this agent's run history. Please try again." };
  }
}

export default function AgentLogViewerPage() {
  const params = useParams<{ agentId: string }>();
  const agentId = params.agentId;

  const [agentName, setAgentName] = useState<string | null>(null);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const result = await fetchRuns(agentId, null);
    if (result.ok) {
      setAgentName(result.data.agent.name);
      setRuns(result.data.runs);
      setHasMore(result.data.runs.length === PAGE_SIZE);
    } else {
      setRuns([]);
      setHasMore(false);
      setLoadError(result.message);
    }
    setLoading(false);
  }, [agentId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleLoadMore() {
    const cursor = runs[runs.length - 1]?.created_at;
    if (!cursor) return;
    setLoadingMore(true);
    const result = await fetchRuns(agentId, cursor);
    setLoadingMore(false);
    if (!result.ok) {
      setLoadError(result.message);
      return;
    }
    setRuns((prev) => [...prev, ...result.data.runs]);
    setHasMore(result.data.runs.length === PAGE_SIZE);
  }

  return (
    <div style={{ backgroundColor: "#D8D3C8", minHeight: "100vh", padding: "32px" }}>
      <div style={{ maxWidth: "1120px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "20px" }}>
        <div>
          <Link
            href="/agents/marketplace"
            style={{ fontSize: "13px", fontWeight: 600, color: "#B88A2E", textDecoration: "none" }}
          >
            ← Agent Marketplace
          </Link>
          <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#101B2D", margin: "6px 0 0 0", borderLeft: "4px solid #B88A2E", paddingLeft: "14px" }}>
            {agentName ?? "Agent Run History"}
          </h1>
          <span style={{ fontSize: "11px", color: "#94A3B8", fontFamily: "monospace" }}>
            {agentId}
          </span>
        </div>

        {loading ? (
          <div style={cardStyle}>
            <span style={{ fontSize: "13px", color: "#6B7280" }}>Loading run history…</span>
          </div>
        ) : loadError ? (
          <div style={errorBoxStyle}>
            <span style={{ fontSize: "13px", color: "#B91C1C" }}>{loadError}</span>
            <div style={{ marginTop: "12px" }}>
              <button
                type="button"
                onClick={() => void load()}
                style={{
                  fontSize: "13px",
                  fontWeight: 600,
                  color: "#B88A2E",
                  backgroundColor: "#F8F5EE",
                  border: "1px solid #B88A2E",
                  borderRadius: "8px",
                  padding: "8px 16px",
                  cursor: "pointer",
                }}
              >
                Retry
              </button>
            </div>
          </div>
        ) : runs.length === 0 ? (
          <div style={cardStyle}>
            <span style={{ fontSize: "13px", color: "#6B7280" }}>
              No runs recorded for this agent yet.
            </span>
            <p style={{ fontSize: "12px", color: "#94A3B8", margin: "8px 0 0 0", lineHeight: 1.5 }}>
              This can mean the agent hasn&apos;t executed in your organization yet, or that it
              writes no agent_runs row by design (some agents in this registry are plain
              functions or multi-source routes with no single logged run type).
            </p>
          </div>
        ) : (
          <div style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #F1F5F9" }}>
                  {["Status", "Started", "Duration", "Found / Processed", "Tokens", "Summary / Error"].map(
                    (label) => (
                      <th
                        key={label}
                        style={{
                          textAlign: "left",
                          padding: "10px 16px",
                          fontSize: "11px",
                          fontWeight: 700,
                          color: "#94A3B8",
                          textTransform: "uppercase",
                          letterSpacing: "0.03em",
                        }}
                      >
                        {label}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => {
                  const badge = statusBadgeColors(run.status);
                  return (
                    <tr key={run.id} style={{ borderBottom: "1px solid #F1F5F9" }}>
                      <td style={{ padding: "10px 16px", verticalAlign: "top" }}>
                        <span
                          style={{
                            fontSize: "11px",
                            fontWeight: 700,
                            color: badge.fg,
                            backgroundColor: badge.bg,
                            borderRadius: "999px",
                            padding: "3px 10px",
                            textTransform: "capitalize",
                          }}
                        >
                          {run.status ?? "unknown"}
                        </span>
                      </td>
                      <td style={{ padding: "10px 16px", verticalAlign: "top", color: "#334155" }}>
                        <div>{formatDate(run.started_at ?? run.created_at)}</div>
                        <div style={{ fontSize: "11px", color: "#94A3B8" }}>
                          {formatRelative(run.started_at ?? run.created_at)}
                        </div>
                      </td>
                      <td style={{ padding: "10px 16px", verticalAlign: "top", color: "#334155" }}>
                        {formatDuration(run.duration_ms)}
                      </td>
                      <td style={{ padding: "10px 16px", verticalAlign: "top", color: "#334155" }}>
                        {run.items_found ?? "—"} / {run.items_processed ?? "—"}
                      </td>
                      <td style={{ padding: "10px 16px", verticalAlign: "top", color: "#334155" }}>
                        {formatTokens(run.tokens_used)}
                      </td>
                      <td style={{ padding: "10px 16px", verticalAlign: "top", maxWidth: "320px" }}>
                        {run.error_message ? (
                          <span style={{ color: "#B91C1C" }}>{run.error_message}</span>
                        ) : run.output_summary ? (
                          <span style={{ color: "#64748B" }}>{run.output_summary}</span>
                        ) : (
                          <span style={{ color: "#94A3B8" }}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {hasMore && !loading && (
          <div style={{ display: "flex", justifyContent: "center" }}>
            <button
              type="button"
              disabled={loadingMore}
              onClick={() => void handleLoadMore()}
              style={{
                fontSize: "13px",
                fontWeight: 600,
                color: "#B88A2E",
                backgroundColor: "#F8F5EE",
                border: "1px solid #B88A2E",
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
    </div>
  );
}
