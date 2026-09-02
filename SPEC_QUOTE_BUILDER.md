# SPEC_QUOTE_BUILDER.md
## AFS — Quote Request Wizard
**Phase 2**
**Route:** `/quote`
**Model: RFQ — No prices shown at any step. Customer specifies. AFS prices.**

---

## 1. WHAT THIS IS

The quote request wizard is the primary ordering path for contractors who do not
have drawings to upload. They step through a guided form specifying exactly what
they need — profile type, material, gauge, finish, dimensions, length, quantity.

The submission creates a `quote_requests` record in the admin queue. AFS runs
the internal pricing engine, sets prices, and delivers a formal quote to the
customer's portal account.

**Zero prices appear at any step.** No estimates, no "from $X", no totals.
The wizard collects a specification — not a purchase.

---

## 2. WIZARD FLOW — 4 STEPS

```
Step 1: Profile + Material Selection
Step 2: Dimensions
Step 3: Quantity + Project Details
Step 4: Review + Submit
```

Progress indicator at top of wizard: numbered steps with labels.
Current step: crimson indicator. Completed steps: crimson checkmark.

---

## 3. MULTI-ITEM SUPPORT

A single quote request can contain multiple line items (profiles).
After completing Step 3, user clicks "Add Another Profile" to return to
Step 1 with existing items preserved in session state.
Step 4 shows all items in a review table.

---

## 4. STEP SPECIFICATIONS

### Step 1 — Profile + Material Selection

```typescript
// ProfileTypeSelector: grid of ProfileTypeCard components
// Data source: product_profiles table (is_active = true, sorted by sort_order)
// Not hardcoded — populates from database

// ProfileTypeCard:
//   Profile SVG diagram thumbnail (static per category)
//   Profile name: font-heading text-xl
//   Short description: font-body text-sm text-afs-chrome-mid
//   Selected: border-afs-crimson bg-afs-crimson-ghost

// requiresConsultation = true:
//   Card shows "Engineering Consultation Required" badge
//   On click → ConsultationRedirectModal:
//     "This profile type requires a conversation with our fabrication team."
//     [Schedule a Consultation] → /architects/consultation
//     Does NOT advance to Step 2

// After profile selected → MaterialSelector appears below

// MaterialSelector: radio card grid
//   Filtered by profile compatibility (future: profile-material join table)
//   Card: material name, common applications note, availability signal
//   Selected: border-afs-crimson

// After material selected → GaugeSelector appears

// GaugeSelector: chip group
//   Filtered by selected material (from gauges table)
//   Chip: gauge label + thickness (e.g. "20 ga — 0.036\"")
//   Selected: bg-afs-crimson text-white
//   Default: lowest sort_order gauge pre-selected

// After gauge selected → FinishSelector appears (if finishes exist for material)

// FinishSelector: color chip grid
//   40×40px chips with hex_preview as background-color
//   Finish name on hover via tooltip
//   Selected: ring-2 ring-afs-crimson ring-offset-afs-bg-base
//   "Mill finish" always shown as first option
//   Upcharge note on non-standard finishes (informational only, no price)

// [Next: Dimensions] button
//   Disabled until at minimum profile + material selected
```

### Step 2 — Dimensions

```typescript
// Dynamic dimension inputs based on selected profile type
// Profile type determines which fields appear and which are required

const DIMENSION_CONFIG: Record<string, DimensionField[]> = {
  'coping-cap':         ['width', 'height', 'legA', 'legB'],
  'base-flashing':      ['height', 'legA', 'legB'],
  'counter-flashing':   ['height', 'lap'],
  'step-flashing':      ['width', 'height'],
  'drip-edge':          ['subtype', 'legA', 'legB'],
  'gravel-stop':        ['height', 'legA'],
  'valley-flashing':    ['width'],
  'expansion-joint':    ['width', 'movementSpec'],
};

interface DimensionField {
  key:          string;
  label:        string;
  unit:         'inches' | 'text';
  required:     boolean;
  minValue?:    number;   // from product_profiles.min_*
  maxValue?:    number;   // from product_profiles.max_*
}

// Input styling:
//   type="number" step="0.125" (1/8 inch precision)
//   Font: font-data (JetBrains Mono)
//   Suffix: " (inches) displayed outside input
//   Hint below each field: "Min: X" / "Max: Y" from product_profiles
//   Real-time validation:
//     Below minimum → red border + "Minimum X inches"
//     Above maximum → red border + "Maximum X inches"

// ProfileDiagramSVG:
//   Updates live as user types (debounced 150ms)
//   Shows current dimension values labeled in crimson
//   Placeholder SVG if dimensions incomplete
//   Generated from lib/utils/profile-svg.ts
//   SVG templates: one per profile type (8 total)

// AI Order Validator fires on this step:
//   POST /api/quote-requests/validate with current dimensions
//   Catches physically impossible combinations
//   Warning banners — non-blocking (user can acknowledge and continue)
//   See SPEC_AI_ORDER_VALIDATOR.md

// Length input (separate from profile dimensions):
//   Label: "Length (linear feet)"
//   type="number" step="1" min="1"
//   Max from product_profiles.max_length_ft
//   Hint: "Standard stock length: X ft" if applicable

// [Back] returns to Step 1 (selection preserved)
// [Next: Quantity] advances if required dimensions valid
```

