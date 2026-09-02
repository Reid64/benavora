# SPEC_ORDER_PORTAL.md
## AFS — Customer Order Portal
**Phase 4**
**Routes:** `/account`, `/account/orders`, `/account/orders/[id]`, `/track/[orderId]`

---

## 1. ACCOUNT DASHBOARD (`/account`)

```
AccountShell (sidebar nav)
  DashboardPage
    WelcomeHeader:
      "Good morning, {firstName}" — greeting shifts by time of day
      font-heading text-3xl text-afs-chrome-high

    DashboardGrid (2×2 on desktop, stacked mobile):

      ActiveOrdersCard:
        Orders with status NOT IN (delivered, cancelled)
        Max 3 shown, "View all orders →" link
        Each row: order number (font-data), status badge, profile summary, expected ship
        Empty: "No active orders. Ready to submit a request?"
          [Upload a Drawing] | [Request a Quote] CTAs

      RecentQuotesCard:
        quote_requests (pending) + formal quotes (sent, awaiting approval)
        Max 3 shown
        Each row: request number OR quote number, status, submitted date
        Status: "Pending Review" (amber) | "Quote Ready" (green, pulsing)
        "Quote Ready" row links to /account/quotes/{id}

      UpcomingDeliveryCard:
        Next scheduled delivery (if any)
        Order number, scheduled date, delivery window
        [Reschedule] button → DeliveryScheduler
        If no scheduled deliveries: "No deliveries scheduled"
          [Schedule a Delivery] link

      QuickActionsCard:
        Four buttons in 2×2 grid:
          "Upload a Drawing" → /upload
          "Request a Quote" → /quote
          "Track an Order" → /account/orders
          "Download an Invoice" → /account/invoices
```

---

## 2. ORDER LIST (`/account/orders`)

```typescript
// Paginated table: 20 per page
// Sort: created_at DESC by default (newest first)
// Columns: Order # | Date | Items | Status | Actions

// Status badge colors:
const STATUS_COLORS = {
  submitted: 'info',      // blue
  received:  'chrome',    // silver
  in_queue:  'warning',   // amber
  cutting:   'warning',
  bending:   'warning',
  qc:        'warning',
  ready:     'success',   // green
  shipped:   'success',
  delivered: 'chrome',    // dimmed
  cancelled: 'error',     // red
};

// Filter tabs: All | Active | Completed | Cancelled
// Search: order number or profile type description

// Each row Actions:
//   "View Details" → /account/orders/{id}
//   "Reorder" → POST /api/orders/{id}/reorder → /quote with items loaded
//   "Download Invoice" → /api/invoices/{invoiceId}/pdf (if invoiced)
//   "Track" → public tracker /track/{id}
```

---

## 3. ORDER DETAIL (`/account/orders/[id]`)

```
AccountShell
  OrderDetailPage
    OrderDetailHeader
      Order number: font-data text-3xl "AFS-2026-XXXXX"
      Status badge (large)
      Order date
      Expected ship date (or "Will be confirmed by AFS")
      [Get Help with This Order] → /contact?order={id}
      [Reorder] button

    OrderLineItemsTable (read-only)
      Columns: Profile | Material | Gauge | Dimensions | Length | Qty | Unit | Line Total
      Line totals visible here (set by AFS, from formal quote)

    PaymentSummary
      Subtotal, Freight, Rush surcharge, Tax, Total
      Payment method used
      "Paid on {date}" or net terms invoice reference

    ProductionTimeline (see SPEC_PRODUCTION_TIMELINE.md)

    OrderAttachmentsSection
      Pre-ship photos (from admin) — shown as image grid
      Approved drawings (customer uploaded) — DocumentList
      [Upload Approved Drawing] — locked after fabrication starts

    DeliverySection
      If ship:
        Delivery address
        Scheduled delivery date + window (if scheduled)
        Tracking number + carrier link (when shipped)
        [Schedule / Reschedule Delivery] button
      If pickup:
        Pickup date + window
        AFS facility address

    ReorderSection
      "Order These Items Again"
      [Reorder] button
      "Quantities and specifications are loaded from this order.
       Edit anything before submitting a new request."
```

