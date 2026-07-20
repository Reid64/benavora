import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { pollFederalSources } from "@/lib/sources/federal-grants-poller";

// POST /api/sources/poll — combined Grants.gov + SAM.gov + Federal Register
// poll for the caller's own org.
//
// orgId comes from the x-organization-id header (set server-side by
// middleware.ts from the authenticated user's profile), matching
// src/app/api/agents/discovery/route.ts's pattern — every query
// pollFederalSources runs is explicitly scoped by organizationId, so a forged
// header just resolves to "no rows" here.
//
// Distinct from the existing CRON_SECRET-gated /api/sources/grantsgov and
// /api/sources/samgov routes: those are single-source system jobs run under
// the service-role admin client (see their own header comments); this route
// is the on-demand, session-scoped, all-three-sources sibling a user can
// trigger from the app.

export const runtime = "nodejs";
export const maxDuration = 300;

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function requireAuth() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const orgId = headers().get("x-organization-id");
  if (!orgId) return null;

  return { supabase, orgId };
}

export async function POST() {
  const ctx = await requireAuth();
  if (!ctx) return jsonError("Authentication required.", 401);

  try {
    const results = await pollFederalSources(ctx.orgId, ctx.supabase);
    return NextResponse.json({ results });
  } catch (err) {
    console.error("[sources/poll]", err);
    return jsonError("Federal source poll failed.", 500);
  }
}
