"use client";

import { useMemo, type ReactElement } from "react";
import {
  Activity,
  Award,
  BarChart3,
  DollarSign,
  Gauge,
  Layers,
  TrendingUp,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Funnel,
  FunnelChart,
  LabelList,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Badge, Card, EmptyState } from "@/components/ui";
import { formatCurrency } from "@/lib/utils/formatters";
import type { SubscriptionTier } from "@/lib/utils/constants";
import {
  buildAgentActivity,
  buildDeadlineHeatmap,
  buildFunnel,
  buildMonthly,
  buildSourcePie,
  buildTopCategories,
  buildYearOverYear,
  computeKpis,
  computeRoi,
  computeVelocity,
  type AgentRunRow,
  type ApplicationRow,
  type DeadlineRow,
  type OpportunityRow,
  type OutcomeRow,
} from "@/lib/analytics/dashboard";

export type AnalyticsDashboardProps = {
  outcomes: OutcomeRow[];
  applications: ApplicationRow[];
  opportunities: OpportunityRow[];
  deadlines: DeadlineRow[];
  agentRuns: AgentRunRow[];
  subscriptionTier: SubscriptionTier;
  /** Injected for deterministic heatmap windowing (defaults to now). */
  now?: Date;
};

// Logo-matched chart palette (see globals.css / tailwind.config.ts).
const C = {
  teal: "#2dd4bf",
  blue: "#3b82f6",
  indigo: "#6366f1",
  purple: "#a855f7",
  green: "#34d399",
  amber: "#fbbf24",
  red: "#f87171",
  pink: "#ec4899",
  sky: "#38bdf8",
  grid: "rgba(255,255,255,0.08)",
  axis: "#8a93b6",
};

const SERIES = [
  C.teal,
  C.blue,
  C.purple,
  C.amber,
  C.green,
  C.pink,
  C.sky,
  C.indigo,
  C.red,
];

const AXIS_TICK = { fill: C.axis, fontSize: 12 };

const TOOLTIP_STYLE = {
  backgroundColor: "#14143a",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 10,
  color: "#f3f6ff",
  fontSize: 12,
  boxShadow: "0 8px 30px -12px rgba(0,0,0,0.8)",
} as const;

/** Compact USD for dense axes, e.g. $12.5k / $1.2M. */
function compactUsd(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  return `$${value}`;
}

/**
 * Outcomes & Analytics charting dashboard (BLUEPRINT §4.10). Renders eleven
 * visualizations over real, RLS-scoped rows - pipeline funnel, success rate
 * over time, dollars requested vs. awarded, source mix, deadline density,
 * agent activity, pipeline velocity, top categories, ROI, and year-over-year.
 * All aggregation is delegated to the pure transforms in lib/analytics/dashboard.
 */
