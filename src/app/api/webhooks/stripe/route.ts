import { NextResponse } from "next/server";
import type Stripe from "stripe";

import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe, handleWebhookEvent } from "@/lib/payments/stripe";

/**
 * Stripe webhook receiver (Behavioral Contracts §22).
 *
 * - Verifies the signature with STRIPE_WEBHOOK_SECRET BEFORE processing - an
 *   unverified payload is rejected (§22).
 * - Idempotent: each event id is recorded in stripe_webhook_events; a replayed
 *   event is acknowledged without reprocessing.
 * - Uses the raw request body (required for signature verification), so this
 *   handler reads request.text() and never request.json().
 */

export const runtime = "nodejs";
// Never cache or pre-render - every call is a live POST from Stripe.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "Billing is not configured.", code: "not_configured" },
      { status: 500 },
    );
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json(
      { error: "Missing signature.", code: "missing_signature" },
      { status: 400 },
    );
  }

  const payload = await request.text();

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(payload, signature, secret);
  } catch {
    // Bad signature or malformed payload - do not process.
    return NextResponse.json(
      { error: "Signature verification failed.", code: "invalid_signature" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  // Idempotency: skip events we have already processed (Contracts §22).
  const { data: seen } = await admin
    .from("stripe_webhook_events")
    .select("id")
    .eq("id", event.id)
    .maybeSingle();
  if (seen) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    await handleWebhookEvent(event);
  } catch {
    // Let Stripe retry on transient failures (do not mark as processed).
    return NextResponse.json(
      { error: "Webhook processing failed.", code: "processing_failed" },
      { status: 500 },
    );
  }

  // Mark processed only after successful handling.
  await admin
    .from("stripe_webhook_events")
    .insert({ id: event.id, type: event.type });

  return NextResponse.json({ received: true });
}
