# SPEC_RUSH_ORDER.md
## AFS — Rush Order System
**Phase 6 — Embedded throughout, not a separate page**
**BLOCKED:** Rush definition and timing (#32), rush surcharge % (#36)

---

## 1. RUSH FLAG ENTRY POINTS

Rush is flagged by the customer in three places:
1. Quote wizard Step 3: "I need this order rushed" checkbox
2. Custom configurator: Rush toggle in controls panel
3. Drawing tool: Rush toggle in TakeoffActions area

All three set `is_rush = true` in the quote_request submission.

---

## 2. RUSH ON QUOTE REQUESTS (ADMIN SIDE)

```typescript
// Quote requests with is_rush = true:
//   Rush badge: bg-afs-crimson text-white "RUSH" displayed on every row
//   Sorted to top of /admin/quote-requests queue
//   Admin notified immediately via email (subject: "🔴 RUSH Quote Request")
//   Pricing engine applies rush_surcharge_pct from pricing_rules
//   Surcharge added as line item on formal quote:
//     "Rush fabrication surcharge — X%"

// Rush definition and turnaround shown to customer:
//   BLOCKED pending checklist #32
//   Placeholder: "Rush orders receive priority scheduling.
//                AFS will confirm turnaround in your formal quote."
```

---

## 3. RUSH ON PRODUCTION QUEUE

```typescript
// Rush orders always float to top of /admin/orders production queue
// Rush badge on every row — cannot be missed
// StatusAdvancer shows rush context:
//   "⚠ RUSH ORDER — Priority scheduling required"
// Rush tab in production queue filters to rush-only
```

---

## 4. RUSH SURCHARGE

```typescript
// Calculated in pricing engine:
//   rushSurcharge = suggestedPricePerLf * pricing_rules.rush_surcharge_pct
//   Appears as separate line item on formal quote
//   BLOCKED: surcharge percentage from checklist #36
//   Current: not applied until percentage received
//   Estimator can also add rush surcharge manually in quote creation flow

// On formal quote customer view:
//   Line item: "Rush fabrication — priority scheduling"
//   Amount: $X.XX (set by AFS)
```

---

*SPEC_RUSH_ORDER.md | AFS | Reid Whitesides | June 2026*
