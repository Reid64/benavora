"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DollarSign } from "lucide-react";

import { Badge, Card, EmptyState, LoadingSpinner } from "@/components/ui";
import type { BadgeColor } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDate, humanizeEnum } from "@/lib/utils/formatters";
import type { Enums, Tables } from "@/types/database";

type FunderCategory = Enums<"funder_category">;
type Outcome = Tables<"outcomes">;
type Application = Pick<
  Tables<"applications">,
  "id" | "stage" | "opportunity_id" | "requested_amount" | "awarded_amount"
>;
type Opportunity = Pick<Tables<"opportunities">, "id" | "name" | "deadline">;

interface CategorySummary {
  category: FunderCategory | null;
  totalRequested: number;
  totalAwarded: number;
  awardCount: number;
  totalCount: number;
}

interface Receivable {
  outcomeId: string;
  oppName: string;
  awardedAmount: number | null;
  recordedAt: string;
}

interface ActiveGrant {
  appId: string;
  oppName: string;
  requested: number | null;
  awarded: number | null;
  stage: Enums<"pipeline_stage">;
}

interface RenewalRisk {
  appId: string;
  oppName: string;
  renewalDeadline: string | null;
  originalAwarded: number | null;
}

export default function FinancialsPage() {
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [opportunityMap, setOpportunityMap] = useState<Map<string, Opportunity>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();

    const [outcomesRes, appsRes, oppsRes] = await Promise.all([
      supabase.from("outcomes").select("*").order("recorded_at", { ascending: false }),
      supabase
        .from("applications")
        .select("id, stage, opportunity_id, requested_amount, awarded_amount"),
      supabase.from("opportunities").select("id, name, deadline"),
    ]);

    if (outcomesRes.error || appsRes.error || oppsRes.error) {
      setError("Could not load financial data.");
      setLoading(false);
      return;
    }

    const oppMap = new Map<string, Opportunity>(
      (oppsRes.data ?? []).map((o) => [o.id, o]),
    );

    setOutcomes(outcomesRes.data ?? []);
    setApplications(appsRes.data ?? []);
    setOpportunityMap(oppMap);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const { summaryStats, categoryBreakdown, receivables, activeGrants, renewalRisks } =
    useMemo(() => {
      const appOppName = new Map<string, string>();
      for (const app of applications) {
        const opp = opportunityMap.get(app.opportunity_id);
        appOppName.set(app.id, opp?.name ?? "Unnamed Grant");
      }

      const outcomeByAppId = new Map<string, Outcome>();
      for (const o of outcomes) {
        outcomeByAppId.set(o.application_id, o);
      }

      // Section 1: category breakdown from recorded outcomes
      const catMap = new Map<string, CategorySummary>();
      for (const o of outcomes) {
        const key = o.funder_category ?? "__none__";
        const existing = catMap.get(key) ?? {
          category: o.funder_category,
          totalRequested: 0,
          totalAwarded: 0,
          awardCount: 0,
          totalCount: 0,
        };
        existing.totalRequested += o.requested_amount ?? 0;
        if (o.result === "awarded" || o.result === "partial") {
          existing.totalAwarded += o.awarded_amount ?? 0;
          existing.awardCount += 1;
        }
        existing.totalCount += 1;
        catMap.set(key, existing);
      }
      const categoryBreakdown = Array.from(catMap.values()).sort(
        (a, b) => b.totalAwarded - a.totalAwarded,
      );

      // Section 2: receivables — awarded/partial outcomes with amounts
      const receivables: Receivable[] = outcomes
        .filter(
          (o) =>
            (o.result === "awarded" || o.result === "partial") &&
            (o.awarded_amount ?? 0) > 0,
        )
        .map((o) => ({
          outcomeId: o.id,
          oppName: appOppName.get(o.application_id) ?? "Unnamed Grant",
          awardedAmount: o.awarded_amount,
          recordedAt: o.recorded_at,
        }));

      // Section 3: active grants in awarded or reporting stage
      const activeGrants: ActiveGrant[] = applications
        .filter((a) => a.stage === "awarded" || a.stage === "reporting_required")
        .map((a) => ({
          appId: a.id,
          oppName: appOppName.get(a.id) ?? "Unnamed Grant",
          requested: a.requested_amount,
          awarded: a.awarded_amount,
          stage: a.stage,
        }));

      // Section 4: renewal risks — applications in renewal_opportunity stage
      const renewalRisks: RenewalRisk[] = applications
        .filter((a) => a.stage === "renewal_opportunity")
        .map((a) => {
          const priorOutcome = outcomeByAppId.get(a.id);
          const opp = opportunityMap.get(a.opportunity_id);
          return {
            appId: a.id,
            oppName: appOppName.get(a.id) ?? "Unnamed Grant",
            renewalDeadline: opp?.deadline ?? null,
            originalAwarded: priorOutcome?.awarded_amount ?? a.awarded_amount,
          };
        });

      const totalRequested = outcomes.reduce(
        (sum, o) => sum + (o.requested_amount ?? 0),
        0,
      );
      const totalAwarded = outcomes
        .filter((o) => o.result === "awarded" || o.result === "partial")
        .reduce((sum, o) => sum + (o.awarded_amount ?? 0), 0);
      const awardedCount = outcomes.filter(
        (o) => o.result === "awarded" || o.result === "partial",
      ).length;
      const awardRate =
        outcomes.length > 0 ? Math.round((awardedCount / outcomes.length) * 100) : 0;
      const renewalAtRisk = renewalRisks.reduce(
        (sum, r) => sum + (r.originalAwarded ?? 0),
        0,
      );

      return {
        summaryStats: { totalRequested, totalAwarded, awardRate, renewalAtRisk },
        categoryBreakdown,
        receivables,
        activeGrants,
        renewalRisks,
      };
    }, [outcomes, applications, opportunityMap]);

  if (loading) return <LoadingSpinner center label="Loading financials..." />;

  if (error) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
      >
        {error}
      </div>
    );
  }

  const isEmpty = outcomes.length === 0 && applications.length === 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-navy-900">Financials</h1>
        <p className="mt-1 text-sm text-navy-500">
          Funding overview: requested vs awarded, outstanding receivables, and renewal risks.
        </p>
      </div>

      {isEmpty ? (
        <EmptyState
          icon={DollarSign}
          title="No financial data yet"
          description="Record outcomes for submitted applications to see funding summaries, receivables, and renewal risk."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard label="Total Requested" value={formatCurrency(summaryStats.totalRequested)} />
            <StatCard
              label="Total Awarded"
              value={formatCurrency(summaryStats.totalAwarded)}
              colorClass="border-teal-200 bg-teal-50 text-teal-700"
            />
            <StatCard label="Award Rate" value={`${summaryStats.awardRate}%`} />
            <StatCard
              label="Renewal at Risk"
              value={formatCurrency(summaryStats.renewalAtRisk)}
              colorClass={
                summaryStats.renewalAtRisk > 0
                  ? "border-amber-200 bg-amber-50 text-amber-700"
                  : undefined
              }
            />
          </div>

          {/* Section 1: Requested vs Awarded by Category */}
          <Card
            title="Requested vs Awarded by Category"
            description="Funding performance across grant types based on recorded outcomes."
            noPadding
          >
            {categoryBreakdown.length === 0 ? (
              <p className="px-5 py-6 text-sm text-navy-500">No outcome data to display.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-navy-100 text-left text-xs font-medium text-navy-500">
                      <th className="px-5 py-3">Category</th>
                      <th className="px-5 py-3 text-right">Requested</th>
                      <th className="px-5 py-3 text-right">Awarded</th>
                      <th className="px-5 py-3 text-right">Win Rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-navy-100">
                    {categoryBreakdown.map((row) => {
                      const winRate =
                        row.totalCount > 0
                          ? Math.round((row.awardCount / row.totalCount) * 100)
                          : 0;
                      const winColor: BadgeColor =
                        winRate >= 50 ? "green" : winRate >= 25 ? "yellow" : "red";
                      return (
                        <tr
                          key={row.category ?? "__none__"}
                          className="hover:bg-navy-50/50"
                        >
                          <td className="px-5 py-3 font-medium text-navy-900">
                            {row.category ? humanizeEnum(row.category) : "Uncategorized"}
                          </td>
                          <td className="px-5 py-3 text-right text-navy-700">
                            {formatCurrency(row.totalRequested)}
                          </td>
                          <td className="px-5 py-3 text-right font-medium text-navy-900">
                            {formatCurrency(row.totalAwarded)}
                          </td>
                          <td className="px-5 py-3 text-right">
                            <Badge color={winColor}>{winRate}%</Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Section 2: Outstanding Receivables */}
          <Card
            title="Outstanding Receivables"
            description={
              receivables.length > 0
                ? `${receivables.length} awarded grant${receivables.length !== 1 ? "s" : ""} · ${formatCurrency(
                    receivables.reduce((s, r) => s + (r.awardedAmount ?? 0), 0),
                  )} total`
                : "Confirmed awards awaiting receipt."
            }
            noPadding
          >
            {receivables.length === 0 ? (
              <p className="px-5 py-6 text-sm text-navy-500">No awarded grants on record.</p>
            ) : (
              <ul className="divide-y divide-navy-100">
                {receivables.map((r) => (
                  <li
                    key={r.outcomeId}
                    className="flex items-center justify-between gap-4 px-5 py-3"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-navy-900">
                        {r.oppName}
                      </div>
                      <div className="text-xs text-navy-500">
                        Awarded {formatDate(r.recordedAt)}
                      </div>
                    </div>
                    <div className="font-medium text-green-700">
                      {formatCurrency(r.awardedAmount)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Section 3: Active Grant Budget vs Actual */}
          <Card
            title="Active Grant Budget vs Actual"
            description="Applications in the awarded or reporting stage showing requested vs actual amounts."
            noPadding
          >
            {activeGrants.length === 0 ? (
              <p className="px-5 py-6 text-sm text-navy-500">
                No active grants in awarded or reporting stage.
              </p>
            ) : (
              <ul className="divide-y divide-navy-100">
                {activeGrants.map((g) => {
                  const bothKnown = g.awarded !== null && g.requested !== null;
                  const diff = bothKnown ? (g.awarded ?? 0) - (g.requested ?? 0) : null;
                  const diffColor: BadgeColor =
                    diff !== null && diff >= 0 ? "green" : "red";
                  return (
                    <li
                      key={g.appId}
                      className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-navy-900">
                          {g.oppName}
                        </div>
                        <div className="mt-1">
                          <Badge
                            color={g.stage === "reporting_required" ? "yellow" : "teal"}
                          >
                            {humanizeEnum(g.stage)}
                          </Badge>
                        </div>
                      </div>
                      <div className="flex items-center gap-6 text-sm">
                        <div className="text-right">
                          <div className="text-xs text-navy-500">Requested</div>
                          <div className="font-medium text-navy-700">
                            {formatCurrency(g.requested)}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-navy-500">Awarded</div>
                          <div className="font-medium text-navy-900">
                            {formatCurrency(g.awarded)}
                          </div>
                        </div>
                        {diff !== null && (
                          <Badge color={diffColor}>
                            {diff >= 0 ? "+" : ""}
                            {formatCurrency(diff)}
                          </Badge>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {/* Section 4: Renewal Revenue at Risk */}
          <Card
            title="Renewal Revenue at Risk"
            description={
              renewalRisks.length > 0
                ? `${renewalRisks.length} grant${renewalRisks.length !== 1 ? "s" : ""} pending renewal · ${formatCurrency(
                    renewalRisks.reduce((s, r) => s + (r.originalAwarded ?? 0), 0),
                  )} at risk`
                : "Grants in the renewal opportunity stage."
            }
            noPadding
          >
            {renewalRisks.length === 0 ? (
              <p className="px-5 py-6 text-sm text-navy-500">No grants in renewal stage.</p>
            ) : (
              <ul className="divide-y divide-navy-100">
                {renewalRisks.map((r) => (
                  <li
                    key={r.appId}
                    className="flex items-center justify-between gap-4 px-5 py-3"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-navy-900">
                        {r.oppName}
                      </div>
                      {r.renewalDeadline && (
                        <div className="text-xs text-navy-500">
                          Deadline: {formatDate(r.renewalDeadline)}
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="mb-0.5 text-xs text-navy-500">Previously Awarded</div>
                      <div className="font-medium text-amber-700">
                        {formatCurrency(r.originalAwarded)}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  colorClass,
}: {
  label: string;
  value: string;
  colorClass?: string;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${colorClass ?? "border-navy-100 bg-white"}`}
    >
      <div className="text-xs font-medium text-navy-500">{label}</div>
      <div className="mt-1 text-xl font-semibold tracking-tight text-navy-900">{value}</div>
    </div>
  );
}
