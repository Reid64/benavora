import { NextResponse } from "next/server";
import { differenceInCalendarDays, format, parseISO } from "date-fns";

import { requireRole } from "@/lib/auth/role-gate";
import {
  ACTION_STAGES,
  DEADLINE_WINDOW_DAYS,
  DRAFT_REVIEW_STAGE,
  EMPTY_COUNTS,
  dedupKeys,
  deadlineSeverity,
  type AlertCounts,
  type AlertSeverity,
  type AlertType,
} from "@/lib/alerts/alerts-service";
import type { Tables, TablesInsert } from "@/types/database";

// GET /api/alerts — regenerate the organization's alerts from live data, then
// return the active list plus the per-category badge counts.
//
// "Active" = not dismissed and not currently snoozed. Generation is idempotent:
// each candidate carries a stable dedup_key, upserts preserve read/dismiss/
// snooze state, and generated alerts whose underlying item is no longer
// actionable are pruned. organization_id is always derived from the session
// (Six Laws Law 2); RLS scopes every row as a second barrier.

export const runtime = "nodejs";

type AlertRow = Tables<"alerts">;
type AlertInsert = TablesInsert<"alerts">;

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

const ACTION_STAGE_MESSAGE: Record<string, string> = {
  awaiting_documents: "Application awaiting documents",
  follow_up_due: "Follow-up due",
  reporting_required: "Reporting required",
};

