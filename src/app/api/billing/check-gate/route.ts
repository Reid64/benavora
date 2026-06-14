// Client-side tier gate preflight (Behavioral Contracts §25).
//
// GET /api/billing/check-gate?feature=<name>
//
// Returns TierCheckResult without blocking, so callers can show upgrade prompts
// or disable UI elements before the user hits a server-side 429.
// organization_id is always derived from the session profile, never from query
// params (Contracts §2).

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import {
  checkTierGate,
  type TierCheckResult,
  type TierFeature,
} from "@/lib/services/tier-gate";

export const runtime = "nodejs";

const VALID_FEATURES: readonly TierFeature[] = ["agent_run", "draft_generation"];

export async function GET(request: Request) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;

  const { organizationId } = gate;

  const { searchParams } = new URL(request.url);
  const feature = searchParams.get("feature");

  if (!feature || !(VALID_FEATURES as readonly string[]).includes(feature)) {
    return NextResponse.json(
      {
        error: `feature must be one of: ${VALID_FEATURES.join(", ")}.`,
        code: "invalid_feature",
      },
      { status: 400 },
    );
  }

  const result: TierCheckResult = await checkTierGate(
    organizationId,
    feature as TierFeature,
  );
  return NextResponse.json(result);
}
