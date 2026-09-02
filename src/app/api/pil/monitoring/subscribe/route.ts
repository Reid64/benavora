import { NextResponse } from "next/server";

import { requirePilRole } from "@/lib/feature-flags/pil";
import { createSubscription } from "@/lib/pil/monitoring";
import { getPilClient } from "@/lib/pil/db";
import type { MonitoringTriggerType } from "@/lib/pil/types";

// POST /api/pil/monitoring/subscribe -- create a monitoring subscription for
// a prospect (PROSPECT_INTELLIGENCE_ARCHITECTURE.md Section 1.6). Next.js
// app-router route files are one file per literal path segment, so the
// task's single "src/app/api/pil/monitoring/route.ts" covering both
// /subscribe and /events isn't representable as one file -- this mirrors the
// existing review-queue split (route.ts + [itemId]/decision/route.ts)
// instead: subscribe/route.ts (POST) and events/route.ts (GET).

export const runtime = "nodejs";

const VALID_TRIGGER_TYPES: MonitoringTriggerType[] = [
  "company_sale",
  "acquisition",
  "ipo",
  "executive_appointment",
  "retirement",
  "foundation_appointment",
  "board_appointment",
  "new_nonprofit_affiliation",
  "major_charitable_gift",
  "new_foundation_filing",
  "corporate_giving_program_launch",
  "geographic_expansion",
  "significant_business_event",
  "philanthropic_announcement",
];

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST(request: Request) {
  const gate = await requirePilRole("writer");
  if ("error" in gate) return gate.error;
  const { organizationId } = gate;

  let body: { prospectId?: string; triggerTypes?: string[] };
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body.", "invalid_body", 400);
  }

  if (!body.prospectId || typeof body.prospectId !== "string") {
    return jsonError("prospectId is required.", "missing_prospect_id", 400);
  }
  if (!Array.isArray(body.triggerTypes) || body.triggerTypes.length === 0) {
    return jsonError("triggerTypes must be a non-empty array.", "missing_trigger_types", 400);
  }
  const invalid = body.triggerTypes.filter((t) => !VALID_TRIGGER_TYPES.includes(t as MonitoringTriggerType));
  if (invalid.length > 0) {
    return jsonError(`Invalid trigger type(s): ${invalid.join(", ")}.`, "invalid_trigger_type", 400);
  }

  const { data: prospect, error: prospectError } = await getPilClient()
    .from("pil_prospects")
    .select("id")
    .eq("id", body.prospectId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (prospectError) throw prospectError;
  if (!prospect) {
    return jsonError("Prospect not found.", "prospect_not_found", 404);
  }

  const subscription = await createSubscription({
    orgId: organizationId,
    prospectId: body.prospectId,
    triggerTypes: body.triggerTypes as MonitoringTriggerType[],
  });

  return NextResponse.json({ subscription });
}
