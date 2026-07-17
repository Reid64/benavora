import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { computeGrantProbability } from "@/lib/intelligence/grant-probability-engine";

// POST /api/intelligence/grant-probability
//
// Accepts { opportunityId, orgId } in the request body. orgId falls back to
// the x-organization-id header (set server-side by middleware.ts from the
// authenticated user's profile) when the body omits it. Both the
// opportunities and opportunity_probability_scores tables are RLS-scoped to
// the caller's real organization_id (profiles.organization_id via the
// session client), so a mismatched/forged orgId cannot read or write another
// org's data -- it just resolves to "not found" here.

export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const { opportunityId, orgId: bodyOrgId } = (body ?? {}) as {
    opportunityId?: unknown;
    orgId?: unknown;
  };

  if (typeof opportunityId !== "string" || opportunityId.trim() === "") {
    return NextResponse.json(
      { error: "opportunityId is required." },
      { status: 400 },
    );
  }

  const orgId =
    typeof bodyOrgId === "string" && bodyOrgId.trim() !== ""
      ? bodyOrgId.trim()
      : headers().get("x-organization-id");

  if (!orgId) {
    return NextResponse.json({ error: "orgId is required." }, { status: 400 });
  }

  try {
    const result = await computeGrantProbability(
      opportunityId.trim(),
      orgId,
      supabase,
    );
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Failed to compute grant probability.",
      },
      { status: 404 },
    );
  }
}