---

## 4. ONE-CLICK REORDER

```typescript
// POST /api/orders/{id}/reorder
// Auth required — must own order

// Process:
// 1. Fetch order_line_items for this order
// 2. Convert to QuoteRequestLineItem[] format
// 3. Strip prices (new order will be priced by AFS)
// 4. Save to QuoteRequestSession in server session or return to client
// 5. Redirect to /quote?step=4&from_order={id}
// User sees: items pre-loaded in Step 4 review
// User can edit quantities before submitting new request

interface ReorderResponse {
  sessionId: string;
  redirectUrl: string;  // /quote?step=4&from_order={id}
}
```

---

## 5. PUBLIC ORDER TRACKER (`/track/[orderId]`)

No authentication required. Identity verified by order ID + email match.

```typescript
// /track/[orderId]
// Public page — no AccountShell

// Form displayed first:
//   "Track your AFS order"
//   Order ID: pre-filled from URL param
//   Email: text input (must match order record email)
//   [Track Order] button

// On submit: POST /api/track/verify { orderId, email }
//   Validates: orders.order_number matches + orders.user.email matches
//   If match: returns read-only order data
//   If no match: "Order not found or email does not match our records"
//   Rate limited: 10 attempts per IP per hour

// On success, shows:
//   Order number, order date
//   ProductionTimeline (read-only, no admin controls)
//   Expected ship date
//   Tracking number + carrier link (when shipped)
//   Delivery scheduled date (when scheduled)
//   
// Does NOT show:
//   Pricing (no line items, no totals)
//   Account information
//   Other orders
```

---

## 6. SUPABASE REALTIME SUBSCRIPTION

```typescript
// On OrderDetailPage mount (client component):
const subscription = supabase
  .channel(`order-${orderId}`)
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'orders',
    filter: `id=eq.${orderId}`,
  }, (payload) => {
    // Update order status in local state
    setOrderStatus(payload.new.status);
    // Show toast: "Your order status has been updated"
    toast.info(`Order status: ${STATUS_LABELS[payload.new.status]}`);
  })
  .subscribe();

// Cleanup on unmount:
return () => supabase.removeChannel(subscription);
```

---

## 7. PLAYWRIGHT TESTS

```typescript
test('dashboard shows active orders', async ({ page }) => {
  // Auth as customer with active orders
  await page.goto('/account');
  await expect(page.locator('[data-testid="active-orders-card"]')).toBeVisible();
});

test('order detail shows production timeline', async ({ page }) => {
  // Auth, navigate to order in cutting status
  await page.goto('/account/orders/AFS-2026-00001');
  await expect(page.locator('[data-testid="production-timeline"]')).toBeVisible();
  await expect(page.locator('[data-testid="stage-cutting"]')).toHaveAttribute('data-active', 'true');
});

test('reorder creates new quote request', async ({ page }) => {
  // Auth, click reorder on delivered order
  await page.click('[data-testid="reorder-button"]');
  await expect(page).toHaveURL(/\/quote\?step=4/);
});

test('public tracker works without login', async ({ page }) => {
  await page.goto('/track/AFS-2026-00001');
  await page.fill('[name="email"]', 'contractor@example.com');
  await page.click('button[type="submit"]');
  await expect(page.locator('[data-testid="production-timeline"]')).toBeVisible();
});

test('public tracker shows no pricing', async ({ page }) => {
  await page.goto('/track/AFS-2026-00001');
  await page.fill('[name="email"]', 'contractor@example.com');
  await page.click('button[type="submit"]');
  const text = await page.locator('main').innerText();
  expect(text).not.toMatch(/\$[\d,]+/);
});
```

---

*SPEC_ORDER_PORTAL.md | AFS | Reid Whitesides | June 2026*
