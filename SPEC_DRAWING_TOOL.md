# SPEC_DRAWING_TOOL.md
## AFS — Blueprint Takeoff AI
**Phase 1 — Built First. Highest complexity, highest value.**
**Route:** `/upload`

---

## 1. WHAT THIS IS

The Blueprint Takeoff AI lets contractors, architects, and project managers upload
a construction drawing and receive a complete, structured material specification
extracted by AI. The extracted specification feeds directly into the quote request
system. No manual measurement. No re-entry of drawing data.

This is the primary intake path for all technical users. It replaces the most
time-consuming part of the estimating process — reading drawings and extracting
quantities.

**Competitive context:** Professional takeoff software charges $1,749/year/user
for less capable tools. AFS provides this as part of the platform.

---

## 2. SUPPORTED FILE TYPES

| Format | Extension | Server Processing |
|---|---|---|
| AutoCAD Drawing | .dwg | Rasterize via server-side tool → AI vision |
| AutoCAD Exchange | .dxf | Parse geometry + layers as structured text → AI analysis |
| PDF (vector) | .pdf | Extract geometry + text via pdfjs-dist → AI analysis |
| PDF (scanned) | .pdf | Rasterize at 300 DPI → AI vision |
| PNG / JPEG / WEBP | .png .jpg .jpeg .webp | Direct AI vision |
| TIFF | .tiff .tif | Convert to PNG → AI vision |

**Limits:** 50MB per file. 20 pages maximum per upload. 1 concurrent upload per session.

---

## 3. USER FLOWS

### 3.1 Authenticated User — Full Flow

```
/upload
  UploadDropzone displayed
    User drags or clicks to select file
    Client-side validation: type + size
      Invalid → FileRejectionMessage, no upload starts
      Valid → continue
    UploadProgress bar appears
    File uploads to Supabase Storage: blueprints/{userId}/{uuid}/{filename}
    POST /api/takeoff { uploadId, storageKey, fileType }
    ProcessingStatusPanel appears:
      Stage 1 — "Reading your drawing..."         (0–15s)
      Stage 2 — "Identifying flashing profiles..." (15–45s)
      Stage 3 — "Calculating quantities..."        (45–90s)
      Stage 4 — "Building your specification..."   (90–120s)
    AI processing completes
    TakeoffResultsTable rendered with extracted items
    User reviews each row:
      Profile type      (editable dropdown — from product_profiles table)
      Material          (editable dropdown — from materials table)
      Gauge             (editable dropdown — filtered by selected material)
      W × H × A × B    (editable numeric inputs, JetBrains Mono, inches)
      Length            (editable, linear feet)
      Quantity          (editable, count)
      Confidence badge  (green/amber/crimson)
    Low-confidence rows: amber left border, "Please verify" note
    AI drawing reference note shown per row (e.g., "North parapet, sheet A3.1")
    User edits any incorrect items inline
    [Submit Quote Request] → creates quote_requests record
    Confirmation: "Quote request submitted — request number AFS-QR-2026-XXXXX"
```

### 3.2 Guest User Flow

```
Same upload and processing flow
After TakeoffResultsTable confirmation:
  GuestCaptureModal appears:
    "Enter your email to receive your quote request confirmation"
    Email (required), Name (optional), Company (optional)
  POST /api/quote-requests with guest_email
  Resend confirmation email with request number
  "Create an account to track your request and manage future orders"
```

### 3.3 Partial Extraction

```
AI extracts some items but flags others as unclear
  TakeoffResultsTable shows extracted items
  PartialExtractionNotice:
    "We identified X items. Some areas of your drawing were not clear enough to read."
    "Review what we found and add anything we missed."
  ManualAddRow button at bottom of table
  Consultation CTA: "This project looks complex — speak with our team"
    → /architects/consultation
```

### 3.4 Failed Extraction

```
AI cannot extract meaningful data
  ExtractionFailurePanel:
    Clear, specific message — not a generic error
    "This drawing does not appear to contain flashing details we can read,
     or the file quality is too low for AI analysis."
  Three recovery options:
    "Try a Different File"           → returns to UploadDropzone
    "Build a Quote Request Manually" → /quote
    "Talk to Our Team"               → /architects/consultation
```

---

## 4. COMPONENT ARCHITECTURE

### `app/(public)/upload/page.tsx`

Page-level state machine drives which component is visible:

```typescript
type UploadPageState =
  | 'idle'        // UploadDropzone
  | 'uploading'   // UploadProgress
  | 'processing'  // ProcessingStatusPanel
  | 'results'     // TakeoffResultsTable + TakeoffActions
  | 'partial'     // TakeoffResultsTable + PartialExtractionNotice
  | 'failed'      // ExtractionFailurePanel
  | 'submitting'  // spinner on submit button, table locked
  | 'submitted';  // confirmation view
```

