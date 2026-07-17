import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { sendMorningDigest } from "@/lib/agents/morning-digest";

// POST/GET /api/agents/morning-digest — Morning Digest
// (PLATFORM_VISION_ARCHITECTURE.md Pillar 2, AGENTS_v2.md AG-17 7:00 AM step).
//
// orgId comes from the x-organization-id header (set server-side by
// middleware.ts from the authenticated user's profile), matching the
// discovery route's pattern — every query inside sendMorningDigest is
// RLS-scoped to the caller's real organization_id, so a forged header just
// resolves to "no rows" here.

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
    await sendMorningDigest(ctx.orgId, ctx.supabase);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonError(
      err instanceof Error ? err.message : "Morning digest failed.",
      500,
    );
  }
}

export async function GET() {
  const ctx = await requireAuth();
  if (!ctx) return jsonError("Authentication required.", 401);

  const { data, error } = await ctx.supabase
    .from("alerts")
    .select("id, message, severity, created_at")
    .eq("organization_id", ctx.orgId)
    .like("dedup_key", "morning-digest:%")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return jsonError("Failed to load morning digest.", 500);
  }

  return NextResponse.json({ digest: data ?? null });
}
