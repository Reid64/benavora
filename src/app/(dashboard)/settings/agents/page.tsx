"use client";

import { useCallback, useEffect, useState } from "react";
import { Lock } from "lucide-react";

import { Card, EmptyState, LoadingSpinner } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { SUBSCRIPTION_TIERS, type SubscriptionTier } from "@/lib/utils/constants";
import { formatRelative } from "@/lib/utils/formatters";

type AgentPlanRequirement = "starter" | "professional" | "enterprise";

type RegistryAgent = {
  agent_id: string;
  name: string;
  description: string;
  version: string;
  plan_requirement: AgentPlanRequirement;
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
};

const PLAN_SECTIONS: { key: AgentPlanRequirement; label: string }[] = [
  { key: "starter", label: "Starter" },
  { key: "professional", label: "Professional" },
  { key: "enterprise", label: "Enterprise" },
];

const PLAN_BADGE_COLORS: Record<AgentPlanRequirement, string> = {
  starter: "#16A34A",
  professional: "#0077B6",
  enterprise: "#7C3AED",
};

function planRank(tier: string): number {
  const index = SUBSCRIPTION_TIERS.indexOf(tier as SubscriptionTier);
  return index === -1 ? 0 : index;
}

export default function AgentsMarketplacePage() {
  const [agents, setAgents] = useState<RegistryAgent[]>([]);
  const [orgTier, setOrgTier] = useState<SubscriptionTier>("starter");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toggling, setToggling] = useState<Record<string, boolean>>({});
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const supabase = createClient();
      const [registryRes, orgRes] = await Promise.all([
        fetch("/api/agents/registry"),
        supabase.from("organizations").select("subscription_tier").single(),
      ]);

      if (!registryRes.ok) {
        setLoadError("Could not load the agent registry.");
        return;
      }
      const body = (await registryRes.json()) as { agents: RegistryAgent[] };
      setAgents(body.agents ?? []);
      setOrgTier(
        (orgRes.data?.subscription_tier as SubscriptionTier | undefined) ??
          "starter",
      );
    } catch {
      setLoadError("Could not load the agent registry.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleToggle(agent: RegistryAgent) {
    setActionError(null);
    setToggling((prev) => ({ ...prev, [agent.agent_id]: true }));
    try {
      const res = await fetch("/api/agents/registry/configure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_id: agent.agent_id,
          enabled: !agent.enabled,
          config: agent.config,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setActionError(data?.error ?? "Could not update the agent.");
        return;
      }
      setAgents((prev) =>
        prev.map((a) =>
          a.agent_id === agent.agent_id ? { ...a, enabled: !a.enabled } : a,
        ),
      );
    } catch {
      setActionError("Could not update the agent.");
    } finally {
      setToggling((prev) => ({ ...prev, [agent.agent_id]: false }));
    }
  }

  if (loading) {
    return <LoadingSpinner center label="Loading agent marketplace..." />;
  }

  if (loadError) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
      >
        {loadError}
      </div>
    );
  }

  const orgRank = planRank(orgTier);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-primary">
          Agent Marketplace
        </h1>
        <p className="mt-1 text-sm text-navy-500">
          Enable or disable the specialized AI agents that run for your
          organization.
        </p>
      </div>

      {actionError && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {actionError}
        </div>
      )}

      {agents.length === 0 ? (
        <Card>
          <EmptyState
            title="No agents available"
            description="The agent registry has not been seeded yet."
          />
        </Card>
      ) : (
        PLAN_SECTIONS.map((section) => {
          const sectionAgents = agents.filter(
            (a) => a.plan_requirement === section.key,
          );
          if (sectionAgents.length === 0) return null;

          return (
            <div key={section.key} className="space-y-3">
              <h2
                style={{
                  fontFamily: "'Plus Jakarta Sans', sans-serif",
                  fontSize: "13px",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  color: "#94A3B8",
                  fontWeight: 600,
                }}
              >
                {section.label}
              </h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {sectionAgents.map((agent) => (
                  <AgentCard
                    key={agent.agent_id}
                    agent={agent}
                    locked={planRank(agent.plan_requirement) > orgRank}
                    isToggling={toggling[agent.agent_id] ?? false}
                    onToggle={() => void handleToggle(agent)}
                  />
                ))}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent card
// ---------------------------------------------------------------------------

function AgentCard({
  agent,
  locked,
  isToggling,
  onToggle,
}: {
  agent: RegistryAgent;
  locked: boolean;
  isToggling: boolean;
  onToggle: () => void;
}) {
  const badgeColor = PLAN_BADGE_COLORS[agent.plan_requirement];

  return (
    <div
      style={{
        backgroundColor: "#FFFFFF",
        borderRadius: "12px",
        padding: "20px",
        boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
      }}
      className="flex flex-col gap-3"
    >
      <div className="flex items-start justify-between gap-2">
        <span
          style={{
            fontWeight: 700,
            fontSize: "15px",
            color: "#0F172A",
          }}
        >
          {agent.name}
        </span>
        <span
          style={{
            backgroundColor: badgeColor,
            color: "#FFFFFF",
            fontSize: "11px",
            fontWeight: 600,
            padding: "2px 10px",
            borderRadius: "999px",
            whiteSpace: "nowrap",
            textTransform: "capitalize",
          }}
        >
          {agent.plan_requirement}
        </span>
      </div>

      <p
        style={{
          fontSize: "13px",
          color: "#64748B",
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {agent.description}
      </p>

      {agent.enabled && (
        <div style={{ fontSize: "12px", color: "#94A3B8" }} className="space-y-0.5">
          <div>
            Last run:{" "}
            {agent.last_run_at ? formatRelative(agent.last_run_at) : "Never"}
          </div>
          <div>Run count: {agent.run_count.toLocaleString()}</div>
        </div>
      )}

      <div className="mt-auto flex items-center justify-end pt-1">
        {locked ? (
          <div className="flex items-center gap-1.5" style={{ color: "#94A3B8" }}>
            <Lock className="h-3.5 w-3.5" aria-hidden />
            <span style={{ fontSize: "12px" }}>
              Upgrade to {agent.plan_requirement}
            </span>
          </div>
        ) : (
          <ToggleSwitch
            checked={agent.enabled}
            disabled={isToggling}
            onChange={onToggle}
            label={`Toggle ${agent.name}`}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toggle switch
// ---------------------------------------------------------------------------

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
        width: "40px",
        height: "22px",
        borderRadius: "999px",
        backgroundColor: checked ? "#0077B6" : "#E2E8F0",
        border: "none",
        position: "relative",
        cursor: disabled ? "wait" : "pointer",
        opacity: disabled ? 0.6 : 1,
        transition: "background-color 0.15s ease",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: "2px",
          left: checked ? "20px" : "2px",
          width: "18px",
          height: "18px",
          borderRadius: "50%",
          backgroundColor: "#FFFFFF",
          boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
          transition: "left 0.15s ease",
        }}
      />
    </button>
  );
}
