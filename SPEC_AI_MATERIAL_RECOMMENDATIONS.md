# SPEC_AI_MATERIAL_RECOMMENDATIONS.md
## AFS — AI Material Recommendations
**Phase 7 — Embedded in Quote Wizard Step 1 and Configurator**
**Model:** claude-sonnet-4-6

---

## 1. PURPOSE

When a customer selects a material with long lead times (special order status),
the AI suggests alternatives that may be faster or better suited to their
application. This prevents orders falling through because of material availability.

Also handles: customer selects aluminum for an application where copper would
be standard practice. AI flags it and explains why.

---

## 2. TRIGGER CONDITIONS

```typescript
// Trigger A: Material selected with stock_type = 'special_order'
//   Fires automatically when special_order material is selected in wizard or configurator
//   Fires after 400ms debounce (don't interrupt rapid selection)

// Trigger B: Material/profile combination with known issues
//   Defined in a configurable rules table (admin-managed)
//   Example: step flashing + painted steel in coastal environment → recommend stainless
//   BLOCKED: rules table populated when checklist #38 received

// Trigger C: Explicitly invited by user
//   "Get material recommendations" link in Step 1 sidebar
```

---

## 3. UI COMPONENT

```typescript
// MaterialRecommendationPanel (slides in below MaterialSelector)
// Width: full-width of the step
// Background: bg-afs-bg-surface border border-[var(--afs-border)]

// Structure:
//   Eyebrow: "MATERIAL GUIDANCE" (font-label text-xs text-afs-chrome-base uppercase)
//   Message from AI (1–3 sentences, plain language)
//   Recommendation cards (1–2 alternatives):
//     Material name, why it's recommended, stock status badge
//     [Select This Instead] button → updates material selection in form
//   [Keep My Selection] link → closes panel

// Example message:
//   "Galvalume is currently a special order material — expect a 2–4 week lead time.
//    For faster availability, consider:"
//   Card: "20ga Galvanized Steel — In Stock — Most common for this application"
//   Card: "0.032 Aluminum — Made to Order — 3–5 days — Rust-free alternative"
```

---

## 4. SYSTEM PROMPT

```typescript
const MATERIAL_REC_PROMPT = `You are a sheet metal fabrication specialist
for AFS Architectural Flashing Supply.

A customer has selected: {material} for {profileType}.
Current stock status: {stockStatus}

CATALOG CONTEXT (available alternatives):
{availableMaterials}

Recommend up to 2 alternative materials if the selected material has
availability issues OR if the material is not ideal for this application.
If the selection is fine: recommend no alternatives.

RULES:
- Only recommend materials actually in the catalog
- Plain language — no jargon the customer might not understand
- Never mention price
- If selection is standard and available: output { "recommend": false }

OUTPUT (JSON only):
{
  "recommend": true,
  "message": "1-2 sentence explanation of the situation",
  "alternatives": [
    {
      "materialId": "uuid",
      "reason": "One sentence why this is a good alternative"
    }
  ]
}`;
```

---

*SPEC_AI_MATERIAL_RECOMMENDATIONS.md | AFS | Reid Whitesides | June 2026*
