# SPEC_LIVE_INVENTORY.md
## AFS — Live Inventory / Stock Status
**Phase 6**
**BLOCKED:** Stock levels (#56), ERP/inventory system (#55)

---

## 1. WHAT THIS IS

AFS fabricates custom — nothing is truly "in stock" in the traditional sense.
But some profiles and materials have faster lead times because standard material
is on hand. This spec manages the stock signal system shown to customers in
the product catalog and quote wizard.

This is NOT a real-time inventory management system. It is a signal system.

---

## 2. STOCK TYPE SYSTEM

```typescript
type StockType =
  | 'stock'          // Material on hand. Fast turn. 1–2 days.
  | 'fabricated'     // Standard fabrication from stock material. 3–5 days.
  | 'special_order'; // Material must be ordered from supplier. 2–4 weeks.

// Stored in products.stock_type
// Set by admin via product editor in /admin/settings (simple dropdown)
// Shown to customers as:
//   stock:          "In Stock" — green dot
//   fabricated:     "Made to Order" — amber dot
//   special_order:  "Special Order" — chrome dot + "Longer lead time"

// Lead time in products.lead_time_days:
//   Shown on product detail pages and quote wizard Step 3
//   "Typical lead time: X–Y days" (range shown)
//   BLOCKED: actual lead times from checklist #6
```

---

## 3. ADMIN STOCK MANAGEMENT

```
/admin/settings → Inventory / Stock Status section

ProductStockTable:
  All products with current stock_type + lead_time
  Inline dropdowns to change
  [Save] per row → updates products table
  No audit log required (not financially sensitive)
  
Bulk status update:
  "Set all galvanized products to: [dropdown]" → [Apply]
  For commodity scarcity events where all one material goes to special_order
```

---

## 4. WHEN ERP INTEGRATION ARRIVES

```typescript
// products.lead_time_days will be read from ERP webhook
// products.stock_type will be computed from ERP quantity-on-hand
// Admin stock management UI becomes read-only (ERP is authoritative)
// Architecture already supports this — no refactor needed
// ERP connection point: /api/admin/inventory/sync (webhook receiver)
```

---

*SPEC_LIVE_INVENTORY.md | AFS | Reid Whitesides | June 2026*
