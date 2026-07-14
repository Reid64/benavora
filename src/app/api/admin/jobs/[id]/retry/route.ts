// POST /api/admin/jobs/[id]/retry — reset a failed automation_queue item back
// to 'queued' so the worker picks it up again. Platform-wide (cross-tenant)
// admin action, mirrors the org-scoped PUT retry in /api/automation/queue.

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type RouteContext = { params: { id: string } };

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST(_request: Request, { params }: RouteContext) {
  const gate = await requireRole("admin");
  if ("error" in gate) return gate.error;

  const { id } = params;
  if (!id) {
    return jsonError("Job id is required.", "invalid_input", 400);
  }

  const admin = createAdminClient();

  const { data, error } = await admin
    .from("automation_queue")
    .update({
      status: "queued",
      retry_count: 0,
      started_at: null,
      completed_at: null,
    })
    .eq("id", id)
    .eq("status", "failed")
    .select("id, status, retry_count")
    .single();

  if (error || !data) {
    return jsonError(
      "Automation job not found or not in a failed state.",
      "not_found",
      404,
    );
  }

  return NextResponse.json({ item: data });
}
