"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BarChart3, Plus, Trophy } from "lucide-react";

import {
  Badge,
  Button,
  Card,
  EmptyState,
  LoadingSpinner,
  Modal,
} from "@/components/ui";
import type { BadgeColor } from "@/components/ui";
import {
  OutcomeForm,
  type OutcomeApplicationContext,
} from "@/components/outcomes/OutcomeForm";
import { createClient } from "@/lib/supabase/client";
import { canEdit, useProfile } from "@/lib/hooks/useProfile";
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
    const awarded = outcomes.filter((o) => o.result === "awarded").length;
    const totalAwarded = outcomes.reduce(
      (sum, o) => sum + (o.awarded_amount ?? 0),
      0,
    );
    return { awarded, totalAwarded };
  }, [outcomes]);

  function handleSaved() {
    setRecording(null);
    void load();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-navy-900">
            Outcomes
          </h1>
          <p className="mt-1 text-sm text-navy-500">
            Record awards and denials. Awarded narratives train the learning
            system.
          </p>
        </div>
        <Link href="/outcomes/analytics">
          <Button variant="secondary">
            <BarChart3 className="h-4 w-4" aria-hidden />
            View analytics
          </Button>
        </Link>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {loading ? (
        <LoadingSpinner center label="Loading outcomes…" />
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
                <ul className="divide-y divide-navy-100">
                  {eligible.map((app) => (
                    <li
                      key={app.id}
                      className="flex items-center justify-between gap-4 py-3"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-navy-900">
                          {app.label}
                        </div>
                        <div className="text-xs text-navy-500">
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
                <p className="text-sm text-navy-500">
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
            noPadding
          >
            {outcomes.length === 0 ? (
              <p className="px-5 py-6 text-sm text-navy-500">
                No outcomes recorded yet.
              </p>
            ) : (
              <ul className="divide-y divide-navy-100">
                {outcomes.map((o) => (
                  <li
                    key={o.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge color={RESULT_COLOR[o.result]}>
                          {humanizeEnum(o.result)}
                        </Badge>
                        <span className="truncate text-sm font-medium text-navy-900">
                          {o.applicationLabel}
                        </span>
                      </div>
                      {o.denial_reason && (
                        <div className="mt-1 text-xs text-navy-500">
                          Reason: {o.denial_reason}
                        </div>
                      )}
                    </div>
                    <div className="text-right text-sm">
                      <div className="font-medium text-navy-900">
                        {o.result === "denied"
                          ? "-"
                          : formatCurrency(o.awarded_amount)}
                      </div>
                      <div className="text-xs text-navy-400">
                        {formatDate(o.recorded_at)}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
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
