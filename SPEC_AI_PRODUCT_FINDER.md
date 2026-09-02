# SPEC_AI_PRODUCT_FINDER.md
## AFS — AI Product Finder
**Phase 7**
**Route:** `/products` — conversational search mode
**Model:** claude-sonnet-4-6

---

## 1. WHAT THIS IS

Contractors often do not know the correct technical name for what they need.
"The bent metal piece that goes over the top of the wall" = coping cap.
The AI Product Finder lets them describe what they need in plain language and
returns the correct AFS product with an explanation.

---

## 2. PLACEMENT

```
On /products page — above the filter panel and product grid
SearchModeBar:
  Tabs: [Browse Products] [Find by Description]

  "Browse Products" tab → standard catalog (ProductFilterPanel + ProductGrid)
  "Find by Description" tab → AIProductFinder
```

---

## 3. AI FINDER INTERFACE

```typescript
// First interaction:
//   Large input: "Describe what you're looking for — in your own words"
//   Placeholder: "e.g., 'the metal cap that goes on top of a parapet wall'"
//   [Find Products] button (crimson)

// After first response:
//   Conversational follow-up mode
//   AI asks clarifying questions (material? building type? condition?)
//   Max 3 clarifying questions before presenting results

// Results:
//   ProductCard grid (2–4 products max)
//   Explanation per card: "I think this is what you need because..."
//   [Request a Quote] on each card → /quote?product={id}
//   "Not what you're looking for?" → follow-up input
```

---

## 4. SYSTEM PROMPT

```typescript
const PRODUCT_FINDER_PROMPT = `You are a product specialist for AFS Architectural
Flashing Supply. Help customers identify which sheet metal flashing products they
need based on their description.

AVAILABLE PRODUCTS (injected at runtime from catalog):
{catalogContext}

PROCESS:
1. Understand what the customer is describing — their words, not technical terms
2. Ask ONE clarifying question if needed (material, building type, location on roof)
3. Never ask more than 2 questions total
4. Present 1–3 product recommendations with plain-language explanations

NEVER:
- Mention prices
- Make up products not in the catalog
- Provide specific dimensions without customer providing them first

OUTPUT FORMAT (JSON only):
{
  "message": "Conversational response to the customer",
  "products": [
    { "productId": "uuid", "reason": "This is the product because..." }
  ],
  "needsMoreInfo": false,
  "clarifyingQuestion": null
}`;
```

---

## 5. API ROUTE

```typescript
// POST /api/products/ai-search
// Body: { query: string, conversationHistory: Message[] }
// Returns structured product recommendations
// Products validated against actual catalog before returning
// No prices in any response
```

---

*SPEC_AI_PRODUCT_FINDER.md | AFS | Reid Whitesides | June 2026*
