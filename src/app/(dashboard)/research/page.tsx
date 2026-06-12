"use client";

import { useCallback, useEffect, useState } from "react";

import {
  ResearchDashboard,
  type ResearchDiscovery,
  type ResearchRun,
} from "@/components/research/ResearchDashboard";
import {
  RunHistory,
  type AgentRunRecord,
} from "@/components/research/RunHistory";
import {
  ResearchSchedule,
  type FamilySchedule,
} from "@/components/research/ResearchSchedule";
import { RESEARCH_FAMILIES } from "@/lib/research/families";
import { createClient } from "@/lib/supabase/client";
import { canEdit, useProfile } from "@/lib/hooks/useProfile";
import type { AgentType } from "@/types/agents";
import type { Enums, Tables } from "@/types/database";

type FunderCategory = Enums<"funder_category">;

/** Research agent types surfaced in the activity feed (AGENTS.md Agents 12-15). */
const RESEARCH_AGENT_TYPES: AgentType[] = [
  "corporate_research",
  "foundation_research",
  "government_research",
  "local_sponsorship",
];

/** How often to re-poll agent_runs while a run is live (Contracts §17). */
const POLL_INTERVAL_MS = 4000;

/** Shape returned by the agent_runs query (status is nullable in the schema). */
type AgentRunRow = {
  id: string;
  agent_type: AgentType;
  status: ResearchRun["status"] | null;
  output_summary: string | null;
  error_message: string | null;
  started_at: string | null;
};

/** Shape returned by the discovery query, with the funder relation embedded. */
type OpportunityRow = {
  id: string;
  name: string;
  category: FunderCategory;
  amount_min: number | null;
  amount_max: number | null;
  source: string | null;
  discovered_at: string | null;
  funders: { name: string } | { name: string }[] | null;
};

/**
 * Research dashboard page (BLUEPRINT §3.1 "Research"). Lists the organization's
 * search profiles with run controls, shows live agent-run status, the scheduled
 * sweep with per-family next-run projections and an enable/disable control, a
 * full agent-run history, and a feed of recently discovered opportunities.
 *
 * Triggering a run POSTs to /api/agents/research; the history comes from
 * /api/agents/research/status — both authenticate and derive organization_id
 * server-side, so this client never sends an organization id (Contracts §2,
 * §16). Reads are RLS-scoped to the organization.
 */
