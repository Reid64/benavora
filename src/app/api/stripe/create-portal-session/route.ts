import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { logAudit } from "@/lib/audit/logger";
import { createPortalSession, isStripeConfigured } from "@/lib/payments/stripe";

/**
 * POST /api/stripe/create-portal-session (BLUEPRINT Phase 5 / Behavioral
 * Contracts §22). Creates a Stripe Billing Portal session for the
 * authenticated org's Stripe customer and returns the redirect URL.
 *
 * Billing is owner-only (BLUEPRINT §3.2: admins cannot manage billing).
 * organization_id is derived from the session profile, never the request body
 * (Contracts §2, §16). Delegates to the same createPortalSession() used by
 * POST /api/billing { action: "portal" } - one Stripe portal implementation,
 * two entry points, per the Settings > Billing page's requested contract.
 */
export const runtime = "nodejs";

export async function POST(request: Request) {
  const gate = await requireRole("owner");
  if ("error" in gate) return gate.error;
  const { organizationId, userId, supabase } = gate;

  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: "Billing is not configured on this server.", code: "not_configured" },
      { status: 500 },
    );
  }

  try {
    const { url } = await createPortalSession(organizationId);
    await logAudit(supabase, {
      organizationId,
      userId,
      action: "billing_change",
      entityType: "subscription",
      details: { action: "portal" },
      request,
    });
    return NextResponse.json({ url });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not open the billing portal.";
    return NextResponse.json({ error: message, code: "billing_error" }, { status: 502 });
  }
}
