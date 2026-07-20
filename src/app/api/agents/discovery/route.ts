import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { runOpportunityDiscovery } from "@/lib/agents/opportunity-discovery-agent";

// POST/GET /api/agents/discovery — Opportunity Discovery Agent
// (PLATFORM_VISION_ARCHITECTURE.md Pillar 2, AGENTS_v2.md AG-17).
//
// orgId comes from the x-organization-id header (set server-side by
// middleware.ts from the authenticated user's profile), matching the
// digital-twin route's pattern — discovery_matches is RLS-scoped to the
// caller's real organization_id, so a forged header just resolves to "no
// rows" here.

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
    const summary = await runOpportunityDiscovery(ctx.orgId, ctx.supabase);
    return NextResponse.json(summary);
  } catch {
    return jsonError("Opportunity discovery failed. Please try again.", 500);
  }
}

export async function GET() {
  const ctx = await requireAuth();
  if (!ctx) return jsonError("Authentication required.", 401);

  const { data, error } = await ctx.supabase
    .from("discovery_matches")
    .select("*")
    .eq("organization_id", ctx.orgId)
    .order("match_score", { ascending: false })
    .limit(10);

  if (error) {
    return jsonError("Failed to load discovery matches.", 500);
  }

  return NextResponse.json({ matches: data ?? [] });
}
