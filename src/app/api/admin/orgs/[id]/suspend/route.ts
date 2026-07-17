import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { createAdminClient } from "@/lib/supabase/admin";

// Platform-admin action: suspend a tenant org. Gated the same way as the
// /admin and /admin/orgs/[id] pages (profiles.role via requireRole), not the
// requireAdmin() env-var stopgap used by the pre-existing sales/domains admin
// routes - this is a cross-tenant RBAC action, not the sales-ops tooling those
// routes cover.
export const runtime = "nodejs";

type RouteContext = { params: { id: string } };

export async function POST(_request: Request, { params }: RouteContext) {
  const gate = await requireRole("owner");
  if ("error" in gate) return gate.error;

  const { id } = params;
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("organizations")
    .update({ subscription_tier: "suspended", updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id, subscription_tier")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Organization not found or update failed.", code: "update_failed" },
      { status: error ? 500 : 404 },
    );
  }

  return NextResponse.json({ ok: true, organization: data });
}
