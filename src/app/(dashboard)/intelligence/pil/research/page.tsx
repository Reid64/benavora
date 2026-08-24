"use client";

// PIL research run monitor - GET /api/pil/research (added for this page; see
// the header comment in src/app/api/pil/research/route.ts) lists every
// pil_research_runs row for the org. Prospect names are resolved from a
// separate GET /api/pil/prospects call since ResearchRun only carries
// prospect_id. "Depth achieved" and "agents involved" aren't dedicated
// columns on pil_research_runs - depth is read out of structured_plan
// (see src/lib/pil/workflow.ts's createResearchRun/advanceRunState, which
// fold run_type/depth_target and the discovery plan's own `depth` field in
// there), and "agents involved" starts from initiating_agent_id, expanded
// to every distinct agent_run_id's owner once the run's steps are loaded.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw } from "lucide-react";

import { formatCurrency, formatRelative, humanizeEnum } from "@/lib/utils/formatters";
import type { Prospect, ResearchRun, ResearchRunStep } from "@/lib/pil/types";

const NAVY = "#101B2D";
const GOLD = "#B88A2E";
const PLUM = "#5B21B6";
const CANVAS = "#D8D3C8";
const CARD_BG = "#F8F5EE";
const TEXT_SECONDARY = "#64748B";
const BORDER = "#D9D3C5";

const POLL_MS = 10_000;

const RUN_STATUS_COLOR: Record<string, string> = {
  planning: "#0EA5E9",
  running: "#F59E0B",
  completed: "#10B981",
  failed: "#EF4444",
  cancelled: "#94A3B8",
};

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

function depthFromPlan(run: ResearchRun): string {
  const plan = run.structured_plan as Record<string, unknown> | null;
  if (!plan) return "-";
  if (typeof plan.depth_target === "number") return `Level ${plan.depth_target}`;
  const nlPlan = plan.natural_language_plan as { depth?: string } | undefined;
  if (nlPlan?.depth) return humanizeEnum(nlPlan.depth);
  return "-";
}

function RunSteps({ runId }: { runId: string }) {
  const [steps, setSteps] = useState<ResearchRunStep[] | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/pil/research/${runId}`, { cache: "no-store" });
        if (!active) return;
        if (res.ok) {
          const payload = (await res.json()) as { steps: ResearchRunStep[] };
          setSteps(payload.steps ?? []);
        } else {
          setSteps([]);
        }
      } catch {
        if (active) setSteps([]);
      }
    })();
    return () => {
      active = false;
    };
  }, [runId]);

  if (steps === null) {
    return (
      <p className="text-sm" style={{ color: TEXT_SECONDARY }}>
        Loading steps...
      </p>
    );
  }
  if (steps.length === 0) {
    return (
      <p className="text-sm" style={{ color: TEXT_SECONDARY }}>
        No steps recorded yet.
      </p>
    );
  }
  return (
    <ol className="space-y-2">
      {steps.map((s) => (
        <li key={s.id} className="flex items-start gap-2 text-sm">
          <span className="mt-0.5 font-mono text-xs" style={{ color: GOLD }}>
            #{s.step_number}
          </span>
          <div>
            <span className="font-medium" style={{ color: NAVY }}>
              {humanizeEnum(s.loop_phase)}
            </span>
            {s.decision && <span style={{ color: TEXT_SECONDARY }}> - {s.decision}</span>}
          </div>
        </li>
      ))}
    </ol>
  );
}

export default function PilResearchMonitorPage() {
  const [runs, setRuns] = useState<ResearchRun[]>([]);
  const [prospectNames, setProspectNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [lastPolled, setLastPolled] = useState<Date | null>(null);
  const firstLoad = useRef(true);

  const load = useCallback(async () => {
    if (firstLoad.current) setLoading(true);
    try {
      const [runsRes, prospectsRes] = await Promise.all([
        fetch("/api/pil/research", { cache: "no-store" }),
        fetch("/api/pil/prospects", { cache: "no-store" }),
      ]);
      if (runsRes.ok) {
        const payload = (await runsRes.json()) as { runs: ResearchRun[] };
        setRuns(payload.runs ?? []);
        setError(null);
      } else {
        setError("Could not load research runs.");
      }
      if (prospectsRes.ok) {
        const payload = (await prospectsRes.json()) as { prospects: Prospect[] };
        setProspectNames(new Map(payload.prospects.map((p) => [p.id, p.display_name])));
      }
    } catch {
      setError("Could not reach the server.");
    }
    setLastPolled(new Date());
    firstLoad.current = false;
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(interval);
  }, [load]);

  const sortedRuns = useMemo(
    () => [...runs].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [runs],
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
            Research Run Monitor
          </h1>
          <p className="mt-1 text-sm" style={{ color: TEXT_SECONDARY }}>
            Every pil_research_runs row for your organization, newest first.
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-xs" style={{ color: TEXT_SECONDARY }}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          {lastPolled ? `Updated ${formatRelative(lastPolled)} - refreshes every 10s` : "Loading..."}
        </div>
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {!loading && sortedRuns.length === 0 ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm" style={{ borderColor: BORDER, color: TEXT_SECONDARY }}>
          No research runs yet. Start one from a prospect's dossier or the Discover page.
        </p>
      ) : (
        <div className="space-y-3">
          {sortedRuns.map((run) => {
            const expanded = expandedId === run.id;
            return (
              <div key={run.id} className="rounded-xl" style={{ backgroundColor: CARD_BG }}>
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : run.id)}
                  className="grid w-full grid-cols-1 gap-2 px-5 py-4 text-left sm:grid-cols-6 sm:items-center sm:gap-4"
                >
                  <div className="sm:col-span-2">
                    <p className="text-sm font-semibold" style={{ color: NAVY }}>
                      {run.prospect_id ? (prospectNames.get(run.prospect_id) ?? run.prospect_id) : "General Discovery"}
                    </p>
                    <p className="mt-0.5 truncate text-xs" style={{ color: TEXT_SECONDARY }}>
                      {run.natural_language_query ?? "No goal recorded"}
                    </p>
                    <p className="mt-0.5 font-mono text-[10px]" style={{ color: TEXT_SECONDARY }}>
                      {run.id}
                    </p>
                  </div>
                  <div>
                    <Pill label={humanizeEnum(run.status)} color={RUN_STATUS_COLOR[run.status] ?? "#64748B"} />
                  </div>
                  <div className="text-xs" style={{ color: TEXT_SECONDARY }}>
                    Depth: <span style={{ color: NAVY }}>{depthFromPlan(run)}</span>
                  </div>
                  <div className="text-xs" style={{ color: TEXT_SECONDARY }}>
                    Agent: <span style={{ color: NAVY }}>{run.initiating_agent_id}</span>
                  </div>
                  <div className="text-xs" style={{ color: TEXT_SECONDARY }}>
                    <span style={{ color: GOLD, fontWeight: 600 }}>{formatCurrency(run.financial_spent)}</span>
                    {" - "}
                    {run.started_at ? formatRelative(run.started_at) : "Not started"}
                  </div>
                </button>
                {expanded && (
                  <div className="border-t px-5 py-4" style={{ borderColor: BORDER }}>
                    <RunSteps runId={run.id} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
