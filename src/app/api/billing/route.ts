import { NextResponse } from "next/server";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/role-gate";
import { logAudit } from "@/lib/audit/logger";
import {
  createCheckoutSession,
  createPortalSession,
  getSubscription,
  isStripeConfigured,
  priceIdForTier,
} from "@/lib/payments/stripe";
import {
  SUBSCRIPTION_TIERS,
  TIER_LIMITS,
  type SubscriptionTier,
} from "@/lib/utils/constants";

/**
 * Billing API (BLUEPRINT Phase 5 / Behavioral Contracts §22).
 *
 *   GET  → current subscription, usage vs. tier limits, and invoice history.
 *   POST { action: 'checkout', priceId } → Stripe Checkout session URL.
 *   POST { action: 'portal' }            → Stripe Billing Portal session URL.
 *
 * Billing is owner-only (BLUEPRINT §3.2: admins cannot manage billing).
 * organization_id is derived from the session profile, never the body
 * (Contracts §2, §16).
 */

export const runtime = "nodejs";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

/** Billing is owner-only (BLUEPRINT §3.2: admins cannot manage billing). */
async function resolveOwner(): Promise<
  | { organizationId: string; userId: string; supabase: SupabaseClient }
  | { error: NextResponse }
> {
  const gate = await requireRole("owner");
  if ("error" in gate) return { error: gate.error };
  return {
    organizationId: gate.organizationId,
    userId: gate.userId,
    supabase: gate.supabase,
  };
}

function startOfTodayIso(): string {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).toISOString();
}

function startOfMonthIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export async function GET() {
  const resolved = await resolveOwner();
  if ("error" in resolved) return resolved.error;
  const { organizationId } = resolved;

  const supabase = createClient();
  const subscription = await getSubscription(organizationId);
  const limits = TIER_LIMITS[subscription.tier];

  // Live usage from real tables (no mocks - Six Laws #4). All RLS-scoped to org.
  const [
    usersRes,
    profilesRes,
    agentRunsRes,
    documentsRes,
    invoicesRes,
    autoapplyRes,
  ] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase.from("search_profiles").select("id", { count: "exact", head: true }),
    supabase
      .from("agent_runs")
      .select("id", { count: "exact", head: true })
      .gte("created_at", startOfTodayIso()),
    supabase.from("documents").select("file_size"),
    supabase
      .from("invoices")
      .select(
        "id, amount_cents, currency, status, description, invoice_url, period_start, period_end, paid_at, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(50),
    // AutoApply has no plan-tiered limit (TIER_LIMITS has no autoapply field),
    // so this is a live informational count only - never a fabricated limit.
    supabase
      .from("submission_queue")
      .select("id", { count: "exact", head: true })
      .gte("created_at", startOfMonthIso()),
  ]);

  const storageBytes = (
    (documentsRes.data as { file_size: number | null }[] | null) ?? []
  ).reduce((sum, doc) => sum + (doc.file_size ?? 0), 0);

  const usage = {
    agent_runs: { used: agentRunsRes.count ?? 0, limit: limits.agent_runs_per_day },
    storage_mb: {
      used: Math.round((storageBytes / (1024 * 1024)) * 10) / 10,
      limit: limits.storage_mb,
    },
    users: { used: usersRes.count ?? 0, limit: limits.users },
    search_profiles: {
      used: profilesRes.count ?? 0,
      limit: limits.search_profiles,
    },
  };

  return NextResponse.json({
    subscription,
    usage,
    invoices: invoicesRes.data ?? [],
    autoapplySubmissionsThisMonth: autoapplyRes.count ?? 0,
    billingEnabled: isStripeConfigured(),
  });
}

export async function POST(request: Request) {
  const resolved = await resolveOwner();
  if ("error" in resolved) return resolved.error;
  const { organizationId, userId, supabase } = resolved;

  if (!isStripeConfigured()) {
    return jsonError("Billing is not configured on this server.", "not_configured", 500);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }
  const { action, priceId, tier } = (body ?? {}) as {
    action?: unknown;
    priceId?: unknown;
    tier?: unknown;
  };

  try {
    if (action === "checkout") {
      // Accept an explicit Stripe priceId, or resolve one from a known tier
      // (price ids are server-only env vars, so the client sends the tier).
      let resolvedPriceId: string | null = null;
      if (typeof priceId === "string" && priceId) {
        resolvedPriceId = priceId;
      } else if (
        typeof tier === "string" &&
        (SUBSCRIPTION_TIERS as readonly string[]).includes(tier)
      ) {
        resolvedPriceId = priceIdForTier(tier as SubscriptionTier);
        if (!resolvedPriceId) {
          return jsonError(
            "That plan is not available for checkout.",
            "price_not_configured",
            400,
          );
        }
      }
      if (!resolvedPriceId) {
        return jsonError("A plan or priceId is required for checkout.", "invalid_input", 400);
      }
      const { url } = await createCheckoutSession(organizationId, resolvedPriceId);
      // Audit the billing change (Behavioral Contracts §24: billing changes are
      // always logged). Starting checkout is the auditable owner action here.
      await logAudit(supabase, {
        organizationId,
        userId,
        action: "billing_change",
        entityType: "subscription",
        details: { action: "checkout", priceId: resolvedPriceId },
        request,
      });
      return NextResponse.json({ url });
    }
    if (action === "portal") {
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
    }
    return jsonError("Unknown billing action.", "invalid_action", 400);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not start the billing session.";
    return jsonError(message, "billing_error", 502);
  }
}