Page sections:
```
UploadPageHero (eyebrow + H1 + subheadline + supported formats list)
UploadWorkspace (the state-driven interactive area)
HowItWorksSteps (below the fold — static, always visible)
```

### `UploadDropzone`

```typescript
interface UploadDropzoneProps {
  onFileAccepted: (file: File) => void;
  isDisabled: boolean;
}

// Behavior:
// min-height: 480px
// Accepts: .dwg .dxf .pdf .png .jpg .jpeg .tiff .tif .webp
// Drag-over: border-afs-crimson bg-afs-crimson-ghost
// Idle: border-afs-chrome-dim border-dashed, subtle pulse animation
// Displays: format chips, 50MB limit, "or drag your drawing here"
// Drag-and-drop AND click-to-browse both work
// Keyboard accessible — click handler on the zone
// Validates on drop — before upload starts

function validateFile(file: File): { valid: boolean; error?: string } {
  const ACCEPTED = ['.dwg','.dxf','.pdf','.png','.jpg','.jpeg','.tiff','.tif','.webp'];
  const MAX_BYTES = 50 * 1024 * 1024;
  if (file.size === 0) return { valid: false, error: 'This file is empty.' };
  if (file.size > MAX_BYTES) return {
    valid: false,
    error: `File exceeds 50MB. Your file is ${(file.size/1024/1024).toFixed(1)}MB.`
  };
  const ext = '.' + file.name.split('.').pop()?.toLowerCase();
  if (!ACCEPTED.includes(ext)) return {
    valid: false,
    error: `${ext.toUpperCase()} is not supported. Accepted: DWG, DXF, PDF, PNG, JPG, TIFF.`
  };
  return { valid: true };
}
```

### `UploadProgress`

```typescript
interface UploadProgressProps {
  progress: number;       // 0–100
  filename: string;
  fileSize: string;       // formatted: "4.2 MB"
  onCancel: () => void;   // AbortController.abort()
}

// Crimson progress bar with smooth CSS transition
// Filename + formatted size displayed
// "Cancel" link — cancels upload, returns to idle
```

### `ProcessingStatusPanel`

```typescript
type ProcessingStage = 'reading' | 'identifying' | 'calculating' | 'building';

interface ProcessingStatusPanelProps {
  stage: ProcessingStage;
  elapsedSeconds: number;
}

// Four-step vertical progress indicator
// NOT a spinner — a step sequence with labels
// Completed steps: crimson filled dot + checkmark
// Current step: pulsing crimson dot
// Pending steps: empty chrome-dim dot, dashed connector
// "Usually takes 60–90 seconds. Do not close this tab."
// If elapsed > 180s: "Taking longer than expected. You can leave — we'll email you when ready."
```

### `TakeoffResultsTable`

```typescript
interface TakeoffItem {
  id:                   string;
  profileType:          string;
  profileTypeOptions:   string[];  // From product_profiles — not hardcoded
  material:             string;
  materialOptions:      string[];  // From materials table
  gauge:                string;
  gaugeOptions:         string[];  // Filtered by selected material
  finish:               string;
  width:                number | null;
  height:               number | null;
  legA:                 number | null;
  legB:                 number | null;
  lengthFt:             number;
  quantity:             number;
  unit:                 'LF' | 'EA' | 'SF';
  confidence:           'high' | 'medium' | 'low';
  aiNote:               string | null;   // Drawing reference from AI
  isManual:             boolean;         // User-added row
}

// Table columns:
// # | Profile Type | Material | Gauge | W×H×A×B (inches) | Length (ft) | Qty | Unit | Confidence | Actions

// Cell behavior:
// Profile Type:  dropdown populated from product_profiles (not hardcoded)
// Material:      dropdown populated from materials table
// Gauge:         populates dynamically based on selected material
// Dimensions:    type="number" step="0.125" JetBrains Mono, suffix: "
//                Real-time validation against product_profiles min/max per profile
// Confidence:    green badge (high) | amber badge (medium) | crimson badge (low)
// Low confidence rows: border-l-2 border-amber-400
// Actions:       duplicate row | remove row
// Row hover:     bg-afs-bg-surface

// Table footer:
// [Add Item] button — appends blank manual row
// "X items identified" count
// "Total: X linear feet" (sum of length × quantity)
```

### `TakeoffActions`

```typescript
// Below TakeoffResultsTable
// Primary:   "Submit Quote Request" (crimson)
// Secondary: "Save for Later" (ghost — auth only, saves to takeoff_drafts)
// Ghost:     "Start Over" (clears all, returns to idle)
// Ghost:     "Talk to Our Team" → /architects/consultation
```