### Step 3 — Quantity + Project Details

```typescript
interface StepThreeData {
  quantity:              number;           // Number of pieces
  unit:                  'LF' | 'EA' | 'SF';
  adjustedQuantityLf:    number;           // Calculated: qty × length × waste_factor
  wasteFactorPct:        number;           // From pricing_rules (default 10% until set)
  recommendedAccessories:AccessorySuggestion[];

  // Project context — all optional
  projectName:           string | null;
  projectId:             string | null;    // Link to existing project
  jobsiteAddress:        string | null;
  requestedDeliveryDate: string | null;    // Date picker
  poNumber:              string | null;
  isRush:                boolean;
  notes:                 string | null;
}

// Waste factor display:
//   "Auto-adding X% waste factor (industry standard for {materialName})"
//   "Your order: X LF + X% waste = X LF total"
//   [What is waste factor?] expandable explanation
//   QUANTITY MATH ONLY — no prices

// Recommended accessories (from product_accessories table):
//   Required accessories: shown with "Required" badge, pre-checked
//   Optional accessories: shown with checkbox (unchecked default)
//   Each shows: name, typical usage, unit
//   NO PRICES on accessories — informational only
//   AI Cross-Sell may add suggestions here (see SPEC_AI_CROSS_SELL.md)

// Project assignment (if authenticated):
//   "Assign to project" dropdown → existing projects + "Create New Project"
//   Selecting project pre-fills jobsite address

// Rush toggle:
//   "I need this order rushed" checkbox
//   Expands: definition of rush (BLOCKED pending checklist #32)
//   Current placeholder: "Rush orders receive priority scheduling"
//   Rush note: "Rush surcharge applies — AFS will confirm amount in your quote"

// Estimator notes field:
//   Placeholder: "Match existing profile on north parapet. Notify me before shipping."
//   Max: 500 characters

// [Add Another Profile] → returns to Step 1, preserves session
// [Back] → Step 2
// [Next: Review] → Step 4
```

### Step 4 — Review + Submit

```typescript
// QuoteRequestSummaryTable — READ ONLY
// Columns: # | Profile | Material | Gauge | Finish | Dimensions | Length | Qty | Unit | Rush
// NO price column. NO total column. NO cost column.
// Edit link per row → returns to Step 2 for that item
// Remove link per row → removes item from session
// "Add Another Profile" → Step 1

// Project summary (if assigned):
//   Project name, jobsite address, requested delivery, PO number

// Rush summary (if flagged):
//   Rush badge prominent
//   "Rush surcharge will be included in your formal quote"

// Submission statement (prominent, not dismissible):
//   Box with border-[var(--afs-border)] bg-afs-bg-surface
//   "AFS will review your specifications and deliver a formal quote
//    to your account. Standard turnaround: [BLOCKED — checklist #6]."

// Authentication gate:
//   If authenticated: show [Submit Quote Request] button directly
//   If guest:
//     GuestOptionPanel:
//       "Create an account to track your request and future orders"
//       [Create Account] (primary)
//       OR email input: "Just send me the quote by email" + [Submit]

// [Submit Quote Request] button:
//   Validates: at least 1 item with profile + material + dimensions
//   POST /api/quote-requests
//   Loading state: spinner on button, table locked
//   On success: ConfirmationView (request number + what happens next)
//   On error: toast "Submission failed. Please try again."
```

---

## 5. CONFIRMATION VIEW

```typescript
// Replaces wizard after successful submission
// Components:
//   ConfirmationHeader: crimson checkmark icon
//   "Quote Request Submitted"
//   Request number: font-data text-2xl "AFS-QR-2026-XXXXX"
//   "AFS will review your specifications and send a formal quote to your account."
//   "Typical turnaround: [BLOCKED — checklist #6]"
//   [View Your Requests] → /account/quotes
//   [Submit Another Request] → resets wizard to Step 1
//   "You'll receive an email when your quote is ready."
```

---

## 6. SESSION STATE

