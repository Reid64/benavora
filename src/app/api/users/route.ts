import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { logAudit } from "@/lib/audit/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { USER_ROLES } from "@/lib/utils/constants";
import type { Enums } from "@/types/database";

export const runtime = "nodejs";

type UserRole = Enums<"user_role">;

function jsonError(message: string, code: string, status: number) {
  // Consistent error shape across API routes (Behavioral Contracts §16).
  return NextResponse.json({ error: message, code }, { status });
}

/**
 * Organization user management (BLUEPRINT US-03, §3.2).
 *
 *   GET    → list every user in the caller's organization (any role; RLS scopes
 *            the rows). Returns role, email, name, and last login.
 *   PUT    { userId, role } → change a member's role (owner/admin). Admins may
 *            not grant or modify the owner role.
 *   DELETE { userId } → remove a member from the organization (owner only,
 *            never yourself). Deleting the auth user cascades their profile.
 *
 * organization_id is always derived from the session, never the body
 * (Contracts §2). RLS permits same-org writes, so role is enforced here.
 */

export async function GET() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase } = gate;

  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, last_login_at, created_at")
    .order("created_at", { ascending: true });

  if (error) {
    return jsonError("Could not load your team.", "load_failed", 500);
  }
  return NextResponse.json({ users: data ?? [] });
}

export async function PUT(request: Request) {
  const gate = await requireRole("admin");
  if ("error" in gate) return gate.error;
  const { supabase, userId, userRole, organizationId } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }
  const { userId: targetId, role } = (body ?? {}) as {
    userId?: unknown;
    role?: unknown;
  };

  if (typeof targetId !== "string" || targetId.trim() === "") {
    return jsonError("A target userId is required.", "invalid_input", 400);
  }
  if (
    typeof role !== "string" ||
    !(USER_ROLES as readonly string[]).includes(role)
  ) {
    return jsonError("A valid role is required.", "invalid_input", 400);
  }
  const newRole = role as UserRole;

  if (targetId === userId) {
    return jsonError(
      "You can't change your own role. Ask another owner or admin.",
      "self_role_change",
      400,
    );
  }

  // Load the target (RLS scopes this to the caller's org).
  const { data: target, error: targetError } = await supabase
    .from("profiles")
    .select("id, role, organization_id")
    .eq("id", targetId)
    .maybeSingle();
  if (targetError) {
    return jsonError("Could not load that user.", "load_failed", 500);
  }
  if (!target || target.organization_id !== organizationId) {
    return jsonError("That user is not in your organization.", "not_found", 404);
  }

  // Admins cannot grant the owner role, nor modify an existing owner
  // (Contracts §23: no granting a role higher than your own).
  if (userRole === "admin") {
    if (newRole === "owner") {
      return jsonError("Only an owner can assign the owner role.", "forbidden", 403);
    }
    if ((target.role as UserRole) === "owner") {
      return jsonError("Only an owner can change another owner's role.", "forbidden", 403);
    }
  }

  const { error: updateError } = await supabase
    .from("profiles")
    .update({ role: newRole, updated_at: new Date().toISOString() })
    .eq("id", targetId);
  if (updateError) {
    return jsonError("Could not update the role.", "update_failed", 500);
  }

  // Audit the role change (Behavioral Contracts §24).
  await logAudit(supabase, {
    organizationId,
    userId,
    action: "role_change",
    entityType: "user",
    entityId: targetId,
    details: { from: target.role, to: newRole },
    request,
  });

  return NextResponse.json({ user: { id: targetId, role: newRole } });
}

export async function DELETE(request: Request) {
  // Only owners may remove members (BLUEPRINT §3.2).
  const gate = await requireRole("owner");
  if ("error" in gate) return gate.error;
  const { supabase, userId, organizationId } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }
  const { userId: targetId } = (body ?? {}) as { userId?: unknown };

  if (typeof targetId !== "string" || targetId.trim() === "") {
    return jsonError("A target userId is required.", "invalid_input", 400);
  }
  if (targetId === userId) {
    return jsonError("You can't remove yourself.", "self_remove", 400);
  }

  // Confirm the target is in the caller's org before deleting (RLS-scoped read).
  const { data: target, error: targetError } = await supabase
    .from("profiles")
    .select("id, organization_id")
    .eq("id", targetId)
    .maybeSingle();
  if (targetError) {
    return jsonError("Could not load that user.", "load_failed", 500);
  }
  if (!target || target.organization_id !== organizationId) {
    return jsonError("That user is not in your organization.", "not_found", 404);
  }

  // Removing a member = deleting their account. profiles.id references
  // auth.users ON DELETE CASCADE, so deleting the auth user removes the profile.
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return jsonError("User management is not configured on this server.", "not_configured", 500);
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(targetId);
  if (deleteError) {
    return jsonError("Could not remove that user.", "delete_failed", 500);
  }

  // Audit the member removal (Behavioral Contracts §24).
  await logAudit(supabase, {
    organizationId,
    userId,
    action: "delete",
    entityType: "user",
    entityId: targetId,
    request,
  });

  return NextResponse.json({ removed: targetId });
}
