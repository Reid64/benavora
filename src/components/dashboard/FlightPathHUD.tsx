"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  ClipboardCheck,
  HeartHandshake,
  PenLine,
  Search,
  Send,
  Target,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { formatRelative } from "@/lib/utils/formatters";

type StageId =
  | "onboard"
  | "research"
  | "opportunities"
  | "narratives"
  | "autoapply"
  | "donorDiscovery";

type StageData = {
  /** Live count for the front-face badge, or null while loading/unavailable. */
  count: number | null;
  /** ISO timestamp of the most recent activity in this stage, or null. */
  lastActivity: string | null;
  /** 0-100 completion percentage for the back-face progress bar. */
  percent: number;
};

type StageConfig = {
  id: StageId;
  label: string;
  icon: LucideIcon;
  accentColor: string;
  href: string;
  actionLabel: string;
};

const STAGES: StageConfig[] = [
  {
    id: "onboard",
    label: "Onboard",
    icon: ClipboardCheck,
    accentColor: "#0077B6",
    href: "/onboarding",
    actionLabel: "Continue Setup",
  },
  {
    id: "research",
    label: "Research",
    icon: Search,
    accentColor: "#7C3AED",
    href: "/research",
    actionLabel: "Run Research",
  },
  {
    id: "opportunities",
    label: "Opportunities",
    icon: Target,
    accentColor: "#F59E0B",
    href: "/opportunities",
    actionLabel: "View Opportunities",
  },
  {
    id: "narratives",
    label: "Grant Narratives",
    icon: PenLine,
    accentColor: "#10B981",
    href: "/draft-generator",
    actionLabel: "Generate Drafts",
  },
  {
    id: "autoapply",
    label: "AutoApply",
    icon: Send,
    accentColor: "#00B4D8",
    href: "/admin/autoapply-ops",
    actionLabel: "View Queue",
  },
  {
    id: "donorDiscovery",
    label: "Donor Discovery",
    icon: HeartHandshake,
    accentColor: "#EF4444",
    href: "/donor-discovery",
    actionLabel: "Discover Donors",
  },
];

const EMPTY_STAGE_DATA: StageData = { count: null, lastActivity: null, percent: 0 };

const EMPTY_STATE: Record<StageId, StageData> = {
  onboard: EMPTY_STAGE_DATA,
  research: EMPTY_STAGE_DATA,
  opportunities: EMPTY_STAGE_DATA,
  narratives: EMPTY_STAGE_DATA,
  autoapply: EMPTY_STAGE_DATA,
  donorDiscovery: EMPTY_STAGE_DATA,
};

type OnboardingResponse = {
  completed: boolean;
  progress: { completed_steps?: string[] } | null;
};

async function fetchOnboard(): Promise<StageData> {
  try {
    const res = await fetch("/api/onboarding", { cache: "no-store" });
    if (!res.ok) return EMPTY_STAGE_DATA;
    const data = (await res.json()) as OnboardingResponse;
    const completedSteps = data.progress?.completed_steps?.length ?? 0;
    const percent = data.completed ? 100 : Math.round((completedSteps / 7) * 100);
    return { count: completedSteps, lastActivity: null, percent };
  } catch {
    return EMPTY_STAGE_DATA;
  }
}

type ResearchRun = { status: string; created_at: string };
type ResearchStatusResponse = { runs: ResearchRun[] };

async function fetchResearch(): Promise<StageData> {
  try {
    const res = await fetch("/api/agents/research/status?limit=50", { cache: "no-store" });
    if (!res.ok) return EMPTY_STAGE_DATA;
    const data = (await res.json()) as ResearchStatusResponse;
    const runs = data.runs ?? [];
    const completed = runs.filter((r) => r.status === "completed").length;
    const percent = runs.length > 0 ? Math.round((completed / runs.length) * 100) : 0;
    return {
      count: runs.length,
      lastActivity: runs[0]?.created_at ?? null,
      percent,
    };
  } catch {
    return EMPTY_STAGE_DATA;
  }
}

