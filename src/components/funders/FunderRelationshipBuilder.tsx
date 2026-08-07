"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Link2,
  Sparkles,
} from "lucide-react";

import { Badge, Button, Card, LoadingSpinner } from "@/components/ui";
import type { BadgeColor } from "@/components/ui";
import { canEdit, useProfile } from "@/lib/hooks/useProfile";
import { formatRelative } from "@/lib/utils/formatters";

// Gen-1 event-sourced score (src/lib/intelligence/relationship-scorer.ts,
// via the existing, untouched /api/funders/[id]/relationship route). Real
// response shape is { funderId, score, momentum } — no trend/isStale fields
// (those belong to a different table's, FunderDetail.tsx's, currently-buggy
// read, not this route).
type Gen1Score = {
  funderId: string;
  score: number;
  momentum: "rising" | "stable" | "declining";
} | null;

type Recommendation = {
  id: string;
  recommendation_text: string;
  urgency: "urgent" | "normal" | "low";
  status: string;
  created_at: string;
} | null;

type Decision = {
  id: string;
  decision_type: string;
  reasoning: string;
  action_taken: string;
  action_payload: Record<string, unknown> | null;
  confidence_score: number | null;
  required_human_review: boolean;
  created_at: string;
};

type DirectConnection = {
  relationshipType: string;
  evidence: string | null;
  weight: number | null;
  connectedToLabel: string;
  connectedToType: string | null;
};

type AgentSlice = {
  funderId: string;
  funderName: string;
  tablesAvailable: boolean;
  message: string | null;
  recommendation: Recommendation;
  decisions: Decision[];
  hasGraphNode: boolean;
  directConnections: DirectConnection[];
  runSummary?: {
    itemsFound: number;
    itemsProcessed: number;
    itemsQueued: number;
    errors: string[];
  };
};

export type FunderRelationshipBuilderProps = {
  funderId: string;
};

const URGENCY_COLOR: Record<"urgent" | "normal" | "low", BadgeColor> = {
  urgent: "red",
  normal: "blue",
  low: "gray",
};

function TrendBadge({ score }: { score: NonNullable<Gen1Score> }) {
  const TrendIcon =
    score.momentum === "rising"
      ? ArrowUp
      : score.momentum === "declining"
        ? ArrowDown
        : ArrowRight;
  const trendColor =
    score.momentum === "rising"
      ? "text-green-600"
      : score.momentum === "declining"
        ? "text-red-600"
        : "text-navy-400";

  return (
    <div className="flex items-center gap-1.5 rounded-full border border-navy-200 bg-white px-3 py-1 text-sm">
      <span className="font-semibold text-navy-800">{score.score}</span>
      <span className="text-navy-400">/100</span>
      <TrendIcon className={`h-3.5 w-3.5 ${trendColor}`} aria-hidden />
    </div>
  );
}

function DecisionCard({ decision }: { decision: Decision }) {
  const payload = decision.action_payload ?? {};
  const memberName =
    typeof payload.memberName === "string" ? payload.memberName : null;
  const hopCount =
    typeof payload.hopCount === "number" ? payload.hopCount : null;
  const emailSubject =
    typeof payload.emailSubject === "string" ? payload.emailSubject : null;

  const label =
    decision.decision_type === "introduction_path_queued"
      ? "Warm introduction path"
      : decision.decision_type === "funder_officer_researched"
        ? "Officer research"
        : "Relationship recommendation";

  return (
    <div className="rounded-lg border border-navy-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-navy-400">
          {label}
        </span>
        <span className="text-xs text-navy-400">
          {formatRelative(decision.created_at)}
        </span>
      </div>

      {decision.decision_type === "introduction_path_queued" ? (
        <div className="mt-2 space-y-1.5">
          <p className="flex items-center gap-1.5 text-sm text-navy-700">
            <Link2 className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
            {decision.action_taken}
          </p>
          <div className="flex flex-wrap gap-2 text-xs text-navy-500">
            {memberName && <span>Board contact: {memberName}</span>}
            {hopCount !== null && (
              <span>
                {hopCount === 1 ? "Direct connection" : `${hopCount}-hop path`}
              </span>
            )}
            {emailSubject && <span>Draft subject: &ldquo;{emailSubject}&rdquo;</span>}
          </div>
          {decision.required_human_review && (
            <p className="flex items-center gap-1 text-xs text-yellow-700">
              <AlertTriangle className="h-3 w-3" aria-hidden />
              Requires human review before any outreach is sent.
            </p>
          )}
        </div>
      ) : (
        <p className="mt-2 text-sm text-navy-700">{decision.reasoning}</p>
      )}

      {decision.confidence_score !== null && (
        <p className="mt-1.5 text-xs text-navy-400">
          Confidence: {decision.confidence_score}/100
        </p>
      )}
    </div>
  );
}

