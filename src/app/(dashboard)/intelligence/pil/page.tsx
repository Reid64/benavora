"use client";

// Prospect Intelligence Layer (PIL) hub — src/lib/pil/types.ts mirrors
// supabase/migrations/150-163_pil_*.sql; every stat below is read from a real
// PIL API route, never fabricated. Two stats (active research runs, agents
// currently running) needed a small additive change to the underlying routes
// — see the header comments in src/app/api/pil/research/route.ts and
// src/app/api/pil/agents/route.ts — because the original routes had no way
// to list runs or report in-flight agent state at all.
//
// Colors per governance/DESIGN_SYSTEM.md's PIL section assignment: Navy
// #101B2D, Gold #B88A2E, Plum #5B21B6. Inline hex only, no Tailwind color
// classes.

import { useEffect, useState } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Bot, DollarSign, ScanSearch, ShieldQuestion, Users } from "lucide-react";

import { formatCurrency } from "@/lib/utils/formatters";
import type { AgentDefinition, CostBudget, HumanReviewItem, Prospect, ResearchRun } from "@/lib/pil/types";

const NAVY = "#101B2D";
const GOLD = "#B88A2E";
const PLUM = "#5B21B6";
const CANVAS = "#D8D3C8";
const CARD_BG = "#F8F5EE";
const TEXT_SECONDARY = "#64748B";

const ACTIVE_RESEARCH_STATUSES = new Set(["planning", "running"]);
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

async function safeJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

interface HubStat {
  key: string;
  label: string;
  value: string;
  description: string;
  href: string;
  icon: LucideIcon;
  accent: string;
}

export default function PilHubPage() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<HubStat[] | null>(null);

  useEffect(() => {
    let active = true;

    (async () => {
      const [agentsPayload, costPayload, prospectsPayload, reviewPayload, researchPayload] =
        await Promise.all([
          safeJson<{ agents: AgentDefinition[]; runningAgentIds: string[] }>("/api/pil/agents"),
          safeJson<{ budgets: CostBudget[] }>("/api/pil/cost/summary"),
          safeJson<{ prospects: Prospect[] }>("/api/pil/prospects"),
          safeJson<{ items: HumanReviewItem[] }>("/api/pil/review-queue?status=pending"),
          safeJson<{ runs: ResearchRun[] }>("/api/pil/research"),
        ]);

      if (!active) return;

      const runs = researchPayload?.runs ?? [];
      const activeRuns = runs.filter((r) => ACTIVE_RESEARCH_STATUSES.has(r.status)).length;

      const prospects = prospectsPayload?.prospects ?? [];
      const weekAgo = Date.now() - WEEK_MS;
      const discoveredThisWeek = prospects.filter(
        (p) => new Date(p.created_at).getTime() >= weekAgo,
      ).length;

      const runningAgents = agentsPayload?.runningAgentIds.length ?? 0;

      const monthlyBudget = (costPayload?.budgets ?? []).find(
        (b) => b.scope_type === "org" && b.budget_period === "monthly",
      );

      const reviewDepth = reviewPayload?.items.length ?? 0;

      setStats([
        {
          key: "research",
          label: "Active Research Runs",
          value: String(activeRuns),
          description: "Planning or running right now",
          href: "/intelligence/pil/research",
          icon: ScanSearch,
          accent: PLUM,
        },
        {
          key: "prospects",
          label: "Prospects Discovered This Week",
          value: String(discoveredThisWeek),
          description: "New pil_prospects rows in the last 7 days",
          href: "/intelligence/pil/prospects",
          icon: Users,
          accent: GOLD,
        },
        {
          key: "agents",
          label: "Agents Currently Running",
          value: String(runningAgents),
          description: `of ${agentsPayload?.agents.length ?? 0} registered agents`,
          href: "/intelligence/pil/agents",
          icon: Bot,
          accent: NAVY,
        },
        {
          key: "budget",
          label: "Budget Consumed This Month",
          value: monthlyBudget ? formatCurrency(monthlyBudget.spent_usd) : "No budget set",
          description: monthlyBudget
            ? `of ${formatCurrency(monthlyBudget.budget_limit_usd)} limit`
            : "No monthly org budget configured",
          href: "/intelligence/pil/agents",
          icon: DollarSign,
          accent: GOLD,
        },
        {
          key: "review-queue",
          label: "Human Review Queue Depth",
          value: String(reviewDepth),
          description: "Pending human review items",
          href: "/intelligence/pil/review-queue",
          icon: ShieldQuestion,
          accent: PLUM,
        },
      ]);
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="min-h-screen p-6" style={{ backgroundColor: CANVAS }}>
      <div className="mb-8" style={{ borderLeft: `4px solid ${PLUM}`, paddingLeft: "1rem" }}>
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: NAVY }}>
          Prospect Intelligence Layer
        </h1>
        <p className="mt-1 text-sm" style={{ color: TEXT_SECONDARY }}>
          Autonomous prospect research, evidence, and human review — one place to watch the whole
          pipeline.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(loading || !stats ? Array.from({ length: 5 }) : stats).map((stat, i) => {
          if (!stat || typeof stat !== "object" || !("key" in stat)) {
            return (
              <div
                key={i}
                className="animate-pulse rounded-[14px] p-5"
                style={{ backgroundColor: CARD_BG, height: "128px" }}
              />
            );
          }
          const s = stat as HubStat;
          const Icon = s.icon;
          return (
            <Link
              key={s.key}
              href={s.href}
              className="block transition-shadow hover:shadow-lg"
              style={{
                backgroundColor: s.accent,
                borderRadius: "14px",
                boxShadow: `0 4px 20px ${s.accent}38`,
                padding: "3px",
              }}
            >
              <div className="rounded-[11px] p-5" style={{ backgroundColor: CARD_BG }}>
                <div
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg"
                  style={{ backgroundColor: `${s.accent}1A` }}
                >
                  <Icon className="h-5 w-5" style={{ color: s.accent }} aria-hidden />
                </div>
                <p className="mt-3 text-2xl font-bold" style={{ color: NAVY }}>
                  {s.value}
                </p>
                <h3 className="mt-1 text-sm font-semibold" style={{ color: NAVY }}>
                  {s.label}
                </h3>
                <p className="mt-1 text-xs" style={{ color: TEXT_SECONDARY }}>
                  {s.description}
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
