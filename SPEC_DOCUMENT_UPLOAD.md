# SPEC_DOCUMENT_UPLOAD.md
## AFS — Document Upload System
**Phase 1 — Built alongside Drawing Tool.**
**Three distinct contexts using shared upload infrastructure.**

---

## 1. THREE DOCUMENT CONTEXTS

The document upload system serves three separate use cases, all sharing the same
core upload infrastructure but with different storage paths, access rules, and UI.

### Context A — Project Document Vault
**Who uses it:** Contractors, architects, project managers
**Where it lives:** `/account/documents` and within project detail pages
**What gets stored:** Construction drawings, specifications, submittals, RFIs,
change orders, permits, lender documents
**Access rules:** User sees only their own documents. Team members share access
when company team accounts are configured.
**Storage path:** `documents/{userId}/projects/{projectId}/{filename}`

### Context B — CAD/BIM Library
**Who uploads:** AFS admin only via `/admin/cad-library`
**Who downloads:** Any authenticated user
**Where it lives:** `/architects/cad-library`
**What gets stored:** DWG fabrication details, DXF profiles, Revit families
**Access rules:** Browse without auth. Download requires any authenticated account.
**Storage path:** `cad-library/{profileSlug}/{format}/{filename}`

### Context C — Order Attachments
**Who uploads:**
  Customer: approved shop drawings (before fabrication starts)
  AFS admin: pre-ship photos, signed BOL, delivery confirmation
**Where it lives:** Within order detail pages
**Access rules:** Customer sees their order's visible attachments. Admin sees all.
**Storage path:** `orders/{orderId}/{attachmentType}/{filename}`

---

## 2. ACCEPTED FILE TYPES BY CONTEXT

### Context A — Project Vault
```
Documents: .pdf, .doc, .docx, .txt, .rtf
Drawings:  .dwg, .dxf, .pdf
Images:    .png, .jpg, .jpeg, .tiff
Data:      .xlsx, .csv
Archives:  .zip
Max size:  100MB per file
```

### Context B — CAD/BIM Library
```
AutoCAD:   .dwg, .dxf
Revit:     .rfa (Revit Family), .rvt
PDF:       .pdf
Images:    .png (preview thumbnails)
Max size:  250MB per file (CAD files are large)
```

### Context C — Order Attachments
```
Drawings:  .pdf, .dwg, .dxf
Images:    .png, .jpg, .jpeg (for pre-ship photos)
Documents: .pdf
Max size:  25MB per file
```

---

## 3. SHARED COMPONENTS

### `DocumentUploader`

Universal upload component. Context prop determines allowed types, storage path,
permissions, and behavior.

```typescript
interface DocumentUploaderProps {
  context:          'vault' | 'cad-library' | 'order-attachment';
  contextId:        string;        // projectId | profileSlug | orderId
  attachmentType?:  string;        // Order context: 'approved_drawing' | 'pre_ship_photo' | etc.
  onUploadComplete: (doc: UploadedDocument) => void;
  onUploadError:    (error: string) => void;
  maxFiles?:        number;        // Default: 10
  allowedTypes?:    string[];      // Override context defaults if needed
  disabled?:        boolean;       // Locks upload zone (e.g., after fab starts)
  disabledMessage?: string;        // Shown when disabled
}

interface UploadedDocument {
  id:             string;
  filename:       string;
  storageKey:     string;
  fileType:       string;
  fileSizeBytes:  number;
  uploadedAt:     string;
}

// Behavior:
// Drag-and-drop zone with click-to-browse
// Multi-file support — drag multiple at once
// Each file gets own progress indicator
// Parallel uploads (max 3 concurrent)
// Failed files can be retried individually
// Duplicate detection: warns if filename exists in this context
```

### `DocumentList`

```typescript
interface DocumentListProps {
  contextType:     'vault' | 'cad-library' | 'order-attachment';
  contextId:       string;
  allowDelete?:    boolean;
  allowDownload?:  boolean;
  viewMode:        'grid' | 'list';
  showUploader?:   boolean;
}

// Each document item displays:
// FileTypeIcon (PDF/DWG/RVT/DXF/DOC/XLS/IMG/ZIP — never generic)
// Filename (truncated at 40 chars with full name in tooltip)
// File size (formatted KB/MB)
// Upload date
// Uploaded by (admin view shows user name)
// Download button
// Delete button (if allowDelete and user owns or is admin)
// Preview button (PDF and images only — opens DocumentPreviewModal)
```

### `DocumentPreviewModal`

```typescript
// PDF:     embedded iframe viewer
// Images:  full-size display with zoom (CSS transform)
// DWG/DXF/RVT: "Download to view in AutoCAD / Revit" message
// DOC/XLS:     "Download to view" message
// Max preview width: 900px modal
```

### `FileTypeIcon`

