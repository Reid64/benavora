import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { createAdminClient } from "@/lib/supabase/admin";

// PATCH /api/autoapply/review-queue/ambiguous/[id]/resolve —
// AUTOAPPLY_ARCHITECTURE_V2.md §10C's "equivalent resolve action" for Tab 2.
// Body: { submissionId: string | null } — a candidate id from the row's
// candidate_submission_ids array, or null for "none of these."
//
// autoapply_confirmation_ambiguous_matches has RLS enabled with no policies
// and is REVOKEd from anon/authenticated (114_gmail_confirmation_monitor.sql)
// — only reachable via the service-role client, same as the GET route.
//
// Concurrency guard: a plain conditional .update().eq("status", ...).select()
// via the admin client IS a single atomic UPDATE ... WHERE ... RETURNING
// (no read-then-write) — this table has no column-referencing expression to
// build, unlike submission_queue's paused_history, so no RPC function is
// needed here. Zero rows returned means another reviewer already resolved
// or dismissed this match.
//
// Never trusts the client's submissionId blindly: it must appear in the
// row's own candidate_submission_ids AND belong to the caller's own org —
// both checked server-side before any write, matching the same cross-org
// leakage guard the GET route applies when building the candidate list.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AmbiguousMatchRow {
  id: string;
  candidate_submission_ids: string[];
  status: string;
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { organizationId } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const { submissionId } = (body ?? {}) as { submissionId?: unknown };
  if (submissionId !== null && typeof submissionId !== "string") {
    return NextResponse.json(
      { error: "submissionId must be a string or null." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  const { data: matchRow, error: matchErr } = await admin
    .from("autoapply_confirmation_ambiguous_matches")
    .select("id, candidate_submission_ids, status")
    .eq("id", params.id)
    .maybeSingle<AmbiguousMatchRow>();

  if (matchErr || !matchRow) {
    return NextResponse.json(
      { error: "Ambiguous match not found." },
      { status: 404 },
    );
  }

  if (submissionId !== null) {
    if (!matchRow.candidate_submission_ids?.includes(submissionId)) {
      return NextResponse.json(
        { error: "submissionId is not a candidate for this match." },
        { status: 400 },
      );
    }
    const { data: sub, error: subErr } = await admin
      .from("autoapply_submissions")
      .select("id")
      .eq("id", submissionId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (subErr || !sub) {
      return NextResponse.json(
        { error: "submissionId does not belong to your organization." },
        { status: 403 },
      );
    }
  }

  const { data: resolved, error: resolveErr } = await admin
    .from("autoapply_confirmation_ambiguous_matches")
    .update({ status: submissionId !== null ? "resolved" : "dismissed" })
    .eq("id", params.id)
    .eq("status", "needs_manual_match")
    .select("id");

  if (resolveErr) {
    return NextResponse.json(
      { error: "Could not resolve this match." },
      { status: 500 },
    );
  }

  if (!resolved || resolved.length === 0) {
    return NextResponse.json(
      {
        error: "Already handled by another reviewer.",
        code: "already_handled",
      },
      { status: 409 },
    );
  }

  // Same confirmation_email_received update the Gmail monitor's
  // exactly-one-match path performs (§10A step 4 / confirmation-monitor.ts).
  if (submissionId !== null) {
    await admin
      .from("autoapply_submissions")
      .update({
        confirmation_email_received: true,
        confirmation_received_at: new Date().toISOString(),
      })
      .eq("id", submissionId)
      .eq("organization_id", organizationId);
  }

  return NextResponse.json({ success: true, id: params.id });
}