export default function ResearchPage() {
  const { profile } = useProfile();
  const editable = canEdit(profile?.role);
  const canToggle = profile?.role === "owner" || profile?.role === "admin";

  const [profiles, setProfiles] = useState<Tables<"search_profiles">[]>([]);
  const [discoveries, setDiscoveries] = useState<ResearchDiscovery[]>([]);
  const [runs, setRuns] = useState<ResearchRun[]>([]);
  const [history, setHistory] = useState<AgentRunRecord[]>([]);
  const [cronEnabled, setCronEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [runningProfileId, setRunningProfileId] = useState<string | null>(null);
  const [runningAll, setRunningAll] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const [cronSaving, setCronSaving] = useState(false);
  const [cronError, setCronError] = useState<string | null>(null);

  const load = useCallback(async (initial: boolean) => {
    if (initial) setLoading(true);
    const supabase = createClient();

    const [profilesRes, oppsRes, runsRes, flagRes, historyRes] =
      await Promise.all([
        supabase
          .from("search_profiles")
          .select("*")
          .order("created_at", { ascending: false }),
        supabase
          .from("opportunities")
          .select(
            "id, name, category, amount_min, amount_max, source, discovered_at, funders(name)",
          )
          .not("source", "is", null)
          .neq("source", "manual")
          .order("discovered_at", { ascending: false })
          .limit(30),
        supabase
          .from("agent_runs")
          .select("id, agent_type, status, output_summary, error_message, started_at")
          .in("agent_type", RESEARCH_AGENT_TYPES)
          .order("started_at", { ascending: false, nullsFirst: false })
          .limit(8),
        supabase
          .from("platform_config")
          .select("value")
          .eq("key", "feature.research_agents")
          .maybeSingle(),
        fetch("/api/agents/research/status?limit=50")
          .then((r) => (r.ok ? r.json() : { runs: [] }))
          .catch(() => ({ runs: [] })),
      ]);

    if (profilesRes.error || oppsRes.error || runsRes.error) {
      setError("Could not load the research dashboard.");
      if (initial) setLoading(false);
      return;
    }

    setError(null);
    setProfiles((profilesRes.data ?? []) as Tables<"search_profiles">[]);
    setDiscoveries(
      ((oppsRes.data ?? []) as unknown as OpportunityRow[]).map(mapDiscovery),
    );
    setRuns(((runsRes.data ?? []) as AgentRunRow[]).map(mapRun));
    setCronEnabled((flagRes.data?.value as string | undefined) === "true");
    setHistory(((historyRes as { runs?: AgentRunRecord[] }).runs ?? []));
    if (initial) setLoading(false);
  }, []);

  useEffect(() => {
    void load(true);
  }, [load]);

  // Poll quietly while any research run is still live, so status indicators and
  // freshly discovered opportunities appear without a manual refresh.
  const hasLiveRun = runs.some(
    (r) => r.status === "running" || r.status === "pending",
  );
  useEffect(() => {
    if (!hasLiveRun) return;
    const timer = setInterval(() => {
      void load(false);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [hasLiveRun, load]);

  async function trigger(body: { profileId?: string; agentType: AgentType }) {
    setRunError(null);
    try {
      const res = await fetch("/api/agents/research", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        setRunError(payload.error ?? "The research run failed. Please try again.");
      }
    } catch {
      setRunError("Could not reach the research agent. Please try again.");
    }
  }

  async function handleRunProfile(profileId: string) {
    setRunningProfileId(profileId);
    await trigger({ profileId, agentType: "corporate_research" });
    setRunningProfileId(null);
    await load(false);
  }

  async function handleRunAll() {
    setRunningAll(true);
    await trigger({ agentType: "corporate_research" });
    setRunningAll(false);
    await load(false);
  }

  async function handleToggleCron(next: boolean) {
    if (!profile) return;
    setCronSaving(true);
    setCronError(null);
    const supabase = createClient();
    const { error: upsertError } = await supabase.from("platform_config").upsert(
      {
        organization_id: profile.organization_id,
        key: "feature.research_agents",
        value: next ? "true" : "false",
      },
      { onConflict: "organization_id,key" },
    );
    if (upsertError) {
      setCronError("Could not update the automation setting. Please try again.");
    } else {
      setCronEnabled(next);
    }
    setCronSaving(false);
  }

  const schedules = computeSchedules(profiles);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-navy-900">
          Research
        </h1>
        <p className="mt-1 text-sm text-navy-500">
          Run your search profiles to discover corporate giving opportunities.
          New finds are scored for eligibility and added to your opportunities.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      <ResearchSchedule
        schedules={schedules}
        cronEnabled={cronEnabled}
        canToggle={canToggle}
        saving={cronSaving}
        toggleError={cronError}
        onToggle={handleToggleCron}
      />

      <ResearchDashboard
        profiles={profiles}
        discoveries={discoveries}
        runs={runs}
        editable={editable}
        runningProfileId={runningProfileId}
        runningAll={runningAll}
        runError={runError}
        isLoading={loading}
        onRunProfile={handleRunProfile}
        onRunAll={handleRunAll}
      />

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-navy-900">Run history</h2>
        <RunHistory runs={history} isLoading={loading} />
      </section>
    </div>
  );
}

/** Project the next scheduled run for each research family from its profiles. */
function computeSchedules(
  profiles: Tables<"search_profiles">[],
): FamilySchedule[] {
  const now = Date.now();
  return RESEARCH_FAMILIES.map((family) => {
    const inScope = profiles.filter(
      (p) =>
        p.is_active &&
        (p.categories ?? []).some((c) =>
          family.categories.includes(c as FunderCategory),
        ),
    );

    if (inScope.length === 0) {
      return {
        agentType: family.agentType,
        label: family.label,
        cadence: family.cadence,
        profileCount: 0,
        nextRunAt: null,
        due: false,
      };
    }

    let due = false;
    let earliestNext = Number.POSITIVE_INFINITY;
    for (const p of inScope) {
      const last = p.last_run_at ? Date.parse(p.last_run_at) : NaN;
      if (!Number.isFinite(last)) {
        due = true; // never run (or unparseable) — due now
        continue;
      }
      const next = last + family.intervalMs;
      if (next <= now) due = true;
      else earliestNext = Math.min(earliestNext, next);
    }

    return {
      agentType: family.agentType,
      label: family.label,
      cadence: family.cadence,
      profileCount: inScope.length,
      nextRunAt:
        due || !Number.isFinite(earliestNext)
          ? null
          : new Date(earliestNext).toISOString(),
      due,
    };
  });
}

/** Normalize an agent_runs row, defaulting a null status to "pending". */
function mapRun(row: AgentRunRow): ResearchRun {
  return {
    id: row.id,
    agent_type: row.agent_type,
    status: row.status ?? "pending",
    output_summary: row.output_summary,
    error_message: row.error_message,
    started_at: row.started_at,
  };
}

/** Flatten an opportunity row (funder relation may arrive as object or array). */
function mapDiscovery(row: OpportunityRow): ResearchDiscovery {
  const funder = Array.isArray(row.funders) ? row.funders[0] : row.funders;
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    amountMin: row.amount_min,
    amountMax: row.amount_max,
    source: row.source,
    discoveredAt: row.discovered_at,
    funderName: funder?.name ?? null,
  };
}
