# SPEC_AI_ORDER_VALIDATOR.md
## AFS — AI Order Validator
**Phase 2 — Embedded in Quote Wizard Step 2 and Checkout**
**Catches impossible dimensions and incompatible combos before submission.**

---

## 1. WHAT THIS IS

The AI Order Validator runs on dimension inputs to catch errors before a quote
request is submitted. For custom fabricated products, an error in dimensions
means a useless piece gets cut. Catching it early — before the quote even
goes to AFS — saves both AFS and the customer from a costly mistake.

**Two validation layers:**
1. **Deterministic** — Range checks from product_profiles (client-side, instant)
2. **AI-assisted** — Physical impossibility checks (Claude API, fires on Step Next)

---

## 2. LAYER 1 — DETERMINISTIC RANGE VALIDATION

```typescript
// Runs client-side in real time on every dimension change
// Source: product_profiles min/max columns
// No API call — client already has profile constraints loaded

function validateDimensions(
  dimensions: DimensionSet,
  profile: ProfileConstraints
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (dimensions.width !== null && profile.minWidth !== null) {
    if (dimensions.width < profile.minWidth)
      errors.push({ field: 'width', message: `Minimum width is ${profile.minWidth}"` });
    if (dimensions.width > profile.maxWidth!)
      errors.push({ field: 'width', message: `Maximum width is ${profile.maxWidth}"` });
  }
  // Repeat for height, legA, legB

  return errors;
}

// UI behavior:
// Red border on input + error message below input
// [Next] button disabled while any error exists
```

---

## 3. LAYER 2 — AI IMPOSSIBILITY CHECK

Fires when user clicks [Next] from Step 2.
Does NOT run on every keystroke — too expensive and slow.

```typescript
// POST /api/quote-requests/validate

const VALIDATOR_PROMPT = `You are a sheet metal fabrication validator for AFS
Architectural Flashing Supply. Check if these dimensions are physically possible
and practical for the selected profile type.

Profile: {profileType}
Material: {materialName}
Gauge: {gaugeName}
Dimensions: Width={W}" Height={H}" Leg A={A}" Leg B={B}"

RULES:
Coping Cap: Leg A + Leg B must be less than Width (legs fold down from the cap)
Counter Flashing: Height must be greater than Lap (cannot lap more than the height)
Step Flashing: Width should be at least 4 inches for standard shingle coverage
All profiles: No dimension should be zero if it is required for this profile type
Gauge vs. Width: Very wide spans in light gauges will not hold shape — flag if Width > 24" and gauge is > 22ga galvanized

Return JSON only:
{
  "valid": true|false,
  "errors": [
    { "field": "legA", "severity": "error", "message": "Leg A plus Leg B (7\") exceeds width (6\"). The legs must fit within the width." }
  ],
  "warnings": [
    { "field": "width", "severity": "warning", "message": "24\\" width in 22ga is at the upper limit for this gauge. Consider 20ga for stability." }
  ]
}

IMPORTANT:
- error: physically impossible — cannot be fabricated as specified
- warning: unusual but possible — contractor should confirm this is intentional
- Return valid: true with empty arrays if all dimensions are reasonable
- Never refuse a valid fabrication — only flag actual impossibilities`;
```

---

## 4. INCOMPATIBLE COMBINATIONS (BLOCKED)

```sql
-- Table exists for future use
-- CREATE TABLE incompatible_combinations in SCHEMA.md (within additional tables section)
-- Populated when checklist #38 data received (fabrication constraints)
-- Currently: table is empty, no incompatibility rules enforced
-- When populated: checked server-side in validator endpoint
```

---

## 5. UI BEHAVIOR

```typescript
// When user clicks [Next] from Step 2:
//   1. Run deterministic validation immediately (client-side)
//      Any errors → show inline, block advance
//   2. If deterministic passes → POST /api/quote-requests/validate
//   3. Show loading state on [Next] button
//   4. On response:
//      errors → show inline warnings, block advance
//      warnings → show amber warning banners with [Acknowledge and Continue] option
//      valid → advance to Step 3

// WarningBanner component:
//   bg-afs-warning-ghost border border-afs-warning
//   Warning text from AI
//   [Acknowledge and Continue] button — clears warning, allows advance
//   User must explicitly acknowledge each warning

// ErrorBanner component:
//   bg-afs-crimson-ghost border border-[var(--afs-border-crimson)]
//   Error text from AI
//   [Revise Dimensions] button — returns focus to the relevant input
//   Cannot proceed until error is corrected
```

---

## 6. API ROUTE

### `POST /api/quote-requests/validate`

```typescript
interface ValidationRequest {
  profileId:   string;
  materialId:  string;
  gaugeId:     string | null;
  dimensions:  DimensionSet;
}

interface ValidationResponse {
  valid:    boolean;
  errors:   ValidationError[];
  warnings: ValidationWarning[];
}

// Server process:
// 1. Deterministic check (redundant but authoritative — do not trust client)
// 2. Check incompatible_combinations table (currently empty)
// 3. Call Claude AI impossibility check if deterministic passes
// 4. Return combined results
// Timeout: 8 seconds max — fall through to valid if API slow
```

---

## 7. PLAYWRIGHT TESTS

```typescript
test('dimension below minimum shows inline error', async ({ page }) => {
  await page.goto('/quote');
  // Select coping-cap + galvanized, go to step 2
  // Enter width below minimum
  // Verify red border and error message
  // Verify Next button disabled
});

test('AI warning shows acknowledge option', async ({ page }) => {
  // Enter dimension combination that is valid but unusual
  // Click Next — verify warning banner appears
  // Verify acknowledge button allows continuing
});

test('physically impossible dimensions block advance', async ({ page }) => {
  // Enter legA + legB > width for coping cap
  // Click Next — verify error banner
  // Verify cannot advance without fixing dimensions
});
```

---

*SPEC_AI_ORDER_VALIDATOR.md | AFS | Reid Whitesides | June 2026*
