# SPEC_FLASHING_CONFIGURATOR.md
## AFS — Custom Flashing Configurator
**Phase 2**
**Route:** `/configure`
**Model: RFQ — Output is a quote request submission. No prices shown.**

---

## 1. WHAT THIS IS

The Flashing Configurator serves contractors and architects who need a profile
outside the standard catalog — different leg lengths, unusual cross-section,
or a custom geometry that must be fabricated to exact spec. The user builds
the profile visually with a live SVG diagram that updates as they type, then
submits a complete specification as a quote request.

No price appears at any point. The value is precision specification speed.

---

## 2. USER FLOW

```
/configure (or from /products/[category]/[slug] → "Configure Custom")
  ConfiguratorShell loads
  Step A: Select base profile type (starting point geometry)
  Step B: Select material + gauge + finish
  Step C: Enter all dimensions → SVG diagram updates live
  Step D: Enter length + quantity + notes
  Actions:
    "Submit for Quote" → creates quote_requests record
    "Save Configuration" (auth) → saves to saved_configurations table
    "Add to Quote Request" → appends to in-progress session → returns to Step A
```

---

## 3. LAYOUT

```
Desktop: Two-panel side by side
  Left panel (480px, sticky):  ConfiguratorControls
  Right panel (flex-1):        ConfiguratorPreview

Mobile (< 768px):
  Tab bar: "Configure" | "Preview"
  Each tab shows its respective panel full-width
```

---

## 4. CONFIGURATOR CONTROLS (LEFT PANEL)

### Section 1 — Base Profile

```typescript
// ProfileTypeSelector — same cards as QuoteWizard Step 1
// requiresConsultation profiles → ConsultationRedirectModal
// "Custom" option at bottom: user can describe a unique shape in notes
```

### Section 2 — Material

```typescript
// MaterialSelector — radio cards from materials table
// Selecting material triggers:
//   GaugeSelector to update with material-specific gauges
//   FinishSelector to update with material-specific finishes
```

### Section 3 — Gauge

```typescript
// Select element (not chips) — more scalable for many gauge options
// Filtered by selected material
// Shows: label + thickness (e.g. "20 ga — 0.036\"")
```

### Section 4 — Finish

```typescript
// Select element
// Filtered by selected material
// Mill finish always first option
// Upcharge note: "(+X% upcharge)" for non-standard — informational only
```

### Section 5 — Dimensions

```typescript
// ALL dimension inputs:
//   type="number" step="0.0625" (1/16 inch precision — more precise than wizard)
//   Font: font-data (JetBrains Mono)
//   Suffix: " (inches)
//   Min/max from product_profiles validated in real-time
//   Fields appear/disappear based on selected profile type
//   Same DIMENSION_CONFIG as SPEC_QUOTE_BUILDER.md

// ProfileDiagramSVG in right panel updates as user types
// Debounce: 150ms after last keypress
```

### Section 6 — Length + Quantity

```typescript
// Length: number input, feet, max from product_profiles.max_length_ft
// Quantity: number input, integer, min 1
// WasteFactorDisplay:
//   "Auto-adding X% waste = X LF total"
//   Quantities only — no prices
// Note field: "Match existing installation — north parapet only"
```

### Section 7 — Actions (bottom of controls panel)

```typescript
// Primary: [Submit for Quote] — crimson, metal-edge-red
// Ghost: [Save Configuration] — auth required, shows auth prompt if guest
// Ghost: [Add to Quote Request] — appends to active session
// Ghost: [Start Over] — clears all fields
```

---

## 5. CONFIGURATOR PREVIEW (RIGHT PANEL)

### ProfileDiagramSVG

```typescript
// lib/utils/profile-svg.ts
interface SVGParams {
  profileType:  string;
  width?:       number;
  height?:      number;
  legA?:        number;
  legB?:        number;
  lap?:         number;
  scale?:       number;  // px per inch, default 8
}

export function generateProfileSVG(params: SVGParams): string {
  // Returns complete SVG string
  // Viewbox calculated from overall dimensions + padding
  // Metal outline: afs-chrome-mid stroke, 2px
  // Dimension lines: afs-crimson stroke, 1px dashed
  // Dimension labels: JetBrains Mono, afs-chrome-high
  // Returns placeholder SVG if dimensions are zero/null
}

// SVG TEMPLATES REQUIRED (one per profile type):
// coping-cap.svg        — W, H, Leg A, Leg B labeled
// base-flashing.svg     — H, Leg A, Leg B
// counter-flashing.svg  — H, Lap
// step-flashing.svg     — W, H
// drip-edge.svg         — subtype variants, Leg A, Leg B
// gravel-stop.svg       — H, Leg A
// valley-flashing.svg   — W (chevron)
// expansion-joint.svg   — W

// SVG transitions: CSS transition on path d attribute (smooth morph)
// Falls back to instant update if browser doesn't support path transition
```

