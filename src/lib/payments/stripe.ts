import Stripe from "stripe";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  SUBSCRIPTION_TIERS,
  TIER_PLANS,
  type SubscriptionTier,
} from "@/lib/utils/constants";

/**
 * Stripe billing infrastructure (BLUEPRINT Phase 5 / Behavioral Contracts §22).
 *
 * SERVER-ONLY. The secret key never reaches the client. Like agent code, this
 * module uses the service-role Supabase client (createAdminClient) because the
 * webhook handler runs with no user session - there is no cookie to derive RLS
 * from. Every query is therefore MANUALLY scoped by organization_id, and the
 * org id is always resolved server-side (from the session in the billing route,
 * or from Stripe metadata in webhooks), never trusted from a request body
 * (Contracts §2, §16).
 */

let stripeClient: Stripe | null = null;

/**
 * Lazily construct the Stripe client. Throws if STRIPE_SECRET_KEY is unset so
 * callers can surface a clean "billing not configured" error rather than crash
 * at import time (the key is absent in the MVP / local dev).
 */
export function getStripe(): Stripe {
  if (stripeClient) return stripeClient;
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is not configured.");
  }
  // apiVersion omitted: pin to the SDK's bundled version to avoid drift.
  stripeClient = new Stripe(secretKey);
  return stripeClient;
}

/** True when billing is configured on this server (Contracts §22 free-tier default). */
export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/**
 * Map a Stripe Price ID to one of our subscription tiers using the per-tier
 * price env vars. Returns null for unknown prices (defensive - never guess).
 */
export function tierForPriceId(priceId: string | null | undefined): SubscriptionTier | null {
  if (!priceId) return null;
  for (const tier of SUBSCRIPTION_TIERS) {
    const envVar = TIER_PLANS[tier].priceEnvVar;
    if (envVar && process.env[envVar] === priceId) return tier;
  }
  return null;
}

/** The configured Price ID for a paid tier, or null if unset / free tier. */
export function priceIdForTier(tier: SubscriptionTier): string | null {
  const envVar = TIER_PLANS[tier].priceEnvVar;
  if (!envVar) return null;
  return process.env[envVar] ?? null;
}

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

/**
 * Ensure the organization has a Stripe customer, creating one if needed and
 * persisting its id on the organizations row. Returns the customer id.
 * Idempotent: reuses an existing stripe_customer_id when present.
 */
export async function createCustomer(
  orgId: string,
  email: string,
  name: string,
): Promise<string> {
  const stripe = getStripe();
  const admin = createAdminClient();

  // Reuse the existing customer if one is already attached to this org.
  const { data: org } = await admin
    .from("organizations")
    .select("stripe_customer_id")
    .eq("id", orgId)
    .single();

  const existing = (org as { stripe_customer_id: string | null } | null)
    ?.stripe_customer_id;
  if (existing) return existing;

  const customer = await stripe.customers.create({
    email,
    name,
    // org id travels with the customer so webhooks can resolve the tenant.
    metadata: { organization_id: orgId },
  });

  await admin
    .from("organizations")
    .update({
      stripe_customer_id: customer.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", orgId);

  return customer.id;
}

/**
 * Create a Stripe Checkout session for a subscription to `priceId`. The org's
 * email/name seed the customer record. Returns the hosted checkout URL.
 */
export async function createCheckoutSession(
  orgId: string,
  priceId: string,
): Promise<{ url: string }> {
  const stripe = getStripe();
  const admin = createAdminClient();

  const { data: org } = await admin
    .from("organizations")
    .select("name, email")
    .eq("id", orgId)
    .single();
  const orgRow = org as { name: string | null; email: string | null } | null;

  const customerId = await createCustomer(
    orgId,
    orgRow?.email ?? "",
    orgRow?.name ?? "Organization",
  );

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${siteUrl()}/billing?checkout=success`,
    cancel_url: `${siteUrl()}/billing?checkout=cancelled`,
    // Mirror the org id onto the subscription so subscription.* webhooks resolve.
    subscription_data: { metadata: { organization_id: orgId } },
    metadata: { organization_id: orgId },
  });

  if (!session.url) {
    throw new Error("Stripe did not return a checkout URL.");
  }
  return { url: session.url };
}

/**
 * Create a Stripe Billing Portal session so the customer can manage / cancel
 * their subscription. Throws if the org has no Stripe customer yet.
 */
export async function createPortalSession(
  orgId: string,
): Promise<{ url: string }> {
  const stripe = getStripe();
  const admin = createAdminClient();

  const { data: org } = await admin
    .from("organizations")
    .select("stripe_customer_id")
    .eq("id", orgId)
    .single();
  const customerId = (org as { stripe_customer_id: string | null } | null)
    ?.stripe_customer_id;

  if (!customerId) {
    throw new Error("This organization has no billing account yet.");
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${siteUrl()}/billing`,
  });
  return { url: session.url };
}

export type OrgSubscription = {
  tier: SubscriptionTier;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  stripe_subscription_id: string | null;
};

/**
 * Fetch the current subscription for an org from our mirror table. Returns a
 * synthetic free-tier record when no row exists (every org is at least free -
 * Contracts §22).
 */
export async function getSubscription(orgId: string): Promise<OrgSubscription> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("subscriptions")
    .select(
      "tier, status, current_period_end, cancel_at_period_end, stripe_subscription_id",
    )
    .eq("organization_id", orgId)
    .maybeSingle();

  const row = data as OrgSubscription | null;
  if (!row) {
    return {
      tier: "free",
      status: "active",
      current_period_end: null,
      cancel_at_period_end: false,
      stripe_subscription_id: null,
    };
  }
  return row;
}

// ---------------------------------------------------------------------------
// Webhook processing
// ---------------------------------------------------------------------------

