// POST /api/automation/process — trigger the Automation Worker Agent (Agent 29)
// to process the next queued item for the authenticated org.
//
// Optional body: { queueItemId } — process a specific item instead of the
// highest-priority queued item.
//
// maxDuration is 300s (5 minutes) to match the per-item processing budget
// defined in BEHAVIORAL_CONTRACTS §23.

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { AutomationWorkerAgent } from "@/lib/agents/automation-worker";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 300;

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST(request: Request) {
  const roleCheck = await requireRole("writer");
  if ("error" in roleCheck) return roleCheck.error;

  let body: Record<string, unknown> = {};
  try {
    const raw = await request.text();
    if (raw.trim()) body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const queueItemId =
    typeof body.queueItemId === "string" && body.queueItemId.trim()
      ? body.queueItemId.trim()
      : undefined;

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Authentication required.", "unauthenticated", 401);

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, organization_id")
    .eq("id", user.id)
    .single();
  if (!profile) return jsonError("Profile not found.", "no_profile", 403);

  const organizationId = profile.organization_id as string;

  const worker = new AutomationWorkerAgent({
    client: supabase,
    organizationId,
    triggeredBy: profile.id as string,
  });

  try {
    const { runId, data } = await worker.process({ queueItemId });
    return NextResponse.json({ runId, ...data });
  } catch {
    return jsonError("Worker execution failed.", "worker_failed", 500);
  }
}
