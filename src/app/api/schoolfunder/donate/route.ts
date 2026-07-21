import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { getStripe, isStripeConfigured } from "@/lib/payments/stripe";

// POST /api/schoolfunder/donate — create a Stripe PaymentIntent for a
// SchoolFunder donation and record a `pending` donation row. Recorded by an
// authenticated org user on a donor's behalf (there is no public,
// unauthenticated donor-facing page in this build — see STATE_OF_THE_BUILD.md).
//
// KNOWN GAP: nothing yet flips payment_status from "pending" to "succeeded" —
// that requires a Stripe webhook handler (mirroring
// src/app/api/webhooks/stripe/route.ts's pattern) which was not built this
// session. Do not report donations as fully wired until that handler exists.

export async function POST(request: Request) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: "Payments are not configured for this environment.", code: "stripe_not_configured" },
      { status: 501 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body.", code: "invalid_body" },
      { status: 400 },
    );
  }

  const amount = typeof body.amount === "number" ? body.amount : Number(body.amount);
  const donorName = typeof body.donor_name === "string" ? body.donor_name.trim() || null : null;
  const donorEmail =
    typeof body.donor_email === "string" ? body.donor_email.trim() || null : null;
  const studentId = typeof body.student_id === "string" ? body.student_id : null;
  const institutionName =
    typeof body.institution_name === "string" ? body.institution_name.trim() || null : null;
  const institutionRoutingNumber =
    typeof body.institution_routing_number === "string"
      ? body.institution_routing_number.trim() || null
      : null;

  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json(
      { error: "A positive donation amount is required.", code: "missing_fields" },
      { status: 400 },
    );
  }

  if (studentId) {
    const { data: student, error: studentError } = await supabase
      .from("schoolfunder_students")
      .select("id")
      .eq("id", studentId)
      .eq("org_id", organizationId)
      .single();
    if (studentError || !student) {
      return NextResponse.json(
        { error: "Student not found.", code: "not_found" },
        { status: 404 },
      );
    }
  }

  const stripe = getStripe();
  const paymentIntent = await stripe.paymentIntents.create({
    amount: Math.round(amount * 100),
    currency: "usd",
    metadata: {
      organization_id: organizationId,
      student_id: studentId ?? "",
      program: "schoolfunder",
    },
  });

  const { data: donation, error: insertError } = await supabase
    .from("schoolfunder_donations")
    .insert({
      org_id: organizationId,
      student_id: studentId,
      donor_name: donorName,
      donor_email: donorEmail,
      amount,
      payment_status: "pending",
      stripe_payment_intent_id: paymentIntent.id,
      institution_name: institutionName,
      institution_routing_number: institutionRoutingNumber,
    })
    .select("id")
    .single();

  if (insertError || !donation) {
    return NextResponse.json(
      { error: "Failed to record donation.", code: "insert_failed" },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      data: {
        donationId: (donation as { id: string }).id,
        clientSecret: paymentIntent.client_secret,
      },
    },
    { status: 201 },
  );
}
