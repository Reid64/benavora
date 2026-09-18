// GET /api/contacts/tasks/[taskId]/download — row #77 Multi-Channel Outreach.
// Mints a fresh 1-hour signed URL for a mail_letter task's stored PDF.
// contact_tasks.asset_path stores the Storage path, not a URL, since signed
// URLs expire (matches the Board Report convention in
// src/app/api/reports/board/route.ts) - re-signed on every download click.

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const STORAGE_BUCKET = process.env.STORAGE_DOCUMENTS_BUCKET ?? "documents";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase } = gate;
  const { taskId } = await params;

  const { data: task, error } = await supabase
    .from("contact_tasks")
    .select("id, task_type, asset_path")
    .eq("id", taskId)
    .maybeSingle();

  if (error || !task || task.task_type !== "mail_letter" || !task.asset_path) {
    return jsonError("No downloadable file for this task.", 404);
  }

  const admin = createAdminClient();
  const { data: signed, error: signError } = await admin.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(task.asset_path, 3600);

  if (signError || !signed?.signedUrl) {
    return jsonError("Could not generate a download link.", 500);
  }

  return NextResponse.json({ downloadUrl: signed.signedUrl });
}
