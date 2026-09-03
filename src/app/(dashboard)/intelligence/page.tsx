"use client";

// Intelligence Hub — module index for every intelligence surface under
// /intelligence. Replaces the old bare redirect to /intelligence/competitors
// with a real grid so the ten modules built across Pillars 1/4/5/6/11/15/18
// and the Phase 2-5 roadmap (AUTONOMOUS_PLATFORM_VISION.md) are actually
// discoverable from one place.
//
// Completeness bars and badge counts are only shown where a real,
// cheap-to-fetch number exists today:
//   - Digital Twin completeness  <- GET /api/intelligence/digital-twin
//   - Reputation alert count     <- GET /api/intelligence/reputation
//   - Learning Network effect   <- GET /api/intelligence/learning-network
//   - Strategic Advisor pending <- GET /api/intelligence/strategic-advisor
//   - Community need signals    <- GET /api/intelligence/community-need
//   - Knowledge corpus size     <- GET /api/intelligence/stats
// Modules without a real per-org metric (Competitor Intelligence, Semantic
// Matches, Funder Recommendations, Disaster Response) render as plain cards
// rather than a fabricated number.

import { useEffect, useState } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  Target,
  Sparkles,
  Search,
  Fingerprint,
  ShieldAlert,
  AlertTriangle,
  Lightbulb,
  Network,
  Compass,
  MapPin,
  FlaskConical,
} from "lucide-react";

// Intelligence & Reports section treatment — PAGE_TREATMENT_PROTOCOL_V2.md /
// DESIGN_SYSTEM_V2_ASSIGNMENT.md. Frame: Plum. Secondary accent: Slate
// Blue. 2026-08-18: confirmed via live getComputedStyle audit this page
// never received the v2 rollout - same real gap as AutoApply's. Each
// module keeps its own distinct identity color (11 genuinely different
// modules), now drawn from the proven v2 accent family instead of the old
// blue/purple/cyan set.
const SECTION_FRAME = "#7A5980";
const CANVAS = "#F0EBE0";
const CARD_BG = "#F8F5EE";
const TEXT_PRIMARY = "#2C4E3B";
const TEXT_SECONDARY = "#64748B";
const TRACK_BG = "rgba(44,78,59,0.08)";
const BADGE_NEUTRAL_BG = "#F1F5F9";
const BADGE_NEUTRAL_TEXT = "#64748B";
const BADGE_ALERT_BG = "#FEE2E2";
const BADGE_ALERT_TEXT = "#DC2626";

type StatKind = "completeness" | "badge" | "info" | "none";

interface ModuleDef {
  key: string;
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
  color: string;
  statKind: StatKind;
}

const MODULES: ModuleDef[] = [
  {
    key: "competitors",
    title: "Competitor Intelligence",
    description: "Organizations competing for the same funding, identified from IRS 990-PF giving history.",
    href: "/intelligence/competitors",
    icon: Target,
    color: "#7A5980",
    statKind: "none",
  },
  {
    key: "matches",
    title: "Funder Matches",
    description: "AI-ranked funders aligned to your mission, programs, and past outcomes.",
    href: "/intelligence/matches",
    icon: Sparkles,
    color: "#4F6D8F",
    statKind: "none",
  },
  {
    key: "recommendations",
    title: "Funder Recommendations",
    description: "Ranked funder matches by geographic fit, program alignment, and award size.",
    href: "/intelligence/recommendations",
    icon: Search,
    color: "#2E6B66",
    statKind: "none",
  },
  {
    key: "twin",
    title: "Organization Profile",
    description: "The AI model of your mission, programs, financials, and proven narrative patterns.",
    href: "/intelligence/twin",
    icon: Fingerprint,
    color: "#7A5980",
    statKind: "completeness",
  },
  {
    key: "reputation",
    title: "Funder & Contact Monitoring",
    description: "Monitors funders and donors for legal, leadership, and financial risk signals.",
    href: "/intelligence/reputation",
    icon: ShieldAlert,
    color: "#DC2626",
    statKind: "badge",
  },
  {
    key: "disaster",
    title: "Disaster Response",
    description: "FEMA disaster declarations matched against emergency funding sources.",
    href: "/intelligence/disaster",
    icon: AlertTriangle,
    color: "#C17817",
    statKind: "none",
  },
  {
    key: "knowledge",
    title: "Funding Knowledge Engine",
    description: "Query a growing corpus of funded proposals and cross-org success patterns.",
    href: "/intelligence/knowledge",
    icon: Lightbulb,
    color: "#7A5980",
    statKind: "info",
  },
  {
    key: "learning-network",
    title: "Global Learning Network",
    description: "How much your org benefits from — and contributes to — the cross-org pattern pool.",
    href: "/intelligence/learning-network",
    icon: Network,
    color: "#4F6D8F",
    statKind: "completeness",
  },
  {
    key: "strategic-advisor",
    title: "Strategic Recommendations",
    description: "A single prioritized action list synthesized from every agent in the roster.",
    href: "/intelligence/strategic-advisor",
    icon: Compass,
    color: "#10B981",
    statKind: "badge",
  },
  {
    key: "community-need",
    title: "Community Need Prediction",
    description: "Census, housing, and employment signals forecasting service demand before it hits.",
    href: "/intelligence/community-need",
    icon: MapPin,
    color: "#B85C3C",
    statKind: "badge",
  },
  {
    key: "simulate",
    title: "Impact Simulator",
    description: "Model what-if scenarios — losing a funder, a budget cut, a new program — before deciding.",
    href: "/intelligence/simulate",
    icon: FlaskConical,
    color: "#5C6935",
    statKind: "none",
  },
];