---

## 5. API ROUTES

### `POST /api/upload`

```typescript
// Multipart form data
// Body: file (File)
// Auth: optional (guests can upload)

// Server-side process:
// 1. Re-validate type and size server-side (never trust client)
// 2. Sanitize filename: remove special chars, spaces → underscores
// 3. Generate storage key: blueprints/{userId|'guest'}/{uuid}/{sanitized}
// 4. Upload buffer to Supabase Storage bucket 'blueprints'
// 5. Insert takeoff_uploads record (status: 'uploaded')
// 6. Return: { uploadId: string, storageKey: string }

interface UploadResponse {
  uploadId:    string;
  storageKey:  string;
  status:      'uploaded' | 'error';
  error?:      string;
}
```

### `POST /api/takeoff`

```typescript
interface TakeoffRequest {
  uploadId:   string;
  storageKey: string;
  fileType:   string;
}

// Server-side process:
// 1. Auth check (guest allowed — matches upload record)
// 2. Update takeoff_uploads.status = 'processing'
// 3. Download file from Supabase Storage
// 4. Convert to processable format:
//    .dxf  → parse with custom DXF text parser → structured geometry JSON
//    .pdf  → attempt pdfjs-dist text/vector extraction
//            if mostly raster → rasterize pages at 300 DPI
//    .dwg  → rasterize via server-side LibreCAD/oda-file-converter
//    image → use directly as base64
// 5. Build Claude API message:
//    Model: claude-sonnet-4-6
//    System: TAKEOFF_SYSTEM_PROMPT (see Section 6)
//    User: processed file content
//    Max tokens: 4096
// 6. Parse JSON response from Claude
// 7. Validate against TakeoffItem schema
// 8. Update takeoff_uploads with results
// 9. Return TakeoffResponse

interface TakeoffResponse {
  items:            TakeoffItem[];
  overallConfidence:'high' | 'medium' | 'low';
  pagesProcessed:   number;
  processingNotes:  string | null;
  status:           'success' | 'partial' | 'failed';
  error?:           string;
}
```

### `POST /api/quote-requests`

See `SPEC_QUOTE_BUILDER.md` — same endpoint used by both drawing tool and quote wizard.

---

## 6. AI SYSTEM PROMPT

```
TAKEOFF_SYSTEM_PROMPT:

You are a construction drawing analyzer for AFS Architectural Flashing Supply,
a sheet metal fabricator. Your job is to read architectural drawings and extract
all flashing and sheet metal details into a structured specification.

PROFILE TYPES TO IDENTIFY:
- Coping Cap (parapet cap) — note width, height, leg lengths
- Base Flashing — note height, leg lengths
- Counter Flashing — note height, lap dimension
- Step Flashing — note width, length per piece
- Drip Edge (D-style, L-style, T-style) — note leg lengths, subtype
- Gravel Stop — note height, leg length
- Valley Flashing — note width
- Expansion Joint Cover — note width, movement specification
- Reglet — note depth
- Through-wall Flashing — note width, projection

FOR EACH ITEM EXTRACT:
1. Profile type (from list above)
2. Material if specified (copper, aluminum, galvanized steel, stainless, Galvalume)
3. Gauge or weight if specified (e.g., "16 oz copper", "20 ga galv", ".032 aluminum")
4. Finish if specified
5. Dimensions in INCHES:
   - Width (W): horizontal span
   - Height (H): vertical rise
   - Leg A: first leg length
   - Leg B: second leg length (if applicable)
6. Length in LINEAR FEET — calculate from drawing scale if readable
7. Quantity — count of pieces or sections
8. Confidence:
   high:   dimension clearly legible, profile type certain, quantity countable
   medium: profile identifiable but dimensions estimated or partially legible
   low:    profile type uncertain or dimensions not readable
9. Note the drawing sheet and detail reference if visible

OUTPUT — Return ONLY valid JSON, no prose, no markdown, no code fences:
{
  "items": [
    {
      "profileType": "Coping Cap",
      "material": "Galvanized Steel",
      "gauge": "20 ga",
      "finish": null,
      "width": 12,
      "height": 4,
      "legA": 3,
      "legB": 3,
      "lengthFt": 48,
      "quantity": 1,
      "unit": "LF",
      "confidence": "high",
      "aiNote": "North parapet, sheet A3.1 detail 5"
    }
  ],
  "processingNotes": "Processed 3 sheets. Sheet A1.0 is site plan — no flashing. Details from A3.1 and A3.2.",
  "overallConfidence": "medium"
}

RULES:
- Do not include items you cannot identify with at least low confidence
- Set dimension to null if not legible — never guess a dimension
- If drawing has no flashing details:
  { "items": [], "processingNotes": "No flashing details identified.", "overallConfidence": "low" }
- Aggregate repeated identical details (e.g., 6 identical coping cap sections = 1 item, quantity 6)
- Note every drawing sheet and detail reference you can read in aiNote
```