export async function GET() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, userId, organizationId } = gate;

  const now = new Date();

  // --- Gather the four live signals (all RLS-scoped + explicit org filter) ----

  // The user's last login establishes the "new opportunities" baseline.
  const { data: profile } = await supabase
    .from("profiles")
    .select("last_login_at")
    .eq("id", userId)
    .single();
  const lastLoginAt = profile?.last_login_at ?? null;

  // Deadlines due within the window (or overdue), not yet completed.
  const windowEnd = format(
    new Date(now.getTime() + DEADLINE_WINDOW_DAYS * 86_400_000),
    "yyyy-MM-dd",
  );
  const [deadlinesRes, actionAppsRes, draftAppsRes] = await Promise.all([
    supabase
      .from("deadlines")
      .select(
        "id, title, due_date, deadline_type, application_id, opportunity_id",
      )
      .eq("organization_id", organizationId)
      .eq("is_completed", false)
      .lte("due_date", windowEnd)
      .order("due_date", { ascending: true }),
    supabase
      .from("applications")
      .select("id, stage, opportunity_id")
      .eq("organization_id", organizationId)
      .in("stage", ACTION_STAGES as unknown as string[]),
    supabase
      .from("applications")
      .select("id, opportunity_id")
      .eq("organization_id", organizationId)
      .eq("stage", DRAFT_REVIEW_STAGE),
  ]);

  // New opportunities since last login. Skipped entirely when there is no
  // baseline (first session) to avoid flooding the list.
  const opportunitiesRes = lastLoginAt
    ? await supabase
        .from("opportunities")
        .select("id, name, match_percentage, created_at")
        .eq("organization_id", organizationId)
        .gt("created_at", lastLoginAt)
        .order("created_at", { ascending: false })
    : { data: [] as { id: string; name: string; match_percentage: number | null }[], error: null };

  if (
    deadlinesRes.error ||
    opportunitiesRes.error ||
    actionAppsRes.error ||
    draftAppsRes.error
  ) {
    return jsonError("Failed to assemble alerts.", "DB_ERROR", 500);
  }

  // Resolve opportunity names for the application alerts in one extra query
  // (the codebase joins in JS rather than embedding — see outcomes page).
  const oppIds = new Set<string>();
  for (const a of actionAppsRes.data ?? []) oppIds.add(a.opportunity_id);
  for (const a of draftAppsRes.data ?? []) oppIds.add(a.opportunity_id);
  const oppNames = new Map<string, string>();
  if (oppIds.size > 0) {
    const { data: opps } = await supabase
      .from("opportunities")
      .select("id, name")
      .eq("organization_id", organizationId)
      .in("id", [...oppIds]);
    for (const o of opps ?? []) oppNames.set(o.id, o.name);
  }

  // --- Build candidate alerts -------------------------------------------------
  const candidates: AlertInsert[] = [];
  const push = (
    type: AlertType,
    severity: AlertSeverity,
    message: string,
    dedup_key: string,
    link: string | null,
    refs: Pick<
      AlertInsert,
      "opportunity_id" | "application_id" | "deadline_id"
    > = {},
  ) => {
    candidates.push({
      organization_id: organizationId,
      type,
      severity,
      message,
      link,
      dedup_key,
      created_by: userId,
      updated_at: now.toISOString(),
      ...refs,
    });
  };

  for (const d of deadlinesRes.data ?? []) {
    const days = differenceInCalendarDays(parseISO(d.due_date), now);
    const when =
      days < 0
        ? `overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"}`
        : days === 0
          ? "due today"
          : `in ${days} day${days === 1 ? "" : "s"}`;
    const link = d.application_id
      ? `/applications/${d.application_id}`
      : d.opportunity_id
        ? `/opportunities/${d.opportunity_id}`
        : "/deadlines";
    push(
      "deadline_due",
      deadlineSeverity(days),
      `Deadline ${when}: ${d.title}`,
      dedupKeys.deadline(d.id),
      link,
      { deadline_id: d.id, application_id: d.application_id, opportunity_id: d.opportunity_id },
    );
  }

  for (const o of opportunitiesRes.data ?? []) {
    const match =
      typeof o.match_percentage === "number"
        ? ` (${o.match_percentage}% match)`
        : "";
    push(
      "new_opportunity",
      o.match_percentage != null && o.match_percentage >= 80 ? "warning" : "info",
      `New opportunity: ${o.name}${match}`,
      dedupKeys.newOpportunity(o.id),
      `/opportunities/${o.id}`,
      { opportunity_id: o.id },
    );
  }

  for (const a of actionAppsRes.data ?? []) {
    const label = ACTION_STAGE_MESSAGE[a.stage] ?? "Application needs attention";
    push(
      "application_action",
      "warning",
      `${label}: ${oppNames.get(a.opportunity_id) ?? "Application"}`,
      dedupKeys.applicationAction(a.id, a.stage),
      `/applications/${a.id}`,
      { application_id: a.id, opportunity_id: a.opportunity_id },
    );
  }

  for (const a of draftAppsRes.data ?? []) {
    push(
      "draft_review",
      "info",
      `Draft ready for review: ${oppNames.get(a.opportunity_id) ?? "Application"}`,
      dedupKeys.draftReview(a.id),
      `/applications/${a.id}`,
      { application_id: a.id, opportunity_id: a.opportunity_id },
    );
  }

  const validKeys = new Set(candidates.map((c) => c.dedup_key));

  // --- Persist: upsert candidates (preserving user state), prune stale --------
  if (candidates.length > 0) {
    const { error: upsertError } = await supabase
      .from("alerts")
      .upsert(candidates, { onConflict: "organization_id,dedup_key" });
    if (upsertError) {
      return jsonError("Failed to save alerts.", "DB_ERROR", 500);
    }
  }

  // Drop generated alerts whose underlying item is no longer actionable.
  // System alerts (type 'system') are user/admin-owned and never pruned.
  const { data: existing } = await supabase
    .from("alerts")
    .select("id, dedup_key")
    .eq("organization_id", organizationId)
    .neq("type", "system");
  const staleIds = (existing ?? [])
    .filter((row) => !validKeys.has(row.dedup_key))
    .map((row) => row.id);
  if (staleIds.length > 0) {
    await supabase.from("alerts").delete().in("id", staleIds);
  }

  // --- Read back the active list + counts -------------------------------------
  const { data: active, error: readError } = await supabase
    .from("alerts")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("is_dismissed", false)
    .or(`snoozed_until.is.null,snoozed_until.lte.${now.toISOString()}`)
    .order("created_at", { ascending: false });

  if (readError) {
    return jsonError("Failed to load alerts.", "DB_ERROR", 500);
  }

  const alerts = (active ?? []) as AlertRow[];
  const counts: AlertCounts = { ...EMPTY_COUNTS };
  for (const a of alerts) {
    if (a.type === "deadline_due") counts.deadline_due += 1;
    else if (a.type === "new_opportunity") counts.new_opportunity += 1;
    else if (a.type === "application_action") counts.application_action += 1;
    else if (a.type === "draft_review") counts.draft_review += 1;
  }
  counts.total = alerts.length;

  return NextResponse.json({ alerts, counts });
}
