"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BarChart3,
  ClipboardList,
  DollarSign,
  Percent,
  Plus,
  Trophy,
  type LucideIcon,
} from "lucide-react";

import {
  Badge,
  Button,
  Card,
  EmptyState,
  LoadingSpinner,
  Modal,
} from "@/components/ui";
import type { BadgeColor } from "@/components/ui";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  OutcomeForm,
  type OutcomeApplicationContext,
} from "@/components/outcomes/OutcomeForm";
import { createClient } from "@/lib/supabase/client";
import { canEdit, useProfile } from "@/lib/hooks/useProfile";
import { cn } from "@/lib/utils/cn";
import { formatCurrency, formatDate, humanizeEnum } from "@/lib/utils/formatters";
import type { Enums, Tables } from "@/types/database";

type OutcomeResult = Enums<"outcome_result">;

// Stages from which an outcome may be recorded (Behavioral Contracts §10):
// awarded, denied, or submitted (early denial).
const ELIGIBLE_STAGES: Enums<"pipeline_stage">[] = [
  "submitted",
  "awarded",
  "denied",
];

const RESULT_COLOR: Record<OutcomeResult, BadgeColor> = {
  awarded: "green",
  partial: "yellow",
  denied: "red",
};

type RecordedOutcome = Tables<"outcomes"> & { applicationLabel: string };

type MetricAccent = "green" | "teal" | "violet";

const METRIC_ACCENTS: Record<
  MetricAccent,
  { bar: string; iconBg: string; iconText: string }
> = {
  green: {
    bar: "absolute left-0 top-0 bottom-0 w-1 bg-[#10B981] rounded-l-xl",
    iconBg:
      "absolute top-4 right-4 w-10 h-10 rounded-lg flex items-center justify-center bg-[#10B981]/10",
    iconText: "text-[#10B981]",
  },
  teal: {
    bar: "absolute left-0 top-0 bottom-0 w-1 bg-[#00B4D8] rounded-l-xl",
    iconBg:
      "absolute top-4 right-4 w-10 h-10 rounded-lg flex items-center justify-center bg-[#00B4D8]/10",
    iconText: "text-[#00B4D8]",
  },
  violet: {
    bar: "absolute left-0 top-0 bottom-0 w-1 bg-[#7C3AED] rounded-l-xl",
    iconBg:
      "absolute top-4 right-4 w-10 h-10 rounded-lg flex items-center justify-center bg-[#7C3AED]/10",
    iconText: "text-[#7C3AED]",
  },
};

