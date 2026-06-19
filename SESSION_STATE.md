# Session State

## Current Session — 2026-06-18

### Completed This Session
- **opportunity-documents-ui**: Added Documents section to opportunity detail page and Parse NOFA button.
  - `src/components/opportunities/OpportunityDetail.tsx` modified:
    - Added `Sparkles` import from lucide-react
    - Added `parseLoading` / `parseError` state
    - Added `handleParseNofa()` async handler (POST /api/agents/nofa-parser, refresh on success, inline error on failure)
    - Added Parse NOFA button in header (variant="secondary", isLoading, next to Edit/Delete)
    - Added inline error alert below header buttons when parseError is set
    - Added `getFilenameFromUrl()` helper (extracts filename from URL pathname)
    - Added NOFA Documents card in OverviewTab (full-width, below Keywords card): lists PDFs from opportunity_documents as teal links with FileText + ExternalLink icons; shows "No NOFA documents available" when empty

- **autoapply-dashboard-ui**: Built full AutoApply dashboard at `/autoapply` with Queue, Submissions, and Templates sections.
  - `src/app/(dashboard)/autoapply/page.tsx` replaced entirely
  - Queue: bulk checkboxes + "Analyze Forms" + "Run Selected" actions; fetches `submission_queue` joined with `funders`
  - Submissions: expandable rows with screenshot thumbnails; color-coded status badges; fetches `autoapply_submissions` joined with `funders`
  - Templates: field count from `field_mapping` JSON; per-row "Re-analyze" button; fetches `form_templates` joined with `funders`
  - "Add to Queue" modal: lists funders where `giving_portal_url` is not null, bulk insert into `submission_queue`

- **lead-scraper-nonprofits**: Created `src/scripts/scrape-nonprofit-leads.ts`.
  - Queries `foundation_directory` via Supabase admin client (service role, bypasses RLS): NTEE prefix filter (L/P/K/F/J/S/X), revenue $100K–$10M, limit 500
  - For each org: Google search → first non-aggregator URL → Playwright page visit → Claude Haiku contact extraction (email, phone, executiveDirector, grantStaff, website)
  - Updates `foundation_directory` rows with discovered website/email/phone (non-destructive: only fills null fields)
  - Exports enriched results to `exports/nonprofit-leads.csv` (ein, name, city, state, ntee_code, revenue_amount, website, email, phone, executive_director, grant_staff)
  - Progress logged every 50 records; results appended incrementally (crash-safe)
  - 3s delay between Google searches, 2s delay between page visits
  - Run overnight: `npx tsx src/scripts/scrape-nonprofit-leads.ts`

### Next Steps
- Execute `npx tsx src/scripts/scrape-nonprofit-leads.ts` overnight — expected 3-4 hours for 500 records
- Run `pnpm tsc --noEmit` then `pnpm run build` before running the scraper to verify clean compile

## Session Verification — 2026-06-19

### Verified This Session
- **lead-scraper-nonprofits**: `src/scripts/scrape-nonprofit-leads.ts` confirmed complete and correct.
  - All ICP filter requirements verified in code: NTEE prefixes L/P/K/F/J/S/X (line 76), revenue $100K–$10M (lines 77–78), limit 500 (line 79)
  - Google search query pattern matches spec: `{name} {city} {state} nonprofit` (line 147)
  - First non-aggregator result taken as website URL (lines 184–198, skips 18 known aggregator domains)
  - Page text sent to claude-haiku-4-5-20251001 for contact extraction (lines 224–277)
  - DB update is non-destructive — only fills null website/email/phone fields (lines 408–424)
  - CSV export to `exports/nonprofit-leads.csv` with all required columns (lines 301–311, 427–439)
  - Rate limiting: 3s between Google searches (line 366), 2s between page visits (line 393)
  - Progress logged every 50 records (lines 386–388, 445–447)
  - STATE_OF_THE_BUILD.md entry confirmed present (line 16)
- **Build gate**: `pnpm tsc --noEmit` and `pnpm run build` require user approval of pnpm commands in terminal — pending execution