async function fetchOpportunities(
  supabase: ReturnType<typeof createClient>,
): Promise<StageData> {
  try {
    const [totalRes, scoredRes, recentRes] = await Promise.all([
      supabase.from("opportunities").select("id", { count: "exact", head: true }),
      supabase
        .from("opportunities")
        .select("id", { count: "exact", head: true })
        .not("eligibility_score", "is", null),
      supabase
        .from("opportunities")
        .select("discovered_at")
        .order("discovered_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const total = totalRes.count ?? 0;
    const scored = scoredRes.count ?? 0;
    const percent = total > 0 ? Math.round((scored / total) * 100) : 0;
    return {
      count: total,
      lastActivity: (recentRes.data as { discovered_at: string } | null)?.discovered_at ?? null,
      percent,
    };
  } catch {
    return EMPTY_STAGE_DATA;
  }
}

async function fetchNarratives(
  supabase: ReturnType<typeof createClient>,
): Promise<StageData> {
  try {
    const [totalRes, draftedRes, recentRes] = await Promise.all([
      supabase.from("applications").select("id", { count: "exact", head: true }),
      supabase
        .from("applications")
        .select("id", { count: "exact", head: true })
        .not("draft_content", "is", null),
      supabase
        .from("applications")
        .select("updated_at")
        .not("draft_content", "is", null)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const total = totalRes.count ?? 0;
    const drafted = draftedRes.count ?? 0;
    const percent = total > 0 ? Math.round((drafted / total) * 100) : 0;
    return {
      count: drafted,
      lastActivity: (recentRes.data as { updated_at: string } | null)?.updated_at ?? null,
      percent,
    };
  } catch {
    return EMPTY_STAGE_DATA;
  }
}

type AutomationStatsResponse = {
  stats: Record<string, number>;
  daily: { used: number; limit: number };
};

async function fetchAutoApply(): Promise<StageData> {
  try {
    const res = await fetch("/api/automation/stats", { cache: "no-store" });
    if (!res.ok) return EMPTY_STAGE_DATA;
    const data = (await res.json()) as AutomationStatsResponse;
    const active = (data.stats.queued ?? 0) + (data.stats.processing ?? 0);
    const percent =
      data.daily.limit > 0
        ? Math.min(100, Math.round((data.daily.used / data.daily.limit) * 100))
        : 0;
    return { count: active, lastActivity: null, percent };
  } catch {
    return EMPTY_STAGE_DATA;
  }
}

type DdProspectsResponse = { total: number };
type DdRequestsResponse = { requests: Array<{ status: string; created_at: string }>; total: number };

async function fetchDonorDiscovery(): Promise<StageData> {
  try {
    const [prospectsRes, requestsRes] = await Promise.all([
      fetch("/api/donor-discovery/prospects?limit=1", { cache: "no-store" }),
      fetch("/api/donor-discovery/requests?limit=25", { cache: "no-store" }),
    ]);

    const prospects = prospectsRes.ok
      ? ((await prospectsRes.json()) as DdProspectsResponse)
      : { total: 0 };
    const requestsData = requestsRes.ok
      ? ((await requestsRes.json()) as DdRequestsResponse)
      : { requests: [], total: 0 };

    const requests = requestsData.requests ?? [];
    const completeCount = requests.filter((r) => r.status === "complete").length;
    const percent = requests.length > 0 ? Math.round((completeCount / requests.length) * 100) : 0;

    return {
      count: prospects.total ?? 0,
      lastActivity: requests[0]?.created_at ?? null,
      percent,
    };
  } catch {
    return EMPTY_STAGE_DATA;
  }
}

async function loadAllStages(
  supabase: ReturnType<typeof createClient>,
): Promise<Record<StageId, StageData>> {
  const [onboard, research, opportunities, narratives, autoapply, donorDiscovery] =
    await Promise.all([
      fetchOnboard(),
      fetchResearch(),
      fetchOpportunities(supabase),
      fetchNarratives(supabase),
      fetchAutoApply(),
      fetchDonorDiscovery(),
    ]);

  return { onboard, research, opportunities, narratives, autoapply, donorDiscovery };
}

/**
 * Mission Control lifecycle HUD (DONOR_DISCOVERY_ARCHITECTURE.md nav order):
 * six flip cards, one per pipeline stage, each showing a live count on the
 * front and last-activity/completion/quick-action on the back. Data is
 * fetched client-side from each stage's existing API route (or a direct
 * Supabase count for the two stages — Opportunities, Grant Narratives —
 * that have no dedicated route), matching the read pattern already used on
 * the Donor Discovery Overview page.
 */
export function FlightPathHUD() {
  const [data, setData] = useState<Record<StageId, StageData>>(EMPTY_STATE);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    void loadAllStages(supabase).then((result) => {
      if (!cancelled) {
        setData(result);
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
      {STAGES.map((stage) => {
        const stageData = data[stage.id];
        const badge = loading ? "—" : (stageData.count ?? "—");

        return (
          <div
            key={stage.id}
            className="relative h-36 cursor-pointer perspective-1000 group"
            style={{
              backgroundColor: "#FFFFFF",
              borderRadius: "12px",
              padding: "20px",
              boxShadow: "0 4px 16px rgba(0,0,0,0.10)",
              border: "1px solid #B8C9D9",
            }}
          >
            <div className="relative h-full w-full preserve-3d transition-transform duration-500 group-hover:rotate-y-180">
              {/* Front face */}
              <Link
                href={stage.href}
                className="absolute inset-0 flex flex-col items-center justify-center backface-hidden overflow-hidden"
                style={{
                  backgroundColor: "#FFFFFF",
                  borderRadius: "12px",
                  padding: "20px",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.10)",
                  border: "1px solid #B8C9D9",
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    color: "#00B4D8",
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    marginBottom: "8px",
                  }}
                >
                  {stage.label}
                </div>
                <div style={{ fontSize: "28px", fontWeight: 900, color: "#0F172A" }}>
                  {badge}
                </div>
              </Link>

              {/* Back face */}
              <div className="absolute inset-0 rounded-lg bg-[#0A0E1A] flex flex-col items-center justify-center backface-hidden rotate-y-180 p-4">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-white/60">
                  Last Activity
                </p>
                <p className="text-xs font-medium text-white mt-0.5">
                  {loading ? "—" : formatRelative(stageData.lastActivity)}
                </p>

                <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/15">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${loading ? 0 : stageData.percent}%`,
                      backgroundColor: stage.accentColor,
                    }}
                  />
                </div>
                <p className="mt-1 text-[10px] text-white/60">
                  {loading ? "—" : `${stageData.percent}% complete`}
                </p>

                <Link
                  href={stage.href}
                  className="text-white px-3 py-1.5 rounded-md text-xs font-semibold mt-2"
                  style={{ backgroundColor: stage.accentColor }}
                >
                  {stage.actionLabel}
                </Link>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
