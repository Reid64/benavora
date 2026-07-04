import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

// GET /api/autoapply/follow-ups?status=&from=&to=
// Backs src/app/(dashboard)/autoapply/follow-ups/page.tsx, which previously
// called this path with no route behind it. Data comes from
// autoapply_follow_ups, the table src/lib/autoapply/follow-up-scheduler.ts
// already reads/writes.

export async function GET(request: Request) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  let query = supabase
    .from("autoapply_follow_ups")
    .select(
      "id, submission_id, organization_id, funder_id, sequence_number, scheduled_at, sent_at, status, template_type, content, response_received, cancel_reason, created_at, " +
        "funders:funder_id ( name ), " +
        "autoapply_submissions:submission_id ( submitted_at, status, confirmation_number )",
    )
    .eq("organization_id", organizationId)
    .order("scheduled_at", { ascending: true });

  if (status) query = query.eq("status", status);
  if (from) query = query.gte("scheduled_at", from);
  if (to) query = query.lte("scheduled_at", to);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json(
      { error: "Failed to load follow-ups.", code: "load_failed" },
      { status: 500 },
    );
  }

  const followUps = ((data ?? []) as unknown as Record<string, unknown>[]).map((row) => {
    const funder = row.funders as { name?: string } | null;
    const submission = row.autoapply_submissions as
      | { submitted_at?: string | null; status?: string | null; confirmation_number?: string | null }
      | null;
    return {
      id: row.id,
      submission_id: row.submission_id,
      organization_id: row.organization_id,
      funder_id: row.funder_id,
      sequence_number: row.sequence_number,
      scheduled_at: row.scheduled_at,
      sent_at: row.sent_at,
      status: row.status,
      template_type: row.template_type,
      content: row.content,
      response_received: row.response_received,
      cancel_reason: row.cancel_reason,
      created_at: row.created_at,
      funder_name: funder?.name ?? null,
      submission_submitted_at: submission?.submitted_at ?? null,
      submission_status: submission?.status ?? null,
      submission_confirmation_number: submission?.confirmation_number ?? null,
    };
  });

  return NextResponse.json({ follow_ups: followUps });
}
