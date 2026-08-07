"use client";

import { useCallback, useEffect, useState } from "react";

import { formatRelative } from "@/lib/utils/formatters";

// Agent Marketplace (AGENTS_v2.md §6, FEATURE_REGISTRY_v2.md #159). Lists
// every row in `agent_registry` annotated with this org's real
// `agent_configurations` state, via /api/agents/registry — organization_id
// is always derived server-side there, never sent from here. Toggling an
// agent persists through /api/agents/registry/configure.

interface RegistryAgent {
  agent_id: string;
  name: string;
  description: string;
  version: string;
  plan_requirement: string;
  trigger_type: string;
  schedule_cron: string | null;
  avg_runtime_seconds: number | null;
  avg_tokens_per_run: number | null;
  active: boolean;
  created_at: string;
  enabled: boolean;
  config: Record<string, unknown>;
  last_run_at: string | null;
  run_count: number;
  total_tokens_consumed: number;
}

interface ConfigureResponse {
  configuration: {
    agent_id: string;
    enabled: boolean;
    config: Record<string, unknown>;
    last_run_at: string | null;
    run_count: number;
    total_tokens_consumed: number;
  };
}

const cardStyle = {
  backgroundColor: "#FFFFFF",
  borderRadius: "12px",
  boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
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

function planBadgeColors(plan: string): { bg: string; fg: string } {
  switch (plan.toLowerCase()) {
    case "enterprise":
      return { bg: "#F3EEFC", fg: "#7C3AED" };
    case "professional":
      return { bg: "#EAF6FC", fg: "#0077B6" };
    default:
      return { bg: "#F0FDF4", fg: "#16A34A" };
  }
}

function triggerLabel(agent: RegistryAgent): string {
  const base = agent.trigger_type
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
  if (agent.schedule_cron) return `${base} · ${agent.schedule_cron}`;
  return base;
}

async function fetchRegistry(): Promise<
  { ok: true; agents: RegistryAgent[] } | { ok: false; status: number; message: string }
> {
  try {
    const res = await fetch("/api/agents/registry");
    if (!res.ok) {
      if (res.status === 401) {
        return { ok: false, status: 401, message: "You must be signed in to view the agent marketplace." };
      }
      if (res.status === 403) {
        return { ok: false, status: 403, message: "You don't have permission to view the agent marketplace." };
      }
      return { ok: false, status: res.status, message: "Could not load the agent registry. Please try again." };
    }
    const body = (await res.json()) as { agents: RegistryAgent[] };
    return { ok: true, agents: body.agents ?? [] };
  } catch {
    return { ok: false, status: 0, message: "Could not load the agent registry. Please try again." };
  }
}

export default function AgentMarketplacePage() {
  const [agents, setAgents] = useState<RegistryAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const result = await fetchRegistry();
    if (result.ok) {
      setAgents(result.agents);
    } else {
      setAgents([]);
      setLoadError(result.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleToggle = useCallback(async (agent: RegistryAgent) => {
    setToggleError(null);
    const nextEnabled = !agent.enabled;
    setTogglingId(agent.agent_id);
    setAgents((prev) =>
      prev.map((a) => (a.agent_id === agent.agent_id ? { ...a, enabled: nextEnabled } : a)),
    );

    try {
      const res = await fetch("/api/agents/registry/configure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_id: agent.agent_id,
          enabled: nextEnabled,
          config: agent.config ?? {},
        }),
      });

      if (!res.ok) {
        setAgents((prev) =>
          prev.map((a) => (a.agent_id === agent.agent_id ? { ...a, enabled: !nextEnabled } : a)),
        );
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setToggleError(body?.error ?? "Could not save your change. Please try again.");
        return;
      }

      const body = (await res.json()) as ConfigureResponse;
      setAgents((prev) =>
        prev.map((a) =>
          a.agent_id === agent.agent_id
            ? {
                ...a,
                enabled: body.configuration.enabled,
                config: body.configuration.config,
                last_run_at: body.configuration.last_run_at,
                run_count: body.configuration.run_count,
                total_tokens_consumed: body.configuration.total_tokens_consumed,
              }
            : a,
        ),
      );
    } catch {
      setAgents((prev) =>
        prev.map((a) => (a.agent_id === agent.agent_id ? { ...a, enabled: !nextEnabled } : a)),
      );
      setToggleError("Could not save your change. Please try again.");
    } finally {
      setTogglingId(null);
    }
  }, []);

  return (
    <div style={{ backgroundColor: "#D6E4F0", minHeight: "100vh", padding: "32px" }}>
      <div style={{ maxWidth: "1120px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "20px" }}>
        <div>
          <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#1A2B3C", margin: 0 }}>
            Agent Marketplace
          </h1>
          <p style={{ fontSize: "13px", color: "#6B7280", margin: "6px 0 0 0" }}>
            Browse every autonomous agent available on the platform and enable the ones you want
            running for your organization.
          </p>
        </div>

        {toggleError && (
          <div role="alert" style={errorBoxStyle}>
            {toggleError}
          </div>
        )}

        {loading ? (
          <div style={cardStyle}>
            <span style={{ fontSize: "13px", color: "#6B7280" }}>Loading agents…</span>
          </div>
        ) : loadError ? (
          <div style={{ ...cardStyle, borderLeft: "4px solid #EF4444" }}>
            <span style={{ fontSize: "13px", color: "#B91C1C" }}>{loadError}</span>
            <div style={{ marginTop: "12px" }}>
              <button
                type="button"
                onClick={() => void load()}
                style={{
                  fontSize: "13px",
                  fontWeight: 600,
                  color: "#0077B6",
                  backgroundColor: "#FFFFFF",
                  border: "1px solid #0077B6",
                  borderRadius: "8px",
                  padding: "8px 16px",
                  cursor: "pointer",
                }}
              >
                Retry
              </button>
            </div>
          </div>
        ) : agents.length === 0 ? (
          <div style={cardStyle}>
            <span style={{ fontSize: "13px", color: "#6B7280" }}>
              No agents are registered yet.
            </span>
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
              gap: "16px",
            }}
          >
            {agents.map((agent) => (
              <AgentCard
                key={agent.agent_id}
                agent={agent}
                saving={togglingId === agent.agent_id}
                onToggle={() => void handleToggle(agent)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AgentCard({
  agent,
  saving,
  onToggle,
}: {
  agent: RegistryAgent;
  saving: boolean;
  onToggle: () => void;
}) {
  const plan = planBadgeColors(agent.plan_requirement);

  return (
    <div style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: "12px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
        <div>
          <h2 style={{ fontSize: "15px", fontWeight: 700, color: "#1A2B3C", margin: 0 }}>
            {agent.name}
          </h2>
          <span style={{ fontSize: "11px", color: "#94A3B8", fontFamily: "monospace" }}>
            {agent.agent_id}
          </span>
        </div>
        <ToggleSwitch
          checked={agent.enabled}
          disabled={saving}
          onChange={onToggle}
          label={`Toggle ${agent.name}`}
        />
      </div>

      <p style={{ fontSize: "13px", color: "#64748B", margin: 0, lineHeight: 1.5 }}>
        {agent.description}
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
        <span
          style={{
            fontSize: "11px",
            fontWeight: 700,
            color: plan.fg,
            backgroundColor: plan.bg,
            borderRadius: "999px",
            padding: "3px 10px",
            textTransform: "capitalize",
          }}
        >
          {agent.plan_requirement}
        </span>
        <span
          style={{
            fontSize: "11px",
            fontWeight: 600,
            color: "#334155",
            backgroundColor: "#F1F5F9",
            borderRadius: "999px",
            padding: "3px 10px",
          }}
        >
          {triggerLabel(agent)}
        </span>
        {!agent.active && (
          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color: "#B91C1C",
              backgroundColor: "#FEF2F2",
              borderRadius: "999px",
              padding: "3px 10px",
            }}
          >
            Inactive
          </span>
        )}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: "12px",
          color: "#94A3B8",
          paddingTop: "10px",
          borderTop: "1px solid #F1F5F9",
        }}
      >
        <span>
          Last run:{" "}
          <span style={{ color: "#334155" }}>
            {agent.last_run_at ? formatRelative(agent.last_run_at) : "Never"}
          </span>
        </span>
        <span>
          Runs: <span style={{ color: "#334155" }}>{agent.run_count}</span>
        </span>
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
