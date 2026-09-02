# SPEC_STRIPE_INTEGRATION.md
## AFS — Stripe Payments Integration
**Phase 3**

---

## 1. OVERVIEW

Stripe handles all payment processing. Three flows:
1. Card payment — standard checkout
2. ACH bank transfer — commercial accounts
3. Net terms — no payment at checkout, invoice generated

Payment amounts always come from `quotes.total` set by AFS estimator.
Never from customer-calculated values.

---

## 2. CONFIGURATION

```typescript
// lib/stripe/client.ts — server-side only
import Stripe from 'stripe';
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-06-20',
  typescript: true,
});

// lib/stripe/client-browser.ts — client-side only
import { loadStripe } from '@stripe/stripe-js';
export const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!
);
```

---

## 3. CARD PAYMENT FLOW

```typescript
// Server: POST /api/checkout/create-intent
// Input: { quoteId }
// Validates: quote.status === 'sent', quote.user_id === auth user
// Creates: Stripe PaymentIntent for quote.total (in cents)
// Returns: { clientSecret }

// Client:
// Load Stripe Elements with dark theme (see SPEC_CHECKOUT.md)
// stripe.confirmCardPayment(clientSecret, { payment_method: { card: elements.card } })
// Handles 3DS automatically

// Webhook: payment_intent.succeeded
// → Creates order record
// → Sets quote.status = 'converted'
// → Sends confirmation notifications
```

---

## 4. ACH PAYMENT FLOW

```typescript
// payment_method_types: ['us_bank_account']
// Requires: ACH mandate acceptance from customer (stored in order record)
// Settlement: 3-5 business days
// Order status: 'submitted' immediately (but noted as pending ACH)
// Webhook: payment_intent.succeeded when ACH clears
// Admin notified when ACH clears and fabrication can begin

// Shown for: orders above a threshold OR accounts with net_terms > 0
// Threshold: configurable, initially $2,500
```

---

## 5. WEBHOOK HANDLER

```typescript
// app/api/webhooks/stripe/route.ts

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.text();
  const sig = request.headers.get('stripe-signature')!;

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      body, sig, process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  switch (event.type) {
    case 'payment_intent.succeeded':
      await handlePaymentSuccess(event.data.object as Stripe.PaymentIntent);
      break;
    case 'payment_intent.payment_failed':
      await handlePaymentFailed(event.data.object as Stripe.PaymentIntent);
      break;
    case 'charge.dispute.created':
      await handleDisputeCreated(event.data.object as Stripe.Dispute);
      // Alert admin immediately
      break;
  }

  return NextResponse.json({ received: true });
}
```

---

## 6. STRIPE ELEMENTS DARK THEME

```typescript
const appearance: Stripe.StripeElementsOptions['appearance'] = {
  theme: 'night',
  variables: {
    colorPrimary:        '#C0001A',   // afs-crimson
    colorBackground:     '#32363F',   // afs-bg-overlay
    colorText:           '#A0AABC',   // afs-chrome-mid
    colorDanger:         '#E8001F',   // afs-crimson-hover
    fontFamily:          'JetBrains Mono, monospace',
    borderRadius:        '4px',
    colorTextPlaceholder:'#6B7A94',   // afs-chrome-base
  },
};
```

---

*SPEC_STRIPE_INTEGRATION.md | AFS | Reid Whitesides | June 2026*