function toIso(seconds: number | null | undefined): string | null {
  if (!seconds) return null;
  return new Date(seconds * 1000).toISOString();
}

/**
 * Upsert our subscriptions mirror from a Stripe Subscription object and sync the
 * organization's denormalized subscription_tier. Resolves the tenant from the
 * subscription metadata, falling back to the customer's metadata.
 */
async function syncSubscription(
  subscription: Stripe.Subscription,
  admin: ReturnType<typeof createAdminClient>,
): Promise<void> {
  const stripe = getStripe();

  let orgId = subscription.metadata?.organization_id ?? null;
  if (!orgId && typeof subscription.customer === "string") {
    const customer = await stripe.customers.retrieve(subscription.customer);
    if (customer && !customer.deleted) {
      orgId = (customer.metadata?.organization_id as string | undefined) ?? null;
    }
  }
  if (!orgId) return; // Cannot resolve tenant - never guess.

  // Stripe API 2025+ moved the billing period onto each subscription item.
  const firstItem = subscription.items.data[0];
  const priceId = firstItem?.price?.id ?? null;
  const tier = tierForPriceId(priceId) ?? "free";

  await admin.from("subscriptions").upsert(
    {
      organization_id: orgId,
      stripe_subscription_id: subscription.id,
      stripe_customer_id:
        typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer.id,
      tier,
      status: subscription.status,
      current_period_start: toIso(firstItem?.current_period_start),
      current_period_end: toIso(firstItem?.current_period_end),
      cancel_at_period_end: subscription.cancel_at_period_end ?? false,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id" },
  );

  await admin
    .from("organizations")
    .update({ subscription_tier: tier, updated_at: new Date().toISOString() })
    .eq("id", orgId);
}

/** Downgrade an org to the free tier when its subscription is deleted. */
async function downgradeToFree(
  subscription: Stripe.Subscription,
  admin: ReturnType<typeof createAdminClient>,
): Promise<void> {
  const orgId = subscription.metadata?.organization_id ?? null;
  if (!orgId) return;

  await admin
    .from("subscriptions")
    .update({
      tier: "free",
      status: "cancelled",
      cancel_at_period_end: false,
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", orgId);

  await admin
    .from("organizations")
    .update({ subscription_tier: "free", updated_at: new Date().toISOString() })
    .eq("id", orgId);
}

/**
 * Record a paid/failed invoice in our mirror table (idempotent on invoice id).
 * Returns the resolved organization id, or null if the tenant can't be resolved.
 */
async function recordInvoice(
  invoice: Stripe.Invoice,
  admin: ReturnType<typeof createAdminClient>,
): Promise<string | null> {
  const stripe = getStripe();

  let orgId =
    (invoice.metadata?.organization_id as string | undefined) ?? null;
  if (!orgId && typeof invoice.customer === "string") {
    const customer = await stripe.customers.retrieve(invoice.customer);
    if (customer && !customer.deleted) {
      orgId = (customer.metadata?.organization_id as string | undefined) ?? null;
    }
  }
  if (!orgId) return null;

  await admin.from("invoices").upsert(
    {
      organization_id: orgId,
      stripe_invoice_id: invoice.id,
      amount_cents: invoice.amount_due ?? 0,
      currency: invoice.currency ?? "usd",
      status: invoice.status ?? "open",
      description: invoice.description ?? null,
      invoice_url: invoice.hosted_invoice_url ?? null,
      period_start: toIso(invoice.period_start),
      period_end: toIso(invoice.period_end),
      paid_at: invoice.status === "paid" ? toIso(invoice.created) : null,
    },
    { onConflict: "stripe_invoice_id" },
  );

  return orgId;
}

/**
 * Process a verified Stripe webhook event (Behavioral Contracts §22).
 * Idempotent: the caller records processed event ids; this function's writes are
 * additionally upsert-based so a replay is harmless.
 *
 *   checkout.session.completed   → sync subscription + tier
 *   customer.subscription.updated→ sync subscription
 *   customer.subscription.deleted→ downgrade to free
 *   invoice.payment_succeeded    → record invoice
 *   invoice.payment_failed       → record invoice + flag past_due
 */
export async function handleWebhookEvent(event: Stripe.Event): Promise<void> {
  const stripe = getStripe();
  const admin = createAdminClient();

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (typeof session.subscription === "string") {
        const subscription = await stripe.subscriptions.retrieve(
          session.subscription,
        );
        // Carry the org id from the checkout session onto the subscription.
        if (!subscription.metadata?.organization_id) {
          const orgId = session.metadata?.organization_id;
          if (orgId) subscription.metadata = { organization_id: orgId };
        }
        await syncSubscription(subscription, admin);
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      await syncSubscription(event.data.object as Stripe.Subscription, admin);
      break;
    }
    case "customer.subscription.deleted": {
      await downgradeToFree(event.data.object as Stripe.Subscription, admin);
      break;
    }
    case "invoice.payment_succeeded": {
      await recordInvoice(event.data.object as Stripe.Invoice, admin);
      break;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const orgId = await recordInvoice(invoice, admin);
      if (orgId) {
        await Promise.all([
          admin
            .from("subscriptions")
            .update({ status: "past_due", updated_at: new Date().toISOString() })
            .eq("organization_id", orgId),
          // Suspend the org's tier so the app can block access until payment
          // is recovered. Webhook customer.subscription.updated will restore
          // the tier once Stripe retries successfully.
          admin
            .from("organizations")
            .update({ subscription_tier: "suspended", updated_at: new Date().toISOString() })
            .eq("id", orgId),
        ]);
      }
      break;
    }
    default:
      // Unhandled event types are acknowledged (200) without action.
      break;
  }
}
