// GET  /api/automation/queue  — list automation_queue items for the org.
// POST /api/automation/queue  — enqueue an application for automation.
//
// POST body: { applicationId, automationLevel? }
// Priority is derived from success_probability_scores if available:
//   80+ → 5, 60-79 → 4, 40-59 → 3, 20-39 → 2, 0-19 → 1 (BEHAVIORAL_CONTRACTS §23).

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

function priorityFromScore(score: number): number {
  if (score >= 80) return 5;
  if (score >= 60) return 4;
  if (score >= 40) return 3;
  if (score >= 20) return 2;
  return 1;
}

// ---------------------------------------------------------------------------
// GET — list queue items
// ---------------------------------------------------------------------------

export async function GET() {
  const roleCheck = await requireRole("writer");
  if ("error" in roleCheck) return roleCheck.error;

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Authentication required.", "unauthenticated", 401);

  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", user.id)
    .single();
  if (!profile) return jsonError("Profile not found.", "no_profile", 403);
  const organizationId = profile.organization_id as string;

  const { data, error } = await supabase
    .from("automation_queue")
    .select(
      `id, priority, status, automation_level, retry_count, max_retries,
       error_log, created_at, started_at, completed_at,
       applications ( id, stage, opportunities ( name ) )`,
    )
    .eq("organization_id", organizationId)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true });

  if (error) {
    return jsonError("Failed to fetch queue.", "db_error", 500);
  }

  return NextResponse.json({ items: data ?? [] });
}

// ---------------------------------------------------------------------------
// POST — add an application to the queue
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  const roleCheck = await requireRole("writer");
  if ("error" in roleCheck) return roleCheck.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const { applicationId, automationLevel } = (body ?? {}) as {
    applicationId?: unknown;
    automationLevel?: unknown;
  };

  if (typeof applicationId !== "string" || !applicationId.trim()) {
    return jsonError("applicationId is required.", "invalid_input", 400);
  }

  const validLevels = ["supervised", "semi_autonomous", "autonomous"];
  const level =
    typeof automationLevel === "string" && validLevels.includes(automationLevel)
      ? automationLevel
      : "supervised";

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Authentication required.", "unauthenticated", 401);

  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", user.id)
    .single();
  if (!profile) return jsonError("Profile not found.", "no_profile", 403);
  const organizationId = profile.organization_id as string;

  // Verify the application belongs to this org.
  const { data: app } = await supabase
    .from("applications")
    .select("id")
    .eq("id", applicationId.trim())
    .eq("organization_id", organizationId)
    .single();

  if (!app) {
    return jsonError("Application not found.", "not_found", 404);
  }

  // Derive priority from success_probability_scores if available.
  const { data: scoreRow } = await supabase
    .from("success_probability_scores")
    .select("probability_score")
    .eq("application_id", applicationId.trim())
    .eq("organization_id", organizationId)
    .maybeSingle();

  const priority =
    scoreRow?.probability_score != null
      ? priorityFromScore(scoreRow.probability_score as number)
      : 3;

  // Prevent duplicate 'queued' or 'processing' entries for the same application.
  const { data: existing } = await supabase
    .from("automation_queue")
    .select("id, status")
    .eq("application_id", applicationId.trim())
    .eq("organization_id", organizationId)
    .in("status", ["queued", "processing"])
    .maybeSingle();

  if (existing) {
    return jsonError(
      `Application is already in the queue with status '${existing.status as string}'.`,
      "already_queued",
      409,
    );
  }

  const { data: queued, error: insertError } = await supabase
    .from("automation_queue")
    .insert({
      organization_id: organizationId,
      application_id: applicationId.trim(),
      priority,
      automation_level: level,
    })
    .select("id, priority, status, automation_level")
    .single();

  if (insertError || !queued) {
    return jsonError("Failed to add to queue.", "db_error", 500);
  }

  return NextResponse.json({ item: queued }, { status: 201 });
}
