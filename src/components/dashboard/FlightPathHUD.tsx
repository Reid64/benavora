"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { createClient } from "@/lib/supabase/client";

type StageId =
  | "onboard"
  | "research"
  | "opportunities"
  | "narratives"
  | "autoapply"
  | "donorDiscovery";

type StageConfig = {
  id: StageId;
  number: string;
  label: string;
  color: string;
  href: string;
};

const STAGES: StageConfig[] = [
  { id: "onboard", number: "01", label: "Onboard", color: "#06B6D4", href: "/onboarding" },
  { id: "research", number: "02", label: "Research", color: "#0EA5E9", href: "/research" },
  { id: "opportunities", number: "03", label: "Opportunities", color: "#8B5CF6", href: "/opportunities" },
  { id: "narratives", number: "04", label: "Grant Narratives", color: "#F59E0B", href: "/draft-generator" },
  { id: "autoapply", number: "05", label: "AutoApply", color: "#10B981", href: "/admin/autoapply-ops" },
  { id: "donorDiscovery", number: "06", label: "Donor Discovery", color: "#EC4899", href: "/donor-discovery" },
];

const EMPTY_COUNTS: Record<StageId, number> = {
  onboard: 0,
  research: 0,
  opportunities: 0,
  narratives: 0,
  autoapply: 0,
  donorDiscovery: 0,
};

type OnboardingResponse = {
  completed: boolean;
  progress: { completed_steps?: string[] } | null;
};

async function fetchOnboardCount(): Promise<number> {
  try {
    const res = await fetch("/api/onboarding", { cache: "no-store" });
    if (!res.ok) return 0;
    const data = (await res.json()) as OnboardingResponse;
    return data.progress?.completed_steps?.length ?? 0;
  } catch {
    return 0;
  }
}

type ResearchStatusResponse = { runs: Array<{ status: string }> };

async function fetchResearchCount(): Promise<number> {
  try {
    const res = await fetch("/api/agents/research/status?limit=50", { cache: "no-store" });
    if (!res.ok) return 0;
    const data = (await res.json()) as ResearchStatusResponse;
    return data.runs?.length ?? 0;
  } catch {
    return 0;
  }
}

async function fetchOpportunitiesCount(
  supabase: ReturnType<typeof createClient>,
): Promise<number> {
  try {
    const { count } = await supabase
      .from("opportunities")
      .select("id", { count: "exact", head: true });
    return count ?? 0;
  } catch {
    return 0;
  }
}

async function fetchNarrativesCount(
  supabase: ReturnType<typeof createClient>,
): Promise<number> {
  try {
    const { count } = await supabase
      .from("applications")
      .select("id", { count: "exact", head: true })
      .not("draft_content", "is", null);
    return count ?? 0;
  } catch {
    return 0;
  }
}

type AutomationStatsResponse = { stats: Record<string, number> };

async function fetchAutoApplyCount(): Promise<number> {
  try {
    const res = await fetch("/api/automation/stats", { cache: "no-store" });
    if (!res.ok) return 0;
    const data = (await res.json()) as AutomationStatsResponse;
    return (data.stats.queued ?? 0) + (data.stats.processing ?? 0);
  } catch {
    return 0;
  }
}

type DdProspectsResponse = { total: number };

async function fetchDonorDiscoveryCount(): Promise<number> {
  try {
    const res = await fetch("/api/donor-discovery/prospects?limit=1", { cache: "no-store" });
    if (!res.ok) return 0;
    const data = (await res.json()) as DdProspectsResponse;
    return data.total ?? 0;
  } catch {
    return 0;
  }
}

async function loadAllStageCounts(
  supabase: ReturnType<typeof createClient>,
): Promise<Record<StageId, number>> {
  const [onboard, research, opportunities, narratives, autoapply, donorDiscovery] =
    await Promise.all([
      fetchOnboardCount(),
      fetchResearchCount(),
      fetchOpportunitiesCount(supabase),
      fetchNarrativesCount(supabase),
      fetchAutoApplyCount(),
      fetchDonorDiscoveryCount(),
    ]);

  return { onboard, research, opportunities, narratives, autoapply, donorDiscovery };
}

interface FlightPathHUDProps {
  stageCounts?: Record<string, number>;
  activeStage?: string;
}

export function FlightPathHUD({ stageCounts, activeStage }: FlightPathHUDProps) {
  const [liveCounts, setLiveCounts] = useState<Record<StageId, number>>(EMPTY_COUNTS);
  const [loading, setLoading] = useState(!stageCounts);

  useEffect(() => {
    if (stageCounts) return;

    let cancelled = false;
    const supabase = createClient();

    void loadAllStageCounts(supabase).then((result) => {
      if (!cancelled) {
        setLiveCounts(result);
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [stageCounts]);

  return (
    <div
      id="tour-flightpath-hud"
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "16px",
        marginBottom: "32px",
      }}
    >
      {STAGES.map((stage) => {
        const count = stageCounts
          ? (stageCounts[stage.id] ?? 0)
          : loading
            ? null
            : liveCounts[stage.id];
        const isActive = activeStage === stage.id;

        return (
          <Link
            key={stage.id}
            href={stage.href}
            style={{
              display: "block",
              textDecoration: "none",
              minWidth: "200px",
              flex: "1 1 200px",
              height: "160px",
              backgroundColor: "#FFFFFF",
              borderRadius: "14px",
              boxShadow: isActive
                ? `0 4px 20px ${stage.color}55`
                : "0 4px 16px rgba(0,0,0,0.10)",
              border: isActive ? `1px solid ${stage.color}` : "1px solid transparent",
              overflow: "hidden",
              position: "relative",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                height: "4px",
                backgroundColor: stage.color,
              }}
            />
            <div
              style={{
                padding: "20px",
                height: "100%",
                boxSizing: "border-box",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: stage.color,
                    marginBottom: "8px",
                  }}
                >
                  {stage.number}
                </div>
                <div
                  style={{
                    fontSize: "15px",
                    fontWeight: 700,
                    color: "#2C4E3B",
                  }}
                >
                  {stage.label}
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div
                  style={{
                    fontSize: "13px",
                    fontWeight: 700,
                    color: "#FFFFFF",
                    backgroundColor: stage.color,
                    borderRadius: "999px",
                    padding: "3px 12px",
                  }}
                >
                  {count === null ? "—" : count}
                </div>
                <span
                  style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    color: stage.color,
                  }}
                >
                  View All
                </span>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
