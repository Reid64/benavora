# SPEC_CUSTOMER_MANAGEMENT.md
## AFS — Customer Management
**Phase 6**
**Routes:** `/admin/customers`, `/admin/customers/[id]`

---

## 1. CUSTOMER LIST (`/admin/customers`)

```typescript
// Searchable, filterable table
// Columns: Name | Company | Email | Role | Pricing Tier | Total Orders | Last Order | Actions
// Filters: Role | Pricing Tier | Has Net Terms | Has Active Orders
// Search: name, company, email — Postgres full-text
// Sort: newest registered (default), total orders, last order
// [Export CSV] — downloads filtered results as CSV for CRM/accounting
```

---

## 2. CUSTOMER DETAIL (`/admin/customers/[id]`)

```
CustomerDetailPage

  CustomerHeader:
    Name, company, email, phone, role badge, pricing tier badge
    [Edit Profile] → inline editable fields

  AccountSettings section:
    Role: dropdown (admin | contractor | architect | customer)
    Pricing Tier: dropdown (standard | contractor | preferred | wholesale)
    Net Terms: dropdown (0 | 15 | 30 | 60)
    Credit Limit: dollar input
    Tax Exempt: toggle
    Require PO: toggle (company level)
    [Save Account Settings] → PATCH /api/admin/customers/{id}
    All changes: admin_audit_log entry

  OrderHistory:
    Paginated table of all orders
    Each row links to /admin/orders/{id}
    "Create Order for This Customer" button (manual order entry — future phase)

  QuoteRequestHistory:
    All quote requests from this customer

  ContractorPricing:
    Per-product custom discounts (BLOCKED pending pricing data)
    [Add Custom Rate] for specific products

  AdminNotesLog:
    Append-only timestamped notes
    Past notes shown with timestamp + admin name
    New note textarea + [Add Note] button
    Notes never editable after saved — use append to correct

  CreditApplications:
    List of submitted credit applications with status
    [Review Application] → /admin/credit-applications/{id}
```

---

## 3. ROLE AND TIER CHANGES

```typescript
// All changes require admin confirmation:
// "Change {name}'s pricing tier from standard to contractor?"
// [Confirm] → saves + audit log
// Customer is NOT notified of backend tier changes (pricing is internal)
// Customer IS notified if net terms are granted (email template)
```

---

*SPEC_CUSTOMER_MANAGEMENT.md | AFS | Reid Whitesides | June 2026*
