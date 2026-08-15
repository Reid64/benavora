import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { buildDigitalTwin } from "@/lib/intelligence/digital-twin-builder";

// GET/POST /api/intelligence/digital-twin
//
// orgId comes from the x-organization-id header (set server-side by
// middleware.ts from the authenticated user's profile). The
// organizational_digital_twins table is RLS-scoped to the caller's real
// organization_id, so a forged header just resolves to "not found" here.
//
// buildDigitalTwin() is a full deterministic rebuild on every call -- there
// is no separate "read cached twin" path, so GET and POST both trigger a
// rebuild and return the fresh result.

export async function GET() {
  return rebuildAndRespond();
}

export async function POST() {
  return rebuildAndRespond();
}

async function rebuildAndRespond() {
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

  const headersList = headers();
  const orgId = headersList.get("x-organization-id");

  if (!orgId) {
    return NextResponse.json({ error: "orgId is required." }, { status: 400 });
  }

  // Demo Account Scope (DEMO_ACCOUNT_SCOPE_2026-08-15.md): buildDigitalTwin()
  // unconditionally upserts organizational_digital_twins, which migration
  // 138's DB trigger rejects for a restricted profile - and this route
  // rebuilds on every plain GET/page view, not just on an explicit save. For
  // a restricted profile, serve the already-computed twin instead of
  // attempting (and failing) a fresh rebuild, so viewing this page stays a
  // safe read.
  if (headersList.get("x-onboarding-edit-restricted") === "true") {
    const { data: cachedTwin, error: cachedError } = await supabase
      .from("organizational_digital_twins")
      .select("*")
      .eq("organization_id", orgId)
      .maybeSingle();
    if (cachedError) {
      return NextResponse.json(
        { error: "Failed to load digital twin." },
        { status: 404 },
      );
    }
    return NextResponse.json(
      cachedTwin ?? { organization_id: orgId, twin_completeness_score: 0 },
    );
  }

  try {
    const twin = await buildDigitalTwin(orgId, supabase);
    return NextResponse.json(twin);
  } catch {
    return NextResponse.json(
      { error: "Failed to build digital twin." },
      { status: 404 },
    );
  }
}