```typescript
// Returns appropriate icon component based on file extension
// Extension → icon mapping:
// .pdf         → PdfIcon (red accent)
// .dwg, .dxf   → DwgIcon (blue accent)
// .rfa, .rvt   → RevitIcon (blue accent)
// .doc, .docx  → DocIcon (blue)
// .xls, .xlsx  → XlsIcon (green)
// .png, .jpg, .jpeg, .tiff → ImgIcon (purple)
// .zip         → ZipIcon (orange)
// everything else → GenericIcon
// Color: afs-chrome-base default, afs-crimson on hover
```

---

## 4. PROJECT DOCUMENT VAULT — FULL SPEC

### Page: `/account/documents`

```
AccountShell
  VaultPage
    VaultHeader
      "Project Documents" (font-heading text-4xl)
      ProjectFilter dropdown (filter by project)
      ViewToggle (grid | list)
      [Upload Files] button → opens upload zone
    VaultSearch
      Text search by filename, tag
    DocumentList (filtered by selected project, all if none selected)
    EmptyState:
      "No documents yet."
      "Upload drawings, specs, and submittals to keep everything organized."
      [Upload Your First Document] CTA
```

### Folder Organization

Documents are organized within projects. User can also create named folders
within a project (e.g., "Submittals", "RFIs", "Change Orders").

```typescript
// Folder depth: maximum 2 levels
// Creation: POST /api/documents/folders { projectId, name, parentId? }
// Navigation: breadcrumb trail above document list

// Folder display:
// FolderCard: folder icon, name, document count, last modified
// Click to enter folder → updates DocumentList filter
// "Back" link to parent folder or project root
```

### Sharing (Team Accounts)

When a user is part of a company team, documents with `is_shared = true`
are visible to all team members with appropriate roles.

```typescript
// Toggle per document: "Share with team"
// Shared badge displayed on document card
// Shared documents appear in team members' vault filtered view
```

---

## 5. CAD/BIM LIBRARY — FULL SPEC

### Page: `/architects/cad-library`

```
ArchitectShell (copper accent)
  CADLibraryPage
    LibraryHero
      "Technical Drawing Library"
      "DWG, DXF, and Revit families for every AFS profile"
    LibraryFilters
      ProfileTypeFilter (checkboxes from product_profiles)
      FormatFilter: All | DWG | DXF | PDF | Revit
      MaterialFilter
    LibraryGrid
      CADFileCard[] — one per file
    EmptyState (if filters return nothing):
      "No files match your filters."
    RequestDrawingCTA:
      "Don't see the profile you need?"
      [Request a Detail] → /architects/consultation
```

### `CADFileCard`

```typescript
interface CADFileCardProps {
  file: {
    id:               string;
    profileName:      string;
    format:           'dwg' | 'dxf' | 'pdf' | 'rfa' | 'rvt';
    filename:         string;
    description:      string;
    fileSizeBytes:    number;
    version:          string;
    revitVersion?:    string;   // e.g., "2024" — shown for .rfa only
    downloadCount:    number;
    previewImageUrl?: string;   // Thumbnail from admin upload
  };
  onDownload: (fileId: string) => void;
}

// Card displays:
// Format badge: DWG (blue) | DXF (teal) | PDF (red) | RVT (purple)
// Profile name: font-heading
// Description (2 lines, truncated)
// File size
// Revit version (only for .rfa files): "Revit 2024"
// Download count: "Downloaded 47 times"
// [Download] button: copper/crimson → requires auth → signed URL → browser download
// Preview thumbnail if available

// Guest user clicks Download:
//   "Sign in to download technical drawings"
//   [Sign In] [Create Free Account]
```

### Download Flow

```typescript
// POST /api/documents/{id}/download
// 1. Verify auth
// 2. Generate Supabase signed URL (15 min expiry)
// 3. Insert cad_download_log record
// 4. Increment cad_library_files.download_count
// 5. Return { signedUrl, expiresAt }
// Client: window.open(signedUrl) or anchor tag trigger
```

### Admin Upload Interface (`/admin/cad-library`)

```
AdminShell
  CADLibraryAdminPage
    Existing files table with edit/delete
    [Upload New File] button → AdminCADUploadModal
      File input (required)
      Profile type dropdown (from product_profiles)
      Format (auto-detected from extension — confirmable)
      Description (textarea)
      Version (text: "1.0", "2024-A")
      Revit Version (text — shown only for .rfa files)
      Preview image (optional — PNG thumbnail)
    Upload → stored in cad-library bucket → inserted to cad_library_files
```

---

## 6. ORDER ATTACHMENTS — FULL SPEC

### Attachment Types

```typescript
type OrderAttachmentType =
  | 'approved_drawing'      // Customer uploads before fabrication
  | 'pre_ship_photo'        // Admin uploads after fabrication complete
  | 'delivery_confirmation' // Admin uploads after delivery
  | 'signed_bol'            // Admin uploads signed bill of lading
  | 'quality_report'        // Admin uploads QC documentation
  | 'other';
```

