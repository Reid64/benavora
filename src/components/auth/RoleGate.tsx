"use client";

import type { ReactNode } from "react";

import { useProfile } from "@/lib/hooks/useProfile";
import { hasRequiredRole, type UserRole } from "@/lib/utils/constants";

export type RoleGateProps = {
  /** Minimum role required to see `children` (owner > admin > writer > viewer). */
  requiredRole: UserRole;
  children: ReactNode;
  /** Rendered instead of `children` when the user's role is insufficient. */
  fallback?: ReactNode;
  /** Rendered while the profile is still loading. Defaults to nothing. */
  loadingFallback?: ReactNode;
};

/**
 * Conditionally renders UI based on the signed-in user's role (BLUEPRINT §3.2).
 * Hides actions a user cannot perform - e.g. wrap a "Delete" button in
 * <RoleGate requiredRole="admin">. This is a UX convenience only; the server
 * (role-gate.ts / RLS) is the real enforcement boundary.
 *
 * While the profile loads we render `loadingFallback` (nothing by default) so a
 * privileged control never flashes for a viewer before the role resolves.
 */
export function RoleGate({
  requiredRole,
  children,
  fallback = null,
  loadingFallback = null,
}: RoleGateProps) {
  const { profile, loading } = useProfile();

  if (loading) return <>{loadingFallback}</>;
  if (!hasRequiredRole(profile?.role, requiredRole)) return <>{fallback}</>;
  return <>{children}</>;
}
