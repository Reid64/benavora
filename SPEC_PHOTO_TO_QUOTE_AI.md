# SPEC_PHOTO_TO_QUOTE_AI.md
## AFS — Photo-to-Quote AI
**Phase 2 — Tab within /upload page**
**Mobile-first intake path for field contractors without drawings.**

---

## 1. WHAT THIS IS

Photo-to-Quote serves contractors in the field who do not have formal drawings.
They photograph an existing installation that needs repair or replacement and
submit those photos as the specification basis for a quote request.

**Key distinction from Blueprint Takeoff:** Photos are single-angle jobsite
images, not technical drawings. The AI identifies profile types and materials
but CANNOT reliably extract precise dimensions from photos. Dimensions must
always be entered manually by the user from site measurements. This is stated
prominently before upload.

---

## 2. UI PLACEMENT

Photo mode is a tab within the `/upload` page:

```
/upload
  Tabs: [Upload Drawing] [Upload Photos]
  
  Drawing tab: SPEC_DRAWING_TOOL.md (blueprint takeoff)
  Photos tab:  This spec
```

---

## 3. USER FLOW

```
User selects "Upload Photos" tab
  PhotoUploadDisclaimer (prominent, cannot be dismissed):
    "Photo analysis identifies profile types and materials.
     Dimensions must be entered from your site measurements.
     For precise quotes from plans, use the Drawing Upload tab."
  PhotoUploadZone:
    Large tap target (mobile-optimized)
    "Take Photo" on mobile devices (capture="environment")
    "Upload from Device" fallback
    Max 10 photos, 20MB each
    Accepted: .jpg .jpeg .png .heic .webp
  User uploads 1–10 photos from different angles
  Processing panel per photo (individual progress)
  AI processes each photo
  PhotoResultsDisplay:
    Per-photo result card:
      Identified profile type (with confidence)
      Identified material (with confidence)
      Condition estimate: Good / Aging / Damaged / Failed
      Note: "Dimensions not visible — please measure on site"
  Combined DimensionEntryForm:
    Profile type dropdown (AI suggestion pre-selected, editable)
    Material dropdown (AI suggestion pre-selected, editable)
    Dimension inputs (all required — AI cannot fill these)
    Length + Quantity
  [Submit Quote Request]
    → same POST /api/quote-requests endpoint
    → photos attached to quote request as reference images
```

---

## 4. AI PROMPT STRATEGY

```typescript
const PHOTO_SYSTEM_PROMPT = `You are a flashing identification specialist for
AFS Architectural Flashing Supply. Analyze photos of existing flashing installations.

IDENTIFY:
1. Profile type: coping cap, base flashing, counter flashing, step flashing,
   drip edge, gravel stop, valley, expansion joint, or unknown
2. Material: copper, aluminum, galvanized steel, stainless, or unknown
3. Condition: good, aging, damaged, failed
4. Any visible labels, manufacturer marks, or spec notes

RETURN JSON ONLY — no prose:
{
  "profileType": "Coping Cap",
  "material": "Galvanized Steel",
  "condition": "aging",
  "confidence": "high|medium|low",
  "dimensionVisible": false,
  "visibleWidth": null,
  "note": "Appears to be standard parapet coping, galvanized, showing rust at seams"
}

CRITICAL: Never estimate dimensions from photos. Always set dimensionVisible to
the actual status. If a dimension IS visible and readable (e.g., a tape measure
is in the photo), set dimensionVisible to true and provide the value.`;
```

---

## 5. MOBILE OPTIMIZATION

```typescript
// PhotoUploadZone on mobile:
//   min-height: 280px (smaller than desktop to leave room for keyboard)
//   Large upload icon — minimum 64px tap target
//   "Take a Photo" button prominent (uses capture="environment")
//   "Or upload from camera roll" secondary option
//   Auto-orientation correction (EXIF data)
//   HEIC files converted to JPEG server-side

// Touch-friendly:
//   All buttons minimum 48px height
//   No hover-only states
//   Clear active/pressed states
```

---

## 6. KEY LIMITATIONS SHOWN TO USER

Always displayed before upload. Cannot be dismissed or minimized:

```
"Photo analysis identifies profile types and materials only.
 Dimensions require site measurement — AI cannot measure from photos.
 For precise digital quotes from AutoCAD, Revit, or PDF drawings,
 use the Drawing Upload tab."
```

---

## 7. PLAYWRIGHT TESTS

```typescript
test('photo tab shows disclaimer before upload zone', async ({ page }) => {
  await page.goto('/upload');
  await page.click('[data-testid="tab-photos"]');
  await expect(page.locator('[data-testid="photo-disclaimer"]')).toBeVisible();
});

test('dimension inputs required before submission', async ({ page }) => {
  // Upload photo, verify AI response, attempt submit without dimensions
  // Verify blocked with "Please enter site measurements"
});

test('no dimensions auto-filled from AI response', async ({ page }) => {
  // Complete photo upload + AI processing
  // Verify all dimension inputs are empty (not pre-filled)
});
```

---

*SPEC_PHOTO_TO_QUOTE_AI.md | AFS | Reid Whitesides | June 2026*