### Customer Upload (Approved Drawings)

Appears in order detail page `/account/orders/{id}`, visible only when order
status is `received` or `in_queue`.

```
OrderAttachmentsSection
  "Approved Drawings for Fabrication"
  Instructions:
    "Upload your final approved drawings before we begin fabrication.
     Our team will review them before cutting."
  DocumentUploader
    context: 'order-attachment'
    attachmentType: 'approved_drawing'
  ExistingDrawingsList
```

When status advances to `cutting` or beyond:

```typescript
// Upload zone shows disabled state:
// "Fabrication has started. Contact us to make changes to your drawings."
// disabledMessage prop on DocumentUploader
// DocumentUploader.disabled = true
```

Admin notified via Resend when customer uploads approved drawings:
> Subject: "Approved Drawing Uploaded — Order AFS-2026-XXXXX"

### Admin Upload (Pre-Ship Photos)

In admin order detail `/admin/orders/{id}`:

```
PreShipPhotoSection
  "Pre-Ship Photos"
  Instructions: "Upload photos of the completed fabrication before packing."
  DocumentUploader
    context: 'order-attachment'
    attachmentType: 'pre_ship_photo'
    accepts: .png .jpg .jpeg only
  PhotoGrid (thumbnails of uploaded photos)
  "Notify Customer of Photos" checkbox (default: checked)
    → sends email/SMS: "Your order is complete — see photos"
  Admin can delete photos before notification is sent
```

Customer sees pre-ship photos in their order detail, with caption:
"Your completed order — ready to ship"

---

## 7. API ROUTES

### `POST /api/documents/upload`

```typescript
// Multipart form data
// Body: file (File), context (string), contextId (string),
//       attachmentType? (string), description? (string), folderId? (string)
// Auth: required for all contexts

// Permission checks by context:
// vault:            user is authenticated, project belongs to user
// cad-library:      user role = 'admin'
// order-attachment: user owns order OR user role = 'admin'

// Process:
// 1. Auth check
// 2. Permission check per context
// 3. File type validation per context allowed types
// 4. Size validation per context limit
// 5. Sanitize filename
// 6. Generate storage key by context pattern
// 7. Upload to appropriate Supabase Storage bucket
// 8. Insert record to vault_documents or order_attachments
// 9. Return { document: UploadedDocument }
```

### `GET /api/documents`

```typescript
// Query: context, contextId, folderId?, search?
// Auth: required
// Returns documents the user has access to in this context
```

### `DELETE /api/documents/{id}`

```typescript
// Auth: required
// Permission: user owns document OR admin
// Process: delete from Supabase Storage + delete DB record
// No soft delete — permanent
// Admin audit log entry on admin deletes
```

### `GET /api/documents/{id}/download`

```typescript
// Auth: required (for cad-library, any auth; for vault/orders, must own)
// Process:
// 1. Fetch document record
// 2. Verify permission
// 3. Generate Supabase signed URL (900 seconds = 15 min)
// 4. Log download if cad-library context
// 5. Return { signedUrl, expiresAt }
```

---

## 8. ERROR STATES

| Scenario | Behavior |
|---|---|
| File type not permitted | Rejected before upload with specific message listing allowed types |
| File exceeds size limit | Rejected before upload with exact limit stated |
| Network failure mid-upload | That file marked failed, retry button — others unaffected |
| Customer upload after fab starts | Upload zone locked with "Fabrication started" message |
| Download URL expired | Auto-regenerate signed URL on 403 response, transparent to user |
| Admin deletes file user is viewing | "This file is no longer available" error state |
| Duplicate filename in vault | Warning: "A file named X already exists. Upload anyway?" |
| Storage bucket full | "Storage limit reached. Contact support." — admin alerted |

---

## 9. PLAYWRIGHT TESTS

```typescript
test('uploads PDF to vault and appears in list', async ({ page }) => {
  // Auth as contractor, upload PDF, verify appears in document list
});

test('rejects file type not allowed in vault', async ({ page }) => {
  // Attempt .exe upload to vault, verify rejection message
});

test('admin can upload DWG to CAD library', async ({ page }) => {
  // Auth as admin, upload DWG, verify in cad-library
});

test('authenticated user can download from CAD library', async ({ page }) => {
  // Auth as any role, click download, verify signed URL generated
});

test('guest cannot download from CAD library', async ({ page }) => {
  // Not authenticated, attempt download, verify sign-in prompt
});

test('customer can upload approved drawing to order in received status', async ({ page }) => {
  // Auth, order in received status, upload drawing
});

test('customer upload locked when order is in cutting status', async ({ page }) => {
  // Auth, order in cutting status, verify upload zone is disabled
});

test('admin pre-ship photo visible to customer', async ({ page }) => {
  // Admin uploads photo, verify customer sees it in order detail
});
```

---

*SPEC_DOCUMENT_UPLOAD.md | AFS | Reid Whitesides | June 2026*
