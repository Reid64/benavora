// GET /api/admin/monitor — platform-wide automation queue health for the
// admin Monitor dashboard. Reads automation_queue (SCHEMA_REGISTRY §2.44),
// which uses automation_status values queued/processing/paused/completed/failed
// (see /api/automation/queue and /api/automation/stats for the org-scoped
// equivalents this mirrors, cross-tenant, via the service-role client).

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

interface ErrorLogEntry {
  error?: string;
  attempt?: number;
  at?: string;
}

function lastErrorMessage(errorLog: unknown): string | null {
  if (!Array.isArray(errorLog) || errorLog.length === 0) return null;
  const last = errorLog[errorLog.length - 1] as ErrorLogEntry;
  return typeof last?.error === "string" ? last.error : null;
}

export async function GET() {
  const gate = await requireRole("admin");
  if ("error" in gate) return gate.error;

  const admin = createAdminClient();
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const [
    { count: activeCount },
    { count: completedToday },
    { count: failedToday },
    { data: failedRows },
  ] = await Promise.all([
    admin
      .from("automation_queue")
      .select("*", { count: "exact", head: true })
      .in("status", ["queued", "processing", "paused"]),
    admin
      .from("automation_queue")
      .select("*", { count: "exact", head: true })
      .eq("status", "completed")
      .gte("completed_at", todayStart.toISOString()),
    admin
      .from("automation_queue")
      .select("*", { count: "exact", head: true })
      .eq("status", "failed")
      .gte("created_at", todayStart.toISOString()),
    admin
      .from("automation_queue")
      .select("id, application_id, error_log, created_at")
      .eq("status", "failed")
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  type FailedRow = {
    id: string;
    application_id: string;
    error_log: unknown;
    created_at: string;
  };
  const failed = (failedRows ?? []) as FailedRow[];

  // Resolve funder names: automation_queue.application_id -> applications ->
  // opportunities -> funders. Done as three batched lookups rather than a
  // nested PostgREST embed since the chain is three tables deep.
  const appIds = Array.from(new Set(failed.map((r) => r.application_id)));
  const appToOpp = new Map<string, string>();
  if (appIds.length > 0) {
    const { data: apps } = await admin
      .from("applications")
      .select("id, opportunity_id")
      .in("id", appIds);
    for (const a of (apps ?? []) as { id: string; opportunity_id: string }[]) {
      appToOpp.set(a.id, a.opportunity_id);
    }
  }

  const oppIds = Array.from(new Set(Array.from(appToOpp.values())));
  const oppToFunder = new Map<string, string | null>();
  if (oppIds.length > 0) {
    const { data: opps } = await admin
      .from("opportunities")
      .select("id, funder_id")
      .in("id", oppIds);
    for (const o of (opps ?? []) as { id: string; funder_id: string | null }[]) {
      oppToFunder.set(o.id, o.funder_id);
    }
  }

  const funderIds = Array.from(
    new Set(
      Array.from(oppToFunder.values()).filter((id): id is string => Boolean(id)),
    ),
  );
  const funderNames = new Map<string, string>();
  if (funderIds.length > 0) {
    const { data: funders } = await admin
      .from("funders")
      .select("id, name")
      .in("id", funderIds);
    for (const f of (funders ?? []) as { id: string; name: string }[]) {
      funderNames.set(f.id, f.name);
    }
  }

  const recent_failures = failed.map((row) => {
    const oppId = appToOpp.get(row.application_id);
    const funderId = oppId ? oppToFunder.get(oppId) : undefined;
    const funderName = funderId ? funderNames.get(funderId) : undefined;
    return {
      id: row.id,
      funder_name: funderName ?? "Unknown funder",
      error_message: lastErrorMessage(row.error_log) ?? "No error message recorded.",
      created_at: row.created_at,
    };
  });

  return NextResponse.json({
    active_count: activeCount ?? 0,
    completed_today: completedToday ?? 0,
    failed_today: failedToday ?? 0,
    recent_failures,
  });
}
