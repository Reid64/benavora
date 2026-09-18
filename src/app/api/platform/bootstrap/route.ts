import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import type { Enums } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StaffPermission = Enums<"staff_permission">;

// Full staff_permission enum (19 values, mirrors migration + pg_enum).
const ALL_PERMISSIONS: StaffPermission[] = [
  "tenant_view",
  "tenant_manage",
  "tenant_impersonate",
  "billing_view",
  "billing_manage",
  "feature_flags_view",
  "feature_flags_manage",
  "staff_view",
  "staff_manage",
  "queue_view",
  "queue_manage",
  "queue_emergency_stop",
  "analytics_view",
  "error_view",
  "error_resolve",
  "sales_outreach_view",
  "sales_outreach_manage",
  "system_health_view",
  "audit_log_view",
];

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ ok: false, error: message, code }, { status });
}

/**
 * POST /api/platform/bootstrap
 *
 * One-time setup endpoint to promote a user to platform_owner.
 * SECURITY: This endpoint is intentionally unauthenticated for initial setup,
 * but self-disables after first platform_owner is created.
 *
 * Body: { email: string }
 */
export async function POST(request: Request) {
  const admin = createAdminClient();

  // SECURITY: refuse to run at all once a platform_owner already exists —
  // otherwise any authenticated caller could self-grant platform_owner by
  // just knowing this endpoint's shape.
  const { data: existingOwner, error: ownerCheckErr } = await admin
    .from("platform_admins")
    .select("id")
    .eq("platform_role", "platform_owner")
    .limit(1)
    .maybeSingle();

  if (ownerCheckErr) {
    return jsonError(
      "Failed to check for an existing platform owner.",
      "owner_check_failed",
      500,
    );
  }

  if (existingOwner) {
    return jsonError(
      "Bootstrap already completed. Platform owner exists.",
      "already_bootstrapped",
      403,
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "bad_json", 400);
  }

  const email =
    typeof body === "object" && body !== null && "email" in body
      ? (body as { email?: unknown }).email
      : undefined;

  if (typeof email !== "string" || email.trim().length === 0) {
    return jsonError("Field 'email' is required.", "missing_email", 400);
  }

  const normalizedEmail = email.trim().toLowerCase();

  // Look up the user in auth.users by email. The admin API paginates, so scan
  // pages until we find a match.
  let userId: string | null = null;
  let userFullName: string | null = null;
  let page = 1;
  const perPage = 1000;
  // Cap the scan to avoid an unbounded loop on very large user tables.
  for (let i = 0; i < 50 && !userId; i++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) {
      return jsonError("Failed to query auth users.", "auth_query_failed", 500);
    }
    const users = data?.users ?? [];
    const match = users.find(
      (u) => (u.email ?? "").toLowerCase() === normalizedEmail,
    );
    if (match) {
      userId = match.id;
      userFullName =
        (match.user_metadata?.full_name as string | undefined) ?? null;
      break;
    }
    if (users.length < perPage) break; // no more pages
    page += 1;
  }

  if (!userId) {
    return jsonError(
      `No auth user found with email '${normalizedEmail}'. The user must sign up first.`,
      "user_not_found",
      404,
    );
  }

  // Already a platform admin? Idempotent — report and exit.
  const { data: existing, error: existingErr } = await admin
    .from("platform_admins")
    .select("id, platform_role, is_active")
    .eq("user_id", userId)
    .maybeSingle();

  if (existingErr) {
    return jsonError(
      "Failed to check existing platform admin.",
      "lookup_failed",
      500,
    );
  }

  if (existing) {
    return NextResponse.json({
      ok: true,
      status: "already_exists",
      message: `User '${normalizedEmail}' is already a platform admin.`,
      admin: existing,
    });
  }

  // Insert as platform_owner with the full permission set.
  const { data: inserted, error: insertErr } = await admin
    .from("platform_admins")
    .insert({
      user_id: userId,
      email: normalizedEmail,
      full_name: userFullName ?? normalizedEmail,
      platform_role: "platform_owner",
      permissions: ALL_PERMISSIONS,
      is_active: true,
    })
    .select("id, email, platform_role, is_active")
    .single();

  if (insertErr) {
    return jsonError(
      `Failed to create platform admin: ${insertErr.message}`,
      "insert_failed",
      500,
    );
  }

  return NextResponse.json({
    ok: true,
    status: "created",
    message: `User '${normalizedEmail}' promoted to platform_owner.`,
    admin: inserted,
  });
}
