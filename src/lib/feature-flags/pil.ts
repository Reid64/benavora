// PIL (Prospect Intelligence Layer) rollout gating.
//
// PIL is a major new system rolling out gradually (10% -> 25% -> 50% -> 100% of
// organizations, plus canary orgs ahead of the percentage rollout) with an instant
// killswitch if issues are detected. The rollout percentage and canary targeting
// live entirely in the LaunchDarkly dashboard against this one flag key — this
// module only wires that flag into the routes.
//
// Rollout is scoped by organization, not by individual user: every teammate at a
// given org must see the same on/off state, otherwise a percentage rollout would
// randomly split one customer's own team between "has PIL" and "doesn't."

import { NextResponse } from "next/server";

import { requireRole, type RoleContext, type UserRole } from "@/lib/auth/role-gate";
import { isFeatureEnabled, type LDContext } from "@/lib/feature-flags/ld-client";

export const PIL_ROLLOUT_FLAG_KEY = "pil-prospect-intelligence-layer";

export function pilOrgContext(organizationId: string): LDContext {
  return { kind: "organization", key: organizationId };
}

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

/** Killswitch check for the raw org id, for call sites with no user session (webhooks). */
export async function isPilEnabledForOrg(organizationId: string): Promise<boolean> {
  return isFeatureEnabled(PIL_ROLLOUT_FLAG_KEY, pilOrgContext(organizationId), false);
}

/**
 * Drop-in replacement for `requireRole` on every PIL route: enforces the role
 * requirement first (so an unauthenticated caller gets 401, not a leak of whether
 * PIL is enabled), then the rollout flag. Fails closed — an LD outage or unset flag
 * hides PIL rather than exposing an unfinished system to every organization.
 */
export async function requirePilRole(
  requiredRole: UserRole,
): Promise<RoleContext | { error: NextResponse }> {
  const gate = await requireRole(requiredRole);
  if ("error" in gate) return gate;

  const enabled = await isPilEnabledForOrg(gate.organizationId);
  if (!enabled) {
    return {
      error: jsonError(
        "This feature is not yet available for your organization.",
        "feature_disabled",
        403,
      ),
    };
  }

  return gate;
}