```typescript
// Stored in React state + localStorage
// localStorage key: 'afs-quote-session'
// No server calls until final submission

interface QuoteRequestSession {
  sessionId:   string;                    // UUID, client-generated
  items:       QuoteRequestLineItem[];
  currentStep: 1 | 2 | 3 | 4;
  projectId:   string | null;
  projectName: string | null;
  jobsiteAddress: string | null;
  requestedDeliveryDate: string | null;
  poNumber:    string | null;
  isRush:      boolean;
  notes:       string | null;
  guestEmail:  string | null;
}

interface QuoteRequestLineItem {
  id:                string;
  profileId:         string;
  profileName:       string;
  profileSlug:       string;
  materialId:        string;
  materialName:      string;
  gaugeId:           string | null;
  gaugeName:         string | null;
  finishId:          string | null;
  finishName:        string | null;
  dimensions: {
    width:     number | null;
    height:    number | null;
    legA:      number | null;
    legB:      number | null;
    lap:       number | null;
    subtype:   string | null;
    movementSpec: string | null;
  };
  lengthFt:          number;
  quantity:          number;
  unit:              string;
  adjustedQtyLf:     number;
  wasteFactorPct:    number;
  accessories:       string[];            // Accessory names
  isRush:            boolean;
  notes:             string | null;
}
```

---

## 7. API ROUTES

### `POST /api/quote-requests`

```typescript
interface QuoteRequestPayload {
  items:                QuoteRequestLineItem[];
  projectId?:           string;
  jobsiteAddress?:      object;
  requestedDelivery?:   string;
  poNumber?:            string;
  isRush:               boolean;
  notes?:               string;
  guestEmail?:          string;
  uploadId?:            string;           // If from drawing tool
}

// Process:
// 1. Auth check (guest allowed if guestEmail provided)
// 2. Validate items: minimum 1, each has profileId + materialId + at least one dimension
// 3. Generate request_number: AFS-QR-{YEAR}-{SEQUENCE}
// 4. Insert quote_requests record
// 5. Send admin notification email: "New Quote Request — [profile summary]"
// 6. Send customer/guest confirmation email
// 7. Send customer SMS if sms_opt_in and phone set
// 8. Return { requestId, requestNumber }

interface QuoteRequestResponse {
  requestId:     string;
  requestNumber: string;
}
```

### `GET /api/quote-requests`

```typescript
// Auth required
// Returns quote_requests for authenticated user
// Includes formal quote status if quote has been sent
```

### `POST /api/quote-requests/validate`

```typescript
// Calls AI order validator (see SPEC_AI_ORDER_VALIDATOR.md)
// Called from Step 2 on dimension input
// Returns: { valid: boolean, warnings: Warning[], errors: ValidationError[] }
```

---

## 8. BLOCKED DATA

| Feature | Blocked By | Current Behavior |
|---|---|---|
| Profile type options | Checklist #15 | Table exists, empty — shows "No profiles yet" |
| Material options | Checklist #12 | Table exists, empty |
| Gauge options | Checklist #13 | Populated when materials received |
| Finish options | Checklist #14 | Populated when finishes received |
| Dimension min/max validation | Checklist #16 | No range validation until limits set |
| Accessory suggestions | Checklist #17 | Section hidden until accessories loaded |
| Rush definition text | Checklist #32 | Generic placeholder shown |
| Quote turnaround time | Checklist #6 | "Contact us for turnaround times" |
| Waste factor percentages | Checklist #37 | Default 10% shown as estimated |

All placeholders are explicit — never show fake data or invent values.

---

## 9. PLAYWRIGHT TESTS

```typescript
test('wizard progresses through all 4 steps', async ({ page }) => {
  await page.goto('/quote');
  // Verify step 1 visible
  await expect(page.locator('[data-testid="step-1"]')).toBeVisible();
  // Step through wizard with valid inputs
  // Verify step 4 summary table visible
});

test('no prices appear at any wizard step', async ({ page }) => {
  await page.goto('/quote');
  // Complete all 4 steps with valid data
  // At each step, check body text contains no $ price pattern
  const pricePattern = /\$[\d,]+\.\d{2}/;
  for (let step = 1; step <= 4; step++) {
    const text = await page.locator('main').innerText();
    expect(text).not.toMatch(pricePattern);
    if (step < 4) await page.click('[data-testid="next-button"]');
  }
});

test('multi-item adds second profile to review table', async ({ page }) => {
  await page.goto('/quote');
  // Complete steps 1-3 for first item
  // Click Add Another Profile
  // Verify step 1 loads with first item preserved in session
  // Complete second item
  // Verify step 4 shows 2 rows
});

test('guest sees email capture on step 4 submit', async ({ page }) => {
  // Complete wizard without logging in
  // Verify guest email input appears
});

test('rush flag appears in step 4 review', async ({ page }) => {
  // Set rush in step 3
  // Verify Rush badge visible in step 4 summary
});

test('dimension validator blocks advance on impossible combo', async ({ page }) => {
  // Enter leg A + leg B > width for a coping cap
  // Verify warning appears and Next is blocked until acknowledged
});

test('submission creates request and shows confirmation', async ({ page }) => {
  // Auth, complete wizard, submit
  // Verify confirmation view with request number AFS-QR format
});
```

---

*SPEC_QUOTE_BUILDER.md | AFS | Reid Whitesides | June 2026*
