// POST /api/drafts/queue/trigger — on-demand trigger for the draft auto-generator.
// Processes up to 3 pending queue items for the authenticated user's organization.
// Uses the same generation code path as the daily cron but limited in batch size to
// avoid exhausting the 300-second serverless function budget.
// Derives organization_id from the authenticated session (never the request body).

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { createAdminClient } from "@/lib/supabase/admin";
import { DraftAutoGenerator } from "@/lib/drafts/auto-generator";
import { checkRateLimit } from "@/lib/utils/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Non-streaming Claude drafts at max_tokens=8192 take ~180s; allow 3 items.
export const maxDuration = 300;

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST(_request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { organizationId, userId } = gate;

  if (!checkRateLimit(`drafts-queue-trigger:${userId}`)) {
    return jsonError(
      "Too many draft-queue triggers. Try again in a bit.",
      "rate_limited",
      429,
    );
  }

  const admin = createAdminClient();
  const generator = new DraftAutoGenerator(admin);

  const result = await generator.processQueue(organizationId, 3);

  return NextResponse.json({
    generated: result.generated,
    failed: result.failed,
    skipped_limit: result.skipped_limit,
    remaining_budget: result.remaining_budget,
  });
}