---

## 7. DATABASE

### `takeoff_uploads` (in SCHEMA.md)

Key columns: `user_id`, `storage_key`, `status`, `result_items JSONB`,
`confirmed_items JSONB`, `request_id`, `processing_ms`.

### Supabase Storage Bucket: `blueprints`

```
Access:       private (signed URLs only)
Path:         blueprints/{userId|'guest'}/{uploadId}/{filename}
Max size:     50MB
File types:   pdf, dwg, dxf, png, jpg, jpeg, tiff, tif, webp
```

---

## 8. RLS

```sql
-- Users see only their own uploads
ALTER TABLE takeoff_uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_uploads" ON takeoff_uploads
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "users_insert_uploads" ON takeoff_uploads
  FOR INSERT WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "admin_all_uploads" ON takeoff_uploads
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );
```

---

## 9. ERROR STATES

| Scenario | Behavior |
|---|---|
| File > 50MB | Client-side rejection before upload, size stated in message |
| Unsupported type | Client-side rejection, lists all accepted formats |
| Network failure during upload | "Upload failed. Try again." — no data lost |
| DWG conversion fails | "DWG conversion failed. Try exporting as PDF from AutoCAD." |
| AI returns malformed JSON | Retry once automatically. If still fails → ExtractionFailurePanel |
| AI timeout > 3 minutes | "Processing is taking longer than usual. We'll email you when ready." Save reference. |
| Zero items extracted | ExtractionFailurePanel with three recovery paths |
| User submits 0 items | "Add at least one item before submitting your request" — toast |
| Session expires during processing | Result saved to takeoff_uploads — user retrieves via email link |

---

## 10. ACCESSIBILITY

- Drag-and-drop has click-to-upload fallback — keyboard users not blocked
- File input visible to screen readers
- Processing stages announced via `aria-live="polite"`
- Errors announced via `aria-live="assertive"`
- Table cells focusable and editable via keyboard
- Confidence badges have text labels, not color alone
- All form inputs have associated labels (not placeholder-only)

---

## 11. PERFORMANCE

- Upload UI responds within 100ms of file drop
- Upload progress via XHR with onprogress events
- AI processing: client polls `GET /api/takeoff/{uploadId}/status` every 5s
- Table renders 200 items without virtualization issues
- All animations CSS-only, prefers-reduced-motion respected

---

## 12. PLAYWRIGHT TESTS

```typescript
// tests/drawing-tool.spec.ts

test('accepts valid PDF and shows processing panel', async ({ page }) => {
  await page.goto('/upload');
  const input = page.locator('[data-testid="file-input"]');
  await input.setInputFiles('fixtures/test-drawing.pdf');
  await expect(page.locator('[data-testid="upload-progress"]')).toBeVisible();
});

test('rejects file over 50MB', async ({ page }) => {
  await page.goto('/upload');
  // Upload oversized file — verify rejection message appears
  await expect(page.locator('text=exceeds 50MB')).toBeVisible();
});

test('rejects unsupported file type', async ({ page }) => {
  await page.goto('/upload');
  // Upload .xlsx — verify rejection message
  await expect(page.locator('text=not supported')).toBeVisible();
});

test('shows results table with correct columns', async ({ page }) => {
  // Mock /api/takeoff to return fixture response
  await page.goto('/upload');
  // Upload file, wait for results
  await expect(page.locator('[data-testid="takeoff-results-table"]')).toBeVisible();
  await expect(page.locator('th:has-text("Profile Type")')).toBeVisible();
  // Verify no price column exists
  await expect(page.locator('th:has-text("Price")')).not.toBeVisible();
  await expect(page.locator('th:has-text("Cost")')).not.toBeVisible();
});

test('inline editing updates table row', async ({ page }) => {
  // Click dimension cell, type new value, verify update
});

test('low confidence rows have amber indicator', async ({ page }) => {
  // Mock response with one low-confidence item
  // Verify amber left border on that row
});

test('guest user sees email capture modal on submit', async ({ page }) => {
  // Complete flow without logging in
  // Click Submit — verify GuestCaptureModal appears
});

test('authenticated user submit creates quote request', async ({ page }) => {
  // Auth as contractor, complete flow, submit
  // Verify redirect to confirmation with request number
});

test('start over returns to upload dropzone', async ({ page }) => {
  // After results shown, click Start Over
  // Verify UploadDropzone visible again
});
```

---

*SPEC_DRAWING_TOOL.md | AFS | Reid Whitesides | June 2026*
