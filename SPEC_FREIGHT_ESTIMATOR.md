# SPEC_FREIGHT_ESTIMATOR.md
## AFS — Freight Estimator
**Phase 6 — Admin use only. Embedded in estimator quote creation flow.**
**BLOCKED:** Carrier details (#27-28), AFS origin ZIP (#5), freight rates (#80-82)

---

## 1. OVERVIEW

Freight is a significant line item on sheet metal orders. Long pieces require
specialized flatbed or structural truck freight. The freight estimator is an
internal tool for AFS estimators to calculate freight and include it on the
formal quote.

Customers see the freight amount on their formal quote. They do not see the
calculation behind it.

---

## 2. UI PLACEMENT

Embedded in `/admin/quote-requests/[id]` below the line item pricing section.

```
FreightCalculatorPanel

Inputs:
  Destination ZIP:       from quote request (pre-filled, editable)
  Estimated weight (lbs): calculated from order weights (auto-filled when products set)
  Longest piece (ft):    from order line items (auto-filled, editable)
  Residential delivery:  toggle (yes / no)
  Liftgate required:     toggle (yes / no)

[Calculate Freight] button
  → POST /api/admin/pricing/freight
  → Returns estimated freight amount

Result display:
  "Estimated freight: $X.XX via {carrier}"
  Freight class: {class}
  "Manually adjust if needed" with editable override field
  Residential adder: "$X.XX for residential delivery"
  Liftgate adder: "$X.XX for liftgate service"
  "Free freight threshold: {threshold}" if order qualifies

[Add to Quote] button:
  Applies freight amount to formal quote as a line item
  Estimator can override the amount before adding
```

---

## 3. FREIGHT ALGORITHM

See `PRICING_ENGINE.md §7` for full freight calculation code.

Key blockers before activation:
- AFS origin ZIP (checklist #5)
- Carrier name and rate structures (checklist #27-28)
- Own truck vs third-party decision (checklist #80)
- Free freight threshold (checklist #30)
- Residential surcharge amount (checklist #29)
- Liftgate upcharge (checklist #88)

Current behavior: estimator enters freight amount manually until data received.

---

## 4. FREIGHT TYPES FOR SHEET METAL

```typescript
// Sheet metal is freight class-sensitive due to piece lengths
function getFreightClass(longestPieceFt: number): string {
  if (longestPieceFt <= 8)  return '85';
  if (longestPieceFt <= 12) return '92.5';
  if (longestPieceFt <= 16) return '100';
  return '110';  // 16+ ft requires special handling
}

// Pieces > 24 ft may require:
//   Flatbed service (not LTL)
//   Oversize permit
//   Admin manual entry required — no auto-calculation for extreme lengths
```

---

*SPEC_FREIGHT_ESTIMATOR.md | AFS | Reid Whitesides | June 2026*
