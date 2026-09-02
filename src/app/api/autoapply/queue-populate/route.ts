// POST /api/autoapply/queue-populate — on-demand trigger for AutoApply queue
// population from funder intelligence ("Populate AutoApply Queue from
// Intelligence" dashboard button). Runs the same populateQueue path as the
// nightly cron (src/app/api/cron/autoapply/route.ts) but for a single org,
// triggered synchronously by a user.
// Derives organization_id from the authenticated session (never the request body).

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { createAdminClient } from "@/lib/supabase/admin";
import { populateQueue } from "@/lib/autoapply/auto-queue-populator";
import { checkRateLimit } from "@/lib/utils/rate-limit";

export const runtime = "nodejs";
// Iterates funders with cross-client dedup + domain throttle checks per row;
// allow the full serverless budget for larger batches.
export const maxDuration = 300;

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { organizationId, userId } = gate;

  if (!checkRateLimit(`autoapply-queue-populate:${userId}`)) {
    return jsonError(
      "Too many queue-populate triggers. Try again in a bit.",
      "rate_limited",
      429,
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const { batchSize } = (body ?? {}) as { batchSize?: unknown };
  let maxItems: number | undefined;
  if (batchSize !== undefined) {
    if (typeof batchSize !== "number" || !Number.isFinite(batchSize) || batchSize <= 0) {
      return jsonError("batchSize must be a positive number.", "invalid_batch_size", 400);
    }
    maxItems = Math.floor(batchSize);
  }

  const admin = createAdminClient();

  try {
    const result = await populateQueue({
      organizationId,
      supabase: admin,
      maxItems,
      dry_run: false,
    });

    return NextResponse.json({
      status: "success",
      queued: result.queued,
      skipped: result.skipped,
      dedupWindowDays: result.dedupWindowDays,
      reasons: result.reasons,
    });
  } catch {
    return jsonError("Failed to populate the queue.", "populate_failed", 500);
  }
}
