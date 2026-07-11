# BENAVORA — STATE OF THE BUILD
## Last updated: 2026-07-10 (Phase 2-4 completion audit — see entry immediately below — on top of Apollo + Hunter §6 BYO-key connectors + run_connector_enrichment worker job, TX TDLR + land bank directory registry adapters + Donor Discovery Connectors page + connectors API + Prospect detail page rebuild + AutoApply handoff route + Donor Discovery Overview page rebuild + process_discovery_request worker job + requests API pagination + Claude-rationale donor-discovery scoring engine + SAM.gov registry adapter + ingest script + ProPublica financial enrichment adapter + script + IRS BMF full ingest script + Google Geocoding adapter + donor_discovery_geocache + Google Places cache-first registry adapter + adapter_usage_log + New Discovery wizard TaxonomyCombobox + taxonomy aliases + header nav placement fix + Phases 2+3 + Foundation Enrichment Pipeline + Onboarding soft-gate)
## Method: live codebase audit — every file path, route, agent, and migration counted directly from the filesystem; no assumptions carried from prior docs.

---

## Phase 2-4 completion audit (2026-07-10) — NOT marked complete; three concrete production breakages found

This session's task requested writing "Donor Discovery Night 3 Build COMPLETE" and marking
Phases 2, 3, and 4 complete in `DONOR_DISCOVERY_ARCHITECTURE.md` §8. That claim is **not
supported** by the codebase and was not written as requested — CLAUDE.md Iron Law #3 ("never
fabricate test results / claim something passes unverified") applies to status claims, not just
test output. `pnpm tsc --noEmit`, `pnpm run build`, and `pnpm lint` were also requested but
blocked on interactive-approval in this session (the same intermittent gate-blocking issue noted
throughout this file) — none of the three could be run or verified this pass, so none are
claimed to pass.

An Explore-agent audit read every Phase 2-4 deliverable listed in `DONOR_DISCOVERY_ARCHITECTURE.md`
§8 against the actual files (not against prior doc text). Headline finding, synthesizing scattered
"file only, not applied to production" notes already present in this file and `SESSION_STATE.md`
into one concrete risk statement no prior entry connected explicitly:

