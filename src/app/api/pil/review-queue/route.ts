import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { getReviewQueue } from "@/lib/pil/human-review";
import type { HumanReviewStatus } from "@/lib/pil/types";

// GET /api/pil/review-queue — pending (or filtered) human review items.

export const runtime = "nodejs";

export async function GET(request: Request) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { organizationId } = gate;

  const { searchParams } = new URL(request.url);
  const status = (searchParams.get("status") as HumanReviewStatus | null) ?? undefined;

  const items = await getReviewQueue(organizationId, status);
  return NextResponse.json({ items });
}
