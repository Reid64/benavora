# SPEC_CHECKOUT.md
## AFS — Quote Approval and Order Payment
**Phase 3**
**Route:** `/account/quotes/[id]` → approve → `/checkout?quote={id}`
**Model: Payment collected AFTER AFS delivers formal quote and customer approves.**

---

## 1. THE SEQUENCE

```
Customer submits quote request (/quote or /upload)
  ↓
AFS estimator receives request in admin portal
AFS runs pricing engine internally
AFS creates formal quote with approved prices
AFS sends formal quote to customer portal
  ↓
Customer sees notification: "Your quote is ready"
Customer visits /account/quotes/[id]
Customer reviews formal quote — FIRST TIME PRICES ARE VISIBLE
Customer clicks "Approve & Place Order"
  ↓
/checkout?quote={id}
Customer enters delivery info + payment
Order confirmed — payment collected
  ↓
Order enters production queue
```

This is not self-service checkout. Payment is collected only after a human
at AFS has reviewed, priced, and approved the specifications.

---

## 2. QUOTE APPROVAL PAGE (`/account/quotes/[id]`)

This page is where the customer sees prices for the first time.

```
AccountShell
  QuoteDetailPage
    QuoteHeader
      Quote number: font-data text-2xl "AFS-Q-2026-XXXXX"
      Status badge: "Ready for Approval" (green)
      Sent date: "Sent [date]"
      Valid until: "Valid until [date]"
      QuoteValidityCountdown: "X days remaining" (amber if < 3 days)

    QuoteLineItemsTable (read-only)
      Columns: Profile | Material | Gauge | Finish | Dimensions | Length | Qty | Unit | Unit Price | Line Total
      Pricing visible here only — set by AFS estimator
      All fields read-only — no editing by customer

    QuoteSummaryPanel
      Subtotal:        $X.XX
      Freight:         $X.XX (or "Included" or "To be confirmed")
      Rush surcharge:  $X.XX (if rush request)
      Tax:             "Calculated at checkout" (TaxJar runs at payment)
      Total:           $X.XX
      "Final pricing confirmed by AFS Architectural Flashing Supply"

    EstimatorNotes (if present)
      "Notes from AFS: [text from estimator]"
      bg-afs-bg-surface border-l-4 border-afs-chrome-dim

    QuoteActions
      Primary: [Approve & Place Order] → /checkout?quote={id}
      Ghost: [Request a Revision] → RevisionRequestModal
      Ghost: [Download Quote PDF] → GET /api/quotes/{id}/pdf

    RevisionRequestModal:
      "What would you like us to revise?"
      Textarea (required)
      [Send Revision Request] → sets quote.status = 'revision_requested'
      Admin notified
```

---

## 3. CHECKOUT PAGE (`/checkout?quote={id}`)

Auth required. Redirect to /login if guest.

```
NavBar (minimal — no main nav links, just AFS logo + "Secure Checkout")
CheckoutPage
  OrderSummaryPanel (right side on desktop, top on mobile)
    Line items from quote (read-only)
    Subtotal, freight, rush surcharge, total
    "Prices set by AFS and confirmed in your quote"

  Section 1: Delivery Information
    DeliveryMethodSelect: Ship | Pickup (radio)

    If Ship:
      AddressAutocomplete (Google Places API)
        Street address, City, State, ZIP auto-fill
      Delivery Instructions textarea (optional)
      Residential toggle: "Is this a residential address?"
      PONumberInput (optional, or required if company requires_po = true)
      DeliveryWindowPreference:
        "Request a delivery window after your order is confirmed"
        Link to DeliveryScheduler in account portal

    If Pickup:
      "You'll receive pickup scheduling instructions in your order confirmation"
      Contact name, contact phone (for pickup coordination)

  Section 2: Payment
    PaymentMethodSelector:
      ● Credit / Debit Card (Stripe Elements)
      ● ACH Bank Transfer (Stripe ACH) — shown for orders above threshold or net-terms accounts
      ● Net Terms — shown only for accounts with net_terms > 0

    If Card:
      StripeCardElement (dark-themed to match AFS gunmetal)
      Billing address toggle: "Same as delivery" (default) | Enter different

    If ACH:
      Stripe ACH bank account + routing number fields
      "ACH transfers clear in 3–5 business days.
       Fabrication begins after payment clears."
      ACH mandate acceptance checkbox (required)

    If Net Terms:
      "Invoiced on Net-{n} terms. Payment due [date]."
      "No payment required now. Order enters fabrication queue immediately."

  Section 3: Legal Acceptance
    Required checkboxes — all must be checked to submit:
    ☑ "I have reviewed and accept the AFS Terms of Sale"
    ☑ "I understand that custom fabricated items cannot be returned once production begins"
    ☑ "I confirm these specifications and dimensions are final and correct"
    All acceptances timestamped in order record

  [Place Order] button (crimson, full-width on mobile)
    Loading state: spinner, all inputs locked
    Disabled until all required fields filled and checkboxes checked
```

---