export function AnalyticsDashboard({
  outcomes,
  applications,
  opportunities,
  deadlines,
  agentRuns,
  subscriptionTier,
  now,
}: AnalyticsDashboardProps) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const today = now ?? new Date();

  const kpis = useMemo(
    () => computeKpis(outcomes, applications),
    [outcomes, applications],
  );
  const funnel = useMemo(() => buildFunnel(applications), [applications]);
  const monthly = useMemo(() => buildMonthly(outcomes), [outcomes]);
  const sources = useMemo(
    () => buildSourcePie(opportunities),
    [opportunities],
  );
  const heatmap = useMemo(
    () => buildDeadlineHeatmap(deadlines, today, 26),
    [deadlines, today],
  );
  const agents = useMemo(() => buildAgentActivity(agentRuns), [agentRuns]);
  const velocity = useMemo(
    () => computeVelocity(applications, outcomes),
    [applications, outcomes],
  );
  const topCategories = useMemo(
    () => buildTopCategories(outcomes, 6),
    [outcomes],
  );
  const roi = useMemo(
    () => computeRoi(outcomes, subscriptionTier),
    [outcomes, subscriptionTier],
  );
  const yearOverYear = useMemo(() => buildYearOverYear(outcomes), [outcomes]);

  const hasAnyData =
    outcomes.length > 0 ||
    applications.length > 0 ||
    opportunities.length > 0 ||
    deadlines.length > 0 ||
    agentRuns.length > 0;

  if (!hasAnyData) {
    return (
      <EmptyState
        icon={TrendingUp}
        title="No analytics yet"
        description="Discover opportunities, build a pipeline, and record outcomes to unlock funnel, success-rate, ROI, and year-over-year analytics here."
      />
    );
  }

  const funnelData = funnel.map((f, i) => ({
    ...f,
    fill: SERIES[i % SERIES.length],
  }));

  return (
    <div className="space-y-6">
      {/* Top-line KPIs --------------------------------------------------- */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard
          icon={Award}
          label="Outcomes"
          value={String(kpis.totalOutcomes)}
        />
        <StatCard
          icon={TrendingUp}
          label="Success rate"
          value={`${kpis.successRate}%`}
        />
        <StatCard
          icon={DollarSign}
          label="Awarded"
          value={formatCurrency(kpis.totalAwarded)}
        />
        <StatCard
          icon={Gauge}
          label="$ efficiency"
          value={`${kpis.dollarEfficiency}%`}
          hint="Awarded ÷ requested"
        />
        <StatCard
          icon={Layers}
          label="Active apps"
          value={String(kpis.activeApplications)}
        />
        <StatCard
          icon={DollarSign}
          label="ROI"
          value={roi.roiMultiple != null ? `${roi.roiMultiple}×` : "-"}
          hint={roi.roiMultiple != null ? "Won ÷ annual cost" : "Free plan"}
        />
      </div>

      {/* Funnel + Source mix --------------------------------------------- */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card
          title="Pipeline funnel"
          description="Applications that reached each milestone."
        >
          <ChartFrame empty={applications.length === 0}>
            <FunnelChart>
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(value) => [`${Number(value)} apps`, "Reached"]}
              />
              <Funnel
                dataKey="count"
                data={funnelData}
                isAnimationActive={false}
              >
                <LabelList
                  position="right"
                  fill="#ccd5ee"
                  stroke="none"
                  dataKey="label"
                  fontSize={12}
                />
                <LabelList
                  position="left"
                  fill="#f3f6ff"
                  stroke="none"
                  dataKey="count"
                  fontSize={12}
                />
              </Funnel>
            </FunnelChart>
          </ChartFrame>
        </Card>

        <Card
          title="Opportunities by source"
          description="Where discovered opportunities originate."
        >
          <ChartFrame empty={sources.length === 0}>
            <PieChart>
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(value, name) => [`${Number(value)}`, String(name)]}
              />
              <Legend
                wrapperStyle={{ fontSize: 12, color: C.axis }}
                iconType="circle"
              />
              <Pie
                data={sources}
                dataKey="value"
                nameKey="label"
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={90}
                paddingAngle={2}
                stroke="none"
                isAnimationActive={false}
              >
                {sources.map((s, i) => (
                  <Cell key={s.key} fill={SERIES[i % SERIES.length]} />
                ))}
              </Pie>
            </PieChart>
          </ChartFrame>
        </Card>
      </div>

      {/* Success rate over time ------------------------------------------ */}
      <Card
        title="Success rate over time"
        description="Awarded ÷ total outcomes, by month."
      >
        <ChartFrame empty={monthly.length === 0}>
          <LineChart
            data={monthly}
            margin={{ top: 8, right: 16, bottom: 0, left: -8 }}
          >
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} />
            <YAxis
              tick={AXIS_TICK}
              tickLine={false}
              domain={[0, 100]}
              unit="%"
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(value, name) => [`${Number(value)}%`, String(name)]}
            />
            <Legend wrapperStyle={{ fontSize: 12, color: C.axis }} />
            <Line
              type="monotone"
              dataKey="successRate"
              name="Success rate"
              stroke={C.teal}
              strokeWidth={2.5}
              dot={{ r: 3, fill: C.teal }}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="fundedRate"
              name="Funded rate"
              stroke={C.purple}
              strokeWidth={2}
              strokeDasharray="4 3"
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ChartFrame>
      </Card>

      {/* Dollars requested vs awarded ------------------------------------ */}
      <Card
        title="Dollars requested vs. awarded"
        description="Funding asked for and secured, by month."
      >
        <ChartFrame empty={monthly.length === 0}>
          <BarChart
            data={monthly}
            margin={{ top: 8, right: 16, bottom: 0, left: 8 }}
          >
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} />
            <YAxis
              tick={AXIS_TICK}
              tickLine={false}
              tickFormatter={compactUsd}
              width={56}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(value, name) => [
                formatCurrency(Number(value)),
                String(name),
              ]}
            />
            <Legend wrapperStyle={{ fontSize: 12, color: C.axis }} />
            <Bar
              dataKey="requested"
              name="Requested"
              fill={C.blue}
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
            />
            <Bar
              dataKey="awardedDollars"
              name="Awarded"
              fill={C.teal}
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
            />
          </BarChart>
        </ChartFrame>
      </Card>

      {/* Agent activity + Top categories --------------------------------- */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card
          title="Agent activity"
          description="Runs per research / drafting agent."
        >
          <ChartFrame empty={agents.length === 0}>
            <BarChart
              layout="vertical"
              data={agents}
              margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
            >
              <CartesianGrid stroke={C.grid} horizontal={false} />
              <XAxis type="number" tick={AXIS_TICK} tickLine={false} allowDecimals={false} />
              <YAxis
                type="category"
                dataKey="label"
                tick={AXIS_TICK}
                tickLine={false}
                width={150}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(value, name) => [`${Number(value)}`, String(name)]}
              />
              <Bar
                dataKey="runs"
                name="Runs"
                fill={C.indigo}
                radius={[0, 4, 4, 0]}
                isAnimationActive={false}
              />
            </BarChart>
          </ChartFrame>
        </Card>

        <Card
          title="Top performing categories"
          description="Dollars awarded by funder category."
        >
          <ChartFrame empty={topCategories.length === 0}>
            <BarChart
              layout="vertical"
              data={topCategories}
              margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
            >
              <CartesianGrid stroke={C.grid} horizontal={false} />
              <XAxis
                type="number"
                tick={AXIS_TICK}
                tickLine={false}
                tickFormatter={compactUsd}
              />
              <YAxis
                type="category"
                dataKey="label"
                tick={AXIS_TICK}
                tickLine={false}
                width={150}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(value) => [
                  formatCurrency(Number(value)),
                  "Awarded",
                ]}
              />
              <Bar
                dataKey="awardedDollars"
                name="Awarded"
                radius={[0, 4, 4, 0]}
                isAnimationActive={false}
              >
                {topCategories.map((c, i) => (
                  <Cell key={c.category} fill={SERIES[i % SERIES.length]} />
                ))}
              </Bar>
            </BarChart>
          </ChartFrame>
        </Card>
      </div>

      {/* Pipeline velocity + ROI ----------------------------------------- */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card
          title="Pipeline velocity"
          description="How fast applications move from start to finish."
        >
          <div className="grid grid-cols-2 gap-4">
            <MetricTile
              icon={Activity}
              label="Avg days to submit"
              value={
                velocity.avgDaysToSubmit != null
                  ? `${velocity.avgDaysToSubmit}d`
                  : "-"
              }
              hint={`${velocity.submittedCount} submitted`}
            />
            <MetricTile
              icon={Gauge}
              label="Avg days to outcome"
              value={
                velocity.avgDaysToOutcome != null
                  ? `${velocity.avgDaysToOutcome}d`
                  : "-"
              }
              hint={`${velocity.decidedCount} decided`}
            />
          </div>
          <p className="mt-4 text-xs text-navy-400">
            Measured from application creation to submission and to a recorded
            outcome, respectively.
          </p>
        </Card>

        <Card
          title="ROI analysis"
          description={`${roi.tierName} plan vs. grants won.`}
        >
          <div className="flex flex-wrap items-center gap-3">
            <Badge color={roi.netGain >= 0 ? "green" : "red"}>
              {roi.roiMultiple != null
                ? `${roi.roiMultiple}× return`
                : "No cost basis"}
            </Badge>
            <span className="text-sm text-navy-500">
              Net {formatCurrency(roi.netGain)}
            </span>
          </div>
          <ChartFrame height="h-44" empty={false}>
            <BarChart
              data={[
                { name: "Annual cost", value: roi.annualCost, fill: C.red },
                { name: "Grants won", value: roi.totalWon, fill: C.teal },
              ]}
              margin={{ top: 8, right: 16, bottom: 0, left: 8 }}
            >
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis dataKey="name" tick={AXIS_TICK} tickLine={false} />
              <YAxis
                tick={AXIS_TICK}
                tickLine={false}
                tickFormatter={compactUsd}
                width={56}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(value) => [formatCurrency(Number(value)), "Amount"]}
              />
              <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                <Cell fill={C.red} />
                <Cell fill={C.teal} />
              </Bar>
            </BarChart>
          </ChartFrame>
        </Card>
      </div>

      {/* Year over year -------------------------------------------------- */}
      <Card
        title="Year-over-year comparison"
        description="Outcomes and dollars awarded by year."
      >
        <ChartFrame empty={yearOverYear.length === 0}>
          <ComposedChart
            data={yearOverYear}
            margin={{ top: 8, right: 16, bottom: 0, left: 8 }}
          >
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis dataKey="year" tick={AXIS_TICK} tickLine={false} />
            <YAxis
              yAxisId="dollars"
              tick={AXIS_TICK}
              tickLine={false}
              tickFormatter={compactUsd}
              width={56}
            />
            <YAxis
              yAxisId="count"
              orientation="right"
              tick={AXIS_TICK}
              tickLine={false}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(value, name) =>
                name === "Awarded $"
                  ? [formatCurrency(Number(value)), String(name)]
                  : [`${Number(value)}`, String(name)]
              }
            />
            <Legend wrapperStyle={{ fontSize: 12, color: C.axis }} />
            <Bar
              yAxisId="dollars"
              dataKey="awardedDollars"
              name="Awarded $"
              fill={C.teal}
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
            />
            <Line
              yAxisId="count"
              type="monotone"
              dataKey="total"
              name="Outcomes"
              stroke={C.amber}
              strokeWidth={2.5}
              dot={{ r: 3, fill: C.amber }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ChartFrame>
      </Card>

      {/* Deadline density heatmap ---------------------------------------- */}
      <Card
        title="Deadline density"
        description={`${heatmap.total} deadlines across the trailing 6 months.`}
      >
        <DeadlineHeatmapGrid heatmap={heatmap} />
      </Card>
    </div>
  );
}

