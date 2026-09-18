import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit/logger";

// POST /api/admin/orgs/[id]/impersonate — owner-only, same gate as the
// sibling /suspend route.
//
// Scope note: this sets a short-lived, httpOnly "viewing as" cookie and an
// audit trail (impersonation_log — SCHEMA_REGISTRY §55, currently unwired
// anywhere else in the app) so a platform admin's support session on
// /admin/orgs/[id] is attributable. It deliberately does NOT rewrite
// organization_id resolution anywhere else in the app (middleware.ts,
// requireRole, RLS) to actually browse the tenant's own UI as that tenant —
// doing so would mean overriding the "organization_id is derived from the
// session profile, never a cookie" rule (Behavioral Contracts §2) across
// every route, which is a materially larger and more security-sensitive
// change than one admin button, and not something to introduce silently.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COOKIE_NAME = "impersonation_org_id";
// WGR-074: bounded to 1 hour per STANDING_DIRECTIVES.
const COOKIE_MAX_AGE_SECONDS = 60 * 60; // 1 hour

type RouteContext = { params: { id: string } };

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST(request: Request, { params }: RouteContext) {
  const gate = await requireRole("owner");
  if ("error" in gate) return gate.error;
  const { userId } = gate;

  const orgId = params.id;
  const admin = createAdminClient();

  const orgRes = await admin
    .from("organizations")
    .select("id, name")
    .eq("id", orgId)
    .single();
  if (orgRes.error || !orgRes.data) {
    return jsonError("Organization not found.", "not_found", 404);
  }

  await admin.from("impersonation_log").insert({
    admin_id: userId,
    target_org_id: orgId,
    reason: "Platform admin support view from /admin/orgs",
    started_at: new Date().toISOString(),
  });

  await logAudit(admin, {
    organizationId: orgId,
    userId,
    action: "login",
    entityType: "organization",
    entityId: orgId,
    details: { admin_action: "impersonate" },
    request,
  });

  const response = NextResponse.json({
    ok: true,
    organization: orgRes.data,
    viewUrl: `/admin/orgs/${orgId}`,
  });
  response.cookies.set(COOKIE_NAME, orgId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE_SECONDS,
    path: "/admin",
  });
  return response;
}

export async function DELETE() {
  const gate = await requireRole("owner");
  if ("error" in gate) return gate.error;

  const response = NextResponse.json({ ok: true });
  response.cookies.delete(COOKIE_NAME);
  return response;
}
