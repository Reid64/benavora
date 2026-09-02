# SPEC_AUTO_MATERIAL_CALCULATOR.md
## AFS — Auto Material Calculator
**Phase 2 — Embedded in Quote Wizard Step 3 and Configurator**
**Quantities only. No pricing. Waste factor and accessory suggestions.**

---

## 1. WHAT THIS IS

The Auto Material Calculator is not a standalone page. It is a calculation
module embedded within the quote request wizard (Step 3) and the configurator.
It automatically computes waste-adjusted quantities and suggests required
accessories so customers never under-order.

Pricing is not part of this calculator. It calculates material quantities.
AFS sets prices internally.

---

## 2. CALCULATIONS

### 2.1 Waste Factor

```typescript
function applyWasteFactor(
  rawQuantityLf: number,
  wasteFactorMultiplier: number   // e.g., 1.10 for 10%
): number {
  // Always round UP — never under-order
  return Math.ceil(rawQuantityLf * wasteFactorMultiplier);
}

// Source: pricing_rules.waste_factor per product
// Default until data received: 1.10 (10%) — displayed as "estimated"
// Displayed to user:
//   "Your order: 100 LF + 10% waste = 110 LF total (billed quantity)"
// Different materials have different waste factors — copper is cut more
// precisely, painted steel has more waste in color matching
```

### 2.2 Accessory Calculation

```typescript
// Source: product_accessories table (BLOCKED pending checklist #17)
// Calc methods:
//   per_lf:    Math.ceil(orderedLf / calcRate)    e.g., 1 tube per 20 LF
//   per_piece: orderedPieces * calcRate
//   fixed:     calcRate (always exactly this quantity)

interface AccessoryRequirement {
  accessoryId:    string;
  accessoryName:  string;
  sku:            string | null;
  calcMethod:     'per_lf' | 'per_piece' | 'per_sqft' | 'fixed';
  calculatedQty:  number;
  unit:           string;
  isRequired:     boolean;
}

function calculateAccessories(
  productId:         string,
  orderedQtyLf:      number,
  orderedPieces:     number,
  accessories:       ProductAccessory[]
): AccessoryRequirement[] {
  return accessories.map(acc => {
    let qty = 1;
    switch (acc.calc_method) {
      case 'per_lf':    qty = Math.ceil(orderedQtyLf / acc.calc_rate); break;
      case 'per_piece': qty = Math.ceil(orderedPieces * acc.calc_rate); break;
      case 'fixed':     qty = acc.calc_rate; break;
    }
    return { ...acc, calculatedQty: qty };
  });
}
```

### 2.3 Stock Length Optimization (Trim Length)

```typescript
// Only runs when product has standard stock lengths defined
// BLOCKED until checklist #21 (standard lengths) received
// When available:
//   orderedLf = 47 LF
//   stockLength = 10 ft
//   piecesNeeded = Math.ceil(47 / (10 - kerfAllowance))
//   Shows: "5 pieces × 10 ft stock = 50 ft — 3 LF off-cut"
// Informational only — estimator uses for cutting optimization
```

---

## 3. UI DISPLAY IN WIZARD STEP 3

```
MaterialCalculatorSection (collapsible accordion, expanded by default)

  ┌──────────────────────────────────────────────────────┐
  │ AUTO MATERIAL CALCULATOR                             │
  │                                                      │
  │ Your quantity:           100 LF                      │
  │ + Waste factor (10%):    +10 LF   (estimated)        │
  │ ─────────────────────────────────────────────        │
  │ Total ordered:           110 LF   ← BILLED QUANTITY  │
  │                                                      │
  │ REQUIRED WITH THIS ORDER                             │
  │ ☑ Butyl tape         2 rolls   [Required]            │
  │ ☑ #14 Hex screws     1 box     [Required]            │
  │                                                      │
  │ ALSO COMMONLY ORDERED                                │
  │ ☐ Termination bars   5 EA      [Add to request]      │
  │ ☐ Touch-up paint     1 can     [Add to request]      │
  └──────────────────────────────────────────────────────┘

  Required accessories: auto-checked, user can uncheck
  Optional accessories: unchecked by default, user can add
  No prices on any accessory
```

---

## 4. API ROUTE

### `POST /api/calculator/materials`

```typescript
interface MaterialCalcRequest {
  productId:    string;
  rawQtyLf:     number;
  lengthFt:     number;
  pieces:       number;
}

interface MaterialCalcResponse {
  adjustedQtyLf:     number;
  wasteFactorPct:    number;
  wasteQtyLf:        number;
  isWasteEstimated:  boolean;   // true until pricing_rules populated
  accessories:       AccessoryRequirement[];
  stockOptimization: StockCutResult | null;
}
```

---

## 5. BLOCKED DATA

| Feature | Blocked By | Current Behavior |
|---|---|---|
| Material-specific waste factors | Checklist #37 | Default 10%, marked "estimated" |
| Accessory list | Checklist #17 | Accessory section hidden |
| Stock lengths | Checklist #21 | Stock optimization hidden |

---

*SPEC_AUTO_MATERIAL_CALCULATOR.md | AFS | Reid Whitesides | June 2026*
