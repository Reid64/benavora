"use client";

// PIL agent activity monitor - GET /api/pil/agents returns the 44
// pil_agent_registry definitions plus runningAgentIds (org-scoped, added to
// that route for this page - see its header comment). Registry rows carry
// no runs-today/success-rate/avg-cost columns; those are computed here from
// each agent's real run history via GET /api/pil/agents/[agentCode]/runs,
// fetched in parallel across all registered agents (44 small requests,
// acceptable for a monitoring page - the alternative was a new bulk
// aggregate endpoint, out of scope for this task).

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Select } from "@/components/ui";
import { formatCurrency, formatRelative, humanizeEnum } from "@/lib/utils/formatters";
import type { AgentDefinition, AgentFamily, AgentRun } from "@/lib/pil/types";

const NAVY = "#101B2D";
const GOLD = "#B88A2E";
const PLUM = "#5B21B6";
const CANVAS = "#D8D3C8";
const CARD_BG = "#F8F5EE";
const TEXT_SECONDARY = "#64748B";
const BORDER = "#D9D3C5";

const RUN_STATUS_COLOR: Record<string, string> = {
  queued: "#94A3B8",
  planning: "#0EA5E9",
  running: "#F59E0B",
  observing: "#F59E0B",
  replanning: "#F59E0B",
  completed: "#10B981",
  blocked: "#EF4444",
  failed: "#EF4444",
  escalated: "#EF4444",
};

const TERMINAL_STATUSES = new Set(["completed", "blocked", "failed", "escalated"]);
const SUCCESS_STATUSES = new Set(["completed"]);

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold"
      style={{ backgroundColor: `${color}1A`, color, borderColor: `${color}40` }}
    >
      {label}
    </span>
  );
}

interface AgentStats {
  runsToday: number;
  successRate: number | null;
  avgCost: number | null;
}

function computeStats(runs: AgentRun[]): AgentStats {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const runsToday = runs.filter((r) => new Date(r.created_at).getTime() >= startOfToday.getTime()).length;

  const terminal = runs.filter((r) => TERMINAL_STATUSES.has(r.status));
  const successRate = terminal.length > 0 ? terminal.filter((r) => SUCCESS_STATUSES.has(r.status)).length / terminal.length : null;

  const avgCost = runs.length > 0 ? runs.reduce((sum, r) => sum + r.cost_usd, 0) / runs.length : null;

  return { runsToday, successRate, avgCost };
}

const FAMILY_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All families" },
  { value: "supervisory", label: "Supervisory" },
  { value: "discovery", label: "Discovery" },
  { value: "prospect_intelligence", label: "Prospect Intelligence" },
  { value: "relationship_intelligence", label: "Relationship Intelligence" },
  { value: "qualification", label: "Qualification" },
  { value: "strategy", label: "Strategy" },
  { value: "knowledge_integrity", label: "Knowledge Integrity" },
  { value: "operations_evaluation_learning", label: "Operations, Evaluation & Learning" },
];

