# SPEC_AI_CROSS_SELL.md
## AFS — AI Cross-Sell and Accessory Recommendations
**Phase 7 — Embedded in Auto Material Calculator (Quote Wizard Step 3)**
**Model:** claude-sonnet-4-6

---

## 1. PURPOSE

Contractors forget accessories — sealant, screws, clips, tape — and then call
AFS when something fails. Cross-sell at the point of order benefits both AFS
(larger order value) and the contractor (one trip to the jobsite).

This spec covers the AI layer ABOVE the deterministic accessory calculator in
SPEC_AUTO_MATERIAL_CALCULATOR.md. The calculator handles required and commonly
ordered accessories from the product_accessories table. The AI handles
context-specific recommendations based on what the customer is building.

---

## 2. WHEN AI FIRES (NOT ALWAYS)

```typescript
// AI cross-sell only fires when:
//   a) Order has 3+ distinct profile types in the quote request
//   b) Order contains a profile known to need system accessories
//   c) Material selection includes copper (copper requires specific accessories)
//   d) Project type = specified in Step 3 (commercial roof means different needs)

// AI does NOT fire for:
//   Simple single-profile orders (deterministic suggestions sufficient)
//   Orders where all accessories already recommended by product_accessories table
```

---

## 3. SYSTEM PROMPT

```typescript
const CROSS_SELL_PROMPT = `You are an AFS Architectural Flashing Supply product
advisor. A contractor is building a quote request and may have forgotten
important accessories.

THEIR ORDER:
{lineItemSummary}

AVAILABLE ACCESSORIES IN OUR CATALOG:
{accessoryCatalog}

WHAT WE ALREADY SUGGESTED (do not duplicate):
{alreadySuggested}

Based on their specific combination of profiles and materials, identify
1–2 accessories they likely forgot that would be critical for installation.

RULES:
- Only suggest accessories actually in our catalog
- Only suggest what is genuinely needed — not everything we sell
- Plain language explanation of why they need it
- No prices
- If nothing important is missing, output { "suggestions": [] }

OUTPUT (JSON only):
{
  "suggestions": [
    {
      "accessoryId": "uuid",
      "reason": "One sentence why they need this for their specific order"
    }
  ]
}`;
```

---

## 4. UI

```typescript
// CrossSellPanel appears BELOW AutoMaterialCalculator output
// Only renders when AI returns suggestions (not on every order)

// CrossSellSuggestionCard:
//   Accessory name: font-heading text-base
//   Why you need it: font-body text-sm text-afs-chrome-mid (from AI reason)
//   "Required for your {profileName} installation" context
//   [Add to Quote Request] checkbox (unchecked default)
//   Checked → adds to QuoteRequestLineItem accessories

// Framing line above suggestions:
//   "You may also need:" (not "Don't forget!" — assumes competence)
```

---

*SPEC_AI_CROSS_SELL.md | AFS | Reid Whitesides | June 2026*
