# SPEC_PURCHASE_ORDER_INTEGRATION.md
## AFS — Purchase Order Integration
**Phase 3 — Embedded in Checkout**

---

## 1. OVERVIEW

Commercial contractors and GCs require PO numbers on every purchase for internal
accounting compliance. Without PO support, those buyers cannot use the platform.

---

## 2. IMPLEMENTATION

```sql
-- PO number stored on order record (already in SCHEMA.md)
-- orders.po_number TEXT
-- companies.require_po BOOLEAN DEFAULT false
```

```typescript
// In checkout Section 1 (Delivery Information):
// PONumberInput:
//   Label: "Purchase Order Number"
//   Optional by default
//   Required if: companies.require_po = true for user's company
//   Max: 50 characters
//   Placeholder: "e.g. PO-2026-04521"
//   Hint if required: "Your account requires a PO number for all orders"

// PO number appears in:
//   Order confirmation email: "PO Number: {poNumber}"
//   Order detail page
//   Invoice PDF header
//   Admin order detail
```

---

## 3. COMPANY PO REQUIREMENT

```typescript
// Admin sets per company in /admin/customers/{id}
// When require_po = true:
//   PO field marked required in checkout
//   If user attempts submit without PO:
//     "Purchase Order Number is required for your account"
//     Submit blocked
```

---

*SPEC_PURCHASE_ORDER_INTEGRATION.md | AFS | Reid Whitesides | June 2026*