### SpecSummaryPanel

```typescript
// Text summary below SVG diagram
// Font: font-data text-sm text-afs-chrome-mid
// Example:
// "20 ga Galvanized Steel Coping Cap"
// "12" W × 4" H × 3" Leg A × 3" Leg B"
// "10 LF × 1 piece = 10 LF ordered"
// "(+10% waste factor = 11 LF billed)"
// Disclaimer below:
// "Estimated CAD preview — for reference only.
//  Shop drawing provided before fabrication begins."
// NO PRICE in preview panel
```

---

## 6. SUBMIT FLOW

```typescript
// "Submit for Quote" clicked:
//   If authenticated:
//     POST /api/quote-requests with single item from configurator
//     Redirect to confirmation view with request number
//   If guest:
//     GuestCaptureModal:
//       "Enter your email to receive your quote request confirmation"
//       Email (required), Name, Company
//     POST /api/quote-requests with guest_email
//     Resend confirmation email

// "Add to Quote Request" clicked:
//   Appends configured item to QuoteRequestSession in localStorage
//   Navigates to /quote?step=1 with session intact
//   User can add more items then review and submit all together

// "Save Configuration" clicked (auth required):
//   If not authenticated: sign-in modal with return URL
//   After auth: POST /api/configurator/save
//   Success toast: "Configuration saved — find it in Saved Profiles"
//   Link: "View Saved Profiles" → /architects/custom-profiles
```

---

## 7. SAVED CONFIGURATIONS

```sql
-- From SCHEMA.md
-- saved_configurations table:
-- id, user_id, name, profile_id, material_id, gauge_id, finish_id,
-- dimensions JSONB, length_ft, quantity, notes, created_at, updated_at
```

```typescript
// /architects/custom-profiles shows saved configurations
// "Reorder" button:
//   Loads saved config into /configure page
//   Pre-populates all fields
//   User edits if needed → submits
// "Edit" button:
//   Same as Reorder but opens configurator in edit mode
```

---

## 8. URL PARAMS

```typescript
// /configure?profile={profileSlug}
//   Pre-selects profile type on load
//
// /configure?saved={configId}
//   Loads a saved configuration (auth required)
//
// /configure?from_product={productId}
//   Pre-selects profile + material from a product detail page
```

---

## 9. API ROUTES

### `GET /api/configurator/profile/{profileId}`

```typescript
// Returns profile with dimension constraints
// Used for client-side real-time validation
interface ProfileConstraints {
  id:         string;
  name:       string;
  minWidth:   number | null;
  maxWidth:   number | null;
  minHeight:  number | null;
  maxHeight:  number | null;
  minLegA:    number | null;
  maxLegA:    number | null;
  minLegB:    number | null;
  maxLegB:    number | null;
  maxLengthFt:number | null;
}
```

### `POST /api/configurator/save`

```typescript
// Auth required
// Body: ConfiguratorState
// Saves to saved_configurations table
// Returns: { configId, name }
```

### `POST /api/configurator/submit`

```typescript
// Converts configurator state to quote_requests record
// Same endpoint behavior as POST /api/quote-requests
// Returns: { requestId, requestNumber }
```

---

## 10. PLAYWRIGHT TESTS

```typescript
test('SVG diagram updates when dimension input changes', async ({ page }) => {
  await page.goto('/configure');
  await page.click('[data-testid="profile-coping-cap"]');
  const svgBefore = await page.locator('[data-testid="profile-svg"]').innerHTML();
  await page.fill('[name="width"]', '24');
  await page.waitForTimeout(200); // debounce
  const svgAfter = await page.locator('[data-testid="profile-svg"]').innerHTML();
  expect(svgBefore).not.toBe(svgAfter);
});

test('no prices appear in configurator', async ({ page }) => {
  await page.goto('/configure');
  const text = await page.locator('main').innerText();
  expect(text).not.toMatch(/\$[\d,]+\.\d{2}/);
});

test('dimension above maximum shows validation error', async ({ page }) => {
  await page.goto('/configure');
  await page.click('[data-testid="profile-coping-cap"]');
  await page.fill('[name="width"]', '999');
  await expect(page.locator('text=Maximum')).toBeVisible();
});

test('submit creates quote request', async ({ page }) => {
  // Auth, complete config, submit, verify request number
});

test('save configuration requires auth', async ({ page }) => {
  // Not authenticated, click Save, verify auth prompt
});

test('loading saved configuration pre-fills all fields', async ({ page }) => {
  // Auth, create saved config, reload at /configure?saved={id}
  // Verify all fields populated
});
```

---

*SPEC_FLASHING_CONFIGURATOR.md | AFS | Reid Whitesides | June 2026*