## 4. STRIPE INTEGRATION AT CHECKOUT

```typescript
// Payment intent created from AFS-approved quote total
// NOT from customer-calculated total
// Source of truth: quotes.total set by AFS estimator

// lib/stripe/checkout.ts
export async function createCheckoutPaymentIntent(
  quoteId: string,
  userId:  string
): Promise<Stripe.PaymentIntent> {
  // Fetch quote from DB (server-side — validates ownership)
  const quote = await getQuote(quoteId, userId);
  if (!quote || quote.status !== 'sent') {
    throw new Error('Quote not available for payment');
  }

  return stripe.paymentIntents.create({
    amount:   Math.round(quote.total * 100),  // cents
    currency: 'usd',
    metadata: {
      quoteId:  quote.id,
      userId:   userId,
    },
    // Tax calculated by TaxJar and added to total before this call
  });
}

// Stripe Elements dark theme to match AFS gunmetal:
const stripeElementStyle = {
  base: {
    color:           '#A0AABC',   // afs-chrome-mid
    backgroundColor: '#32363F',   // afs-bg-overlay
    fontFamily:      'JetBrains Mono, monospace',
    fontSize:        '16px',
    '::placeholder': { color: '#6B7A94' }, // afs-chrome-base
  },
  invalid: { color: '#E8001F' },  // afs-crimson-hover
};
```

---

## 5. TAX CALCULATION

```typescript
// Called when delivery ZIP is entered/changed
// POST /api/tax
// Input: { toZip, toState, subtotal, shipping, lineItems }
// Output: { taxAmount, taxRate }
// BLOCKED: TaxJar nexus configuration pending checklist #31
// Current: tax line shows "Calculated at checkout" until TaxJar configured
// Final tax amount added to payment intent before charge
```

---

## 6. ORDER CREATION ON PAYMENT SUCCESS

```typescript
// Triggered by Stripe webhook: payment_intent.succeeded
// app/api/webhooks/stripe/route.ts

async function handlePaymentSuccess(paymentIntent: Stripe.PaymentIntent) {
  const { quoteId, userId } = paymentIntent.metadata;

  // 1. Fetch approved quote
  // 2. Generate order_number: AFS-{YEAR}-{SEQUENCE}
  // 3. Create orders record (copies from quote)
  // 4. Copy quote_line_items → order_line_items
  // 5. Update quote.status = 'converted'
  // 6. Insert order_status_history: { status: 'submitted', note: 'Payment confirmed' }
  // 7. Send order confirmation email (Resend)
  // 8. Send order confirmation SMS if sms_opt_in (Twilio)
  // 9. Send admin notification: "New Order — AFS-XXXX" (Resend)
  // 10. Log to admin_audit_log
}
```

---

## 7. NET TERMS FLOW

```typescript
// When user selects Net Terms payment method:
// No Stripe PaymentIntent created
// Order created immediately with status: 'submitted'
// payment_method: 'net_terms'
// Invoice generated and placed in /account/invoices
// Admin notified same as paid order
// Order enters production queue — fabrication begins
// Net terms due date calculated from order.created_at + profile.net_terms days
```

---

## 8. DEPOSIT FLOW (BLOCKED)

```typescript
// BLOCKED pending checklist #35 (deposit requirement and percentage)
// Architecture ready:
//   If deposit required:
//     PaymentIntent created for deposit amount (X% of total)
//     Remaining balance PaymentIntent created when order ships
//     Both stored in orders table
//     Customer sees: "Charging today: $X.XX (X% deposit)"
//     "Remaining balance of $X.XX charged when your order ships"
// Current: no deposit — full amount charged at checkout
```

---

## 9. ERROR STATES

| Scenario | Behavior |
|---|---|
| Quote expired | "This quote has expired. Request a new quote." |
| Quote already converted | "This quote has already been placed as an order." |
| Quote not owned by user | 404 |
| Card declined | Stripe error message inline. No order created. |
| ACH verification pending | Show pending state, order NOT created yet |
| Network error on submit | "Could not submit. Your card was not charged. Try again." |

---

## 10. PLAYWRIGHT TESTS

```typescript
test('checkout requires authentication', async ({ page }) => {
  await page.goto('/checkout?quote=test-id');
  await expect(page).toHaveURL(/\/login/);
});

test('legal checkboxes must all be checked before submit', async ({ page }) => {
  // Auth, navigate to checkout with valid quote
  // Attempt submit without checking boxes
  // Verify Place Order button disabled
});

test('Stripe card element renders in dark theme', async ({ page }) => {
  // Verify Stripe Elements iframe present with correct styling
});

test('net terms payment shows no card fields', async ({ page }) => {
  // Auth as net-terms account, go to checkout
  // Select Net Terms payment
  // Verify no Stripe card form visible
});

test('successful payment creates order and redirects', async ({ page }) => {
  // Auth, complete checkout with Stripe test card
  // Verify redirect to /account/orders/{id}
  // Verify order confirmation shown
});
```

---

*SPEC_CHECKOUT.md | AFS | Reid Whitesides | June 2026*
