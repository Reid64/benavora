"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DollarSign } from "lucide-react";

import { Badge, Card, EmptyState, LoadingSpinner } from "@/components/ui";
import type { BadgeColor } from "@/components/ui";
import { PageHeader } from "@/components/layout/PageHeader";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";
import { formatCurrency, formatDate, humanizeEnum } from "@/lib/utils/formatters";
import type { Enums, Tables } from "@/types/database";

type FunderCategory = Enums<"funder_category">;
type Outcome = Tables<"outcomes">;
type Application = Pick<
  Tables<"applications">,
  "id" | "stage" | "opportunity_id" | "requested_amount" | "awarded_amount"
>;
type Opportunity = Pick<Tables<"opportunities">, "id" | "name" | "deadline">;
type GrantBudget = Pick<Tables<"grant_budgets">, "application_id" | "total_budget" | "created_at">;
type GrantExpense = Pick<Tables<"grant_expenses">, "application_id" | "amount">;

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

interface ReconciliationRow {
  appId: string;
  oppName: string;
  awarded: number | null;
  totalBudgeted: number;
  totalSpent: number;
  variance: number;
  hasBudget: boolean;
}

export default function FinancialsPage() {
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [opportunityMap, setOpportunityMap] = useState<Map<string, Opportunity>>(new Map());
  const [budgets, setBudgets] = useState<GrantBudget[]>([]);
  const [expenses, setExpenses] = useState<GrantExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();

    const [outcomesRes, appsRes, oppsRes, budgetsRes, expensesRes] = await Promise.all([
      supabase.from("outcomes").select("*").order("recorded_at", { ascending: false }),
      supabase
        .from("applications")
        .select("id, stage, opportunity_id, requested_amount, awarded_amount"),
      supabase.from("opportunities").select("id, name, deadline"),
      supabase
        .from("grant_budgets")
        .select("application_id, total_budget, created_at")
        .order("created_at", { ascending: false }),
      supabase.from("grant_expenses").select("application_id, amount"),
    ]);

    if (
      outcomesRes.error ||
      appsRes.error ||
      oppsRes.error ||
      budgetsRes.error ||
      expensesRes.error
    ) {
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
    setBudgets(budgetsRes.data ?? []);
    setExpenses(expensesRes.data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const {
    summaryStats,
    categoryBreakdown,
    receivables,
    activeGrants,
    renewalRisks,
    reconciliationRows,
  } = useMemo(() => {
      const appOppName = new Map<string, string>();
      for (const app of applications) {
        const opp = opportunityMap.get(app.opportunity_id);
        appOppName.set(app.id, opp?.name ?? "Unnamed Grant");
      }

      // Reconciliation: most recent budget per application, summed expenses per application.
      const latestBudgetByApp = new Map<string, GrantBudget>();
      for (const b of budgets) {
        if (!b.application_id) continue;
        const existing = latestBudgetByApp.get(b.application_id);
        if (!existing || (b.created_at ?? "") > (existing.created_at ?? "")) {
          latestBudgetByApp.set(b.application_id, b);
        }
      }
      const spentByApp = new Map<string, number>();
      for (const e of expenses) {
        if (!e.application_id) continue;
        spentByApp.set(e.application_id, (spentByApp.get(e.application_id) ?? 0) + (e.amount ?? 0));
      }
      const reconciliationRows: ReconciliationRow[] = applications
        .filter((a) => a.stage === "awarded" || a.stage === "reporting_required")
        .map((a) => {
          const budget = latestBudgetByApp.get(a.id);
          const totalSpent = spentByApp.get(a.id) ?? 0;
          const totalBudgeted = budget?.total_budget ?? a.awarded_amount ?? 0;
          return {
            appId: a.id,
            oppName: appOppName.get(a.id) ?? "Unnamed Grant",
            awarded: a.awarded_amount,
            totalBudgeted,
            totalSpent,
            variance: totalBudgeted - totalSpent,
            hasBudget: budget !== undefined,
          };
        });

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
        reconciliationRows,
      };
    }, [outcomes, applications, opportunityMap, budgets, expenses]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#EEF2F7] p-6">
        <LoadingSpinner center label="Loading financials..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen space-y-6 bg-[#EEF2F7] p-6">
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      </div>
    );
  }

  const isEmpty = outcomes.length === 0 && applications.length === 0;
  const maxCategoryAwarded = Math.max(
    1,
    ...categoryBreakdown.map((row) => row.totalAwarded),
  );

  return (
    <div className="min-h-screen space-y-6 bg-[#EEF2F7] p-6">
      <PageHeader
        title="Financials"
        description="Funding overview: requested vs awarded, outstanding receivables, and renewal risks."
      />

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
              colorClass="border-teal-200 bg-teal-50"
            />
            <StatCard label="Award Rate" value={`${summaryStats.awardRate}%`} />
            <StatCard
              label="Renewal at Risk"
              value={formatCurrency(summaryStats.renewalAtRisk)}
              colorClass={
                summaryStats.renewalAtRisk > 0 ? "border-amber-200 bg-amber-50" : undefined
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
              <p className="px-5 py-6 text-sm text-slate-500">No outcome data to display.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-sidebar text-left text-xs font-medium text-white">
                      <th className="px-5 py-3">Category</th>
                      <th className="px-5 py-3 text-right">Requested</th>
                      <th className="px-5 py-3 text-right">Awarded</th>
                      <th className="px-5 py-3">Budget Utilization</th>
                      <th className="px-5 py-3 text-right">Win Rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {categoryBreakdown.map((row) => {
                      const winRate =
                        row.totalCount > 0
                          ? Math.round((row.awardCount / row.totalCount) * 100)
                          : 0;
                      const winColor: BadgeColor =
                        winRate >= 50 ? "green" : winRate >= 25 ? "yellow" : "red";
                      const utilizationPct = Math.round(
                        (row.totalAwarded / maxCategoryAwarded) * 100,
                      );
                      return (
                        <tr
                          key={row.category ?? "__none__"}
                          className="even:bg-[#F8FAFC] hover:bg-slate-50"
                        >
                          <td className="px-5 py-3 font-medium text-slate-900">
                            {row.category ? humanizeEnum(row.category) : "Uncategorized"}
                          </td>
                          <td className="px-5 py-3 text-right text-slate-700">
                            {formatCurrency(row.totalRequested)}
                          </td>
                          <td className="px-5 py-3 text-right font-semibold text-[#15803D]">
                            {formatCurrency(row.totalAwarded)}
                          </td>
                          <td className="px-5 py-3">
                            <BudgetBar percent={utilizationPct} />
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
              <p className="px-5 py-6 text-sm text-slate-500">No awarded grants on record.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {receivables.map((r, i) => (
                  <li
                    key={r.outcomeId}
                    className={cn(
                      "flex items-center justify-between gap-4 px-5 py-3",
                      i % 2 === 1 && "bg-[#F8FAFC]",
                    )}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-900">
                        {r.oppName}
                      </div>
                      <div className="text-xs text-slate-500">
                        Awarded {formatDate(r.recordedAt)}
                      </div>
                    </div>
                    <div className="font-semibold text-[#15803D]">
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
              <p className="px-5 py-6 text-sm text-slate-500">
                No active grants in awarded or reporting stage.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {activeGrants.map((g, i) => {
                  const bothKnown = g.awarded !== null && g.requested !== null;
                  const diff = bothKnown ? (g.awarded ?? 0) - (g.requested ?? 0) : null;
                  return (
                    <li
                      key={g.appId}
                      className={cn(
                        "flex flex-wrap items-center justify-between gap-3 px-5 py-3",
                        i % 2 === 1 && "bg-[#F8FAFC]",
                      )}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-slate-900">
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
                          <div className="text-xs text-slate-500">Requested</div>
                          <div className="font-medium text-slate-700">
                            {formatCurrency(g.requested)}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-slate-500">Awarded</div>
                          <div className="font-medium text-slate-900">
                            {formatCurrency(g.awarded)}
                          </div>
                        </div>
                        {diff !== null && (
                          <div
                            className={cn(
                              "font-semibold",
                              diff >= 0 ? "text-[#15803D]" : "text-[#B91C1C]",
                            )}
                          >
                            {diff >= 0 ? "+" : ""}
                            {formatCurrency(diff)}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {/* Section 3b: Grant Budget Reconciliation */}
          <Card
            title="Grant Budget Reconciliation"
            description="Awarded grants: budgeted vs. actual spend, with variance."
            noPadding
          >
            {reconciliationRows.length === 0 ? (
              <p className="px-5 py-6 text-sm text-slate-500">
                No awarded grants to reconcile yet.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {reconciliationRows.map((r, i) => {
                  const overBudget = r.variance < 0;
                  const variancePercent =
                    r.totalBudgeted > 0
                      ? Math.round((r.variance / r.totalBudgeted) * 100)
                      : 0;
                  return (
                    <li
                      key={r.appId}
                      className={cn(
                        "flex flex-wrap items-center justify-between gap-3 px-5 py-3",
                        i % 2 === 1 && "bg-[#F8FAFC]",
                      )}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-slate-900">
                          {r.oppName}
                        </div>
                        <div className="text-xs text-slate-500">
                          Awarded {formatCurrency(r.awarded)}
                          {!r.hasBudget && " · no budget entered"}
                        </div>
                      </div>
                      <div className="flex items-center gap-6 text-sm">
                        <div className="text-right">
                          <div className="text-xs text-slate-500">Budgeted</div>
                          <div className="font-medium text-slate-700">
                            {formatCurrency(r.totalBudgeted)}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-slate-500">Spent</div>
                          <div className="font-medium text-slate-900">
                            {formatCurrency(r.totalSpent)}
                          </div>
                        </div>
                        <Badge color={overBudget ? "red" : "green"}>
                          {overBudget ? "Over budget" : "Under budget"}
                          {r.totalBudgeted > 0 && ` (${variancePercent >= 0 ? "+" : ""}${variancePercent}%)`}
                        </Badge>
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
              <p className="px-5 py-6 text-sm text-slate-500">No grants in renewal stage.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {renewalRisks.map((r, i) => (
                  <li
                    key={r.appId}
                    className={cn(
                      "flex items-center justify-between gap-4 px-5 py-3",
                      i % 2 === 1 && "bg-[#F8FAFC]",
                    )}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-900">
                        {r.oppName}
                      </div>
                      {r.renewalDeadline && (
                        <div className="text-xs text-slate-500">
                          Deadline: {formatDate(r.renewalDeadline)}
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="mb-0.5 text-xs text-slate-500">Previously Awarded</div>
                      <div className="font-semibold text-amber-700">
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
      className={cn(
        "bg-white rounded-xl shadow-sm border border-border p-5",
        colorClass,
      )}
    >
      <div className="text-sm font-medium text-slate-400 uppercase tracking-wide">
        {label}
      </div>
      <div className="mt-2 text-4xl font-black text-slate-900">{value}</div>
    </div>
  );
}

/** Horizontal budget bar: teal fill on a slate track (Elevated Slate design system). */
function BudgetBar({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full rounded-full bg-[#0077B6]"
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="text-xs font-medium text-slate-500">{clamped}%</span>
    </div>
  );
}