// --- sub-components ----------------------------------------------------------

function ChartFrame({
  children,
  empty,
  height = "h-72",
}: {
  children: ReactElement;
  empty: boolean;
  height?: string;
}) {
  if (empty) {
    return (
      <div className={`flex ${height} items-center justify-center`}>
        <p className="text-sm text-navy-500">No data yet.</p>
      </div>
    );
  }
  return (
    <div className={height}>
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Award;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="glow-border rounded-xl bg-ink-700/60 p-4 shadow-card backdrop-blur-md">
      <div className="flex items-center gap-2 text-navy-500">
        <Icon className="h-4 w-4" aria-hidden />
        <span className="text-xs font-medium uppercase tracking-wide">
          {label}
        </span>
      </div>
      <div className="mt-2 text-xl font-semibold tracking-tight text-navy-900">
        {value}
      </div>
      {hint && <div className="mt-0.5 text-xs text-navy-400">{hint}</div>}
    </div>
  );
}

function MetricTile({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Award;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-navy-200 bg-white/[0.02] p-4">
      <div className="flex items-center gap-2 text-navy-500">
        <Icon className="h-4 w-4" aria-hidden />
        <span className="text-xs">{label}</span>
      </div>
      <div className="mt-1 text-2xl font-semibold tracking-tight text-navy-900">
        {value}
      </div>
      {hint && <div className="mt-0.5 text-xs text-navy-400">{hint}</div>}
    </div>
  );
}

