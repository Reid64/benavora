import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { predictDeadlines } from "@/lib/intelligence/deadline-predictor";

// GET /api/intelligence/deadline-predictions
// org_id comes from the x-organization-id header, which middleware.ts injects
// after re-deriving it server-side from the authenticated user's profile row
// (never trusted from client input - Behavioral Contracts §2).

export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const orgId = headers().get("x-organization-id");

  if (!user || !orgId) {
    return NextResponse.json(
      { error: "Authentication required.", code: "unauthenticated" },
      { status: 401 },
    );
  }

  const predictions = await predictDeadlines(orgId, supabase);

  return NextResponse.json({ predictions });
}