/** One of the three outcome summary tiles, accented by function. */
function OutcomeMetricCard({
  label,
  value,
  hint,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  accent: MetricAccent;
}) {
  const styles = METRIC_ACCENTS[accent];
  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-surface p-5 shadow-sm">
      <div className={styles.bar} />
      <div className={styles.iconBg}>
        <Icon className={cn("h-5 w-5", styles.iconText)} aria-hidden />
      </div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p className="mt-2 text-3xl font-bold text-slate-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

/** Awarded / partial / denied breakdown, teal / amber / navy (never gray). */
function OutcomeBreakdownBar({ outcomes }: { outcomes: RecordedOutcome[] }) {
  const total = outcomes.length;
  if (total === 0) return null;

  const awarded = outcomes.filter((o) => o.result === "awarded").length;
  const partial = outcomes.filter((o) => o.result === "partial").length;
  const denied = outcomes.filter((o) => o.result === "denied").length;
  const pct = (n: number) => `${(n / total) * 100}%`;

  const segments: { count: number; color: string; label: string }[] = [
    { count: awarded, color: "bg-[#00B4D8]", label: `Awarded (${awarded})` },
    { count: partial, color: "bg-[#F59E0B]", label: `Partial (${partial})` },
    { count: denied, color: "bg-[#1a2744]", label: `Denied (${denied})` },
  ];

  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
        {segments
          .filter((s) => s.count > 0)
          .map((s) => (
            <div
              key={s.label}
              className={s.color}
              style={{ width: pct(s.count) }}
              title={s.label}
            />
          ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-500">
        {segments.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <span className={cn("h-2 w-2 rounded-full", s.color)} aria-hidden />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Outcomes recording + history (BLUEPRINT §4.10). Lists recorded outcomes and
 * lets editors record a new one for any application that reached an eligible
 * stage and doesn't already have an outcome (one outcome per application -
 * Contracts §10). Recording an awarded/partial outcome triggers the Recursive
 * Learning Agent. Reads are RLS-scoped to the organization.
 */
export default function OutcomesPage() {
  const { profile } = useProfile();
  const [outcomes, setOutcomes] = useState<RecordedOutcome[]>([]);
  const [eligible, setEligible] = useState<OutcomeApplicationContext[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] =
    useState<OutcomeApplicationContext | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();

    const [appsRes, oppsRes, fundersRes, keywordsRes, outcomesRes] =
      await Promise.all([
        supabase
          .from("applications")
          .select("id, stage, requested_amount, draft_content, opportunity_id"),
        supabase.from("opportunities").select("id, name, category, funder_id"),
        supabase.from("funders").select("id, category"),
        supabase.from("opportunity_keywords").select("opportunity_id, keyword"),
        supabase
          .from("outcomes")
          .select("*")
          .order("recorded_at", { ascending: false }),
      ]);

    if (appsRes.error || outcomesRes.error) {
      setError("Could not load outcomes.");
      setLoading(false);
      return;
    }

    const oppById = new Map(
      (oppsRes.data ?? []).map((o) => [o.id, o]),
    );
    const funderCategoryById = new Map(
      (fundersRes.data ?? []).map((f) => [f.id, f.category]),
    );
    const keywordsByOpp = new Map<string, string[]>();
    for (const row of keywordsRes.data ?? []) {
      const list = keywordsByOpp.get(row.opportunity_id) ?? [];
      list.push(row.keyword);
      keywordsByOpp.set(row.opportunity_id, list);
    }

    // Applications that already have an outcome are excluded (UNIQUE per app).
    const recordedAppIds = new Set(
      (outcomesRes.data ?? []).map((o) => o.application_id),
    );

    const eligibleApps: OutcomeApplicationContext[] = [];
    for (const app of appsRes.data ?? []) {
      if (!ELIGIBLE_STAGES.includes(app.stage)) continue;
      if (recordedAppIds.has(app.id)) continue;
      const opp = oppById.get(app.opportunity_id);
      const opportunityCategory = opp?.category ?? null;
      const funderCategory = opp?.funder_id
        ? (funderCategoryById.get(opp.funder_id) ?? opportunityCategory)
        : opportunityCategory;
      eligibleApps.push({
        id: app.id,
        label: opp?.name ?? "Application",
        requestedAmount: app.requested_amount,
        draftContent: app.draft_content,
        funderCategory,
        opportunityCategory,
        keywords: keywordsByOpp.get(app.opportunity_id) ?? [],
        funderId: opp?.funder_id ?? null,
      });
    }

    const recorded: RecordedOutcome[] = (outcomesRes.data ?? []).map((o) => ({
      ...o,
      applicationLabel: "Application",
    }));
    // Label each outcome with its opportunity name via its application.
    const appOppName = new Map<string, string>();
    for (const app of appsRes.data ?? []) {
      appOppName.set(app.id, oppById.get(app.opportunity_id)?.name ?? "Application");
    }
    for (const o of recorded) {
      o.applicationLabel = appOppName.get(o.application_id) ?? "Application";
    }

    setOutcomes(recorded);
    setEligible(eligibleApps);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const editable = canEdit(profile?.role);
  const showEmpty =
    !loading && !error && outcomes.length === 0 && eligible.length === 0;

  const totals = useMemo(() => {
    const total = outcomes.length;
    const awarded = outcomes.filter((o) => o.result === "awarded").length;
    const totalAwarded = outcomes.reduce(
      (sum, o) => sum + (o.awarded_amount ?? 0),
      0,
    );
    const successRate = total > 0 ? Math.round((awarded / total) * 100) : null;
    return { total, awarded, totalAwarded, successRate };
  }, [outcomes]);

  function handleSaved() {
    setRecording(null);
    void load();
  }

  return (
    <div className="min-h-screen space-y-6 bg-page p-6">
      <PageHeader
        title="Outcomes"
        description="Record awards and denials. Awarded narratives train the learning system."
        actions={
          <Link href="/outcomes/analytics">
            <Button variant="secondary">
              <BarChart3 className="h-4 w-4" aria-hidden />
              View analytics
            </Button>
          </Link>
        }
      />

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {loading ? (
        <LoadingSpinner center label="Loading outcomes..." />
      ) : showEmpty ? (
        <EmptyState
          icon={Trophy}
          title="No outcomes yet"
          description="Once applications reach the submitted, awarded, or denied stage, record their outcomes here to track success and improve future drafts."
          action={
            <Link href="/applications">
              <Button variant="secondary">Go to pipeline</Button>
            </Link>
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            <OutcomeMetricCard
              label="Success Rate"
              value={totals.successRate != null ? `${totals.successRate}%` : "—"}
              hint={`${totals.awarded} awarded of ${totals.total}`}
              icon={Percent}
              accent="green"
            />
            <OutcomeMetricCard
              label="Total Awarded"
              value={formatCurrency(totals.totalAwarded)}
              icon={DollarSign}
              accent="teal"
            />
            <OutcomeMetricCard
              label="Applications"
              value={String(totals.total)}
              hint="outcomes recorded"
              icon={ClipboardList}
              accent="violet"
            />
          </div>

          {editable && (
            <Card
              title="Record an outcome"
              description={
                eligible.length > 0
                  ? "Select an application that reached an eligible stage."
                  : "No applications are awaiting an outcome right now."
              }
            >
              {eligible.length > 0 ? (
                <ul className="divide-y divide-slate-100">
                  {eligible.map((app) => (
                    <li
                      key={app.id}
                      className="flex items-center justify-between gap-4 py-3"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-slate-900">
                          {app.label}
                        </div>
                        <div className="text-xs text-slate-500">
                          Requested {formatCurrency(app.requestedAmount)}
                          {app.funderCategory
                            ? ` · ${humanizeEnum(app.funderCategory)}`
                            : ""}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setRecording(app)}
                      >
                        <Plus className="h-4 w-4" aria-hidden />
                        Record
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-500">
                  Move an application to the submitted, awarded, or denied stage
                  to record its outcome.
                </p>
              )}
            </Card>
          )}

          <Card
            title="Recorded outcomes"
            description={
              outcomes.length > 0
                ? `${totals.awarded} awarded · ${formatCurrency(totals.totalAwarded)} total awarded`
                : undefined
            }
          >
            {outcomes.length === 0 ? (
              <p className="py-1 text-sm text-slate-500">
                No outcomes recorded yet.
              </p>
            ) : (
              <>
                <OutcomeBreakdownBar outcomes={outcomes} />
                <ul className="mt-5 divide-y divide-slate-100">
                  {outcomes.map((o) => (
                    <li
                      key={o.id}
                      className="flex flex-wrap items-center justify-between gap-3 py-3"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge color={RESULT_COLOR[o.result]}>
                            {humanizeEnum(o.result)}
                          </Badge>
                          <span className="truncate text-sm font-medium text-slate-900">
                            {o.applicationLabel}
                          </span>
                        </div>
                        {o.denial_reason && (
                          <div className="mt-1 text-xs text-slate-500">
                            Reason: {o.denial_reason}
                          </div>
                        )}
                      </div>
                      <div className="text-right text-sm">
                        <div className="font-medium text-slate-900">
                          {o.result === "denied"
                            ? "-"
                            : formatCurrency(o.awarded_amount)}
                        </div>
                        <div className="text-xs text-slate-400">
                          {formatDate(o.recorded_at)}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>
        </>
      )}

      <Modal
        isOpen={recording !== null}
        onClose={() => setRecording(null)}
        title="Record outcome"
        description="Awarded and partial outcomes feed the recursive learning system."
        size="lg"
      >
        {recording && (
          <OutcomeForm
            application={recording}
            onSaved={handleSaved}
            onCancel={() => setRecording(null)}
          />
        )}
      </Modal>
    </div>
  );
}