// GitHub-style deadline density grid (intensity by count). Not a recharts chart
// - a compact custom SVG-free grid that reads well on the dark canvas.
function DeadlineHeatmapGrid({
  heatmap,
}: {
  heatmap: ReturnType<typeof buildDeadlineHeatmap>;
}) {
  if (heatmap.total === 0) {
    return (
      <p className="text-sm text-navy-500">
        No deadlines scheduled in the trailing 6 months.
      </p>
    );
  }

  const shade = (count: number): string => {
    if (count <= 0) return "rgba(255,255,255,0.04)";
    const ratio = heatmap.maxCount > 0 ? count / heatmap.maxCount : 0;
    // Teal ramp: low → high opacity.
    const alpha = 0.2 + ratio * 0.65;
    return `rgba(45,212,191,${alpha.toFixed(2)})`;
  };

  return (
    <div className="overflow-x-auto pb-1">
      <div className="inline-flex flex-col gap-1">
        {/* Month labels */}
        <div className="flex gap-[3px] pl-1 text-[10px] text-navy-400">
          {heatmap.weeks.map((_, w) => {
            const label = heatmap.monthLabels.find((m) => m.index === w);
            return (
              <div key={w} className="w-[12px] shrink-0">
                {label ? label.label : ""}
              </div>
            );
          })}
        </div>
        {/* Week columns */}
        <div className="flex gap-[3px]">
          {heatmap.weeks.map((week, w) => (
            <div key={w} className="flex flex-col gap-[3px]">
              {week.map((day, d) => (
                <div
                  key={day ? day.date : `${w}-${d}`}
                  className="h-[12px] w-[12px] rounded-[2px]"
                  style={{ backgroundColor: shade(day?.count ?? 0) }}
                  title={
                    day
                      ? `${day.date}: ${day.count} deadline${day.count === 1 ? "" : "s"}`
                      : undefined
                  }
                  aria-hidden
                />
              ))}
            </div>
          ))}
        </div>
        {/* Legend */}
        <div className="mt-2 flex items-center gap-2 text-[11px] text-navy-400">
          <BarChart3 className="h-3.5 w-3.5" aria-hidden />
          <span>Less</span>
          {[0, 0.25, 0.5, 0.75, 1].map((r) => (
            <span
              key={r}
              className="h-[12px] w-[12px] rounded-[2px]"
              style={{
                backgroundColor:
                  r === 0
                    ? "rgba(255,255,255,0.04)"
                    : `rgba(45,212,191,${(0.2 + r * 0.65).toFixed(2)})`,
              }}
            />
          ))}
          <span>More</span>
        </div>
      </div>
    </div>
  );
}

