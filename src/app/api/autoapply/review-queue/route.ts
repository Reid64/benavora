import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseRiskFactors } from "@/components/autoapply/ManualQueue";
import type { Json } from "@/types/database";

// GET /api/autoapply/review-queue — AUTOAPPLY_ARCHITECTURE_V2.md §10C.
// Serves both tabs of the Human Review Queue in one round trip:
//   1. submission_queue rows paused for CAPTCHA/verification (§10B), scoped
//      to the caller's own org (fetched via the session-bound client, so
//      submission_queue's RLS policies — 066_fix_autoapply_rls_policies.sql —
//      apply naturally; .eq("organization_id", ...) is defense-in-depth).
//   2. autoapply_confirmation_ambiguous_matches rows (§10A) — this table has
//      RLS enabled with NO policies and is REVOKEd from anon/authenticated
//      entirely (114_gmail_confirmation_monitor.sql: "no dashboard user
//      queries these tables directly"), so it can only be read via the
//      service-role client. Its candidate_submission_ids are pooled
//      platform-wide (the Gmail monitor's own candidate query has no org
//      filter — src/lib/autoapply/confirmation-monitor.ts loadCandidates()),
//      so a match can legitimately span multiple orgs. Rather than expose
//      other orgs' submission/funder data to this caller (a real cross-org
//      leak — Behavioral Contracts' "no cross-org data leakage" rule), each
//      ambiguous row is filtered down to only the candidates that belong to
//      the caller's own org; a row with zero org-owned candidates is hidden
//      entirely, and a row with some hidden peers reports hiddenCandidateCount
//      so a reviewer knows the full candidate set was larger without seeing it.

export const runtime = "nodejs";

interface PausedRow {
  id: string;
  organization_id: string;
  funder_id: string | null;
  priority: number;
  status: string;
  automation_mode: string;
  pause_reason: string | null;
  paused_at: string | null;
  paused_screenshot_path: string | null;
  paused_history: Json | null;
  resume_count: number | null;
  created_at: string;
  funders: { name: string; giving_portal_url: string | null } | null;
  organizations: { name: string } | null;
  // Optional — 052_governance_layer.sql's ALTER TABLE adding these columns to
  // submission_queue has never been applied live (see ManualQueue.tsx's own
  // "Optional columns from future risk-engine migration" comment); selecting
  // via "*" rather than naming them explicitly means a missing column is
  // simply absent from the row, not a query error.
  risk_score?: number | null;
  risk_factors?: Json | null;
}

interface AmbiguousMatchRow {
  id: string;
  gmail_message_id: string;
  candidate_submission_ids: string[];
  sender: string | null;
  subject: string | null;
  received_at: string | null;
  status: string;
  created_at: string;
}

interface CandidateSubmissionRow {
  id: string;
  organization_id: string;
  funder_id: string | null;
  submitted_at: string | null;
  funders: { name: string } | null;
}

export async function GET() {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  // ── Tab 1: CAPTCHA/verification-paused items, this org only ──────────────
  const { data: pausedRaw, error: pausedErr } = await supabase
    .from("submission_queue")
    .select("*, funders(name, giving_portal_url), organizations(name)")
    .eq("organization_id", organizationId)
    .eq("status", "paused_verification")
    .order("paused_at", { ascending: true });

  if (pausedErr) {
    return NextResponse.json(
      { error: "Could not load paused submissions." },
      { status: 500 },
    );
  }

  const admin = createAdminClient();
  const pausedRows = (pausedRaw ?? []) as unknown as PausedRow[];

  // Signed screenshot thumbnails — the autoapply-screenshots bucket has zero
  // storage.objects policies (confirmed live), so the session client cannot
  // create a signed URL itself; the admin client does it here instead.
  const screenshotUrls = new Map<string, string>();
  await Promise.all(
    pausedRows
      .filter((r) => r.paused_screenshot_path)
      .map(async (r) => {
        const { data } = await admin.storage
          .from("autoapply-screenshots")
          .createSignedUrl(r.paused_screenshot_path as string, 300);
        if (data?.signedUrl) screenshotUrls.set(r.id, data.signedUrl);
      }),
  );

  const paused = pausedRows.map((r) => ({
    id: r.id,
    funderName: r.funders?.name ?? null,
    givingPortalUrl: r.funders?.giving_portal_url ?? null,
    orgName: r.organizations?.name ?? null,
    pauseReason: r.pause_reason,
    pausedAt: r.paused_at,
    screenshotUrl: screenshotUrls.get(r.id) ?? null,
    pausedHistory: r.paused_history,
    resumeCount: r.resume_count ?? 0,
    riskScore: r.risk_score ?? null,
    riskFactors: parseRiskFactors(r.risk_factors),
    createdAt: r.created_at,
  }));

  // ── Tab 2: ambiguous Gmail confirmation matches, filtered to this org ────
  const { data: ambiguousRaw, error: ambiguousErr } = await admin
    .from("autoapply_confirmation_ambiguous_matches")
    .select("*")
    .eq("status", "needs_manual_match")
    .order("received_at", { ascending: true });

  if (ambiguousErr) {
    return NextResponse.json(
      { error: "Could not load ambiguous confirmation matches." },
      { status: 500 },
    );
  }

  const ambiguousRows = (ambiguousRaw ?? []) as unknown as AmbiguousMatchRow[];
  const allCandidateIds = Array.from(
    new Set(ambiguousRows.flatMap((r) => r.candidate_submission_ids ?? [])),
  );

  let orgOwnedCandidates: CandidateSubmissionRow[] = [];
  if (allCandidateIds.length > 0) {
    const { data: subs } = await admin
      .from("autoapply_submissions")
      .select("id, organization_id, funder_id, submitted_at, funders(name)")
      .in("id", allCandidateIds)
      .eq("organization_id", organizationId);
    orgOwnedCandidates = (subs ?? []) as unknown as CandidateSubmissionRow[];
  }
  const orgCandidateMap = new Map(orgOwnedCandidates.map((c) => [c.id, c]));

  const ambiguous = ambiguousRows
    .map((r) => {
      const orgIds = (r.candidate_submission_ids ?? []).filter((id) =>
        orgCandidateMap.has(id),
      );
      if (orgIds.length === 0) return null;
      return {
        id: r.id,
        sender: r.sender,
        subject: r.subject,
        receivedAt: r.received_at,
        candidates: orgIds.map((id) => {
          const c = orgCandidateMap.get(id)!;
          return {
            submissionId: c.id,
            funderName: c.funders?.name ?? null,
            submittedAt: c.submitted_at,
          };
        }),
        hiddenCandidateCount:
          (r.candidate_submission_ids ?? []).length - orgIds.length,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  return NextResponse.json({ paused, ambiguous });
}
