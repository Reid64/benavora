# AFS Platform — Session Handoff (2026-07-31 → next session)

Paste this entire document as your first message in the new chat.

## Context on why this handoff exists
The previous chat session became too large for file uploads to reliably
transmit content (several document uploads arrived empty). This handoff
exists to transfer everything that session accomplished and everything
still open, in plain text, so nothing is lost.

## What this project is
AFS (Architectural Flashing Supply) platform — a full-stack RFQ system
for Steve Harycki (owner, AFS, Burnet TX) built by Reid Whitesides at
Visual AI Method. Next.js 14/TypeScript/Tailwind/Supabase/Vercel.
RFQ-only, no self-service pricing, manual estimator pricing at launch.
Governance docs (source of truth, read these first in the new chat):
STATE_OF_THE_BUILD.md and SESSION_STATE.md at the project root of
C:\Users\manag\Documents\afs-website — both were just updated with a
full, detailed record of everything below. Read them fully before doing
anything else.

## Immediate priorities for the next session, in order

### 1. Confirm the last governance-doc commit actually landed
The previous session ended mid-verification of a large governance-doc
update commit. First action in the new session: run
`cd C:\Users\manag\Documents\afs-website; git log --oneline -5` and
confirm the most recent commit is the governance/session-record commit
(message starts "docs: comprehensive session record"). If it's not
there, the update needs to be redone from what's captured in this
handoff.

### 2. Apply migration 013 to live Supabase
`supabase/migrations/013_bid_documents.sql` exists in the repo (added
this session, part of the bid-documents feature) but has NOT been
applied to the live database yet. Use the same careful process as
migrations 007-012 from this session: read the file in full first,
check via direct `information_schema` queries (NOT the Supabase
REST/PostgREST layer — confirmed unreliable, returns stale
schema-cache results and false positives this session) whether any
referenced functions/tables already exist under different names before
applying, apply via the Supabase Dashboard SQL Editor, then
independently re-verify every table/column/function it should create
with direct `information_schema.columns` / `information_schema.tables`
/ `pg_proc` queries — do not trust an automated check script's report
at face value.

### 3. Fix and re-run the po-gaps queue
`C:\Users\manag\Documents\FORGE\library\afs-website\queue-po-gaps.yaml`
exists as a file but was never actually copied into the FORGE library
folder before a launch, so it failed instantly with "Queue file not
found" — not a real build failure. It targets two confirmed-real gaps
from earlier verification: (a) no admin UI exists anywhere to set
`companies.require_po`, and (b) `app/api/checkout/create-intent/route.ts`
has zero server-side enforcement of that flag even if it were set — a
customer could submit no PO number and checkout would succeed anyway.
See `PO_GAPS_VERIFIED.md` and `PO_INTEGRATION_SCOPE.md` at the project
root for full detail. To re-run: confirm the file exists at
`C:\Users\manag\Documents\FORGE\library\afs-website\queue-po-gaps.yaml`
(if not, it needs to be regenerated — full content is in this session's
git history if lost), reset its manifest status from `failed` to
`pending` in `library-manifest.yaml`, then run the orchestrator.

### 4. Spot-check bid-documents and credit-application against their scope docs
Both queues reported genuine pass (bid-documents: 3/3 prompts, 68.6 min;
credit-application: 2/2 prompts, 14.9 min) via the real orchestrator
log — but neither has been independently verified against its scope
document yet. This matters because earlier the same session, the
PO integration scope doc was excellent but its implementation silently
built only 1 of 6 specified items with zero indication anything was
skipped — caught only by manual line-by-line comparison. Do the same
for BID_DOCUMENT_SCOPE.md and CREDIT_APP_GAPS.md: grep the actual
changed files for the specific mechanisms each doc called for (for
bid-documents: mutual claim release between Trica/Steve, the staleness
auto-release timeout, real Resend send vs. a stub, the exact PDF
line-item structure; for credit-application: whether approving an
application actually sets `companies.require_po`, which was the whole
point of connecting these two features).