/**
 * AG-19 RelationshipBuilderAgent output for one funder (registry #101),
 * shown alongside the existing Gen-1 event-sourced score (unchanged
 * /api/funders/[id]/relationship route). This is the first UI wiring AG-19
 * has ever had outside its own file — running it here calls the real agent
 * (real Claude spend, real writes), it is not a mock or "coming soon" panel.
 */
export function FunderRelationshipBuilder({
  funderId,
}: FunderRelationshipBuilderProps) {
  const { profile } = useProfile();
  const [gen1, setGen1] = useState<Gen1Score>(null);
  const [gen1Error, setGen1Error] = useState<string | null>(null);
  const [agentSlice, setAgentSlice] = useState<AgentSlice | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const loadGen1 = useCallback(async () => {
    try {
      const res = await fetch(`/api/funders/${funderId}/relationship`);
      if (!res.ok) {
        setGen1(null);
        setGen1Error("Could not load the existing relationship score.");
        return;
      }
      const data = await res.json();
      setGen1({
        funderId: data.funderId,
        score: data.score,
        momentum: data.momentum ?? "stable",
      });
      setGen1Error(null);
    } catch {
      setGen1(null);
      setGen1Error("Could not load the existing relationship score.");
    }
  }, [funderId]);

  const loadAgentSlice = useCallback(async () => {
    const res = await fetch(`/api/funders/${funderId}/relationship-builder`);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error ?? "Could not load Relationship Builder data.");
    }
    const data: AgentSlice = await res.json();
    setAgentSlice(data);
  }, [funderId]);

  const load = useCallback(async () => {
    setLoading(true);
    await Promise.all([
      loadGen1(),
      loadAgentSlice().catch((err) => {
        setAgentSlice(null);
        setRunError(err instanceof Error ? err.message : "Failed to load.");
      }),
    ]);
    setLoading(false);
  }, [loadGen1, loadAgentSlice]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRun = useCallback(async () => {
    setRunning(true);
    setRunError(null);
    try {
      const res = await fetch(`/api/funders/${funderId}/relationship-builder`, {
        method: "POST",
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.error ?? "Relationship Builder run failed.");
      }
      setAgentSlice(body as AgentSlice);
    } catch (err) {
      setRunError(
        err instanceof Error ? err.message : "Relationship Builder run failed.",
      );
    } finally {
      setRunning(false);
    }
  }, [funderId]);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner />
      </div>
    );
  }

  const funderName = agentSlice?.funderName ?? "";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-primary">
          {funderName ? `${funderName} — Relationship` : "Relationship"}
        </h1>
        <p className="mt-1 text-sm text-navy-500">
          Existing event-sourced score alongside AG-19&apos;s deterministic
          scoring, recommendations, and warm-introduction paths.
        </p>
      </div>

      {/* Gen-1 event-sourced score — unchanged existing route */}
      <Card className="p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-navy-400">
            Relationship Score
          </h2>
          {gen1 && <TrendBadge score={gen1} />}
        </div>
        {gen1Error && (
          <p className="mt-2 text-sm text-navy-400">{gen1Error}</p>
        )}
        {!gen1 && !gen1Error && (
          <p className="mt-2 text-sm text-navy-400">
            No relationship events recorded yet.
          </p>
        )}
      </Card>

      {/* AG-19 RelationshipBuilderAgent output */}
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-navy-400">
              Relationship Builder (AG-19)
            </h2>
            <p className="mt-0.5 text-xs text-navy-400">
              Runs a full org-wide pass (every funder, not just this one) each
              time it&apos;s triggered.
            </p>
          </div>
          {canEdit(profile?.role) && (
            <Button
              variant="secondary"
              onClick={() => void handleRun()}
              isLoading={running}
              disabled={running}
            >
              <Sparkles className="mr-1.5 h-4 w-4" aria-hidden />
              Run Relationship Analysis
            </Button>
          )}
        </div>

        {runError && (
          <p className="mt-3 text-sm text-red-600">{runError}</p>
        )}

        {agentSlice?.runSummary && (
          <p className="mt-3 text-xs text-navy-400">
            Last run: {agentSlice.runSummary.itemsProcessed} funder(s)
            scored, {agentSlice.runSummary.itemsQueued} recommendation(s)/path(s)
            queued
            {agentSlice.runSummary.errors.length > 0 &&
              ` (${agentSlice.runSummary.errors.length} error(s) — see decision log below)`}
            .
          </p>
        )}

        {agentSlice && !agentSlice.tablesAvailable && (
          <p className="mt-3 flex items-center gap-1.5 text-sm text-yellow-700">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
            {agentSlice.message}
          </p>
        )}

        {agentSlice?.tablesAvailable && (
          <div className="mt-4 space-y-5">
            {/* Recommendation */}
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-navy-400">
                Recommendation
              </h3>
              {agentSlice.recommendation ? (
                <div className="mt-2 rounded-lg border border-navy-200 bg-white p-3">
                  <div className="flex items-center justify-between gap-2">
                    <Badge color={URGENCY_COLOR[agentSlice.recommendation.urgency]}>
                      {agentSlice.recommendation.urgency}
                    </Badge>
                    <span className="text-xs text-navy-400">
                      {formatRelative(agentSlice.recommendation.created_at)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-navy-700">
                    {agentSlice.recommendation.recommendation_text}
                  </p>
                </div>
              ) : (
                <p className="mt-2 text-sm text-navy-400">
                  No recommendation yet — either the relationship score is
                  below the recommendation threshold, or Relationship
                  Analysis hasn&apos;t been run yet.
                </p>
              )}
            </div>

            {/* Warm-introduction paths / decision log */}
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-navy-400">
                Warm-Introduction Paths &amp; Decision Log
              </h3>
              {agentSlice.decisions.length > 0 ? (
                <div className="mt-2 space-y-2">
                  {agentSlice.decisions.map((d) => (
                    <DecisionCard key={d.id} decision={d} />
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-sm text-navy-400">
                  No warm-introduction paths found yet. Board-member pathfinding
                  only runs when relationship analysis is enabled in autonomous
                  settings — run the analysis above to check.
                </p>
              )}
            </div>

            {/* Direct graph connections */}
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-navy-400">
                Direct Graph Connections
              </h3>
              {agentSlice.hasGraphNode ? (
                agentSlice.directConnections.length > 0 ? (
                  <ul className="mt-2 space-y-1.5">
                    {agentSlice.directConnections.map((c, i) => (
                      <li
                        key={i}
                        className="flex items-center gap-2 rounded-lg border border-navy-200 bg-white px-3 py-2 text-sm text-navy-700"
                      >
                        <Link2 className="h-3.5 w-3.5 shrink-0 text-navy-400" aria-hidden />
                        <span className="font-medium">{c.connectedToLabel}</span>
                        <span className="text-navy-400">
                          ({c.relationshipType.replace(/_/g, " ")})
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-navy-400">
                    No direct connections found in the relationship graph yet.
                  </p>
                )
              ) : (
                <p className="mt-2 text-sm text-navy-400">
                  This funder has no relationship-graph node yet — it&apos;s
                  created the first time Relationship Analysis runs with
                  relationship analysis enabled.
                </p>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
