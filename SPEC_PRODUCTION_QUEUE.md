# SPEC_PRODUCTION_QUEUE.md
## AFS — Production Queue Management
**Phase 6**
**Routes:** `/admin/orders`, `/admin/orders/[id]`
**BLOCKED:** Stage names from shop manager (#39)

---

## 1. PRODUCTION QUEUE LIST (`/admin/orders`)

```
AdminShell
  ProductionQueuePage

  FilterTabs:
    All | Rush | In Queue | Cutting | Forming | QC | Ready to Ship
    Tab counts update in real time (Supabase Realtime on orders table)

  SortControls:
    Default: Rush orders first → then oldest created_at first
    Alternatives: by expected ship date, by status

  ProductionQueueTable:
    Columns:
      Order #     — font-data, link to /admin/orders/{id}
      Customer    — name + company
      Profiles    — "Coping Cap, Galv, 20ga + 2 more" (summary of line items)
      Created     — relative: "2 hours ago"
      Expected    — "Jan 20" or "Not set"
      Rush        — Red badge "RUSH" if is_rush = true
      Status      — StatusBadge with color per stage
      Advance     — QuickAdvanceButton (primary action — advances to next stage in one click)

  QuickAdvanceButton:
    Shows: "→ {nextStage}"
    Click: PATCH /api/admin/orders/{id}/status { status: nextStatus }
    Optimistic update: status updates instantly in table
    Confirmation toast: "Order AFS-XXXX → {newStage}"
    Triggers: customer notification + status_history + audit_log
    No modal — click and done
    If already at 'delivered': disabled with "Delivered" label

  EmptyState per tab:
    "No orders in this stage."
    Color-coordinated empty state per status
```

---

## 2. ADMIN ORDER DETAIL (`/admin/orders/[id]`)

```
AdminShell
  AdminOrderDetailPage

  OrderDetailHeader:
    Order number: font-data text-3xl
    Customer name + company (link to /admin/customers/{id})
    Status badge (large, prominent)
    Created date, expected ship
    Rush badge if applicable
    Total: font-data text-2xl (AFS-set amount — correct to show in admin)

  StatusAdvancer (most prominent — top right):
    Currently: "{status label}"
    [→ Advance to: {nextStage}] primary button
    StatusDropdown (for manual override — corrections, skipping):
      All statuses in select element
      NoteField: text input "Reason for manual change"
      [Apply Status Change] button
    Backward status change requires confirmation modal

  OrderLineItemsTable (read-only):
    Full line items with specs + prices + totals

  QuoteReference:
    Quote number, link to quote record
    "Approved by customer on {date}"

  ProductionNotes:
    AdminNotesField: textarea, append-only display
    Previous notes stack below with timestamp + admin name
    [Add Note] button

  PreShipPhotoSection:
    PhotoUploader (images only, 25MB each)
    PhotoGrid (thumbnails)
    "Notify customer" checkbox (default: checked)
    [Upload Photos] button

  OrderAttachments:
    Customer-uploaded approved drawings
    All order_attachments for this order

  CustomerInfo:
    Name, email, phone, company
    Delivery address
    Delivery scheduled date + window
    PO number
    Payment info (method, Stripe PaymentIntent ID)

  StatusHistory:
    Full order_status_history list
    Every status change with timestamp and admin name
```

---

## 3. RUSH ORDER PRIORITY QUEUE

```typescript
// Rush orders always sort to top of production queue
// Rush badge: bg-afs-crimson text-white font-bold text-xs
// Rush surcharge line item on formal quote (% from pricing_rules.rush_surcharge_pct)
// Rush confirmation to customer in quote:
//   "Rush order — priority fabrication" (text BLOCKED #32 for exact timing)
// Admin rush view: FilterTab "Rush" shows only rush orders, sorted by oldest first
```

---

## 4. REALTIME ON PRODUCTION QUEUE

```typescript
// Admin production queue subscribes to orders table changes
// When any order status changes (including from another admin):
//   Row status badge updates live
//   Tab counts update live
//   QuickAdvanceButton label updates live
// Prevents two admins from advancing the same order simultaneously

const subscription = supabase
  .channel('production-queue')
  .on('postgres_changes', {
    event:  'UPDATE',
    schema: 'public',
    table:  'orders',
    filter: `status=neq.delivered`,
  }, () => {
    refetchOrderList(); // Refresh the query
  })
  .subscribe();
```

---

## 5. PLAYWRIGHT TESTS

```typescript
test('quick advance updates order status', async ({ page }) => {
  // Auth as admin, navigate to production queue
  await page.goto('/admin/orders');
  const initialStatus = await page.locator('[data-testid="order-status-0"]').innerText();
  await page.click('[data-testid="quick-advance-0"]');
  await page.waitForTimeout(500);
  const newStatus = await page.locator('[data-testid="order-status-0"]').innerText();
  expect(newStatus).not.toBe(initialStatus);
});

test('rush orders appear at top of queue', async ({ page }) => {
  await page.goto('/admin/orders');
  // Verify first row has rush badge if any rush orders exist
  const firstRow = page.locator('[data-testid="queue-row-0"]');
  // Rush badge visible or no rush orders in system
});

test('admin order detail shows status advancer', async ({ page }) => {
  await page.goto('/admin/orders/AFS-2026-00001');
  await expect(page.locator('[data-testid="status-advancer"]')).toBeVisible();
});

test('pre-ship photo upload triggers customer notification', async ({ page }) => {
  // Mock Resend — upload photo — verify notification sent
});
```

---

*SPEC_PRODUCTION_QUEUE.md | AFS | Reid Whitesides | June 2026*