### 5. Fix or remove scripts/generate-employee-icons.js
This script does NOT use the real AFS logo — it hand-draws a fabricated
shield graphic with a crude bitmap font. The real icons currently live
at `public/employee-icon-192.png` / `-512.png` (committed, correct, from
the real logo) but if anyone runs
`pnpm run generate:employee-icons` again without fixing this script
first, it will silently overwrite them with the wrong graphic again.

### 6. Rotate the exposed Supabase service_role key
A live `service_role` key was pasted in plaintext into the previous
chat session and has not been rotated as of this handoff. Rotate it in
Supabase Dashboard → Project Settings → API, then update
`.env.local` and Vercel's environment variables. This is a standing
security exposure until done.

## Key facts to carry forward (condensed — full detail in
STATE_OF_THE_BUILD.md / SESSION_STATE.md)

- **FORGE 1.0 is the only system in use.** FORGE 2.0 (a separate,
  more ambitious rebuild attempted in a different Claude Project) was
  abandoned after real complications — its own retrospective found its
  foundational layer (basic prompt execution against the correct
  project directory) was never fully proven reliable before 15 major
  subsystems were built on top of it, including an oversight/
  verification layer (Sentinel Prime) that never made it onto the "what
  actually works" list. Lesson carried forward: verify the simple thing
  works before building sophistication on top of it.
- **Canonical FORGE launch command:**
  `cd C:\Users\manag\Documents\FORGE`
  `powershell -ExecutionPolicy Bypass -File .\forge-orchestrator.ps1 -project afs-website [-dryRun]`
- **Manifest file: values must be unquoted** (bare filename, no quote
  marks) — the parser is line-based regex, not real YAML.
- **Downloads folder collision risk:** `C:\Users\manag\Downloads\Recent
  Downloads` is shared across multiple unrelated projects. Before
  trusting any file copied from there into the FORGE library folder,
  run `Get-ChildItem` with a wildcard filter first and check for
  `(1)`/`(2)`/`(3)` suffix duplicates from filename collisions.
- **Migrations 007–009 were found almost entirely unapplied this
  session** despite being marked applied previously — the check
  script's PostgREST-based existence check gave false positives. Only
  trust direct `information_schema`/`pg_proc` queries against Postgres
  itself for migration verification going forward.
- **PathfinderEdge has a real, working REST API** (confirmed live:
  `GET /api/v1/catalogs`, `POST /api/v1/profiles` both return 200) but
  profiles created through it do NOT sync to the physical Thalmann
  machine — only the UI's Save action or SignalR's ProcessProfile does
  that. An AMS Controls support ticket asking whether a sync-capable
  endpoint exists was opened; check for a reply.
- **Two distinct AFS logo variants exist** — a flat red "AFS" wordmark
  on a black rounded-square card (`public/afs-logo-512.png`, confirmed
  correct for icons/small-format use) and a wider chrome-bevel mark with
  "ARCHITECTURAL FLASHING SUPPLY" spelled out beneath it (used for
  document headers/full-size branding). Confirm which context each
  belongs in before using either — do not assume.

## Working style for this project (carry forward exactly)
- pnpm only, never npm/yarn
- Claude Code places all files automatically — never ask the user to
  manually create/edit files
- Full file replacement, never surgical edits, in Claude Code runs
- No background tasks — real-time processing output only
- One prompt/command at a time — never stack multiple in a row
- Every command must include the launch path for the project root
- STATE_OF_THE_BUILD.md and SESSION_STATE.md updated after every real
  run — these are the source of truth, not memory
- `pnpm tsc --noEmit` must pass 0 errors before any prompt is complete
- No customer-facing pricing anywhere before a formal AFS-generated
  quote
- PowerShell: no `&&` as a separator; `-LiteralPath` for paths with
  square brackets; git commands run sequentially, not chained
