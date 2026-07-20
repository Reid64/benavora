import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { computeGrantProbability } from "@/lib/intelligence/grant-probability-engine";

// POST /api/intelligence/grant-probability
//
// Accepts { opportunityId } in the request body. orgId is always derived
// server-side from the x-organization-id header (set by middleware.ts from
// the authenticated user's profile) -- never trusted from the request body
// (Behavioral Contracts §2).

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

  const { opportunityId } = (body ?? {}) as {
    opportunityId?: unknown;
  };

  if (typeof opportunityId !== "string" || opportunityId.trim() === "") {
    return NextResponse.json(
      { error: "opportunityId is required." },
      { status: 400 },
    );
  }

  const orgId = headers().get("x-organization-id");

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
  } catch {
    return NextResponse.json(
      { error: "Failed to compute grant probability." },
      { status: 404 },
    );
  }
}