**Three live code paths will throw or 500 in production right now**, because the migrations they
depend on were authored file-only and never applied (only 067-074 are live; see "Production Sync
2026-07-09" below):
1. `GET /api/donor-discovery/taxonomy/search` 500s on every call — it queries
   `donor_discovery_taxonomy_aliases` (migration 075, unapplied) via `Promise.all`, and fails
   the whole request if either query errors. This is the New Discovery wizard's step-1 taxonomy
   picker (`TaxonomyCombobox.tsx`) — **the wizard's first step cannot be used in production
   today.**
2. `ScoringEngine.persist()` (`scoring-engine.ts`) writes `donor_discovery_prospects.scored_at`
   (migration 078, unapplied) — every call throws `prospect_score_persist_failed` in production.
3. `run-connector-enrichment.ts`'s job writes `donor_discovery_prospects.enrichment_private`
   (migration 079, unapplied) — every real Apollo/Hunter connector run would throw in production.
   (Migration 077's `donor_discovery_geocache` is also unapplied but degrades gracefully — cache
   read/write swallow errors — so geocoding still works, just uncached; not a breakage.)

Additional findings not previously documented:
- **Three new §2A registry adapters are built but architecturally orphaned from the live
  pipeline.** `tx-tdlr-adapter.ts`, `land-bank-adapter.ts`, and `google-places-adapter.ts` share
  a `RegistryAdapter` interface that is a sibling system to, not an extension of, what
  `worker/dd-request-processor.ts` actually calls (`google-places.ts` only). None of the three
  are imported by the live request-processing pipeline; each is reachable only via its own
  standalone ingest script (`ingest-tx-tdlr.ts`, `ingest-land-banks.ts`), and none of those
  scripts have ever been run. `google-places-adapter.ts`'s own header comment self-documents this
  as a deliberate deferral ("which one the worker uses is a decision for a later phase"), but that
  decision was never made, so three of Phase 4's core adapters do not affect what a real discovery
  request returns.
- **`propublica-adapter.ts` (§2C signal layer) is orphaned the same way** — only called from the
  standalone `scripts/enrich-nonprofits-propublica.ts` batch script (never run), not from
  `scoring.ts` or `scoring-engine.ts`. It writes `enrichment.propublica`; nothing reads that field.
- **Trade-association meta-adapter (§2A) does not exist.** No file anywhere in `src/` references
  it. `DONOR_DISCOVERY_ARCHITECTURE.md` §8 already listed this as a documented Phase 4 gap; this
  audit confirms the gap is still open, not silently dropped from tracking.
- **Stray duplicate `src/supabase/migrations/072-074_*.sql`** — near-duplicate copies of the real
  `supabase/migrations/075-077` files, sitting at migration numbers that collide with the real,
  already-applied `072`/`073`/`074`. Not referenced by any tsconfig, Supabase config, or code —
  won't break a build or `supabase db push` (which only reads `./supabase/migrations`) — but it's
  confusing dead clutter that should be deleted, not committed.
- **`worker/dist/` is a stale build artifact**, older than `tx-tdlr-adapter.ts`,
  `land-bank-adapter.ts`, and `run-connector-enrichment.ts`. No verified successful compile of the
  current worker source tree exists — `worker/tsconfig.json --noEmit` needs to be re-run before
  treating the worker build gate as clean for this batch of files (not run this session; blocked
  on the same interactive-approval issue as the root tsc gate).
- **Playwright coverage remains thin**: only `e2e/donor-discovery-prospects.spec.ts` exists
  (Overview, Prospects list, Prospect-detail-not-found — 3 smoke tests). Zero E2E coverage for
  the New Discovery wizard (the flow most likely to break in prod, per finding #1 above) or the
  Connectors page.

**What IS genuinely real and wired** (confirmed by reading the code, not just file presence):
directory dedup (`directory.ts` → `donor_discovery_upsert_directory_record` RPC, live in prod),
foundation linkage (`foundation-linkage.ts`, live), both scoring implementations' logic (only the
persistence column is missing in prod for one of them), the enrichment agent (wired via
`enrich-donor-prospect.ts` into the worker's idle cycle), all 5 dashboard pages (nav, routes, real
data fetching — not stubs), Apollo/Hunter connectors (real HTTP integrations reusing the existing
encrypted BYO-key infra correctly, not a reinvented scheme), and the Connectors page's real
test-before-save CRUD flow.

**Recommended next actions (not taken this session — DDL against production requires explicit
sign-off, per this project's established migration-application process):**
1. Apply migrations 075-079 to production (same Management API + `sbp_` PAT path used since
   migration 011) — this alone fixes all three production breakages above.
2. Decide and wire: either point `dd-request-processor.ts` at the new adapters, or explicitly
   defer Phase 4's registry-adapter breadth to a future pass — leaving them silently unwired is
   the actual current state, not a decision anyone has made.
3. Build the trade-association meta-adapter, or formally re-scope it out of Phase 4.
4. Delete `src/supabase/` (stray duplicate) before it causes a real collision.
5. Re-run `tsc --noEmit` (root and `worker/tsconfig.json`) and `pnpm run build` once shell/gate
   approval is available in a session — neither has been run against this exact file set yet.

This entry supersedes the "Reid's morning actions" list further below for migration-application
scope — that list only covers 072-074 (now live) and predates 075-079's authorship.

---

## Apollo + Hunter §6 BYO-key connectors + run_connector_enrichment worker job (2026-07-10)

Built the actual enrichment behavior behind the Connectors page (prior session built the page +
routes against an empty `donor_discovery_connectors` table — no connector ever *did* anything).
DONOR_DISCOVERY_ARCHITECTURE.md §6 read in full first.

- **New `src/lib/donor-discovery/connectors/types.ts`** — shared `ConnectorEnricher` interface
  (`{ provider, enrich(prospect: DirectoryRecord, apiKey: string): Promise<ConnectorEnrichment> }`),
  `ConnectorEnrichment`/`DecisionMakerContact` types, and `isDecisionMakerTitle()` — one
  case-insensitive keyword filter (ceo/chief executive/executive director/president/director/
  manager/csr/corporate social responsibility/development/donor/giving/philanthropy) shared by
  both connectors so their decision-maker filtering can't drift apart.
- **New `src/lib/donor-discovery/connectors/apollo-connector.ts`** — `POST
  https://api.apollo.io/v1/mixed_people/search`, `api_key` in the request body (Apollo's own
  auth convention for this endpoint, not a header). Searches by `q_organization_domains` when
  the directory record has a website, falls back to `q_organization_name` when it doesn't (the
  task's "searches by company domain or name"). Sends the task's explicit target titles (CEO,
  Executive Director, CSR Director, Donations Manager + synonyms) as Apollo's own
  `person_titles` filter, then re-filters client-side via `isDecisionMakerTitle`. Rate limited
  1 req/2s (`DomainRateLimiter`, same class `google-places-adapter.ts` uses) — Apollo publishes
  no uniform cross-plan rate limit, so this is a conservative default, not a documented number.
  Contacts carry `confidence: null` — Apollo's People Search response has no per-contact
  confidence field (unlike Hunter's), so this is an honest null, not a fabricated score.
- **New `src/lib/donor-discovery/connectors/hunter-connector.ts`** — `GET
  https://api.hunter.io/v2/domain-search?domain=&api_key=`. Domain-only (Hunter has no
  organization-name search mode) — throws `NO_SEARCH_TARGET` if the directory record has no
  website. Extracts every email Hunter returns, keeps each email's real `confidence` score, then
  filters to the same shared `isDecisionMakerTitle` keyword list (director/manager/president/
  CEO/executive/development/donor/giving/CSR, per the task spec — already covered by the shared
  keyword set built for Apollo, so no separate list was needed). Rate limited 1 req/s, matching
  this codebase's other "respectful polling" adapters (e.g. `propublica-adapter.ts` §19).
- **New `src/lib/donor-discovery/connectors/usage-log.ts`** — `logConnectorUsage()`, a thin
  shared `adapter_usage_log` (migration 076) writer keyed by `adapter_name = provider`
  ("apollo"/"hunter") — the same column convention `GET /api/donor-discovery/connectors` already
  aggregates by, so no route change was needed for the connectors page to show real "last used"/
  "records enriched" numbers once this job actually runs.
- **New `src/worker/jobs/run-connector-enrichment.ts`** — `handleRunConnectorEnrichmentJob(supabase,
  {prospectId, connectorProvider})`: loads the `donor_discovery_prospects` row, loads its shared
  `donor_discovery_directory` record, resolves + decrypts the org's `active`
  `donor_discovery_connectors` row for that provider (`src/lib/crypto/key-encrypt.ts`'s
  `decryptKey`, same infra as the connectors API route), calls the connector, merges the result
  into `donor_discovery_prospects.enrichment_private` (new column, keyed by provider — a Hunter
  run never erases a prior Apollo result), and logs usage. `claimNextRunConnectorEnrichmentJob`
  scans active Apollo/Hunter connectors, then each org's oldest prospect not yet enriched by that
  provider (`enrichment_private->>provider IS NULL`, matching
  `enrich-nonprofits-propublica.ts`'s existing `.is("col->>key", null)` JSON-null-filter
  convention) — same plain-scan, no-lock-column posture as `enrich-donor-prospect.ts`/
  `score-donor-prospect.ts`.
- **New migration `supabase/migrations/079_donor_discovery_prospects_enrichment_private.sql`** —
  adds `donor_discovery_prospects.enrichment_private jsonb not null default '{}'`. Already
  RLS-protected by that table's existing `donor_discovery_prospects_org_isolation` policy
  (migration 067) — deliberately distinct from `donor_discovery_directory.enrichment` (shared,
  no RLS): connector contact data is "contractually theirs, never shared cross-tenant" per §6,
  so it belongs on the org-scoped prospect row, never the shared directory row. File only, not
  applied to production, consistent with 067-078's status.
- **Wired into `worker/queue-processor.ts`**: a third idle-cycle call alongside
  `enrich_donor_prospect`/`score_donor_prospect`, same "only runs when `submission_queue` is
  empty" posture.
- Gate: `pnpm run typecheck` (root `tsc --noEmit`) — 0 errors. `pnpm tsc --noEmit -p
  worker/tsconfig.json` (the only way to actually type-check the `queue-processor.ts` edit,
  since `worker/` is excluded from the root tsconfig) — 0 errors.
- **Not done:** migration 079 not applied to production; no connector has actually enriched a
  prospect (`donor_discovery_connectors` has no real Apollo/Hunter keys on file to test against);
  `pnpm run build` / `pnpm lint` / Playwright not run (only the two tsc gates were requested this
  pass); not manually verified against live Apollo/Hunter APIs.
- Governance docs updated: this file, `SESSION_STATE.md`. `BLUEPRINT.md`, `SCHEMA_REGISTRY.md`,
  `BEHAVIORAL_CONTRACTS.md`, `AGENTS.md`, `CLAUDE.md`, and `DONOR_DISCOVERY_ARCHITECTURE.md`
  untouched — §6 already documented this exact connector shape (provider list, "test call
  required before saving," "contractually theirs, never shared cross-tenant"); this pass
  implements it, it doesn't change the design. No new table (one additive column), contract, or
  agent-type definition was needed.

---

## TX TDLR + land bank directory registry adapters (2026-07-10)

Built two more §2A "Registry layer" acquisition adapters (DONOR_DISCOVERY_ARCHITECTURE.md
§2A, read in full first) — the first state-license-board adapter and the first civic-directory
adapter, both new adapter *kinds* in this codebase, not new instances of an existing pattern.

- **New `src/lib/donor-discovery/adapters/tx-tdlr-adapter.ts`** — Texas Department of Licensing
  and Regulation licensee search (`GET https://www.tdlr.texas.gov/TNPWS/Lookup.aspx?SearchType=
  Business&LicenseType=<code>`) for five license types: Electrical (ELEC), Plumbing (PLMB),
  HVAC (HVAC), Elevator (ELEV), Boiler (BLRP). Each maps to a NAICS code already in the taxonomy
  seed — `NAICS_BY_LICENSE_TYPE`: ELEC→238210, PLMB→238220, HVAC→238220, ELEV→238290,
  BLRP→238290 (the task spec only gave the first four mappings explicitly; BLRP→238290 follows
  the Census NAICS manual's own grouping of elevator and boiler-house piping installation under
  "Other Building Equipment Contractors," the same code ELEV maps to). Filters to active
  licenses only — a parsed `expiration_date` strictly after today; licenses with no parseable
  expiration date are treated as not-active rather than included on an unverified assumption.
  Implements the generic `RegistryAdapter` interface (`enumerate(naicsCodes, geography,
  organizationId)`), deriving which license types to query from the requested NAICS codes;
  `geography`/`organizationId` are accepted for interface conformance but not used as filters —
  TDLR's licensee search is a statewide public dataset with no lat/lng on the result rows and no
  per-organization key, unlike `googlePlacesAdapter`. Also exports a standalone
  `searchLicenseType(licenseType)` for the ingest script to call directly (same split as
  `samgov-adapter.ts`'s standalone `searchEntitiesByNaics`).
- **New `src/lib/donor-discovery/adapters/land-bank-adapter.ts`** — scrapes the Center for
  Community Progress land bank directory page (a single fixed URL, not a per-NAICS or
  per-geography search) into `donor_discovery_directory` rows with `civic_kind = 'land_bank'`
  and `source_adapters` containing `land_bank_directory`. Not a `RegistryAdapter` — there's no
  NAICS code or radius to enumerate against for a fixed ~300-entity national list; exports a
  standalone `fetchLandBankDirectory()`.
- **HTML parsing**: both adapters use the newly-added `node-html-parser` dependency rather than
  this codebase's existing `cheerio` (used by `src/lib/enrichment/sources/website-scraper.ts`) —
  a deliberate per-adapter choice for a single flat table extraction, not a house-wide switch.
  Both match table columns by header text (case-insensitive), not a hardcoded index, so a column
  reorder on either source site doesn't silently mis-map fields — the same "flag for
  reconfiguration on structural drift" posture BEHAVIORAL_CONTRACTS.md §18/§21 require of every
  scraped source (a zero-rows-parsed result on an otherwise-successful fetch logs a warning
  rather than failing silently).
- **Compliance**: both fetch through `fetchCompliant` (crawler-core.ts) — kill switch, ToS
  registry, robots.txt, and the shared per-domain rate limiter — never a bare `fetch`, matching
  every other scraped (non-paid-API) source in this codebase.
- **New: `scripts/ingest-tx-tdlr.ts`** (`pnpm ingest:tdlr`) — sweeps all five TDLR license types,
  non-fatal per-type failure handling (one bad license type doesn't block the other four), same
  posture as `ingest-samgov.ts`. **New: `scripts/ingest-land-banks.ts`** (`pnpm ingest:landbanks`)
  — single-page fetch, no loop.
- **New dependency**: `node-html-parser` (`pnpm add node-html-parser`), added to `package.json`
  dependencies.
- Gate: `pnpm tsc --noEmit` — 0 errors, ran clean.
- **Not done:** neither script has been run — `donor_discovery_directory` not yet populated by
  either adapter. `pnpm run build` / `pnpm lint` / Playwright not run (only tsc was requested
  this pass); not manually verified against the live TDLR/Community Progress pages (their actual
  HTML table structure is unverified — the header-text-matching parser is a best-effort design
  against an undocumented public page, not a page confirmed byte-for-byte against this code).
- Governance docs updated: this file, `SESSION_STATE.md`, and `DONOR_DISCOVERY_ARCHITECTURE.md`
  §2A (new adapter cross-reference bullets under items 2 and 4) and §8 Phase 4 (status note).
  `BLUEPRINT.md`, `SCHEMA_REGISTRY.md`, `BEHAVIORAL_CONTRACTS.md`, `AGENTS.md`, and `CLAUDE.md`
  untouched — no schema, contract, or agent-type change; both adapters write through the
  existing `donor_discovery_directory` table via the existing `upsertDirectoryRecord()` helper,
  no new migration needed.

---

## Donor Discovery Connectors page + connectors API (2026-07-10)

Built `src/app/(dashboard)/donor-discovery/connectors/page.tsx` per
`DONOR_DISCOVERY_ARCHITECTURE.md` §6 — the BYO-key third-party enrichment connector
management page, the last of the five pages in §4's dashboard page list (Overview, New
Discovery, Prospects, Prospect detail, Connectors — this was the missing one).

- **New `src/lib/donor-discovery/connector-providers.ts`** — single-source-of-truth catalog
  of the 5 providers (`google_places`, `apollo`, `hunter` connectable; `zoominfo`, `clay`
  marked `connectable: false` / "coming soon" per §6's V1 list), imported by the page and
  both new routes so the coming-soon gate can't drift between client and server.
- **New `GET`/`POST`/`DELETE /api/donor-discovery/connectors`** — GET always returns one row
  per catalog provider (merges `donor_discovery_connectors` connection status with
  `adapter_usage_log` telemetry: `MAX(called_at)` as `last_used_at`,
  `SUM(records_returned)` as `records_enriched`, grouped by `adapter_name` = provider key —
  the same `adapter_name` convention `google-places-adapter.ts` already uses for
  `google_places`). POST upserts an encrypted key (`encryptKey` from
  `src/lib/crypto/key-encrypt.ts`) with `status='active'`. DELETE removes the row
  (disconnect). All three reject `zoominfo`/`clay` server-side, not just in the UI. Keys are
  never returned in plaintext — only `maskKey()`'s `****last4` hint (Behavioral Contracts
  §20).
- **New `POST /api/donor-discovery/connectors/test`** — validates a key against the real
  provider before save, per §6/Contracts §20's "test call required before saving": Apollo's
  documented `GET /api/v1/auth/health` (`x-api-key` header), Hunter's `GET /v2/account`
  (`api_key` query param, both real documented endpoints), Google Places' legacy Nearby
  Search (status read from the JSON `status` field since Places always returns HTTP 200).
  8s timeout via `AbortController`. Never persists anything — the key only round-trips to
  the provider.
- **Page**: provider grid (2-col desktop / 1-col mobile per task spec), each card showing a
  `ColorIcon` (emerald when connected, cyan otherwise, dimmed for coming-soon), name,
  description, status badge, cost note ("Your key, billed to your account."), and for
  connected providers a stats block (masked key, last used, records enriched). Connect flow
  is a `Modal` with a password-type key input, a Test button (disabled until a key is typed,
  shows the provider's real validation message) gating a Save button (disabled until the
  test returns valid) — matches the task's explicit test-then-save sequencing rather than
  letting Save fire on an unverified key.
- **Wiring**: added a "Connectors" secondary button next to "New Discovery" in the Donor
  Discovery Overview page header (`donor-discovery/page.tsx`) — the page had no inbound link
  otherwise, which would have left it unreachable (Six Laws §5 Wiring).
- Gate: `pnpm run typecheck` (`tsc --noEmit`) — 0 errors, ran clean on the second attempt
  (`npx tsc --noEmit` hit the known intermittent approval block across ~6 tries first;
  `pnpm run typecheck` — the project's own script, same underlying command — went through
  immediately).
- **Not done:** `pnpm run build` / `pnpm lint` / Playwright not run (only tsc was requested
  this pass); not manually verified in a browser (no live Apollo/Hunter/Google Places keys
  available to exercise the test endpoint end-to-end); migrations 067/076 (which the
  `donor_discovery_connectors`/`adapter_usage_log` tables and the `google_places` enum value
  depend on) remain unapplied to production, unchanged by this pass.
- Governance docs updated: this file, `SESSION_STATE.md`. `BLUEPRINT.md`,
  `SCHEMA_REGISTRY.md`, `BEHAVIORAL_CONTRACTS.md`, `AGENTS.md`, `CLAUDE.md`, and
  `DONOR_DISCOVERY_ARCHITECTURE.md` untouched — no schema, contract, or agent-type change;
  this task only builds UI + routes against tables and enum values that already existed in
  migrations 067/076.

---

## Prospect detail page rebuild + AutoApply handoff route (2026-07-10)

`src/app/(dashboard)/donor-discovery/prospects/[id]/page.tsx`, `ProspectDetail.tsx`, and
`GET`/`PATCH /api/donor-discovery/prospects/[id]` already existed (prior uncommitted session).
This pass closed the gaps against `DONOR_DISCOVERY_ARCHITECTURE.md` §4/§7's exact spec:

- **`PATCH /api/donor-discovery/prospects/[id]`** now accepts any non-empty subset of
  `pipeline_stage` / `notes` / `assigned_to` in one request (previously `pipeline_stage`
  only). `assigned_to` must resolve to a `profiles` row in the caller's own
  `organization_id`, verified server-side before the update — never trusted as a bare uuid.
- **`POST /api/autoapply/queue`** gained a second request shape for the Donor Discovery
  handoff: `{ source: "donor_discovery", prospect_id, form_url, org_name }`. Looks up the
  prospect (org-scoped), reuses an existing funder by `giving_portal_url` match then exact
  `name` match, else creates one (`category: "in_kind_donation"`), then inserts into
  `submission_queue` (`automation_mode: "donor_discovery"`) with the same
  already-queued/dedup check as the pre-existing `{ funder_ids: string[] }` batch shape. That
  batch shape is unchanged and still the only path used by `funders/page.tsx` and
  `autoapply/settings/page.tsx` (both call sites checked before editing this shared route).
  Funder creation moved server-side out of `ProspectDetail.tsx` (was a direct browser
  Supabase `insert` followed by a call to the batch route with the new id — two round trips
  with a duplicate-detection race between them; now one atomic route call).
- **`ProspectDetail.tsx`**: `has_giving_program` renders as a green `CheckCircle2` / gray
  `XCircle` icon (was a Yes/No `Badge`). Added `in_kind_history_signals` (bulleted list) and
  `company_size_estimate` (badge) to the Enrichment card — both fields already existed on
  `enrichment-agent.ts`'s `EnrichmentRecord` and in the stored `enrichment` jsonb, just never
  rendered. Score rationale card now shows `scored_at` (migration 078's column, added by the
  Claude-rationale scoring engine session) formatted inside a highlighted teal-tinted card.
  AutoApply button now always renders a state instead of disappearing when there's no
  donation form: disabled "No donation form found" / "Queue in AutoApply" (editable + form
  found) / "Queued — view funder" (already queued).
- **New activity timeline**: `donor_discovery_prospects.notes` (migration 067) is a single
  `text` column, not a table — timeline entries are a JSON array
  (`{content, author, created_at}`) serialized into that column, newest first. A legacy
  plain-text or unparseable value degrades to one untimed entry. Add-note textarea + list
  above an "Assigned to" `Select` populated from a client-side `profiles` query (RLS already
  scopes results to the caller's org — same pattern the file already used for
  already-queued-funder detection).
- Gate: `pnpm tsc --noEmit` — 0 errors, ran clean.
- **Not done:** `pnpm run build` / `pnpm lint` / Playwright not run this pass (only tsc was
  requested); not manually verified in a browser. Migrations 067-078 remain unapplied to
  production, unchanged by this pass (no new migration needed — every touched table/column
  already exists per those files).
- Governance docs updated: this file, `SESSION_STATE.md`. `BLUEPRINT.md`, `SCHEMA_REGISTRY.md`,
  `BEHAVIORAL_CONTRACTS.md`, `AGENTS.md`, `CLAUDE.md`, and `DONOR_DISCOVERY_ARCHITECTURE.md`
  untouched — no schema, contract, or agent-type change.

---

## Donor Discovery Overview page rebuild (2026-07-10)

Rewrote `src/app/(dashboard)/donor-discovery/page.tsx` (§4 of `DONOR_DISCOVERY_ARCHITECTURE.md`)
to match the Overview spec exactly rather than keep the prior ad-hoc layout built during
Phases 2+3:

- **Active Requests** — each request from `GET /api/donor-discovery/requests` now renders as
  its own card (grid, not a single list) showing taxonomy label badges (resolved via a
  `donor_discovery_taxonomy` `id`-keyed lookup scoped to just the ids referenced by the
  fetched requests, not a full-table preload), a `formatGeography()` summary of the
  `{national}` / `{states}` / `{center,radius_mi}` shapes, a status badge
  (`queued`=neutral, `enumerating`/`enriching`=info, `scoring`=warning, `complete`=success,
  `failed`=error), a status-derived progress bar, the existing `counts.{enumerated,enriched,
  scored}` summary text, and `formatRelative(created_at)` ("3 hours ago"). Empty state copy
  now reads "No discovery requests yet" / "Launch your first one…" per spec.
- **Pipeline Funnel** — replaced the old vertical vertical-bar-per-stage widget with a
  horizontal 6-up stat row (New/Reviewing/Contacted/Applied/Received/Rejected — `archived` is
  tracked on the Prospects table but intentionally excluded from this row per the task spec).
  Each stat is a `Link` to `/donor-discovery/prospects?stage=X`, which the existing Prospects
  page already reads via `useUrlState`'s `stage` param — no new filtering code needed there.
- **Top Prospects** — now calls `GET /api/donor-discovery/prospects?stage=new&limit=5`
  (already sorts by score desc) instead of a raw Supabase query, rendered as compact cards
  (not list rows) with a 3-tier score badge (green `>70` / yellow `40–70` / red `<40`,
  `scoreBadgeVariant()`), a `line-clamp-2` rationale excerpt, a taxonomy label resolved via a
  second `code`-keyed lookup against `donor_discovery_taxonomy` (from each prospect's
  `directory.naics_codes[0]` or `directory.civic_kind`), and a "Review" link to
  `/donor-discovery/prospects/[id]`.
- **Scout Report** — new placeholder card, "Weekly Scout Report" + a "Coming soon" badge +
  "Your personalized digest of new high-scoring prospects." No backing feature yet — §8 Phase
  5 of the architecture doc scopes the real weekly-digest email this points at.
- Dropped the three `MetricCard` KPI tiles (Active Requests / Total Prospects / New — Awaiting
  Review) that the prior version had — not in this task's spec, and the Pipeline Funnel row
  already surfaces the "New" count.
- Gate: `pnpm tsc --noEmit` — 0 errors.
- **Not done:** `pnpm run build` / `pnpm lint` / Playwright not run (only tsc was requested
  this pass); not manually verified in a browser.
- Governance docs updated: this file, `SESSION_STATE.md`. `BLUEPRINT.md`, `SCHEMA_REGISTRY.md`,
  `BEHAVIORAL_CONTRACTS.md`, `AGENTS.md`, `CLAUDE.md`, and `DONOR_DISCOVERY_ARCHITECTURE.md`
  untouched — pure UI rebuild against existing routes/tables, no schema, contract, or
  agent-type change.

---

## process_discovery_request worker job + requests API pagination (2026-07-10)

This session's task asked to build `src/worker/jobs/process-discovery-request.ts`, wire it
into `worker/queue-processor.ts`, and add `src/app/api/donor-discovery/requests/route.ts`
(POST create + enqueue, GET paginated list). **All three already existed**, built by a prior
uncommitted session — verified rather than rebuilt:

- **`src/worker/jobs/process-discovery-request.ts`** — thin wrapper: fetches the
  `donor_discovery_requests` row by `(requestId, organizationId)` and delegates to
  `worker/dd-request-processor.ts`'s `DdRequestProcessor.processItem()`, which already
  implements the full enumerate → enrich (concurrency 5) → link foundations → score pipeline
  this task described, including the `enumerating`/`enriching`/`scoring`/`complete`/`failed`
  status transitions and `counts.{enumerated,enriched,scored}` updates.
- **Not wired into `worker/queue-processor.ts`'s idle cycle**, unlike the sibling
  `enrich_donor_prospect`/`score_donor_prospect` jobs — and this is correct, not a gap.
  `DdRequestProcessor` runs its own independent poll loop (`worker/dd-request-processor.ts`,
  started via `ddRequestProcessor.start(supabase)` in `worker/index.ts`'s `main()`, alongside
  `queueProcessor.start()`), claiming queued requests through the
  `donor_discovery_claim_request` RPC (migration 070, real `FOR UPDATE SKIP LOCKED`) so it
  runs continuously, not just during `queue-processor.ts`'s idle cycles. Adding a second
  consumer inside `queue-processor.ts` would only poll a subset of the time for zero
  functional gain (both loops already run in the same worker process). The `src/worker/jobs/*`
  wrapper exists for a future manual/API-triggered single-request invocation path, not as a
  second poll consumer — confirmed via `grep` that `handleProcessDiscoveryRequestJob` has no
  current caller, which is intentional per its own docstring, not dead code left by mistake.
- **`src/app/api/donor-discovery/requests/route.ts`** — POST validates `name`/`taxonomy_ids`/
  `geography`, derives `organization_id` from session (`requireRole("writer")`), inserts with
  `status: "queued"` for `DdRequestProcessor` to claim. GET was **missing pagination** — fixed
  this session to match the `page`/`limit`/`range()` + `count: "exact"` convention already used
  by `src/app/api/donor-discovery/prospects/route.ts` (`DEFAULT_LIMIT=25`, `MAX_LIMIT=100`).
  Response shape grew `total`/`page`/`limit` alongside the existing `requests` array — backward
  compatible, the two existing callers (`/donor-discovery/page.tsx` overview,
  `/donor-discovery/new/page.tsx`) only read `.requests` and don't pass query params, so they
  now implicitly get page 1 of 25 instead of the full unbounded list. The per-request
  `prospect_count` tally (via `dd_prospect_requests` join) was also narrowed to just the current
  page's request ids instead of scanning the org's entire history on every call.
- **Confirmed, not addressed (out of scope for this pass):** two independent Google Places
  registry adapters still coexist — `google-places.ts` (Text Search, actually wired into
  `worker/dd-request-processor.ts`) and `google-places-adapter.ts` (legacy Nearby Search,
  cache-first, `RegistryAdapter` interface, BYOK/Faith-Foundation-budget aware) — not connected
  to each other, per the 2026-07-09 entry below. Worth a consolidation decision from Reid before
  either grows further.
- Gate: `pnpm tsc --noEmit` (root) — 0 errors. `pnpm tsc --noEmit -p worker/tsconfig.json`
  (worker subproject — `worker/` is excluded from the root tsconfig, so this is the only way to
  actually type-check `queue-processor.ts`/`dd-request-processor.ts`) — 0 errors. `pnpm run
  build` / `pnpm lint` / Playwright not run this pass.
- Governance docs updated: this file, `SESSION_STATE.md`. `BLUEPRINT.md`, `SCHEMA_REGISTRY.md`,
  `BEHAVIORAL_CONTRACTS.md`, `AGENTS.md`, `CLAUDE.md`, and `DONOR_DISCOVERY_ARCHITECTURE.md`
  untouched — no schema, contract, or agent-type change; the only code change is additive
  pagination on an existing route.

---

## Claude-rationale donor-discovery scoring engine (2026-07-10)

**New: `src/lib/donor-discovery/scoring-engine.ts`** — `ScoringEngine` class
(DONOR_DISCOVERY_ARCHITECTURE.md §2D). Deliberately distinct from the existing
`scoring.ts` (`scoreProspect`, pure, no I/O, templated rationale, used inline
by `worker/dd-request-processor.ts`'s per-request pipeline): this is a
self-contained class whose `score(prospectId, requestContext)` does its own
Supabase I/O and calls Claude for a genuinely plain-English rationale. Both
engines write the same `donor_discovery_prospects.score` /
`score_rationale` columns; this one additionally stamps `scored_at`.

- Seven additive signals, weights summing to 100 per the task spec:
  `has_giving_program` +25, `has_donation_form` +20,
  `in_kind_history_signals.length > 0` +15, `foundation_linkage_found` +15,
  `geographic_match` +10, `company_size_match` +10, `csr_page_exists` +5.
- **Foundation linkage** checks, in order: an existing
  `donor_discovery_directory.linked_foundation_id` (from the §2C pipeline,
  0.55 similarity floor — stricter than this engine's own, so an existing
  link always counts), an exact EIN match against `foundation_directory.ein`
  when the directory record's enrichment happens to carry one (no adapter
  populates this today — checked "if available" per the task spec rather
  than assumed absent), then a live `donor_discovery_match_foundations` RPC
  call (migration 074) at a 0.4 similarity floor (looser than the §2C
  pipeline's 0.55 since here it's one signal among seven, not a standalone
  persisted claim).
- **Claude call:** `claude-haiku-4-5`, `max_tokens: 300`, asked for exactly
  two plain-English sentences given the fired signals, org mission, ask size,
  and taxonomy context. Falls back to a deterministic templated sentence
  (never blocks persistence) if the Claude call throws or returns empty.
- **Per-org weight overrides:** reuses `organizations
  .donor_discovery_scoring_weights` (migration 074) rather than adding a
  second jsonb column — `scoring.ts` already owns that column's top-level
  camelCase keys, so this engine's overrides live under a nested
  `scoring_engine` sub-object with its own snake_case keys, avoiding any
  collision.
- **Known gap:** `RequestContext.askSizeEstimate` has no backing column yet
  (`donor_discovery_requests` doesn't capture a per-request ask size) — the
  worker job below always passes `null`, which the engine already treats as
  "the company-size-match signal doesn't fire," not a guess.

**New: `src/worker/jobs/score-donor-prospect.ts`** — `claimNextScoreDonorProspectJob`
/ `handleScoreDonorProspectJob`, mirroring `enrich-donor-prospect.ts`'s
claim/handle shape. Claims the oldest prospect with `scored_at` null or
older than 30 days (plain scan, no lock column — same posture as the
enrichment job), builds `RequestContext` from the prospect's originating
`donor_discovery_requests` row (geography, taxonomy labels resolved via
`donor_discovery_taxonomy`) and organization (`mission_statement`), then
delegates to `ScoringEngine`.

**Wired into `worker/queue-processor.ts`**: a second idle-cycle call
alongside the existing `enrich_donor_prospect` job, same "only runs when
`submission_queue` is empty" posture.

**New migration `supabase/migrations/078_donor_discovery_prospects_scored_at.sql`**
— adds `donor_discovery_prospects.scored_at timestamptz` + index. File only,
not applied to production, consistent with migrations 074-077's status.

- Gate: `pnpm tsc --noEmit` — ran clean, 0 errors. `pnpm run build:worker`
  also run (not explicitly requested, but `worker/queue-processor.ts` is
  excluded from the root tsconfig, so this is the only way to actually
  type-check that edit) — clean, 0 errors. `pnpm run build` / `pnpm lint` /
  Playwright not run this pass.
- **Not done this session:** migration 078 has not been applied to
  production; no prospect has actually been scored by this engine yet.
- Governance docs updated: this file and `SESSION_STATE.md`. `BLUEPRINT.md`,
  `SCHEMA_REGISTRY.md` (that document's Tier 6 schema is unrelated to
  Donor Discovery's tables, which live entirely in
  `DONOR_DISCOVERY_ARCHITECTURE.md`), `BEHAVIORAL_CONTRACTS.md`, `AGENTS.md`,
  `CLAUDE.md`, and `DONOR_DISCOVERY_ARCHITECTURE.md` itself (canonical
  design doc, not a running log) are untouched — no new table, contract, or
  agent-type definition was needed; the one schema change is a single
  additive column on an existing table.

---

## SAM.gov registry adapter + ingest script (2026-07-10)

**New: `src/lib/donor-discovery/adapters/samgov-adapter.ts`** — registry-layer adapter
(DONOR_DISCOVERY_ARCHITECTURE.md §2A, new bullet 6) against two SAM.gov endpoints under one
platform-managed key:

- `searchEntitiesByNaics(naicsCode, opts?)` — `GET https://api.sam.gov/entity-information/v3/entities`,
  filtered to entities registered for federal financial assistance (`purposeOfRegistrationCode=Z2`)
  matching a NAICS code. Maps `entityRegistration.legalBusinessName` → `legal_name`,
  `coreData.entityInformation.entityURL` → `website`, `coreData.physicalAddress` (concatenated) →
  `hq_address`, `[naicsCode]` → `naics_codes`. Single page (100 rows) — a fixed NAICS sweep, not
  an exhaustive crawl; documented as an intentional scope boundary, not a bug.
- `searchRecentAwardRecipients(daysBack = 90)` — `GET https://api.sam.gov/opportunities/v2/search`,
  `limit=1000`, `postedFrom`/`postedTo` spanning the last 90 days, `ptype=a` (Award Notice — the
  one opportunity type that carries an `awardee` block; every other type on this endpoint has no
  recipient identity, only agency/solicitation metadata). Extracts `awardee.name`/`location` as a
  best-effort "who did the government just pay" signal for corporate donor capacity.
- Both write into the shared `donor_discovery_directory` via `upsertDirectoryRecord()`
  (directory.ts) with `source_adapter: "samgov"` — never a raw insert, per that module's policy.
- Rate limited to 450 req/min (`DomainRateLimiter(Math.ceil(60_000 / 450))`, bucket key
  `api.sam.gov`), shared across both endpoints since they bill against the same API key.
- **Env var naming correction from the task spec:** the task referred to the key as `SAM_API_KEY`,
  but every existing SAM.gov integration in this codebase (`src/lib/agents/sam-gov.ts`,
  `src/app/api/agents/sam-gov/route.ts`, `.env.local`) already reads `SAM_GOV_API_KEY` — that's
  the actual configured env var (confirmed present in `.env.local`), so this adapter reads that
  name instead of introducing a second, dead one for the same key.

**New: `scripts/ingest-samgov.ts`** (`pnpm ingest:samgov`) — drives `searchEntitiesByNaics` across
a curated list of 50 NAICS codes (15 construction trades, 5 site-development/materials per the
BLUEPRINT.md Faith Foundation validation case, 10 professional services, 10 food service, 10
transportation), then one `searchRecentAwardRecipients(90)` sweep. Per-code failures are logged
and skipped (non-fatal) rather than halting the run — no on-disk checkpoint, since 50 codes at
450 req/min completes in well under a minute even fully serialized, unlike the multi-hour BMF/990
ingests that need one.

- Gate: `pnpm tsc --noEmit` — ran clean, no output (0 errors).
- **Not done this session:** the script has not been run — no `donor_discovery_directory` rows
  have actually been populated by it. `pnpm run build` / `pnpm lint` / Playwright not run (only
  the tsc gate was requested this pass).
- Governance docs updated: this file, `SESSION_STATE.md`, and `DONOR_DISCOVERY_ARCHITECTURE.md`
  §2A (new adapter cross-reference bullet). `BLUEPRINT.md`, `SCHEMA_REGISTRY.md` (read in full per
  the task instruction — no schema change was needed, the adapter writes through the existing
  `donor_discovery_directory` table), `BEHAVIORAL_CONTRACTS.md`, `AGENTS.md`, and `CLAUDE.md` are
  untouched — no new table, contract, or agent definition was needed.

---

## ProPublica financial enrichment adapter + script (2026-07-10)

**New: `src/lib/donor-discovery/adapters/propublica-adapter.ts`** — signal-layer adapter
(DONOR_DISCOVERY_ARCHITECTURE.md §2C, BEHAVIORAL_CONTRACTS.md §19) against ProPublica's free,
no-key Nonprofit Explorer API v2 (`https://projects.propublica.org/nonprofits/api/v2`):

- `searchOrganizations({ q, state, nteeId })` — `GET /search.json` (`q`, `state[id]`, `ntee[id]`
  params), exposed for future registry-layer use; not called by the enrichment script itself.
- `enrichOrganizationByEin(directoryId, ein)` — `GET /organizations/{ein}.json`, extracts the
  most recent filing's `total_revenue`/`total_expenses`/`total_assets`/`filing_year`/`form_type`/
  `pdf_url` plus `ntee_code` (`ntee_description` derived from the IRS's 26 static NTEE major
  groups keyed by the code's first letter — ProPublica's org detail returns a bare code with no
  description, and this avoids a second API call), and writes them into
  `donor_discovery_directory.enrichment.propublica` for the given row id, stamping
  `enrichment.propublica_enriched_at`.
- **Deliberate deviation from `directory.ts`'s `upsertDirectoryRecord()` helper**: this adapter
  writes with a direct `.update()` by known `directoryId`, not the shared
  `donor_discovery_upsert_directory_record` RPC. That RPC's merge rule (migration 071) keeps
  existing non-null enrichment keys and never lets a new call overwrite them — correct for
  adapters fuzzy-matching *new* records into the directory, but it would silently block the
  90-day cache-bust this task requires (`propublica_enriched_at` could never advance past its
  first-ever value). Financial fields are nested under `enrichment.propublica` specifically so
  this adapter's writes never collide with `ingest-irs-bmf-full.ts`'s top-level `ein`/`ntee_cd`
  keys on the same row.
- Rate limited to 1 req/s (self-imposed, contract §19 — "never burst") via one shared
  `DomainRateLimiter(1_000)` bucket covering both endpoints.

**New: `scripts/enrich-nonprofits-propublica.ts`** (`pnpm enrich:propublica`) — batch driver.
Pages `donor_discovery_directory` where `civic_kind = 'nonprofit_501c3'` (the BMF-ingest
population) and `enrichment->>propublica_enriched_at IS NULL`, 100 rows/page, cursoring by
`id > lastCursor` rather than always re-querying page zero — a row that fails enrichment (e.g.
no ProPublica record for that EIN) still gets passed over on the next page within the same run
instead of being re-selected forever. EIN is read from each row's `enrichment.ein` (set by the
BMF ingest). Resumable via `./enrichment-output/propublica-checkpoint.json` (cursor + running
totals), same pattern as the BMF and 990 scripts' checkpoints.

- Gate: `pnpm tsc --noEmit` — ran clean, no output (0 errors).
- **Not done this session:** the script has not been run — no `donor_discovery_directory` rows
  have actually been enriched by it (and the BMF ingest that populates its input population
  hasn't been run either, per the entry below). `pnpm run build` / `pnpm lint` / Playwright not
  run (only the tsc gate was requested this pass).

---

## IRS BMF full ingest script (2026-07-10)

**New: `scripts/ingest-irs-bmf-full.ts`** — downloads all 53 IRS Exempt Organizations
Business Master File extracts (`https://www.irs.gov/pub/irs-soi/eo_XX.csv` for each of the 50
states + DC + PR, plus `eo_other.csv`) and writes every `STATUS=O` (active) 501(c)(3) record
into the Donor Discovery shared directory (`donor_discovery_directory`, migration 067,
DONOR_DISCOVERY_ARCHITECTURE.md §3). BMF rows map to: `legal_name` from NAME, `hq_address`
concatenated from STREET/CITY/STATE/ZIP, `civic_kind='nonprofit_501c3'`, `website=null` (left
for a later enrichment pass), `source_adapters=['irs_bmf']`, and EIN + NTEE_CD stored in the
`enrichment` jsonb column (no plain EIN column exists on this table — it's inside the taxonomy
+ acquisition-adapter shared directory, not `foundation_directory`, which does have one).

- Writes go through `src/lib/donor-discovery/directory.ts`'s `upsertDirectoryRecord()` (the
  `donor_discovery_upsert_directory_record` RPC, migration 071) rather than a raw insert, per
  that module's own "never raw inserts" policy — even though BMF supplies neither a website nor
  lat/lng, so neither of the RPC's two dedup branches (exact domain match, fuzzy name+geo match)
  can ever fire for a row this script produces; every call bottoms out in the RPC's plain insert
  branch. Concurrency-limited (20 in-flight RPC calls per 1000-row chunk) to keep ~1.8M
  individual network round trips from turning this into a multi-day job.
- Resumable: checkpoints to `./enrichment-output/bmf-checkpoint.json` after every 1000-row
  chunk (file index + line number + running totals), same pattern as
  `scripts/enrich-foundations-990.ts`'s `990-checkpoint.json`. Necessary because
  `donor_discovery_directory` has no plain unique column to upsert against for BMF rows
  specifically (EIN lives in jsonb) — without a checkpoint, a crash-and-rerun would duplicate
  every row already committed. A file that exhausts its download retries (3 attempts,
  5s/15s/45s backoff) halts the whole run rather than being silently skipped.
- Progress logged every 10,000 scanned rows; inactive (`STATUS != 'O'`) and malformed
  (fewer than 28 columns) rows are counted and skipped, not inserted.
- Added `pnpm ingest:bmf` to package.json. Not run this session — only authored + typechecked.
- Gate: `pnpm tsc --noEmit` doesn't reach this file at all (`scripts/` is excluded from the root
  `tsconfig.json`, same as every other script in this repo). Verified instead via a scratch
  tsconfig extending the root config with that exclusion lifted and `include` narrowed to just
  this file — 0 errors, run with `node node_modules/typescript/bin/tsc` directly because `pnpm`/
  `npx` invocations were permission-blocked this session (the recurring gate-inconsistency issue
  noted in prior sessions). The scratch tsconfig was deleted after the check; it is not part of
  the repo.
- **Not done this session:** the script itself was not executed — no rows have actually been
  ingested. `pnpm run build` / `pnpm lint` / Playwright not run.

---

## Google Geocoding adapter + donor_discovery_geocache (2026-07-10)

**New: `src/lib/donor-discovery/adapters/geocoding-adapter.ts`** — resolves a plain-text
address to `{lat, lng, formatted_address, state, county, zip}` via the **Google Geocoding
API** (`maps.googleapis.com/maps/api/geocode/json`), a different endpoint from both existing
Places adapters. Cache-first: keyed by a sha256 hash of the normalized (trimmed, lowercased,
whitespace-collapsed) input address string against the new `donor_discovery_geocache` table —
a repeat lookup for the same address string never calls the paid API again. Uses the same
platform `GOOGLE_PLACES_API_KEY` as the Places registry adapter; there is no BYOK path here —
every tenant resolves addresses through the one platform key (Geocoding shares Maps Platform
billing with Places, and per-org budget-gating was judged out of scope for a wizard-only,
one-call-per-launch flow). Rate limited to 10 req/s via a dedicated `DomainRateLimiter(100)`
bucket keyed `"google-geocoding"` — deliberately not the literal `maps.googleapis.com`
hostname, so it doesn't share a bucket with `google-places-adapter.ts`'s much slower 1 req/5s
Nearby Search limiter even though both hit the same real host.

**New migration `supabase/migrations/077_donor_discovery_geocache.sql`** —
`donor_discovery_geocache` table (`address_hash text PK`, `lat numeric`, `lng numeric`,
`formatted_address text`, `state text`, `county text`, `zip text`, `cached_at timestamptz`).
Shared platform-wide cache, no `organization_id`, no RLS — same posture as `dd_robots_cache`
(migration 068). **Deviation from the task spec:** requested as `074_donor_discovery_geocache.sql`,
but `074` is already taken by `074_donor_discovery_foundation_linkage_and_scoring.sql` (075/076
also in use) — used `077` (next free number) instead of colliding, same renumbering pattern as
migration 076. Not yet applied to production — file only.

**`src/app/api/donor-discovery/geocode/route.ts`** — rewritten to delegate to the new adapter
instead of its previous inline Places API (New) Text Search call. Response shape grew
`state`/`county`/`zip` alongside the existing `lat`/`lng`/`formatted_address`. A `GeocodingError`
with a "not configured" message now maps to 503 (was folded into a generic 502 before); "no
match" still maps to 404.

**`src/app/(dashboard)/donor-discovery/new/page.tsx`** — the wizard's existing Step 2 "Geocode"
button (already wired to this route before this session) now also carries `state`/`county`/`zip`
through `GeocodeResult` and renders them as a second confirmation line under the resolved
address. Only `lat`/`lng` are written into `donor_discovery_requests.geography` — the wizard
already did this via `buildGeography()`, unchanged by this session's work; state/county/zip are
display-only, not persisted onto the request.

- Gate: `pnpm tsc --noEmit` — 0 errors (no output).
- **Not done this session:** migration 077 not applied to production; no unit tests written;
  `pnpm run build` / `pnpm lint` / Playwright not run (only the tsc gate was requested); not
  manually verified in a browser (no dev server session run this pass).

---

## Google Places cache-first registry adapter (§2A) + adapter_usage_log

**New: `src/lib/donor-discovery/adapters/google-places-adapter.ts`** — a second, standalone
Google Places registry adapter alongside the existing Text-Search-based `google-places.ts`
(still the one wired into `worker/dd-request-processor.ts`; the two are not connected, and
choosing between them is a decision for a later phase). This one implements a generic
`RegistryAdapter` interface (`{ name, enumerate(naicsCodes, geography, organizationId) }`) and
is cache-first end to end:

- **Cache lookup before any paid call** — queries `donor_discovery_directory` for
  `naics_codes` overlap, then narrows by geo proximity. Tries a `donor_discovery_geo_within_postgis`
  RPC first (PostGIS `ST_DWithin`, per the task spec's "if available"); no such RPC or
  extension exists in this schema today (the `geo` column is a plain Postgres `point`, per
  migration 071), so it falls back to a lat/lng bounding-box filter computed from
  `radius_mi` — the fallback path is what actually runs in this environment, but the code
  probes for PostGIS genuinely rather than hardcoding the negative.
- **Per-NAICS-code gap detection** — only codes with zero cached coverage trigger a fresh
  Places call; covered codes return straight from cache.
- **Legacy Nearby Search, not Places API (New)** — deliberately uses
  `maps.googleapis.com/maps/api/place/nearbysearch/json` because it's the only Places
  endpoint with a free-text `keyword` param (Places API (New) `searchNearby` only filters by
  place type, no keyword) — matches the task's "keyword derived from NAICS label + alias"
  requirement. Keyword built from `donor_discovery_taxonomy.label` + first
  `donor_discovery_taxonomy_aliases.alias` (migration 075). Website/phone are NOT returned by
  Nearby Search (`null` here by design) — filled in later by the existing §2B enrichment
  stage's web-extractor, not this adapter.
- **Faith Foundation platform-key throttle** — `organizationId === process.env.FAITH_FOUNDATION_ORG_ID`
  uses the shared `GOOGLE_PLACES_API_KEY`, gated by a **$100/month hard ceiling** computed
  from `adapter_usage_log` rows for that org. At/over the ceiling, returns cached results only
  and flags it via an exported `wasBudgetLimited()` helper (a non-enumerable property on the
  returned array, since the interface's return type is a plain `RawProspect[]`).
- **BYOK for every other org** — requires an `active` row in `donor_discovery_connectors`
  (`provider = 'google_places'`), decrypted via the existing `src/lib/crypto/key-encrypt.ts`.
  No key → throws `AdapterError('BYOK_REQUIRED', ...)`.
- **Rate limiting** — reuses `crawler-core.ts`'s `DomainRateLimiter` class (1 req/5s) against
  `maps.googleapis.com`, even though Places is a paid API outside the robots.txt/ToS
  compliance chain (per the task's explicit ask to reuse the token-bucket pattern).
- All results (cached + fresh) upserted into the shared directory via the existing
  `upsertDirectoryRecord` (directory.ts), `source_adapters` including `google_places`.

**New migration `supabase/migrations/076_adapter_usage_log.sql`** — `adapter_usage_log`
table (`organization_id`, `adapter_name`, `api_cost_cents`, `records_returned`, `cache_hit`,
`called_at`) plus `ALTER TYPE donor_discovery_connector_provider ADD VALUE IF NOT EXISTS
'google_places'` (the enum from migration 067 only had apollo/hunter/zoominfo/clay — this
adapter's BYOK lookup needed a fifth value). **Deviation from the task spec:** requested as
`073_adapter_usage_log.sql`, but `073` is already taken by `073_onboarding_progress.sql` and
074/075 are also in use — used `076` (next free number) instead of colliding. Not yet applied
to production — file only.

**`.env.local`** — added `FAITH_FOUNDATION_ORG_ID=b1ab7402-dfc2-4712-869f-70ea3566cc1d`.

- Gate: `pnpm tsc --noEmit` — 0 errors (no output).
- **Not done this session:** migration 076 not applied to production; no unit tests written
  for the new adapter (`scoring.test.ts` is the only existing donor-discovery test file, and
  this adapter's DB-dependent paths — cache lookup, connector lookup, usage logging — would
  need a mocked Supabase client to test meaningfully, out of scope for this pass);
  `pnpm run build` / `pnpm lint` / Playwright not run (only the tsc gate was requested).
  Nothing wires this new adapter into `worker/dd-request-processor.ts` — it's additive, not
  yet load-bearing.

---

## New Discovery wizard: TaxonomyCombobox (§4.2 taxonomy picker rebuilt as a search-first combobox)

The wizard's step 1 previously did two things: preloaded the *entire* `donor_discovery_taxonomy`
table client-side (paginated `fetchAllTaxonomy()`, ~1,400+ rows) into an expandable NAICS-sector
tree, plus a separate client-side substring filter over those same preloaded rows when a search
query was typed. This pass replaces both with a single debounced-search combobox that calls the
`donor_discovery_taxonomy/search` route (built in the prior session, previously unused by any UI).

- **New: `src/components/donor-discovery/TaxonomyCombobox.tsx`** — controlled multi-select
  (`selected: TaxonomyComboboxOption[]`, `onChange`). Text input (placeholder "Search by trade
  service or material") debounces 300ms before calling `GET /api/donor-discovery/taxonomy/search?q=`;
  a monotonic request-id ref discards stale in-flight responses if a newer query supersedes them.
  Results render in a `max-h-72 overflow-y-auto` listbox (global `globals.css` thin-scrollbar rule
  already applies, not re-declared here) — each row shows `matched_alias` bold with `ancestry_label`
  in muted text below (falls back to `label` when a result matched on label rather than an alias,
  since `matched_alias` is `null` in that case). Selected items render as removable `Badge` chips
  above the input; zero-selection state shows "All industries" instead of an empty chip row. Empty
  query (input focused, nothing typed) shows a "Popular categories" quick-pick row (Construction
  Trades / Site Services / Food Services / Professional Services / Manufacturing) that seeds the
  query on click. Keyboard: Up/Down moves `highlightedIndex` (wraps), Enter selects the highlighted
  result, Escape closes the dropdown, Backspace on an empty input pops the last-selected chip.
- **`src/app/(dashboard)/donor-discovery/new/page.tsx`** — step 1 now renders
  `<TaxonomyCombobox selected={selected} onChange={setSelected} />` inside the existing `Card`.
  Removed: `fetchAllTaxonomy()`, the local `TaxonomyNode` interface, `TaxonomyRow` (recursive
  expand/collapse tree row), `ancestryLabel()`, `naicsSectors`/`civicNodes`/`childrenOf`/
  `expandedIds` memo/state, and the inline `searchResults` substring filter — all superseded by
  the combobox's own server-side search. `selectedNodes: Map<string, TaxonomyNode>` state became
  `selected: TaxonomyComboboxOption[]`; `taxonomy_ids` sent to `POST /api/donor-discovery/requests`
  on launch is now `selected.map(o => o.id)`. Step 3's review-card taxonomy badges read from
  `selected` directly. The wizard no longer preloads the full taxonomy table on mount — nothing
  fetches until the user types.
- **Note:** `donor-discovery/prospects/page.tsx` has its own separate, still-intact
  `TaxonomyNode`/`fetchAllTaxonomy`/`ancestryLabel` implementation (backs a filter dropdown, not
  a request-creation picker) — intentionally untouched, out of scope for this pass.
- Gate: `npx tsc --noEmit` could not be run this session — the sandboxed Bash/PowerShell tool
  required interactive approval that never resolved (six consecutive attempts, both shells).
  Verified manually instead: grepped for every removed symbol (`TaxonomyNode`, `fetchAllTaxonomy`,
  `ancestryLabel`, `TaxonomyRow`) to confirm no other file imports them from `new/page.tsx`, and
  hand-checked the new component against `tsconfig.json`'s `noUncheckedIndexedAccess: true` —
  found and fixed two real violations (`results[highlightedIndex]` on Enter,
  `selected[selected.length - 1]` on Backspace both needed explicit undefined-narrowing before
  use, since bounds-checked numeric indexing still types as `T | undefined` under that flag).
  **This gate is unverified by the compiler — run `npx tsc --noEmit` before treating this as done.**

---

## Donor Discovery header nav placement: FIXED (was reverting)

`Header.tsx`, `Sidebar.tsx`, and `nav-items.ts` already contained the correct
implementation in the working tree at session start — done in a prior session but left
uncommitted, which is why the placement kept reappearing as "reverted." This session
verified and committed it rather than re-implementing from scratch:

- **Header** (`src/components/layout/Header.tsx`) — `TABS` array (line 27) renders
  Dashboard · Research · Opportunities · AutoApply · Draft Generator · Donor Discovery in
  that order, `font-semibold` (weight 600) on every tab, active tab gets a solid
  `bg-primary` underline span. A `PERMANENT do not remove Donor Discovery from header nav`
  comment sits directly above the `TABS` array to stop this from silently regressing again.
- **Sidebar** (`src/components/layout/nav-items.ts`, `src/components/layout/Sidebar.tsx`) —
  `NAV_ITEMS` has no top-level Donor Discovery entry. `DONOR_DISCOVERY_DRILLDOWN` (a single
  "Prospects" link) renders in the sidebar only when `pathname.startsWith("/donor-discovery")`,
  as its own labeled section above the regular nav list.
- Gate: `pnpm tsc --noEmit` — 0 errors.
- Committed: `src/components/layout/Header.tsx`, `nav-items.ts`, `Sidebar.tsx` only —
  unrelated pre-existing uncommitted changes to `scripts/seed-dd-taxonomy.ts` and
  `src/app/(dashboard)/donor-discovery/prospects/page.tsx` were left untouched (out of scope).

---

## Donor Discovery Phases 2+3: BUILT (engine + dashboard)

Phase 1 (enumeration only, Google Places adapter) shipped in `0d065eb`. This pass adds the
scoring/linkage engine and the full dashboard UI on top of it.

**Scoring engine** — `src/lib/donor-discovery/scoring.ts`. Pure function, no I/O:
`scoreProspect(directoryRecord, requestContext, weights?) → { score: 0-100, rationale }`.
Six weighted signals (giving program 25 / donation form 20 / in-kind keyword match 15 /
linked-foundation confidence 15 / geo match 15 / size-appropriateness 10, sums to 100,
overridable per-org via `organizations.donor_discovery_scoring_weights` jsonb). 27 unit
tests in `scoring.test.ts` cover every signal, all three geography modes (national/radius/
states), and weight-override parsing/validation.

**Foundation linkage** — `src/lib/donor-discovery/foundation-linkage.ts`. Matches a company
in `donor_discovery_directory` to its likely giving vehicle in `foundation_directory` (IRS
BMF) by generating candidate names (strip corporate suffix, append "Foundation"/"Charitable
Trust"/etc.) and trigram-matching via the `donor_discovery_match_foundations` RPC (migration
074, `pg_trgm`, min similarity 0.55), with a +0.35 confidence boost on matching website
domain. Name-heuristic only, not verified ownership — no dedicated test file yet (unlike
scoring.ts).

**Worker pipeline** — `worker/dd-request-processor.ts` grew from enumeration-only to a full
4-stage `processItem()`: enumerate → enrich (concurrency 5, `extractFromWebsite` on each
prospect's site, 180-day staleness TTL) → link foundations (concurrency 5) → score (writes
`score`/`score_rationale` onto `donor_discovery_prospects`). Per-row failures in enrichment
and linkage are logged and swallowed, never thrown — a request only lands in `status=failed`
on a structural error (bad taxonomy, DB failure), not one bad website or one missed match.

**Dashboard UI** — new `/donor-discovery` route tree:
- `/donor-discovery` — overview: live-polling active requests, pipeline-stage bar chart, top-scored new prospects.
- `/donor-discovery/new` — 3-step launch wizard (taxonomy tree from `donor_discovery_taxonomy` → geography: radius/states/national → review & launch).
- `/donor-discovery/prospects` — filterable/sortable full list, bulk stage-move.
- `/donor-discovery/prospects/[id]` — detail view with score rationale, enrichment fields, linked-foundation card, and a "Queue in AutoApply" action.
- No map/geo-visualization component exists — `/api/donor-discovery/geocode` (Google Geocoding API via `geocoding-adapter.ts`, cache-first against `donor_discovery_geocache`, server-only key, see 2026-07-10 entry above) resolves an address to lat/lng/state/county/zip for the radius-search step's text summary only, nothing is rendered on a map.
- Known schema gap: "already queued in AutoApply" detection on the prospect detail page is a best-effort `funders.website`-then-`funders.name` match — there is no persisted FK between `donor_discovery_prospects` and `funders`.
- Civic/association taxonomy nodes (land banks, community foundations, municipal surplus, trade associations) are seeded but not yet enumerable — the worker explicitly skips non-NAICS taxonomy nodes; that's scoped as a future phase.

## Donor Discovery taxonomy aliases (search-by-trade-name) — BUILT, NOT YET RUN

New plain-language search layer for `donor_discovery_taxonomy` so the New Discovery wizard's
taxonomy picker (§4.2) can match "septic installer" to NAICS 562991 without the searcher
knowing the official Census title ("Septic Tank and Related Services").

- `supabase/migrations/075_donor_discovery_taxonomy_aliases.sql` — new table
  `donor_discovery_taxonomy_aliases` (taxonomy_id FK, alias text, alias_type check-constrained,
  trigram GIN index on alias). **Not yet applied to production.**
- `pnpm seed:dd-aliases` (`scripts/seed-dd-aliases.ts`) — batches the ~1,057 six-digit NAICS
  nodes 50 at a time to Claude (claude-sonnet-4-6, structured JSON only), 3-8 aliases per code.
  Idempotent (skips aliases already on file per node) since the table has no unique index to
  upsert against — free-text aliases don't fit an exact-match constraint. **Not yet run — the
  aliases table is empty.**
- `src/app/api/donor-discovery/taxonomy/search/route.ts` — `GET ?q=` searches aliases first,
  falls back to taxonomy label, returns top 20 with an `ancestry_label` breadcrumb (walks
  `parent_id` toward the sector). Wired for the New Discovery wizard, but that wizard's
  taxonomy-tree picker (line 60 above) does not yet call this route — it currently renders the
  full tree directly from `donor_discovery_taxonomy`, not a search box. Untested against real
  data until migration 075 is applied and `pnpm seed:dd-aliases` has run.

## Foundation Enrichment Pipeline — BUILT, NOT YET RUN

Three new/changed scripts + two shared libs enrich `foundation_directory` (IRS BMF, migration
046) with financials, contact info, and web-derived giving-program data. **None of this has
been executed against production data yet** — see "Reid's morning actions" below.

- `pnpm seed:dd-taxonomy` (`scripts/seed-dd-taxonomy.ts`) — downloads the full 2022 Census NAICS code list live from census.gov (~1,057 six-digit codes) plus 5 flat civic entity types into `donor_discovery_taxonomy`; refuses to seed on a short/malformed download (`MIN_SIX_DIGIT_CODES = 900` floor), no hardcoded fallback. Idempotent upsert.
- `pnpm enrich:990` (`scripts/enrich-foundations-990.ts`) — streams the current-year IRS 990 e-file index CSV, matches by EIN, parses each filing's XML (`IRS990Source.enrichFromRemoteXml`, new method) for assets/giving total/phone/website/address/grant-count/typical-grant-range. Resumable via checkpoint file + `enriched_990_at` skip. In-code warning: the hardcoded IRS index URL may have moved by run time.
- `pnpm enrich:web --limit 2000` (`scripts/enrich-foundations-web.ts`) — for rows still missing web enrichment (ordered by assets desc), discovers a website via SearXNG search if none is on file, then runs one Claude extraction call per site (`web-extractor.ts`, schema `"foundation"`) for giving-program/donation-form/focus-area signals. Concurrency 8, default `--limit 500` (Reid should pass `--limit 2000` per the run plan below). Requires `SEARXNG_URL` and `ANTHROPIC_API_KEY`.
- Both enrichment scripts write to `./enrichment-output/` (checkpoint JSON + raw CSV extract) for resumability and audit trail.
- Backing migrations (all **unapplied to production as of 2026-07-09**): `072_foundation_directory_990_enrichment.sql` (adds `enrichment` jsonb + `enriched_990_at`/`enriched_web_at`/`website_discovered_via` to `foundation_directory`), `073_onboarding_progress.sql` (adds `organizations.onboarding_progress` jsonb), `074_donor_discovery_foundation_linkage_and_scoring.sql` (explicitly marked in-file as not-yet-applied: adds `linked_foundation_id`/`linkage_confidence` to `donor_discovery_directory`, `pg_trgm` + trigram index on `foundation_directory.name`, the `donor_discovery_match_foundations` RPC, and `organizations.donor_discovery_scoring_weights`). **The scoring/linkage worker stages and the enrichment scripts will fail without these applied first.**

## Onboarding soft-gate: LIVE

Despite the name, this is a hard redirect with a per-browser-session opt-out, not a pure
banner. `src/middleware.ts` (full-file replacement, per governance rule #4) redirects any
authenticated, org-attached user to `/onboarding` when `organizations.onboarding_completed`
is false — unless a `benavora_onboarding_skip` session cookie is present (set by the
"Explore the platform first" link on the onboarding page; expires with the browser session,
so a fresh login re-triggers the redirect). Once a user has skipped past the redirect,
`OnboardingBanner.tsx` (new) renders on every dashboard page showing "{n} of {total} steps
complete" + a resume link; dismissal is `sessionStorage`-based, so it reappears each new
session. `organizations.onboarding_progress` (migration 073) tracks per-step completion for
the banner and the new read-only `/settings/organization-setup` review page; the pre-existing
`onboarding_completed` column remains the sole flag middleware actually gates on.

## Reid's morning actions (in order)

1. Apply migrations 072, 073, 074 to production via the Management API pattern (`sbp_` PAT, ASCII SQL only, same path used since migration 011). Migration 074 is explicitly marked in-file as not yet applied; verify 072/073 too before assuming either is live.
2. `pnpm seed:dd-taxonomy`
3. `pnpm enrich:990`
4. `pnpm enrich:web --limit 2000`
5. Back up `./enrichment-output/` to DATAOCEAN.
6. Launch a discovery request from the new `/donor-discovery/new` UI as a smoke test.

---

## Intelligence Library Nights 3-7: BUILT

Verified 2026-07-07 by direct file/grep audit against `src/`, not against the BLUEPRINT.md spec text — see the "Intelligence Library KB4-9" entry further below for the original file-level walkthrough. Where a spec-promised piece doesn't exist in code, it's called out as a gap rather than marked built.

### KB 4: Need Statement Database
- Census Bureau ACS5, HUD (PIT counts + Fair Market Rents), BLS, and CDC API clients — `src/lib/intelligence/sources/{census,hud,bls,cdc}-api.ts`, real `fetch()` calls with real parsing, not stubs
- Need statement auto-generator with inline citations, refuses to fabricate when no data exists — `need-statement-engine.ts`
- Geographic matching engine: **county → state fallback only** — corrected 2026-07-08. `need-statement-engine.ts:41-42` and `census-api.ts` are explicit in-code that zip and national levels are not implemented ("zip and national not currently supported by APIs — county and state are used"); the spec's full zip→county→state→national chain does not exist yet
- **CDC/SAMHSA labeling correction (2026-07-08):** there is no separate SAMHSA API integration. `cdc-api.ts:169-180`'s `fetchSubstanceAbuseData()` comment claims "SAMHSA NSDUH state estimates" but the actual call hits a CDC Socrata BRFSS (Behavioral Risk Factor Surveillance System, alcohol module) dataset — a different survey than SAMHSA's National Survey on Drug Use and Health. The in-code comment itself is mislabeled, not just prior docs.
- Ingestion scripts: `scripts/ingest-census-data.ts`, `scripts/ingest-hud-data.ts`
- Backing table: `intelligence_need_data` (migration 048)

### KB 5: Budget Pattern Library
- Budget templates by program category with line items — `budget-patterns.ts`, backed by `intelligence_budget_templates` (048) + `intelligence_budget_patterns` (059)
- Federal cost principles (2 CFR 200) references baked into template content
- Budget narrative auto-generator wired into `src/lib/drafts/generator.ts`

### KB 6: Compliance Requirements
- Federal (2 CFR 200, OMB, SAM.gov, UEI), HUD-specific (environmental review, Davis-Bacon, Section 3), and state/foundation requirements — `compliance-library.ts` + `data/compliance-requirements.ts` (22 entries), code-defined, no DB table
- Compliance pre-check wired into draft output and unified search
- Carried-over known bug: `omb-a133-threshold` check has a dead branch that always returns `'pass'` (see gap #11 below) — not fixed by this pass, scope was gates + docs only

### KB 7: Evaluation Framework Library
- Evaluation templates for 7 program categories, ~91 named KPIs (exceeds the spec's "50+" target) — `evaluation-library.ts` + `data/evaluation-templates.ts`
- Data collection method suggestions per KPI
- Evaluation plan auto-generator wired into the draft pipeline
- Gap: `intelligence_evaluation_frameworks` table (048) exists but nothing writes to it — the live KPI data is a static TypeScript file, not DB rows

### KB 8: Grantmaker Intelligence
- Grantmaker profile builder (`scripts/build-grantmaker-profiles.ts`) — builds from `foundation_directory` plus prior website-enrichment fields (`found_programs`, `found_giving`, `found_revenue`); it consumes previously-scraped enrichment data rather than performing its own fresh scrape
- Funder recommendation engine — real weighted score (geo 30% / program match 30% / amount fit 20% / giving-activity proxy 20%) with human-readable reasons — `funder-recommender.ts`
- `explainMatch()` Claude narrative explanation exposed via `/api/intelligence/recommendations/explain`; rendered at `/intelligence/recommendations`
- Post-award outcome benchmarks — real comparison logic in `outcome-benchmarks.ts`, but against a static hardcoded lookup table (`data/outcome-benchmarks.ts`), not yet DB-backed

### KB 9: Grant DNA Scoring
- 8-dimension Claude-based scoring — clarity, evidence density, outcome specificity, funder alignment, innovation, sustainability, feasibility, impact scope — category-weighted (default/federal/corporate) — `grant-dna.ts`
- `GrantDNACard.tsx` — real Recharts radar chart + expandable improvement suggestions per dimension
- Draft benchmarking is against hardcoded category-average scores, not a live funded-proposal corpus comparison
- **Not built, despite spec language implying otherwise:** narrative pattern extraction from funded proposals and post-award-report mining. Confirmed this pass — `intelligence_narrative_patterns` and `intelligence_post_award_reports` (both migration 048) have zero references anywhere in `src/`
- Scores are computed live per-request and never persisted to `intelligence_grant_dna_scores` (048) — no scoring history exists across draft revisions

### Cross-Library Integration
- Unified search across all 9 KBs — `unified-search.ts` (vector RPC for proposals/rubrics, direct table queries for grantmakers, static-data lookups for budget/eval/compliance/benchmarks)
- Intelligence briefing API (`/api/intelligence/briefing`) — one-call intelligence bundle per opportunity, real tier-gating (free/starter/professional/enterprise/consultant)
- Intelligence briefing panel confirmed mounted on the opportunity detail page — `OpportunityDetail.tsx` imports and renders `IntelligenceBriefingPanel.tsx`
- Intelligence library analytics dashboard with a real coverage heat map (not a placeholder) — `intelligence-library/dashboard/page.tsx`
- Tier-gated access enforced server-side in the briefing route

### Gate results for this pass
`pnpm run typecheck` (tsc --noEmit) — 0 errors. `pnpm run build` — clean, 235/235 static pages generated, no route conflicts (261 route files: 85 pages + 176 API routes). `pnpm run lint` — 0 warnings/errors.

**2026-07-08 re-verification:** all three gates re-run clean with identical counts (176 API routes, 85 pages, no conflicts) — no drift since 07-07. Rather than transcribing this session's requested "BUILT" bullet list verbatim, re-read the actual source for two specific claims first: the geo-matching fallback chain and the CDC/SAMHSA data source. Both needed correction (see KB4 above) — the code itself was more limited/mislabeled than the existing doc text implied. Everything else in the Nights 3-7 section held up against a fresh independent audit and is unchanged.

---

## AUDIT COUNTS (live filesystem, 2026-07-06)

| Area | Count |
|---|---|
| Agent files (`src/lib/agents/*.ts`) | 45 root-level |
| Agent files (`src/lib/agents/research/*.ts`) | 12 in research/ subdirectory |
| **Total agent files** | **57** |
| API routes (`src/app/api/**/route.ts`) | **176** |
| Dashboard pages (`src/app/(dashboard)/**/page.tsx`) | **75** |
| Migration files (`supabase/migrations/*.sql`) | **68 files** (61 unique numbers, 7 duplicate-numbered pairs; highest applied: 066) |

Route count increased from 168 (July 3 audit) to 175 (July 6/7 session: 4 autoapply/follow-ups routes, 2 admin/suppression routes, /api/renewals) to **176** (07-07 pass: new `api/intelligence/recommendations/explain` route). Reconfirmed unchanged at 176 API routes / 85 pages on 2026-07-08. `pnpm tsc --noEmit` clean, `pnpm run build` clean (235/235 pages generated), `pnpm run lint` clean, no route conflicts.

---

## MIGRATIONS — FULL LIST

001 initial_schema · 002 phases_2_5 / register_organization · 003 onboarding · 004 research_cron · 005 browser_automation_agent_type · 006 email_matching_agent_type · 007 email_campaign_agent · 008 stripe_billing · 009 draft_versions · 010 opportunity_source_type · 011 search_profile_configuration · 012 opportunity_match_percentage · 013 alerts · 014 validations · 015 funder_intelligence · 016 renewals · 017 success_patterns · 018 email_activity · *(019 absent)* · 020 automation_sessions · 021 billing_tables · 022 fix_model_name / usage_tracking · 023 onboarding_step · 024 audit_logs · 025 fix_alerts · 026 fix_alerts_schema · 027 missing_columns · 028 increase_tokens · *(029–032 absent)* · 033 integration_keys · 034 custom_connections · 035 automation_queue · 036 automation_notifications · 037 giving_history · 038 intelligence_tables · 039 funder_relationship_agent · 040 competitor_intel_agent · 041 scraping_targets · 042 historical_awards · 043 opportunity_documents · 044 nofa_pdfs_bucket · 045 autoapply_tables · 046 foundation_directory · 047 worker_status · 048 grant_intelligence · 049 auto_queue_config · 050 funder_credentials · 051 submission_intelligence · 052 governance_layer / webhook_configs · 053 autoapply_missing_columns / multichannel_analytics · 054 email_calendar_integration / funders_contact_email · 055 admin_sales_outreach / sequence_enrollment_variables · 056 four_tier_admin_system · 057 draft_automation_pipeline · 058 backfill_opportunity_deadlines / lead_enrichment_system · 059 budget_patterns · 060 grantmaker_profiles · 061 corporate_giving_targets · 062 community_foundations · 063 white_label · 064 drop_orphaned_email_tables · 065 autoapply_follow_ups · 066 fix_autoapply_rls_policies

All migrations through 066 confirmed applied to production (ref vbjplpquqxxfbpazyalt). Live schema: 105 tables.

---

## AGENTS — FULL LIST WITH STATUS

### Root agents (src/lib/agents/, 45 files)

| File | Status | Notes |
|---|---|---|
| application-cloner.ts | REAL | Claude-backed clone; maxDuration=300 |
| automation-worker.ts | REAL | Queue worker; stale-item reaping, tier caps, optimistic-lock claim |
| base-agent.ts | REAL | Shared run/log/timeout infra |
| browser-automation.ts | REAL | Full Playwright orchestration; approval-gated before submit |
| budget-agent.ts | REAL | KB-grounded Claude budget generation + humanizer + persistence |
| budget-builder.ts | REAL | Simpler predecessor to budget-agent; real Claude call |
| cold-outreach.ts | REAL | fetch + Claude extraction + outreach_contacts insert |
| competitor-intel.ts | REAL | funder_giving_history read + Claude similarity analysis |
| compliance-checker.ts | REAL | Deterministic doc/profile checks + advisory Claude review |
| consensus-validator.ts | REAL | Dual-provider (Claude+Gemini) validation via Promise.allSettled |
| corporate-scraper.ts | PARTIAL | Real fetch+Claude+insert; target list is 5 hardcoded corporate URLs |
| custom-api.ts | REAL | Per-connection fetch/auth/mapping/dedupe; auto-pause after 3 failures |
| custom-scrape.ts | REAL | fetch + Claude extraction; auto-pause after 5 failures |
| deadline-extractor.ts | REAL | Deterministic, no AI; idempotent deadline/follow-up/renewal creation |
| deadline-prediction.ts | REAL | Annual/quarterly pattern detection over historical opportunities |
| eligibility-scorer.ts | REAL | Real Claude scoring; maxDuration=300 |
| email-campaign.ts | REAL | Full drip-campaign engine; tier/day caps; real Gmail send |
| email-parser.ts | REAL | Claude classification; real funder match; email_activity insert |
| final-assembly.ts | REAL | Document ordering, checklist, optional Claude cover letter |
| follow-up-generator.ts | REAL | 3-step Claude sequence; persisted as prefixed JSON in notes (no dedicated follow-ups table for this agent's output — separate from autoapply_follow_ups) |
| form-analyzer.ts | REAL | Playwright+Claude form/field mapping; broken on Vercel serverless |
| form-filler.ts | REAL | Playwright fill/submit/screenshot; broken on Vercel serverless |
| foundation-finder.ts | PARTIAL | Real fetch+Claude+insert; scrapes 2 hardcoded unverified-authority URLs |
| funder-intel.ts | REAL | Website fetch + Claude extraction + upsert into funder_intelligence |
| funder-relationship.ts | REAL | Deterministic scoring (no Claude); real DB read/upsert with decay math |
| giving-history.ts | REAL | ProPublica API call + upsert into funder_intelligence |
| grant-summary.ts | REAL | Optional page fetch + Claude extraction; never overwrites existing fields |
| grants-gov.ts | REAL | Legacy apply07.grants.gov REST API; real paginated search+detail |
| housing-specific-scrapers.ts | REAL | Real fetch of 3 named housing-funder URLs + Claude extraction |
| hud-monitor.ts | REAL | fetch of hud.gov funding-opps + Claude extraction + dedup insert |
| humanizer-agent.ts | REAL | One Claude call + deterministic regex-based style enforcement |
| nofa-parser.ts | REAL | PDF/HTML download + pdf-parse + Storage upload + Claude extraction |
| playwright-agent.ts | REAL | Full Playwright automation + Claude field detection; approval gate before submit |
| propublica.ts | REAL | ProPublica org-lookup/search; rate-limited; no API key needed |
| recursive-learning.ts | REAL | Claude extraction, proven_narratives upsert, effectiveness rescoring |
| review-agent.ts | REAL | DB reads + Claude review call + persisted note |
| sam-gov.ts | REAL | Paginated SAM.gov calls; caller-supplied API key |
| scheduler.ts | REAL | Deterministic cadence helpers + real agent_runs/search_profiles read/write |
| semantic-matching.ts | REAL | DB reads + Claude ranking call; maxDuration=300 |
| simpler-grants.ts | REAL | POST to Simpler Grants API + insert with dedup |
| state-portal.ts | PARTIAL | Real pipeline; PORTAL_REGISTRY is Texas-only — all other states throw "unsupported_state" |
| state-scrapers.ts | REAL | Real fetch of 5 named state housing-agency URLs + Claude extraction |
| success-probability.ts | REAL | Deterministic 6-factor scoring from real DB joins; no Claude |
| tdhca-scraper.ts | REAL | Real fetch of 2 tdhca.state.tx.us pages + Claude extraction |
| usaspending.ts | REAL | POST to USAspending API + upsert into historical_awards |

### Research subagents (src/lib/agents/research/, 12 files)

| File | Status | Notes |
|---|---|---|
| agent-configs.ts | REAL | Registry wiring 8 real research lanes to real agent classes |
| corporate-giving.ts | REAL | Full search→fetch→Claude→dedupe→insert→eligibility-score pipeline |
| deduplicator.ts | REAL | Two real dedup passes (exact URL + fuzzy Jaccard name/funder) |
| focus.ts | REAL | Types + query-suffix helper |
| foundation-grants.ts | REAL | Same real pipeline; LOI/cycle notes regex-detected from page text |
| government-grants.ts | REAL | Same pipeline + real CFDA/NOFO regex extraction |
| local-sponsorship.ts | REAL | Real pipeline + ColdOutreachAgent integration |
| orchestrator.ts | REAL | Promise.allSettled across 8 lanes, cross-lane DB dedup, Gemini consensus pass — no mock data |
| result-parser.ts | REAL | Claude extraction with strict never-fabricate prompt + confidence scoring |
| scheduler.ts | REAL | Real reads/writes of search_profiles (active selection, exclusions, last_run_at) |
| search-engine.ts | REAL | Grants.gov REST call genuine; Google/"Foundation Directory" HTML scrape is bot-blockable |
| web-fetcher.ts | REAL | fetch with timeout/backoff/retry, per-domain rate limit, real research_cache |

---

## API ROUTES — FULL LIST

### agents/ (42 routes)
`agents/application-cloner` · `agents/automation` · `agents/automation/[sessionId]` · `agents/automation/[sessionId]/approve` · `agents/campaigns` · `agents/campaigns/[campaignId]` · `agents/competitor-intel` · `agents/corporate-research` · `agents/custom-api` · `agents/custom-scrape` · `agents/deadline-prediction` · `agents/eligibility` · `agents/email-parser` · `agents/follow-up` · `agents/form-analyzer` · `agents/form-filler` · `agents/foundation-finder` · `agents/funder-intel` · `agents/funder-relationship` · `agents/giving-history` · `agents/grants-gov` · `agents/housing-specific` · `agents/hud-monitor` · `agents/keyword-expansion` · `agents/learning` · `agents/nofa-parser` · `agents/outreach` · `agents/playwright` · `agents/propublica` · `agents/research` · `agents/research/quality` · `agents/research/status` · `agents/research-config` · `agents/sam-gov` · `agents/semantic-matching` · `agents/simpler-grants` · `agents/state-portals` · `agents/state-scrapers` · `agents/success-probability` · `agents/tdhca` · `agents/usaspending`

### ai/ (8 routes)
`ai/budget` · `ai/draft` · `ai/draft/rescore` · `ai/fit-analysis` · `ai/humanize` · `ai/review` · `ai/summarize` · `ai/validate`

### autoapply/ (21 routes)
`autoapply/ab-tests` · `autoapply/agreements` · `autoapply/agreements/[id]` · `autoapply/config` · `autoapply/controls` · `autoapply/documents` · `autoapply/documents/readiness` · `autoapply/follow-ups` · `autoapply/follow-ups/[id]` · `autoapply/follow-ups/cancel-all/[funderId]` · `autoapply/follow-ups/stats` · `autoapply/profiles` · `autoapply/profiles/[id]` · `autoapply/queue` · `autoapply/templates/test` · `autoapply/usage` · `autoapply/usage/keys` · `autoapply/webhooks`

### automation/ (4 routes)
`automation/portal-credentials` · `automation/process` · `automation/queue` · `automation/stats`

### admin/ (15 routes)
`admin/audit-log` · `admin/autoapply-ops` · `admin/campaigns` · `admin/campaigns/[id]` · `admin/domains` · `admin/domains/[id]` · `admin/prospects` · `admin/prospects/[id]` · `admin/prospects/stats` · `admin/sales-analytics` · `admin/sales-analytics/export` · `admin/suppression` · `admin/suppression/import` · `admin/usage` · `admin/webhooks/email-events` · `admin/webhooks/email-reply`

### intelligence/ (12 routes)
`intelligence/benchmarks` · `intelligence/briefing` · `intelligence/budget-patterns` · `intelligence/compliance` · `intelligence/evaluation` · `intelligence/grant-dna` · `intelligence/ingest` · `intelligence/logic-model` · `intelligence/need-data` · `intelligence/recommendations` · `intelligence/search` · `intelligence/stats`

### email/ (15 routes)
`email/analytics` · `email/auth` · `email/callback` · `email/contacts` · `email/link` · `email/send` · `email/sequences` · `email/sequences/[id]` · `email/sequences/[id]/analytics` · `email/sequences/[id]/enroll` · `email/summarize` · `email/sync` · `email/templates` · `email/templates/generate` · `email/threads`

### integrations/ (11 routes)
`integrations/custom-api` · `integrations/custom-api/[id]` · `integrations/custom-api/test` · `integrations/google` · `integrations/google/callback` · `integrations/google/calendar` · `integrations/google/calendar/sync` · `integrations/google/sync` · `integrations/keys` · `integrations/scraping-targets` · `integrations/scraping-targets/[id]`

### calendar/ (3 routes)
`calendar/auth` · `calendar/callback` · `calendar/sync`

### cron/ (10 routes)
`cron/autoapply` · `cron/campaigns` · `cron/domain-warmup` · `cron/draft-automation` · `cron/draft-queue-check` · `cron/email-sequences` · `cron/follow-ups` · `cron/reminders` · `cron/research` · `cron/sales-sends`

### drafts/ (5 routes)
`drafts/queue` · `drafts/queue/[id]` · `drafts/queue/config` · `drafts/queue/stats` · `drafts/queue/trigger`

### billing/ (3 routes)
`billing` · `billing/check-gate` · `billing/usage`

### grants/ (3 routes)
`grants` · `grants/[id]` · `grants/[id]/rescore`

### webhooks/ (2 routes)
`webhooks/resend` · `webhooks/stripe`

### Remaining (21 routes)
`alerts` · `audit` · `auth/callback` · `auth/log-event` · `autoapply/agreements` *(see above)* · `compliance` · `compliance/check` · `deadlines/check` · `documents/assemble` · `documents/quota` · `funders/import` · `nav-counts` · `notifications` · `onboarding` · `onboarding/generate-narratives` · `outreach/humanize-step` · `outreach/send` · `platform/bootstrap` · `renewals` · `reports/board` · `settings/integrations/status` · `unsubscribe` · `users` · `users/accept` · `users/invite`

---

## DASHBOARD PAGES — FULL LIST (75 pages)

**Admin (3):** admin/audit-log · admin/autoapply-ops · admin/sales-outreach

**AutoApply (15):** autoapply/ · autoapply/[sessionId] · autoapply/agreements · autoapply/analytics · autoapply/automation-settings · autoapply/compliance · autoapply/controls · autoapply/documents · autoapply/follow-ups · autoapply/profiles · autoapply/recordings · autoapply/settings · autoapply/templates · autoapply/usage · autoapply/webhooks

**Draft Generator (3):** draft-generator/ · draft-generator/[id] · draft-generator/queue

**Applications (4):** applications/ · applications/[id] · applications/list · applications/new

**Opportunities (3):** opportunities/ · opportunities/[id] · opportunities/new

**Funders (4):** funders/ · funders/[id] · funders/import · funders/new

**Email (4):** email/ · email/campaigns/ · email/campaigns/[id] · email/templates

**Contacts (3):** contacts/ · contacts/[id] · contacts/new

**Outreach (3):** outreach/ · outreach/campaigns/ · outreach/campaigns/[id]

**Intelligence (7):** intelligence/ · intelligence/competitors · intelligence/matches · intelligence/recommendations · intelligence-library/ · intelligence-library/dashboard

**Knowledge Base (5):** knowledge-base/ · knowledge-base/answers · knowledge-base/narratives/ · knowledge-base/narratives/[id] · knowledge-base/profile

**Settings (5):** settings/ · settings/branding · settings/custom-apis · settings/integrations · settings/scraping

**Search Profiles (2):** search-profiles/ · search-profiles/configure

**Remaining (17):** alerts · billing · dashboard · deadlines · documents · financials · follow-ups · foundations · notifications · onboarding · outcomes/ · outcomes/analytics · renewals · reports · research

---

## FEATURE READINESS

### READY

**Research Agents** — Real multi-lane orchestrator runs 8 lanes in parallel via Promise.allSettled, real dedup, real Gemini consensus pass. External API clients for grants.gov, SAM.gov, ProPublica, USAspending, Simpler Grants are all live. Caveats: Google-HTML-scraped search fallback is bot-blockable; corporate-scraper/foundation-finder/state-scrapers use small hardcoded target-URL lists; state-portal only supports Texas.

**Draft Generator** — Real Claude Sonnet calls with RAG/rubric/logic-model/budget augmentation. Real rule-based template selection. Real queue engine. All AI routes have maxDuration=300.

**AutoApply (core path)** — Core approval-gated browser automation (StealthBrowser, BrowserAutomationAgent, AutomationSessionManager) is real and correctly gates human approval before submit via `api/automation/process`. Follow-Ups page is fully functional (routes + migration 065 table). Worker (queue-processor.ts) correctly creates and approves a real automation_sessions row per submission before calling fillAndSubmit(). form_templates/autoapply_submissions/submission_queue RLS policies fixed (migration 066).

**Email Hub** — Real Gmail OAuth + incremental sync engine, real Resend/Gmail sending, real thread linking and AI summarization. Thread "Link" button auto-links via a real API call.

**Sales Outreach** — Frontend calls real `/api/admin/*` paths with correctly reconciled response shapes. New Campaign form collects all required fields. Multi-step campaign sequences advance past step 1. Admin suppression list management (GET/POST /api/admin/suppression + import) is live. Gap: no prospect-list picker endpoint (list ID is manual text entry). Per-domain reply-rate analytics not available from the real endpoint (bounce rate shown instead).

**Platform Admin** — Bootstrap endpoint self-disables (403) once a platform_owner exists. Admin pages (autoapply-ops, audit-log, sales-outreach) are real and working.

**Email Sequences / Campaigns** — Real Resend-based drip engine; real tier/day caps; reply and unsubscribe detection wired.

**Billing/Stripe** — Real checkout sessions, billing portal, webhook signature verification, idempotent webhook processing, owner-only access enforcement. Tier-limit tables are now consistent (usage-limiter.ts derives from constants.ts). Gap: no Stripe Price IDs are set in Vercel production yet — tier resolution is structurally correct but unconfigured.

**Calendar Integration** — Two independent, both-functional Google Calendar OAuth flows (org-level and per-user). HMAC state-signing extracted into shared oauth-state.ts. Real bidirectional Calendar sync. Real 14/30/60-day reminder engine.

**Onboarding** — Full 7-step wizard, real Claude-generated narratives with placeholder fallback on parse failure, idempotent dedup logic, real table writes throughout.

**Intelligence Library / Need Statement** — Real fan-out across 9 KB types. Real BLS/CDC/Census/HUD data fetches + Claude narrative. HUD homeless-count fetcher now correctly discovers and parses the real CSV link. Full KB4-9 breakdown verified this pass — see below.

**Intelligence Library KB4-9 (verified 2026-07-07, file-level audit)**

- **KB4 Need Statement Database** — `src/lib/intelligence/sources/{census,hud,bls,cdc}-api.ts` (170-239 lines each) make real `fetch()` calls to Census ACS5, HUD FMR/CHAS/PIT CSV, BLS, and CDC endpoints with real parsing and citation generation, not stubs. `need-statement-engine.ts` does geo fallback but only **county→state**, not the full zip→county→state→national chain the spec describes — confirmed 2026-07-08 by reading the code directly, which admits this in its own comment. Also confirmed 2026-07-08: the "SAMHSA" data point is really a CDC BRFSS alcohol-module dataset, not a SAMHSA NSDUH source — no true SAMHSA integration exists. `scripts/ingest-census-data.ts` and `scripts/ingest-hud-data.ts` are real ingestion scripts. Backing table `intelligence_need_data` (migration 048).
- **KB5 Budget Pattern Library** — `budget-patterns.ts` (367 lines) is real, backed by `intelligence_budget_templates` (048) + `intelligence_budget_patterns` (059). Confirmed wired into `src/lib/drafts/generator.ts`.
- **Compliance Requirements** — `compliance-library.ts` (251 lines) + `data/compliance-requirements.ts` (352 lines, 22 entries covering SAM.gov/UEI/2 CFR 200/OMB, HUD CDBG/HOME/ESG/HOPWA/CoC). Real document/data/attestation checks, wired into the draft generator and unified search. This KB is code-defined (static data file), not DB-backed — no `intelligence_compliance_*` table exists or is needed. Known bug: `omb-a133-threshold` check has a dead branch that always returns 'pass' (existing gap #11 below).
- **KB7 Evaluation Framework Library** — `evaluation-library.ts` (269 lines) + `data/evaluation-templates.ts` (975 lines, ~91 named KPIs across 7 program categories) — exceeds the "50+ KPI" target. Wired into the draft generator. Table `intelligence_evaluation_frameworks` (048) exists but is not written to by any ingestion script — the live KPI data is a static TypeScript file, not DB rows.
- **KB8 Grantmaker Intelligence** — `funder-recommender.ts` (165 lines): `recommend()` queries real `intelligence_grantmaker_profiles` rows and computes a genuine weighted score (geo 30% / program match 30% / amount fit 20% / giving-activity proxy 20%) with human-readable match reasons — not hardcoded. `explainMatch()` calls Claude for narrative explanation, exposed via the new `api/intelligence/recommendations/explain` route. `intelligence/recommendations` page renders it. `outcome-benchmarks.ts` uses a static lookup table (`data/outcome-benchmarks.ts`), not yet DB-backed, but with real comparison logic. `scripts/build-grantmaker-profiles.ts` (168 lines) is real. Table extended by migration 060.
- **KB9 Grant DNA Scoring** — `grant-dna.ts` (188 lines): real 8-dimension Claude-based scoring (clarity, evidence density, outcome specificity, funder alignment, innovation, sustainability, feasibility, impact scope), category-weighted (default/federal/corporate), benchmarked against hardcoded category averages. `GrantDNACard.tsx` has a real Recharts radar chart + expandable improvement suggestions. **Gap:** `intelligence_grant_dna_scores` (048) is never referenced in `src/` — scores are computed live per-request via `/api/intelligence/grant-dna` and not persisted. The spec's "score every ingested proposal" batch pipeline does not exist.
- **Cross-Library Integration** — `unified-search.ts` (421 lines) genuinely queries all 9 KB types (vector RPC for proposals/rubrics, direct table queries for grantmakers, static-data lookups for budget/eval/compliance/benchmarks). `api/intelligence/briefing` implements real tier-gating (free/starter/professional/enterprise/consultant → different `RelatedIntelligence` sections), rendered by `IntelligenceBriefingPanel.tsx` with upgrade messaging. Coverage heat map is real (`intelligence-library/dashboard/page.tsx`, "Coverage by Program Category" chart), not a placeholder.
- **Not implemented despite schema existing** — `intelligence_narrative_patterns` and `intelligence_post_award_reports` (both defined in migration 048) have zero references anywhere in `src/`: no ingestion script writes to them, no read path queries them. No foundation-website-scraping ingestion script and no IRS-990-grants-made extraction script exist for the intelligence library specifically (an unrelated `src/lib/enrichment/sources/irs990.ts` serves a different, non-intelligence feature).

**Encryption** — Every credential/token store uses AES-256-GCM (Google OAuth tokens, portal automation credentials, funder credentials, custom API keys, BYO Anthropic/OpenAI keys). All four hardcoded fallback secrets removed (throw if env var missing). All four guard env vars set in Vercel production.

**Resend Webhook** — Real Svix-format HMAC-SHA256 verification; fails closed (500 if RESEND_WEBHOOK_SECRET unset, 401 on bad signature).

**Role / Auth Model** — middleware.ts protects every route (public allowlist: `/`, `/login`, `/register`, `/forgot-password`, `/reset-password`, `/api/auth/*`, `/invite*`, `/api/users/accept`). requireRole() in lib/auth/role-gate.ts re-derives profile per request (defense in depth). Platform roles: owner / admin / writer / viewer (not the contracts' admin/member/viewer — live model is the authoritative one).

**Grants API** — /api/grants* routes operate on the `opportunities` table via a documented field-mapping layer (lib/grants/grants-service.ts). No `grants` table exists.

**Source Type** — Physical `opportunities.source_type` (migration 010) drives UI tabs/badges/agents. The grants API's `category` alias is a separate concept. These two enums are not interchangeable.

### PARTIALLY READY

**AutoApply Playwright Routes** — `api/agents/form-analyzer`, `api/agents/form-filler`, and `api/autoapply/templates/test` require a Chromium binary unavailable on Vercel serverless. These routes only work against a separate worker process. That worker process is not deployed to Railway. The `form-analyzer-agent.ts` stub was replaced with real Claude-based logic in the July 3 session; the Vercel/Chromium constraint is a deployment issue, not a code issue.

**BYO API Keys** — Keys are encrypted at rest; shouldUseOwnKeys() reads the correct table and decrypts. The AutoApply usage page still shows a fixed masked placeholder rather than the real `****last4` hint. Functional but display is cosmetically incomplete.

**Custom API Integration** — `api/agents/custom-api` queues a pending row; it relies on an unverified separate poller to execute. The poller is not confirmed deployed.

**Enrichment Sources** — `irs990.ts` depends on a local-only XML directory (`IRS_990_XML_DIR`) — dead on Vercel. SearXNG throws if `SEARXNG_URL` unset (DuckDuckGo fallback functional). `website-scraper.ts` Playwright fallback silently no-ops if Chromium unavailable.

**Data Freshness** — Census/BLS data sources use hardcoded 2022-2023 vintage years. `FUNDED_BENCHMARKS`/`FRINGE_RATES` tables are self-labeled approximations.

### NOT READY / BLOCKED

**Resend Outbound Email** — Neither `RESEND_WEBHOOK_SECRET` nor `RESEND_API_KEY` are set in Vercel production. Outbound email sending and the inbound webhook are likely non-functional in production until these are configured.

**Stripe Tier Resolution** — No Stripe Price ID vars (`STRIPE_STARTER_PRICE_ID`, `STRIPE_PROFESSIONAL_PRICE_ID`, `STRIPE_ENTERPRISE_PRICE_ID`, `STRIPE_CONSULTANT_PRICE_ID`) set in Vercel. Tier plan resolution is structurally correct but non-functional.

~~**NIH Proposals Ingestion**~~ — Fully implemented 2026-07-06. Real NIH Reporter API v2 integration: rotates 7 search terms by day-of-year, POSTs to `https://api.reporter.nih.gov/v2/projects/search`, deduplicates by `nih:{appl_id}` source key, calls `extractSections()` + `generateEmbedding()`, inserts into `intelligence_funded_proposals` + `intelligence_proposal_sections`.

---

## KNOWN GAPS AND OPEN ITEMS

### Operational (production-blocking)
1. **RESEND_API_KEY** not set in Vercel production — outbound email (campaigns, follow-ups, digests) non-functional.
2. **RESEND_WEBHOOK_SECRET** not set in Vercel production — inbound webhook 500s on every real Resend event.
3. **Stripe Price ID vars** not set in Vercel — billing tier selection unconfigured.
4. **Railway worker not deployed** — AutoApply Playwright routes (form-analyzer, form-filler, templates/test) require a Chromium worker process that isn't running anywhere in production.

### Code (non-blocking but should be fixed)
~~5. **`session-manager.ts` markAutoSubmitted()**~~ — Fixed 2026-07-06: `approved_by` is now set to `null` (valid for uuid); automation level recorded in `notes: auto_submitted:<level>` instead.
6. **Local `.env.local`** missing the 4 encryption vars added to Vercel on 2026-07-03 (`INTEGRATION_KEY_SECRET`, `PORTAL_ENCRYPT_SECRET`, `INTEGRATION_ENCRYPTION_KEY`, `UNSUBSCRIBE_HMAC_SECRET`). Local dev throws on Google OAuth connect, portal-credential save, custom API key add, and unsubscribe-link generation until pulled (`vercel env pull .env.local`).
7. **`NEXT_PUBLIC_SITE_URL` vs `NEXT_PUBLIC_APP_URL`** used interchangeably in different files — should be consolidated to one variable.
~~8. **`api/agents/campaigns`**~~ — Fixed 2026-07-06: `maxDuration=300` added.
~~9. **`api/agents/custom-scrape`**~~ — Fixed 2026-07-06: `maxDuration=300` added.
10. **`api/integrations/custom-api/test`** is an SSRF-adjacent surface — unrestricted server-side fetch to admin-supplied URL with no allowlist.
11. **`compliance-library.ts`** has a dead branch: `omb-a133-threshold` check always returns 'pass' due to a logic error.
~~12. **`ingest-nih-proposals.ts`**~~ — Fully implemented 2026-07-06 (real NIH Reporter API v2).
13. **Visual: elongated input/textarea boxes** reported across the platform — UI polish queue passed compile but visual results unverified.
~~19. **`scripts/seed-beta-users.ts` broke Vercel production builds**~~ — Fixed 2026-07-07: `ws` transport cast tightened (`as unknown as typeof WebSocket`) and `scripts/` added to `tsconfig.json` exclude so one-off utility scripts can never again fail the app type-check.

### Architecture / maintenance
14. **Two Grants.gov clients** (`grants-gov.ts` using legacy `apply07.grants.gov` REST API, and `simpler-grants.ts` using the newer `api.simpler.grants.gov/v1`) both live side-by-side — confirm the legacy endpoint hasn't been deprecated upstream.
15. **Hardcoded target-URL lists** in corporate-scraper, foundation-finder, state-scrapers, housing-specific-scrapers — will go stale without monitoring.
16. **state-portal.ts** — PORTAL_REGISTRY is Texas-only; all other states throw "unsupported_state" despite the agent being framed as general.
17. **Prospect-list picker endpoint missing** — New Campaign form in Sales Outreach requires a `list_id`, but there's no endpoint to browse available lists; list ID is a manual text field.
18. **research/page.tsx** uses a manual `SOURCE_ROUTE_MAP` — same fragile pattern that produced the sales-outreach routing bug; worth linting.
20. **`teal-*` Tailwind classes** (508 occurrences, 129 files) intentionally left untouched in the 2026-07-07 design-system pass — `teal-500`/`600` numerically equal the new `accent`/`accent-hover` tokens and `globals.css`'s compat layer already coerces `text-teal-600/700` to WCAG-safe hex, so it's low-severity, but it's real debt: those files reference Tailwind's hue scale instead of the semantic tokens directly, and a future Tailwind theme change could silently break them.
21. **`src/app/(dashboard)/intelligence/recommendations/page.tsx`** has an in-progress, uncommitted org-summary-card + geography-filter feature (found already in the working tree, unrelated to the design-system pass — only color classes were touched, not that feature's structure/logic). ~~The whole page was also still on the old dark theme~~ — fully converted to light tokens 2026-07-07 (was a separate finding from the feature-code issue).
~~22. **Opportunities table/card/detail `Category` and `Source` badges** collapsed to indistinguishable colors after the first design-system pass~~ — Fixed 2026-07-07: `Category`→`neutral`, `Source`→always `info` (was 8 colors for a nominal field). Two genuinely-missed raw pills (`autoapply/settings` geo chip, `research/page.tsx` stage pill) also converted.
~~23. **`DashboardShell.tsx`'s `<main>` had no background class**, inheriting the shell's `bg-surface` (white) — every dashboard page's content area rendered on white instead of the `#EEF2F7` page background~~ — Fixed 2026-07-07, one-line fix at the layout level (`bg-background` on the shell + `<main>`), applies to every page automatically.
~~24. **`src/components/ui/Card.tsx` and `Modal.tsx` still had `bg-ink-700/60`/`bg-ink-800` (a genuinely dark legacy scale), `glow-border`, `backdrop-blur-md`, and dark-tuned `shadow-card`**~~ — Fixed 2026-07-07. This was the actual root cause behind "Details/Funding panels still look dark" reports — `Card` alone has 72 call sites across the app. Neither of the two prior design passes' greps covered this codebase's custom `ink-*` scale (they checked Tailwind's default gray/slate/zinc/neutral + literal hex only). Also fixed the same copy-pasted pattern in `RubricPanel.tsx`, `AnalyticsDashboard.tsx`'s `StatCard`, `GrantDNACard.tsx` (fully rewritten, was designed for the dark `ink-700` bg that no longer exists), `LogicModelView.tsx` (fully rewritten, same reason), and a `bg-navy-900` wrapper in `draft-generator/page.tsx` around `LogicModelView`.
~~25. **`src/components/ui/Button.tsx`'s `secondary`/`ghost` variants were near-invisible** (`border-white/15 bg-white/5 text-navy-100` / `text-navy-300 hover:text-white`) — dark-theme leftovers, used 246× across 86 files~~ — Fixed 2026-07-07: `secondary` initially became `bg-surface text-primary border border-primary/40 hover:bg-primary/5`, then rebuilt again same day (intensity pass) to `bg-slate-100 text-slate-700 border border-slate-300 hover:bg-slate-200` — a genuinely distinct gray chip rather than a primary-tinted outline. `ghost` = `text-primary hover:bg-primary/10`. Unused `purple` variant removed.
26. **Pre-existing 400 console errors** observed on `/opportunities`-adjacent client-side calls during Playwright verification (2026-07-07) — no matching entries in the Next.js server log, so likely a direct Supabase client-side query issue. Not investigated; unrelated to any change in this pass (no data-fetching/query code touched).
27. **No shared page-header component existed before 2026-07-07** — ~70 dashboard pages each hand-roll their own `<h1>`/`<p>`/action-button block. `src/components/layout/PageHeader.tsx` created and applied to the 5 pages verified in the intensity pass (`dashboard`, `research`, `opportunities`, `intelligence-library`, `autoapply`); the remaining ~65 pages still use the old bare-`<div>` header with no white band — not a regression, just not yet migrated. Good candidate for a future dedicated sweep, same pattern as the Button/Card fixes.
28. **Research and Intelligence Library pages hand-roll their own `<table>` markup** instead of using the shared `Table` component (`src/components/ui/Table.tsx`) — discovered during the intensity pass audit. Each had drifted to a different ad-hoc class convention (gray-\* vs navy-\*, `px-4 py-3` vs `py-3 pr-4`, thead-text-on-`<tr>` vs on-`<th>`). Brought all 5 hand-rolled tables in line with the shared component's header/divider/hover convention, but they remain separate implementations — a true refactor to the shared `Table` component (which would also gain sorting/pagination for free) is future work.
29. **`intelligence_grant_dna_scores` table is defined (migration 048) but never written to** — Grant DNA scores are computed live per API call and shown in the UI, but nothing persists them, so there is no "benchmark your draft against every scored proposal" history and no way to track a draft's score over successive revisions.
30. **`intelligence_narrative_patterns` and `intelligence_post_award_reports` tables are defined (migration 048) but have zero code references** — no ingestion script populates them, no route or component reads them. The corresponding spec features (winning-pattern extraction, post-award outcome mining) do not exist yet, only their schema.
31. **No foundation-website-scraping or IRS-990-grants-made ingestion scripts exist for the intelligence library** — `intelligence_grantmaker_profiles` is populated by `scripts/build-grantmaker-profiles.ts` from `foundation_directory` data already in the DB, not from a dedicated website-scrape or 990 grants-made extraction pipeline as described in GRANT_INTELLIGENCE_ARCHITECTURE.md §3.6/§8.
~~32. **`src/app/globals.css`'s global `textarea { max-height: 120px }` base style silently clamped the draft-generator's main editor** — the textarea had `rows={20}` in the JSX (a hint, not a hard height) but the CSS `max-height` won regardless, rendering ~5 visible rows with dead space below on a card that visually should have filled the viewport~~ — Fixed 2026-07-07: the draft editor's textarea gets an explicit `max-h-none` override (Tailwind class beats the element-selector base rule on specificity) plus `min-h-[55vh] flex-1`; `Card.tsx`'s body wrapper made unconditionally `flex-1` (inert elsewhere) so a `flex flex-col` `Card` genuinely stretches to match its CSS Grid row's height. The global 120px clamp itself was left in place — other small textareas (Mission Statement, etc.) still want it; this was a single-component override, not a global rule change.
33a. **Need-statement geo fallback is county→state only, not zip→county→state→national** (found 2026-07-08) — `need-statement-engine.ts:41-42` documents this itself in a code comment; no zip-level or national-level fallback exists in `census-api.ts`/`hud-api.ts`/`bls-api.ts`/`cdc-api.ts`.
33b. **CDC/SAMHSA labeling is wrong in `cdc-api.ts`** (found 2026-07-08) — `fetchSubstanceAbuseData()`'s comment claims "SAMHSA NSDUH state estimates" but the query hits CDC's own BRFSS alcohol-module Socrata dataset (`dttw-5yxu`), not any SAMHSA source. No real SAMHSA API integration exists anywhere in the codebase.
33. **`ColorIcon` categorical hue system added** (`src/components/ui/ColorIcon.tsx`) — cyan/emerald/blue/amber/violet/indigo/rose, one per function (opportunities, money, documents, deadlines, analytics, applications, alerts). Uses raw Tailwind hue classes including violet/rose, a deliberate, documented exception to the intensity pass's "no purple/violet brand accents" rule — these are nominal/categorical colors for icon-chip scanning, not brand accents. Applied to dashboard `MetricCard`s (+ matching `border-l-4`), `TemplateSelector`'s 6 template cards, Research's 9 source cards, and Intelligence Library's 5 stat tiles. Not yet applied anywhere else in the app — a future consistency sweep could extend it, but wasn't asked for beyond these four surfaces.

---

## ENVIRONMENT

- **Stack:** Next.js 14, Supabase, Vercel Pro, TypeScript 5.6, pnpm 9.0
- **Key dependencies:** `@anthropic-ai/sdk ^0.30.1`, `openai ^6.44.0` (Gemini), `@supabase/supabase-js ^2.45.4`, `stripe ^22.2.0`, `resend ^6.12.4`, `googleapis ^173.0.0`, `playwright ^1.60.0`, `@react-pdf/renderer ^4.1.1`
- **Supabase project:** vbjplpquqxxfbpazyalt (105 tables, migrations 001–066 applied)
- **Vercel:** benavora.vercel.app (Pro), 5 configured crons
- **Platform owner:** info@faithfoundation.org (bootstrapped, bootstrap endpoint now self-disabled)
- **Auth model:** profiles + owner/admin/writer/viewer roles (contracts reference admin/member/viewer — that is aspirational, not the live model)
- **Tests (2026-07-06):** Vitest passing (`.env.test` added for secrets; compliance + logic-model tests fixed). tsc --noEmit 0 errors. pnpm build clean. Playwright: 27 passing before this session's selector fixes; ~40+ additional fixes applied (dashboard labels, deadlines Month button, documents upload zone, pipeline kanban switch, onboarding wizard text, automation autoapply page, research Command Center, ui-redesign sidebar items). Security page added at `/security` with marketing nav link.
- **New files (2026-07-06):** `.env.test` (Vitest secrets), `src/app/(marketing)/security/page.tsx`
- **Brand tokens (2026-07-07):** `tailwind.config.ts`'s own color/gradient/shadow definitions (previously still the old dark purple/emerald/teal-green theme underneath the `globals.css` compat layer) rewritten to the live navy `#0077B6` / cyan `#00B4D8` brand — `accent`/`cta` tokens, the legacy `teal` and `plum` 50–950 scales, `gradient-accent`/`gradient-brand`/`gradient-cta`/`gradient-purple`, and `shadow-glow`/`glow-accent`/`glow-blue`. Root layout: dropped `className="dark"` from `<html>`, `themeColor` `#0a0a1a→#0077B6`. tsc --noEmit clean; pnpm build clean.
- **Self-hosted fonts (2026-07-07):** `next/font/google` fetches Inter/JetBrains Mono from `fonts.googleapis.com` at build time, which times out in this environment. Replaced with `next/font/local` in `src/app/layout.tsx`, sourcing latin variable-weight woff2 files copied from the `@fontsource-variable/inter` and `@fontsource-variable/jetbrains-mono` packages into `public/fonts/`. Same `--font-sans`/`--font-mono` CSS variables and weight ranges preserved — no other file changed. `pnpm run build` now completes with zero external font network requests.

## VERCEL CRON SCHEDULE

| Route | Schedule |
|---|---|
| /api/cron/research | 0 6 * * * (daily 6am) |
| /api/cron/reminders | 0 8 * * * (daily 8am) |
| /api/cron/campaigns | 0 */2 * * * (every 2h) |
| /api/cron/autoapply | 0 2 * * * (daily 2am) |
| /api/cron/domain-warmup | 0 6 * * * (daily 6am) |

Note: vercel.json applies a global maxDuration=60 to `api/agents/**` — individual routes that need 300s override this with `export const maxDuration = 300`. All AI-calling routes have been verified to set 300s. `api/ai/**` routes get 300s from the global config. `api/cron/**` routes get 120s from the global config.

## Production Sync 2026-07-09 14:19
- Migrations 067-074 ALL applied to production Supabase (vbjplpquqxxfbpazyalt) via Management API
- Commit 03cb3ab pushed: DD Phases 2+3, enrichment pipeline, onboarding soft-gate (11/11 FORGE gates)
- NOT YET RUN: pnpm seed:dd-taxonomy, pnpm enrich:990, pnpm enrich:web, DATAOCEAN backup, DD smoke test
- Railway status of 03cb3ab UNVERIFIED; RESEND_API_KEY still unset on both platforms

## Donor Discovery taxonomy aliases added (this session, later same day) — NOT synced to prod
- Migration 075 (`donor_discovery_taxonomy_aliases`), `scripts/seed-dd-aliases.ts`, and
  `/api/donor-discovery/taxonomy/search` created. Gate run: `pnpm tsc --noEmit` only (0 errors).
- NOT done: migration 075 not applied to prod, `pnpm seed:dd-aliases` not run, no
  `pnpm run build`/`pnpm lint`/Playwright pass for this change, wizard UI not wired to the new
  search route.