interface ModuleStat {
  completeness?: number;
  badgeCount?: number;
  badgeAlert?: boolean;
  infoText?: string;
}

async function safeJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export default function IntelligencePage() {
  const [stats, setStats] = useState<Record<string, ModuleStat>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    (async () => {
      const [twin, reputation, learningNetwork, strategicAdvisor, communityNeed, kbStats] =
        await Promise.all([
          safeJson("/api/intelligence/digital-twin"),
          safeJson("/api/intelligence/reputation"),
          safeJson("/api/intelligence/learning-network"),
          safeJson("/api/intelligence/strategic-advisor"),
          safeJson("/api/intelligence/community-need"),
          safeJson("/api/intelligence/stats"),
        ]);

      if (!active) return;

      const next: Record<string, ModuleStat> = {};

      if (twin && typeof twin.twin_completeness_score === "number") {
        next.twin = { completeness: twin.twin_completeness_score };
      }

      if (reputation && Array.isArray(reputation.alerts)) {
        const alerts = reputation.alerts as Array<{
          reputation_signals?: { severity?: string } | Array<{ severity?: string }> | null;
        }>;
        const hasCritical = alerts.some((a) => {
          const sig = Array.isArray(a.reputation_signals) ? a.reputation_signals[0] : a.reputation_signals;
          return sig?.severity === "critical" || sig?.severity === "high";
        });
        next.reputation = { badgeCount: alerts.length, badgeAlert: hasCritical };
      }

      if (
        learningNetwork &&
        typeof learningNetwork.stats === "object" &&
        learningNetwork.stats !== null &&
        typeof (learningNetwork.stats as { networkEffectScore?: unknown }).networkEffectScore === "number"
      ) {
        next["learning-network"] = {
          completeness: (learningNetwork.stats as { networkEffectScore: number }).networkEffectScore,
        };
      }

      if (strategicAdvisor && Array.isArray(strategicAdvisor.recommendations)) {
        const recs = strategicAdvisor.recommendations as Array<{ urgency?: string }>;
        const hasUrgent = recs.some((r) => r.urgency === "immediate" || r.urgency === "urgent");
        next["strategic-advisor"] = { badgeCount: recs.length, badgeAlert: hasUrgent };
      }

      if (communityNeed && Array.isArray(communityNeed.signals)) {
        const signals = communityNeed.signals as Array<{ severity?: string | null }>;
        const hasCritical = signals.some((s) => s.severity === "critical" || s.severity === "high");
        next["community-need"] = { badgeCount: signals.length, badgeAlert: hasCritical };
      }

      if (kbStats && typeof kbStats.funded_proposals_count === "number") {
        next.knowledge = {
          infoText: `${(kbStats.funded_proposals_count as number).toLocaleString()} proposals indexed`,
        };
      }

      setStats(next);
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="min-h-screen p-6" style={{ backgroundColor: CANVAS }}>
      <div className="mb-8" style={{ borderLeft: `4px solid ${SECTION_FRAME}`, paddingLeft: "1rem" }}>
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: TEXT_PRIMARY }}>
          Intelligence Hub
        </h1>
        <p className="mt-1 text-sm" style={{ color: TEXT_SECONDARY }}>
          Every intelligence module in one place — completeness, alerts, and predictions across your organization.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MODULES.map((mod) => {
          const stat = stats[mod.key];
          const Icon = mod.icon;

          return (
            <Link
              key={mod.key}
              href={mod.href}
              className="block transition-shadow hover:shadow-lg"
              style={{
                backgroundColor: SECTION_FRAME,
                borderRadius: "14px",
                boxShadow: "0 4px 20px rgba(122,89,128,0.22)",
                padding: "3px",
              }}
            >
            <div className="rounded-[11px] p-5" style={{ backgroundColor: CARD_BG }}>
              <div className="flex items-start justify-between gap-3">
                <div
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg"
                  style={{ backgroundColor: `${mod.color}1A` }}
                >
                  <Icon className="h-5 w-5" style={{ color: mod.color }} aria-hidden />
                </div>

                {mod.statKind === "badge" && (
                  <span
                    className="rounded-full px-2.5 py-1 text-xs font-bold"
                    style={{
                      backgroundColor: stat?.badgeAlert ? BADGE_ALERT_BG : BADGE_NEUTRAL_BG,
                      color: stat?.badgeAlert ? BADGE_ALERT_TEXT : BADGE_NEUTRAL_TEXT,
                    }}
                  >
                    {loading ? "…" : (stat?.badgeCount ?? 0)}
                  </span>
                )}
              </div>

              <h3 className="mt-3 text-base font-semibold" style={{ color: TEXT_PRIMARY }}>
                {mod.title}
              </h3>
              <p className="mt-1 text-sm" style={{ color: TEXT_SECONDARY }}>
                {mod.description}
              </p>

              {mod.statKind === "completeness" && (
                <div className="mt-4">
                  <div className="flex items-center justify-between text-xs" style={{ color: TEXT_SECONDARY }}>
                    <span>Completeness</span>
                    <span style={{ color: mod.color, fontWeight: 700 }}>
                      {loading || stat?.completeness === undefined ? "—" : `${stat.completeness}%`}
                    </span>
                  </div>
                  <div
                    className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full"
                    style={{ backgroundColor: TRACK_BG }}
                  >
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${loading ? 0 : (stat?.completeness ?? 0)}%`,
                        backgroundColor: mod.color,
                      }}
                    />
                  </div>
                </div>
              )}

              {mod.statKind === "info" && stat?.infoText && (
                <p className="mt-4 text-xs font-semibold" style={{ color: mod.color }}>
                  {stat.infoText}
                </p>
              )}
            </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