export default function PilAgentsPage() {
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  const [runsByAgent, setRunsByAgent] = useState<Map<string, AgentRun[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [familyFilter, setFamilyFilter] = useState<AgentFamily | "">("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/pil/agents", { cache: "no-store" });
        if (!res.ok) {
          if (active) setError("Could not load the agent registry.");
          return;
        }
        const payload = (await res.json()) as { agents: AgentDefinition[]; runningAgentIds: string[] };
        if (!active) return;
        setAgents(payload.agents ?? []);
        setRunningIds(new Set(payload.runningAgentIds ?? []));

        const entries = await Promise.all(
          (payload.agents ?? []).map(async (agent): Promise<readonly [string, AgentRun[]]> => {
            try {
              const runsRes = await fetch(`/api/pil/agents/${agent.agent_id}/runs`, { cache: "no-store" });
              if (!runsRes.ok) return [agent.agent_id, []];
              const runsPayload = (await runsRes.json()) as { runs: AgentRun[] };
              return [agent.agent_id, runsPayload.runs ?? []];
            } catch {
              return [agent.agent_id, []];
            }
          }),
        );
        if (active) setRunsByAgent(new Map(entries));
      } catch {
        if (active) setError("Could not reach the server.");
      }
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  const visibleAgents = useMemo(
    () => (familyFilter ? agents.filter((a) => a.family === familyFilter) : agents),
    [agents, familyFilter],
  );

  return (
    <div className="min-h-screen p-6" style={{ backgroundColor: CANVAS }}>
      <Link href="/intelligence/pil" className="inline-flex items-center gap-1.5 text-sm" style={{ color: PLUM }}>
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to PIL Hub
      </Link>

      <div className="mb-6 mt-4 flex flex-wrap items-center justify-between gap-3">
        <div style={{ borderLeft: `4px solid ${PLUM}`, paddingLeft: "1rem" }}>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: NAVY }}>
            Agent Activity Monitor
          </h1>
          <p className="mt-1 text-sm" style={{ color: TEXT_SECONDARY }}>
            All {agents.length || 44} pil_agent_registry agents and their real run history.
          </p>
        </div>
        <div className="w-64">
          <Select
            aria-label="Filter by family"
            options={FAMILY_OPTIONS}
            value={familyFilter}
            onChange={(e) => setFamilyFilter(e.target.value as AgentFamily | "")}
          />
        </div>
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-2">
        {visibleAgents.map((agent) => {
          const runs = runsByAgent.get(agent.agent_id) ?? [];
          const stats = computeStats(runs);
          const isRunning = runningIds.has(agent.agent_id);
          const expanded = expandedId === agent.agent_id;

          return (
            <div key={agent.agent_id} className="rounded-xl" style={{ backgroundColor: CARD_BG }}>
              <button
                type="button"
                onClick={() => setExpandedId(expanded ? null : agent.agent_id)}
                className="grid w-full grid-cols-1 gap-2 px-5 py-4 text-left sm:grid-cols-7 sm:items-center sm:gap-4"
              >
                <div className="sm:col-span-2">
                  <p className="text-sm font-semibold" style={{ color: NAVY }}>
                    {agent.name}
                  </p>
                  <p className="mt-0.5 text-xs" style={{ color: TEXT_SECONDARY }}>
                    {humanizeEnum(agent.family)} - {agent.agent_id}
                  </p>
                </div>
                <div>
                  <Pill
                    label={agent.active ? (isRunning ? "Running" : "Idle") : "Inactive"}
                    color={agent.active ? (isRunning ? "#F59E0B" : "#10B981") : "#94A3B8"}
                  />
                </div>
                <div className="text-xs" style={{ color: TEXT_SECONDARY }}>
                  Autonomy <span style={{ color: NAVY, fontWeight: 600 }}>{agent.default_autonomy_level}</span>
                </div>
                <div className="text-xs" style={{ color: TEXT_SECONDARY }}>
                  Runs today <span style={{ color: NAVY, fontWeight: 600 }}>{loading ? "..." : stats.runsToday}</span>
                </div>
                <div className="text-xs" style={{ color: TEXT_SECONDARY }}>
                  Success{" "}
                  <span style={{ color: NAVY, fontWeight: 600 }}>
                    {loading ? "..." : stats.successRate === null ? "-" : `${Math.round(stats.successRate * 100)}%`}
                  </span>
                </div>
                <div className="text-xs" style={{ color: TEXT_SECONDARY }}>
                  Avg cost{" "}
                  <span style={{ color: GOLD, fontWeight: 600 }}>
                    {loading ? "..." : stats.avgCost === null ? "-" : formatCurrency(stats.avgCost)}
                  </span>
                </div>
              </button>

              {expanded && (
                <div className="border-t px-5 py-4" style={{ borderColor: BORDER }}>
                  {runs.length === 0 ? (
                    <p className="text-sm" style={{ color: TEXT_SECONDARY }}>
                      No runs recorded yet for this agent.
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {[...runs]
                        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                        .slice(0, 20)
                        .map((run) => (
                          <div key={run.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                            <span className="font-mono" style={{ color: TEXT_SECONDARY }}>
                              {run.id.slice(0, 8)}
                            </span>
                            <Pill label={humanizeEnum(run.status)} color={RUN_STATUS_COLOR[run.status] ?? "#64748B"} />
                            <span style={{ color: GOLD }}>{formatCurrency(run.cost_usd)}</span>
                            <span style={{ color: TEXT_SECONDARY }}>{formatRelative(run.created_at)}</span>
                            {run.error && <span className="text-red-600">{run.error}</span>}
                          </div>
                        ))}
                      {runs.length > 20 && (
                        <p className="pt-1 text-xs" style={{ color: TEXT_SECONDARY }}>
                          Showing 20 most recent of {runs.length} runs.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
