# SPEC_QUICKBOOKS_INTEGRATION.md
## AFS — QuickBooks Online Integration
**Phase 8 — Conditional**
**BLOCKED:** QuickBooks confirmation (#52), subscription level (#53), sync scope (#54)

---

## 1. STATUS

```
CONDITIONAL BUILD — this spec is NOT built unless client confirms:
  1. AFS has or will get a QuickBooks Online subscription
  2. QuickBooks is the actual accounting system in use
  3. What exactly should sync: invoices only? customers? orders?
  4. Who manages the QBO connection: AFS owner or an accountant?

If client confirms QBO at checklist items #52-54:
  Build this spec as Phase 8.
If client does NOT confirm:
  Skip entirely. CSV export from /admin/customers suffices.
```

---

## 2. INTEGRATION SCOPE (IF BUILT)

```
Proposed sync direction: AFS Platform → QuickBooks Online
Proposed sync objects:
  - Invoices (when payment confirmed or net-terms order created)
  - Customers (new profile + company records)
  - Line items (for job costing visibility in QBO)

NOT synced:
  - Payments (Stripe is authoritative for payments)
  - Quotes (AFS platform is authoritative — not pushed to QBO)
  - Inventory (not in scope for Phase 1)
```

---

## 3. OAUTH SETUP

```typescript
// QuickBooks Online uses OAuth 2.0
// Connect flow from /admin/settings:
//   [Connect QuickBooks] button → Intuit OAuth flow
//   After auth: store tokens in environment or Supabase secrets table
//   Token refresh: automatic on 401 from QBO API

// Required: intuit-oauth npm package
// Credentials: QBO developer account + app client_id + client_secret
```

---

## 4. INVOICE SYNC

```typescript
// Triggered after: order payment confirmed (Stripe webhook) OR net-terms order created
// lib/quickbooks/sync.ts

export async function syncInvoiceToQBO(orderId: string): Promise<void> {
  // 1. Fetch order + line items + customer from Supabase
  // 2. Find or create QBO Customer matching profile email
  // 3. Create QBO Invoice with:
  //    Customer: linked QBO customer
  //    Invoice number: AFS-INV-{year}-{seq}
  //    Line items: description + qty + unit price (from AFS quote)
  //    Due date: from net_terms or payment date
  //    Memo: order number reference
  // 4. Store QBO invoice ID in orders table (qbo_invoice_id column)
  // 5. Log to admin_audit_log
}

// Error handling:
// If sync fails: log + admin alert — NEVER block order flow
// Manual sync button in /admin/settings → /api/admin/qbo/sync/{orderId}
```

---

## 5. DATABASE COLUMN

```sql
-- Added to orders table when QBO integration activated:
ALTER TABLE orders ADD COLUMN qbo_invoice_id TEXT;
ALTER TABLE orders ADD COLUMN qbo_synced_at TIMESTAMPTZ;
```

---

*SPEC_QUICKBOOKS_INTEGRATION.md | AFS | Reid Whitesides | June 2026*
