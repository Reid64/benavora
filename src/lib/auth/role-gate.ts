// Server-side role enforcement (BLUEPRINT §3.2, Behavioral Contracts §16/§23).
//
// SERVER-ONLY. Imports the session-bound Supabase server client, so this module
// must never be imported by a Client Component. The pure role hierarchy lives in
// `@/lib/utils/constants` (ROLE_HIERARCHY / hasRequiredRole) so client
// components can share it without dragging server code into the browser bundle.
//
// Two layers:
//   - checkPermission(userId, requiredRole) - the primitive asked for in the
//     build task: looks up a user's role and reports whether it suffices.
//   - requireRole(requiredRole) - the convenience used by route handlers:
//     authenticates the session, derives organization_id from the profile
//     (never the request body - Contracts §2), and enforces the role in one call.

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { ROLE_HIERARCHY, hasRequiredRole } from "@/lib/utils/constants";
import type { Enums } from "@/types/database";

export type UserRole = Enums<"user_role">;

// Re-exported so callers can depend on a single import for role logic.
export { ROLE_HIERARCHY, hasRequiredRole };

export interface PermissionResult {
  allowed: boolean;
  userRole: UserRole | null;
}

/**
 * Verify a user holds at least `requiredRole`. Reads the user's role from their
 * profile row. Pass a client to reuse an existing one; otherwise a session
 * server client is created. Returns `{ allowed, userRole }` - `userRole` is null
 * when the profile cannot be resolved (treated as not allowed).
 */
export async function checkPermission(
  userId: string,
  requiredRole: UserRole,
  client?: SupabaseClient,
): Promise<PermissionResult> {
  const supabase = client ?? createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();

  if (error || !data) {
    return { allowed: false, userRole: null };
  }
  const userRole = data.role as UserRole;
  return { allowed: hasRequiredRole(userRole, requiredRole), userRole };
}

/** Caller context returned once a route's role requirement is satisfied. */
export interface RoleContext {
  supabase: SupabaseClient;
  userId: string;
  userRole: UserRole;
  organizationId: string;
}

function jsonError(message: string, code: string, status: number) {
  // Consistent error shape across API routes (Behavioral Contracts §16).
  return NextResponse.json({ error: message, code }, { status });
}

/**
 * Route guard. Authenticates the session, loads the caller's profile, and
 * enforces `requiredRole`. On success returns the session client plus the
 * caller's id, role, and organization_id (derived server-side, never trusted
 * from the body - Contracts §2). On failure returns a ready-to-send error
 * response, so handlers can do:
 *
 *   const gate = await requireRole("admin");
 *   if ("error" in gate) return gate.error;
 *   const { organizationId } = gate;
 */
export async function requireRole(
  requiredRole: UserRole,
): Promise<RoleContext | { error: NextResponse }> {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: jsonError("Authentication required.", "unauthenticated", 401) };
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("organization_id, role")
    .eq("id", user.id)
    .single();
  if (error || !profile) {
    return { error: jsonError("Could not resolve your profile.", "no_profile", 403) };
  }

  const userRole = profile.role as UserRole;
  if (!hasRequiredRole(userRole, requiredRole)) {
    return {
      error: jsonError(
        "You do not have permission to perform this action.",
        "forbidden",
        403,
      ),
    };
  }

  return {
    supabase,
    userId: user.id,
    userRole,
    organizationId: profile.organization_id as string,
  };
}
