# SPEC_INVOICE_PORTAL.md
## AFS — Invoice and Statement Portal
**Phase 4**
**Route:** `/account/invoices`

---

## 1. OVERVIEW

Contractors need invoices for job costing, lender documentation, and accounting.
The invoice portal provides PDF downloads and payment status — eliminating manual
invoice requests to AFS staff.

Invoices show AFS-set prices from formal quotes. This is one of the correct places
where prices appear to customers.

---

## 2. INVOICE LIST (`/account/invoices`)

```typescript
// Paginated table: 20 per page
// Columns: Invoice # | Order # | Date | Amount | Status | Actions
//
// Invoice number: AFS-INV-2026-XXXXX
//
// Status values + badges:
//   'paid':    green badge "Paid"
//   'due':     amber badge "Due {date}"
//   'overdue': crimson badge "Overdue"
//   'pending': chrome badge "Net Terms — Due {date}" (for net-terms accounts)
//
// Actions:
//   "Download PDF" → GET /api/invoices/{id}/pdf
//   "Pay Now" → initiates Stripe payment if status is due/overdue + card on file
//
// Filter: All | Paid | Outstanding
// Date range: filter by month or custom range
```

---

## 3. INVOICE PDF CONTENT

Generated server-side with `@react-pdf/renderer`. Generated fresh on demand — not stored.

```typescript
// Header:
//   AFS logo (left) + "INVOICE" (right, font-display style)
//   Invoice number, date, due date
//
// Bill To:
//   Customer name, company, address
//
// Ship To:
//   Delivery address from order
//
// Line Items Table:
//   Columns: Description | Qty | Unit | Unit Price | Line Total
//   All quantities and prices from order_line_items (AFS-set values)
//
// Summary:
//   Subtotal, Freight, Rush surcharge, Tax, Total
//
// Payment Instructions:
//   For card payments: "Paid on {date} — {last 4 digits}"
//   For net terms: "Payment due {date} — Net {n} terms"
//   Payment portal: "Pay online at {url}/account/invoices"
//
// Footer:
//   AFS address, phone (BLOCKED #5)
//   "Terms and Conditions: {url}/legal/terms"
//   Dispute contact (BLOCKED #94)
```

---

## 4. ACCOUNT STATEMENT

```typescript
// "Download Account Statement" button at top of invoice page
// GET /api/invoices/statement?from={date}&to={date}
// PDF: all invoices in date range, running balance
// Useful for net-terms accounts tracking outstanding balance
```

---

## 5. API

```typescript
// GET /api/invoices — list invoices for user
// GET /api/invoices/{id}/pdf — generate and stream PDF
// GET /api/invoices/statement — generate statement PDF
// POST /api/invoices/{id}/pay — initiate Stripe payment for outstanding invoice
```

---

## 6. PLAYWRIGHT TESTS

```typescript
test('invoice list shows correct columns', async ({ page }) => {
  // Auth as customer with orders
  await page.goto('/account/invoices');
  await expect(page.locator('th:has-text("Invoice #")')).toBeVisible();
  await expect(page.locator('th:has-text("Amount")')).toBeVisible();
});

test('PDF download is triggered on button click', async ({ page }) => {
  // Set up download listener
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('[data-testid="download-invoice"]'),
  ]);
  expect(download.suggestedFilename()).toMatch(/AFS-INV/);
});
```

---

*SPEC_INVOICE_PORTAL.md | AFS | Reid Whitesides | June 2026*
