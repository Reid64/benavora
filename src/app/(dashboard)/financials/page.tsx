"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DollarSign } from "lucide-react";

import { EmptyState, LoadingSpinner } from "@/components/ui";
import { PageHeader } from "@/components/layout/PageHeader";
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

const CANVAS = "#D6E4F0";
const CARD = "#FFFFFF";
const TEXT_PRIMARY = "#0F172A";
const TEXT_SECONDARY = "#64748B";
const TEXT_MUTED = "#94A3B8";
const NAVY = "#1A2B3C";
const ACCENT = "#0077B6";
const GREEN = "#15803D";
const AMBER = "#B45309";
const RED = "#B91C1C";
const SHADOW = "0 4px 20px rgba(0,0,0,0.08)";

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
      <div style={{ backgroundColor: CANVAS, minHeight: "100vh" }} className="p-6">
        <LoadingSpinner center label="Loading financials..." />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ backgroundColor: CANVAS, minHeight: "100vh" }} className="space-y-6 p-6">
        <div
          role="alert"
          style={{ border: "1px solid #FECACA", backgroundColor: "#FEF2F2", color: RED }}
          className="rounded-lg px-4 py-3 text-sm"
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
  const totalReceivable = receivables.reduce((s, r) => s + (r.awardedAmount ?? 0), 0);

  return (
    <div style={{ backgroundColor: CANVAS, minHeight: "100vh" }} className="space-y-6 p-6">
      <PageHeader
        title="Financials"
        description="Funding overview: requested vs awarded, outstanding receivables, and renewal risks."
      />

      {isEmpty ? (
        <div style={{ backgroundColor: CARD, borderRadius: "16px", boxShadow: SHADOW }} className="p-10">
          <EmptyState
            icon={DollarSign}
            title="No financial data yet"
            description="Record outcomes for submitted applications to see funding summaries, receivables, and renewal risk."
          />
        </div>
      ) : (
        <>
          {/* Summary cards row */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard label="Total Requested" value={formatCurrency(summaryStats.totalRequested)} band={ACCENT} />
            <StatCard label="Total Awarded" value={formatCurrency(summaryStats.totalAwarded)} band={GREEN} />
            <StatCard label="Award Rate" value={`${summaryStats.awardRate}%`} band="#6B48CC" />
            <StatCard
              label="Renewal at Risk"
              value={formatCurrency(summaryStats.renewalAtRisk)}
              band={summaryStats.renewalAtRisk > 0 ? AMBER : "#94A3B8"}
            />
          </div>

          {/* Section 1: Requested vs Awarded by Category */}
          <div style={{ backgroundColor: CARD, borderRadius: "16px", boxShadow: SHADOW }} className="overflow-hidden">
            <div style={{ borderBottom: "1px solid #EEF2F7" }} className="px-6 py-5">
              <h3 style={{ color: TEXT_PRIMARY }} className="text-base font-semibold">
                Requested vs Awarded by Category
              </h3>
              <p style={{ color: TEXT_MUTED }} className="mt-0.5 text-xs">
                Funding performance across grant types based on recorded outcomes.
              </p>
            </div>
            {categoryBreakdown.length === 0 ? (
              <p style={{ color: TEXT_SECONDARY }} className="px-6 py-6 text-sm">
                No outcome data to display.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ backgroundColor: NAVY }} className="text-left text-xs font-medium text-white">
                      <th className="px-6 py-3">Category</th>
                      <th className="px-6 py-3 text-right">Requested</th>
                      <th className="px-6 py-3 text-right">Awarded</th>
                      <th className="px-6 py-3">Budget Utilization</th>
                      <th className="px-6 py-3 text-right">Win Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {categoryBreakdown.map((row, i) => {
                      const winRate =
                        row.totalCount > 0
                          ? Math.round((row.awardCount / row.totalCount) * 100)
                          : 0;
                      const winColor =
                        winRate >= 50 ? GREEN : winRate >= 25 ? AMBER : RED;
                      const winBg =
                        winRate >= 50 ? "#DCFCE7" : winRate >= 25 ? "#FEF3C7" : "#FEE2E2";
                      const utilizationPct = Math.round(
                        (row.totalAwarded / maxCategoryAwarded) * 100,
                      );
                      return (
                        <tr
                          key={row.category ?? "__none__"}
                          style={{ backgroundColor: i % 2 === 1 ? "#F8FAFC" : CARD, borderBottom: "1px solid #F1F5F9" }}
                        >
                          <td style={{ color: TEXT_PRIMARY }} className="px-6 py-3 font-medium">
                            {row.category ? humanizeEnum(row.category) : "Uncategorized"}
                          </td>
                          <td style={{ color: TEXT_SECONDARY }} className="px-6 py-3 text-right">
                            {formatCurrency(row.totalRequested)}
                          </td>
                          <td style={{ color: GREEN }} className="px-6 py-3 text-right font-semibold">
                            {formatCurrency(row.totalAwarded)}
                          </td>
                          <td className="px-6 py-3">
                            <BudgetBar percent={utilizationPct} />
                          </td>
                          <td className="px-6 py-3 text-right">
                            <span
                              style={{ backgroundColor: winBg, color: winColor }}
                              className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold"
                            >
                              {winRate}%
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Section 2: Outstanding Receivables — awards timeline */}
          <div style={{ backgroundColor: CARD, borderRadius: "16px", boxShadow: SHADOW }} className="overflow-hidden">
            <div style={{ borderBottom: "1px solid #EEF2F7" }} className="px-6 py-5">
              <h3 style={{ color: TEXT_PRIMARY }} className="text-base font-semibold">
                Outstanding Receivables
              </h3>
              <p style={{ color: TEXT_MUTED }} className="mt-0.5 text-xs">
                {receivables.length > 0
                  ? `${receivables.length} awarded grant${receivables.length !== 1 ? "s" : ""} · ${formatCurrency(totalReceivable)} total`
                  : "Confirmed awards awaiting receipt."}
              </p>
            </div>
            {receivables.length === 0 ? (
              <p style={{ color: TEXT_SECONDARY }} className="px-6 py-6 text-sm">
                No awarded grants on record.
              </p>
            ) : (
              <div className="px-6 py-5">
                <div className="relative">
                  <div
                    style={{ backgroundColor: "#E2E8F0", left: "5px" }}
                    className="absolute top-1 bottom-1 w-0.5"
                    aria-hidden
                  />
                  {receivables.map((r) => (
                    <div key={r.outcomeId} className="relative mb-5 flex items-start gap-4 pl-0 last:mb-0">
                      <span
                        style={{ backgroundColor: GREEN, boxShadow: "0 0 0 3px #FFFFFF" }}
                        className="relative z-10 mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                        aria-hidden
                      />
                      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-3 pl-2">
                        <div className="min-w-0">
                          <div style={{ color: TEXT_PRIMARY }} className="truncate text-sm font-medium">
                            {r.oppName}
                          </div>
                          <div style={{ color: TEXT_MUTED }} className="text-xs">
                            Awarded {formatDate(r.recordedAt)}
                          </div>
                        </div>
                        <div style={{ color: GREEN }} className="font-semibold">
                          {formatCurrency(r.awardedAmount)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Section 3: Active Grant Budget vs Actual */}
          <div style={{ backgroundColor: CARD, borderRadius: "16px", boxShadow: SHADOW }} className="overflow-hidden">
            <div style={{ borderBottom: "1px solid #EEF2F7" }} className="px-6 py-5">
              <h3 style={{ color: TEXT_PRIMARY }} className="text-base font-semibold">
                Active Grant Budget vs Actual
              </h3>
              <p style={{ color: TEXT_MUTED }} className="mt-0.5 text-xs">
                Applications in the awarded or reporting stage showing requested vs actual amounts.
              </p>
            </div>
            {activeGrants.length === 0 ? (
              <p style={{ color: TEXT_SECONDARY }} className="px-6 py-6 text-sm">
                No active grants in awarded or reporting stage.
              </p>
            ) : (
              <ul>
                {activeGrants.map((g, i) => {
                  const bothKnown = g.awarded !== null && g.requested !== null;
                  const diff = bothKnown ? (g.awarded ?? 0) - (g.requested ?? 0) : null;
                  const reporting = g.stage === "reporting_required";
                  return (
                    <li
                      key={g.appId}
                      style={{ backgroundColor: i % 2 === 1 ? "#F8FAFC" : CARD, borderBottom: "1px solid #F1F5F9" }}
                      className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 last:border-0"
                    >
                      <div className="min-w-0">
                        <div style={{ color: TEXT_PRIMARY }} className="truncate text-sm font-medium">
                          {g.oppName}
                        </div>
                        <div className="mt-1">
                          <span
                            style={{
                              backgroundColor: reporting ? "#FEF3C7" : "#CCFBF1",
                              color: reporting ? AMBER : "#0F766E",
                            }}
                            className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold"
                          >
                            {humanizeEnum(g.stage)}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-6 text-sm">
                        <div className="text-right">
                          <div style={{ color: TEXT_MUTED }} className="text-xs">Requested</div>
                          <div style={{ color: TEXT_SECONDARY }} className="font-medium">
                            {formatCurrency(g.requested)}
                          </div>
                        </div>
                        <div className="text-right">
                          <div style={{ color: TEXT_MUTED }} className="text-xs">Awarded</div>
                          <div style={{ color: TEXT_PRIMARY }} className="font-medium">
                            {formatCurrency(g.awarded)}
                          </div>
                        </div>
                        {diff !== null && (
                          <div style={{ color: diff >= 0 ? GREEN : RED }} className="font-semibold">
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
          </div>

          {/* Section 3b: Grant Budget Reconciliation — budget breakdown */}
          <div style={{ backgroundColor: CARD, borderRadius: "16px", boxShadow: SHADOW }} className="overflow-hidden">
            <div style={{ borderBottom: "1px solid #EEF2F7" }} className="px-6 py-5">
              <h3 style={{ color: TEXT_PRIMARY }} className="text-base font-semibold">
                Grant Budget Reconciliation
              </h3>
              <p style={{ color: TEXT_MUTED }} className="mt-0.5 text-xs">
                Awarded grants: budgeted vs. actual spend, with variance.
              </p>
            </div>
            {reconciliationRows.length === 0 ? (
              <p style={{ color: TEXT_SECONDARY }} className="px-6 py-6 text-sm">
                No awarded grants to reconcile yet.
              </p>
            ) : (
              <ul>
                {reconciliationRows.map((r, i) => {
                  const overBudget = r.variance < 0;
                  const spentPct =
                    r.totalBudgeted > 0
                      ? Math.min(100, Math.round((r.totalSpent / r.totalBudgeted) * 100))
                      : 0;
                  const variancePercent =
                    r.totalBudgeted > 0
                      ? Math.round((r.variance / r.totalBudgeted) * 100)
                      : 0;
                  return (
                    <li
                      key={r.appId}
                      style={{ backgroundColor: i % 2 === 1 ? "#F8FAFC" : CARD, borderBottom: "1px solid #F1F5F9" }}
                      className="px-6 py-4 last:border-0"
                    >
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div style={{ color: TEXT_PRIMARY }} className="truncate text-sm font-medium">
                            {r.oppName}
                          </div>
                          <div style={{ color: TEXT_MUTED }} className="text-xs">
                            Awarded {formatCurrency(r.awarded)}
                            {!r.hasBudget && " · no budget entered"}
                          </div>
                        </div>
                        <div className="flex items-center gap-6 text-sm">
                          <div className="text-right">
                            <div style={{ color: TEXT_MUTED }} className="text-xs">Budgeted</div>
                            <div style={{ color: TEXT_SECONDARY }} className="font-medium">
                              {formatCurrency(r.totalBudgeted)}
                            </div>
                          </div>
                          <div className="text-right">
                            <div style={{ color: TEXT_MUTED }} className="text-xs">Spent</div>
                            <div style={{ color: TEXT_PRIMARY }} className="font-medium">
                              {formatCurrency(r.totalSpent)}
                            </div>
                          </div>
                          <span
                            style={{
                              backgroundColor: overBudget ? "#FEE2E2" : "#DCFCE7",
                              color: overBudget ? RED : GREEN,
                            }}
                            className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold"
                          >
                            {overBudget ? "Over budget" : "Under budget"}
                            {r.totalBudgeted > 0 && ` (${variancePercent >= 0 ? "+" : ""}${variancePercent}%)`}
                          </span>
                        </div>
                      </div>
                      <div style={{ backgroundColor: "#F1F5F9" }} className="h-2.5 w-full overflow-hidden rounded-full">
                        <div
                          style={{
                            width: `${spentPct}%`,
                            backgroundColor: overBudget ? "#EF4444" : ACCENT,
                          }}
                          className="h-full rounded-full transition-all"
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Section 4: Renewal Revenue at Risk */}
          <div style={{ backgroundColor: CARD, borderRadius: "16px", boxShadow: SHADOW }} className="overflow-hidden">
            <div style={{ borderBottom: "1px solid #EEF2F7" }} className="px-6 py-5">
              <h3 style={{ color: TEXT_PRIMARY }} className="text-base font-semibold">
                Renewal Revenue at Risk
              </h3>
              <p style={{ color: TEXT_MUTED }} className="mt-0.5 text-xs">
                {renewalRisks.length > 0
                  ? `${renewalRisks.length} grant${renewalRisks.length !== 1 ? "s" : ""} pending renewal · ${formatCurrency(
                      renewalRisks.reduce((s, r) => s + (r.originalAwarded ?? 0), 0),
                    )} at risk`
                  : "Grants in the renewal opportunity stage."}
              </p>
            </div>
            {renewalRisks.length === 0 ? (
              <p style={{ color: TEXT_SECONDARY }} className="px-6 py-6 text-sm">
                No grants in renewal stage.
              </p>
            ) : (
              <ul>
                {renewalRisks.map((r, i) => (
                  <li
                    key={r.appId}
                    style={{
                      backgroundColor: "#FFFBEB",
                      borderLeft: "4px solid #F59E0B",
                      borderBottom: i === renewalRisks.length - 1 ? "none" : "1px solid #FDE68A",
                    }}
                    className="flex items-center justify-between gap-4 px-6 py-4"
                  >
                    <div className="min-w-0">
                      <div style={{ color: TEXT_PRIMARY }} className="truncate text-sm font-medium">
                        {r.oppName}
                      </div>
                      {r.renewalDeadline && (
                        <div style={{ color: TEXT_SECONDARY }} className="text-xs">
                          Deadline: {formatDate(r.renewalDeadline)}
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <div style={{ color: TEXT_MUTED }} className="mb-0.5 text-xs">Previously Awarded</div>
                      <div style={{ color: AMBER }} className="font-semibold">
                        {formatCurrency(r.originalAwarded)}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  band,
}: {
  label: string;
  value: string;
  band: string;
}) {
  return (
    <div
      style={{ backgroundColor: CARD, borderRadius: "16px", boxShadow: SHADOW, overflow: "hidden" }}
    >
      <div style={{ backgroundColor: band, height: "6px" }} />
      <div className="p-5">
        <div style={{ color: TEXT_MUTED }} className="text-xs font-bold uppercase tracking-wide">
          {label}
        </div>
        <div style={{ color: TEXT_PRIMARY }} className="mt-2 text-4xl font-black">
          {value}
        </div>
      </div>
    </div>
  );
}

/** Horizontal budget bar: ocean-blue fill on a light track. */
function BudgetBar({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className="flex items-center gap-2">
      <div style={{ backgroundColor: "#E2E8F0" }} className="h-2 w-24 overflow-hidden rounded-full">
        <div
          style={{ width: `${clamped}%`, backgroundColor: ACCENT }}
          className="h-full rounded-full"
        />
      </div>
      <span style={{ color: TEXT_MUTED }} className="text-xs font-medium">{clamped}%</span>
    </div>
  );
}
