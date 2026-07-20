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

  const orgId = headers().get("x-organization-id");

  if (!orgId) {
    return NextResponse.json({ error: "orgId is required." }, { status: 400 });
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
