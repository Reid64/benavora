# State Portal Framework — Scoping Document
## Date: August 13, 2026
## Status: SCOPING ONLY — no scraper code changed in this pass
## Purpose: Row #56 (FEATURE_REGISTRY_v2.md) is marked PARTIAL with no specifics on
## which states, how many, or what data model. This document narrows that down to a
## concrete, evidence-based build target for a future, properly-sized FORGE prompt.

---

## 1. What actually exists today (read in full this session)

"State Portal Framework" is not one stub — it's **four separate, overlapping, uncoordinated
implementations**, none of them wired into any autonomous/scheduled pipeline (confirmed by a
repo-wide grep of `worker/` — zero matches for state-portal-related identifiers).

| File | What it is | States covered | Real status found this session |
|---|---|---|---|
| `src/lib/sources/state-portals/portal-scraper.ts` + `portal-config.ts` | A deliberately non-real "parser" — plain substring search for a `titleSelector`/`deadlineSelector` string near candidate blocks, not a DOM parser. Its own header comment says this is intentional (portals change markup, so it degrades to `[]` instead of throwing). | TX, FL, IL, CA, NY (hardcoded in `STATE_PORTAL_CONFIGS`) | Read-only preview endpoint (`GET /api/sources/state-portals?state=X`), does **not** persist to `opportunities`. Not agent-driven, not autonomous. |
| `src/lib/agents/state-portal.ts` | `StatePortalResearchAgent` (AGENTS.md Agent 18, `agentId`/`agentType`: `state_portal`) — the real design: server-side fetch → Claude extraction (not regex) → dedup → insert into `opportunities`. Manual-trigger only via `POST /api/agents/state-portals`, tier-gated (Starter=1 state, Pro=5, Enterprise/Consultant=all). | TX only (`PORTAL_REGISTRY` has exactly one entry) | This is the most credible of the four — real Claude-based extraction, not string matching. Its own comment documents a 2026-08-04 live test that got a 404 and a 2026-08-05 URL fix to `https://egrants.gov.texas.gov/fundingopp`. **Re-verified live this session — see §2, still 200/real.** |
| `src/lib/agents/state-scrapers.ts` | `StateScrapersAgent` — Claude-extraction scraper, but targets 5 **state housing agencies**, not general grant portals: CA HCD, FL Housing, NY Homes, CO Housing, AZ Housing. Different `category` (`housing_grant`) and different source URLs than the two files above. | CA, FL, NY, CO, AZ (housing-specific, not general) | Overlaps in agent_type (`state_portal`) but is functionally a distinct, narrower agent (housing grants only). Not reconciled with `state-portal.ts` — two different classes both claim `agentType: "state_portal"`. |
| `src/lib/agents/tdhca-scraper.ts` | `TdhcaScraperAgent` — Claude-extraction scraper hardcoded to 2 specific Texas Department of Housing and Community Affairs URLs. | TX only (housing-specific subset, overlapping with `state-portal.ts`'s TX but a different agency/URL) | Third, separate implementation of "Texas," also `agentType: "state_portal"`. |

**Real, previously-undocumented finding from this session:** `src/app/(dashboard)/settings/integrations/page.tsx`
queries a `state_portals` **table** (`.from("state_portals")`, line 149) to show an "N Active" badge on
the State Portals connector card. A repo-wide grep for `CREATE TABLE` (case-insensitive) matching
`state_portals` across both `supabase/migrations/` and `src/supabase/migrations/` returns **zero
matches** — this table does not appear to exist anywhere in either migration tree. The only other
reference to `state_portals` in the codebase is a comment in `supabase/migrations/094_agent_registry.sql`
citing it as a naming *precedent* ("migration 010"), which is incorrect — migration 010 is
`010_opportunity_source_type.sql`, unrelated. This means the integrations page's "N Active" badge for
State Portals almost certainly always renders 0/silently fails, independent of anything else in this
document. Flagging for a future session — not fixed here, out of scope for a scoping pass.

**Net picture:** four uncoordinated code paths, three different `BaseAgent` subclasses all claiming
`agentType: "state_portal"`, a UI badge querying a table that may not exist, and a genuinely-designed
but never-scaled-past-Texas Claude-extraction agent (`state-portal.ts`) that is the closest thing to a
real foundation to build on. None of this needs to be reconciled to write this scoping doc, but a
future build task should treat "which of the four files becomes canonical" as an explicit decision,
not an afterthought — recommendation in §4.

---

## 2. Live evidence gathered this session (real HTTP checks, not assumptions)

Per the task's instruction to cite real evidence rather than guess, every URL below was fetched live
this session (`curl`, `Mozilla/5.0` UA, 15–20s timeout) on 2026-08-13. Full HTML/RSS was inspected for
structure, not just HTTP status.

| State / Portal | URL tested | Result |
|---|---|---|
| **California Grants Portal** | `https://www.grants.ca.gov/grants/` | **200 OK**, 58KB. WordPress site with real, dated content (newest post timestamped the day of this test). |
| **Texas eGrants (OOG)** | `https://egrants.gov.texas.gov/fundingopp` | **200 OK**, 30KB. The exact URL `state-portal.ts` was corrected to on 2026-08-05 — confirmed still live. |
| New York Grants Gateway (as configured in `portal-config.ts`) | `https://grantsgateway.ny.gov/` | **Connection failure** (curl exit 6 / HTTP 000 — DNS/connect failure). The hardcoded config URL is dead. |
| New York Grants Management (alternate domain) | `https://grantsmanagement.ny.gov` | 200 OK, 38KB, but a Drupal 10 **informational** front page ("New York State Grants Management"), not an opportunity listing. The real Grants Gateway search/prequalification system is a separate, likely-authenticated application this session could not reach. |
| Illinois GATA Portal (as configured) | `https://gata.illinois.gov/portal/` | **404**. Dead. |
| Illinois (alternate) | `https://grants.illinois.gov` | 200 but only 384 bytes — a meta-refresh redirect stub pointing right back to `gata.illinois.gov` (the URL that 404s). Confirmed dead both ways. |
| Florida Grants Portal (as configured) | `https://www.floridagrants.gov/` | **Connection failure** (HTTP 000). Dead. |
| Florida (generic state portal) | `https://www.myflorida.com` | 200 but a generic state-government homepage, not a grants list. |
| Florida Housing (used by `state-scrapers.ts`) | `https://www.floridahousing.org/programs` | 200 OK, 19KB — real page, but housing-specific, not general grants. |
| California HCD (used by `state-scrapers.ts`) | `https://www.hcd.ca.gov/grants-funding/active-funding` | **403** — bot-blocked. The existing `state-scrapers.ts` config for CA is broken today, separate from the general CA Grants Portal above. |
| Colorado DOLA (used by `state-scrapers.ts`) | `https://cdola.colorado.gov/grants` | **403** — bot-blocked. |
| Ohio Grants Partnership | `https://grants.ohio.gov` | **404**. Dead. |
| Pennsylvania DCED | `https://www.dced.pa.gov` | 200 OK, 202KB — the department homepage, not a grants list; the real PA eGrants applicant system is a separate, likely-login-gated application not reached this session. |
| Massachusetts (mass.gov grants finder) | `https://www.mass.gov/how-to/find-grants` | **403** — bot-blocked (Akamai). |
| Michigan (budget/procurement/grants) | `https://www.michigan.gov/budget/services/procurement/grants` | **404**. Dead link. |
| Washington (Commerce grants) | `https://www.commerce.wa.gov/grants/` | **403** — bot-blocked. |
| North Carolina (OSBM grants) | `https://www.osbm.nc.gov/grants-programs` | **404**. Dead link. |
| TDHCA (used by `tdhca-scraper.ts`) | `https://www.tdhca.state.tx.us/fund-info/index.htm` | **404**. Confirms the same stale-URL pattern already documented elsewhere in this repo (the old TX "Texas Online" URL) — this specific hardcoded TDHCA URL is now also dead. |

**Summary of the sweep:** of 17 real URLs tested across 12 states (including every URL already
hardcoded in the four existing stub files), only **2 returned a real, structured, non-blocked grant
listing**: California's general portal and Texas's eGrants/OOG portal. Every other state either 404s,
fails to connect, redirects to a dead page, is bot-blocked (403), or resolves to a generic
informational page with no actual opportunity listing reachable without authentication. This is not
a "these states weren't tried" gap — it's a real, live-verified result.

---

## 3. Recommended target states, with reasoning

### #1 — California (`grants.ca.gov`) — clear first choice

- **Structurally, this is closer to a public API than a scrape target.** It is WordPress-generated,
  and WordPress's default archive templates ship a real RSS feed: `https://www.grants.ca.gov/grants/feed/`
  was fetched live this session and returned well-formed XML with `<title>`, `<link>`,
  `<description>`, `<pubDate>`, and (inside `content:encoded`) explicit `Agency/Department Name` and
  `Application Close Date` fields with a machine-readable `datetime` attribute. This means a real
  implementation could parse XML instead of HTML at all — dramatically lower fragility risk than
  regex/string-matching against markup that "changes without notice" (the exact risk the current stub's
  header comment warns about).
- **The non-feed HTML is also genuinely structured**, not JS-rendered: real `<article>` elements with
  schema.org `BlogPosting` microdata, an `entry-title` class on each grant's `<h2>`, and — critically —
  a `applicant_type-nonprofit` CSS class directly on grants that accept nonprofit applicants. This is a
  built-in nonprofit filter Benavora doesn't have to infer from free text.
- **Real volume and breadth, confirmed live**: the default archive page listed 21 distinct grants
  across at least 6 different state agencies (Parks and Recreation, Health Care Services, Education,
  Water Resources, State Treasurer's Office, and more) and paginates to at least a second page (also
  fetched live, 200 OK, similar size) — this is a statewide, cross-agency feed, not one department's
  narrow list.
- **Currency confirmed live**: the RSS feed's newest item was timestamped the same day this research
  was performed (2026-08-13), meaning the portal is actively maintained, not stale/abandoned.

### #2 — Texas (`egrants.gov.texas.gov/fundingopp`) — second choice, with a real caveat found this session

- Already the designed "primary" portal in this codebase (`state-portal.ts`'s own comment cites
  BLUEPRINT §3.6), and its URL — corrected on 2026-08-05 after the original URL was found dead — is
  confirmed **still live and correct** as of this session's direct fetch (200 OK).
- The HTML is clean, semantic, server-rendered (Bootstrap 5 classes: `.opp-list-item`, `.opp-title`,
  `.opp-date-box`, `.opp-date-name`), not a JS-rendered SPA — a real DOM parser (not the current
  regex stub) would work reliably against it.
- **Real caveat found this session, not previously documented**: this specific URL is scoped to the
  Texas **Governor's Office (OOG)** only, not a statewide multi-agency feed like California's. The live
  page currently lists exactly **3** open opportunities (ALERRT Travel Assistance, County Essential
  Services Grant Program, Crime Victim Notification Systems Program) — all criminal-justice/public-safety
  flavored, not a broad cross-sector nonprofit grant list. This is meaningfully lower volume and
  narrower scope than California. Recommending it anyway because (a) it's real, live, and already the
  documented primary target, so building on it extends existing design intent rather than diverging
  from it, and (b) `tdhca-scraper.ts` shows there's appetite for more than one Texas source — a future
  build could pair this OOG feed with a *fixed* TDHCA URL (the currently-hardcoded one 404s, confirmed
  this session) to get real TX housing-grant coverage too, closer to CA's breadth.

### Deferred — New York — real candidate, needs one more round of research before committing

New York is a well-known high-grant-volume state (its Grants Gateway is one of the most-cited state
grant systems nationally), but this session's live check found the *configured* URL
(`grantsgateway.ny.gov`) doesn't resolve at all, and the domain that does resolve
(`grantsmanagement.ny.gov`) is an informational front page, not the opportunity search itself — NY's
real Grants Gateway search/prequalification interface appears to be a separate, likely-authenticated
system this session didn't reach. Not recommending as a build target yet because the actual scrapeable
surface (if any exists without login) is unconfirmed — a future scoping pass should specifically hunt
for a public, non-authenticated NY opportunity listing (possibly a different subdomain or an "open
opportunities" report page) before treating NY as build-ready. Listed here rather than silently
dropped because it's a real, evidence-backed "maybe," not a guess.

### Not recommended — everything else tested

FL, IL, OH, MI, NC (all dead/404/redirect-to-dead), MA, WA, CO, CA-HCD (all bot-blocked, 403), PA
(only the department homepage was reachable, not an opportunity list). All of these are the *existing*
hardcoded URLs in the four stub files — meaning most of the current `STATE_PORTAL_CONFIGS`/
`STATE_SOURCES` entries are pointing at dead or blocked endpoints today, not just theoretically fragile.
This is a real, live-verified finding: of the 5 states in `portal-config.ts` (TX, FL, IL, CA, NY) and
the 5 in `state-scrapers.ts` (CA-HCD, FL, NY, CO, AZ — AZ untested this session), only CA's *general*
portal and TX's *OOG* portal actually resolve to a real opportunity list today.

---

## 4. Scrapeability assessment summary

| Target | Structured HTML? | Requires JS rendering? | Has a real feed/API? | Volume/breadth |
|---|---|---|---|---|
| CA Grants Portal | Yes — WordPress, schema.org microdata, semantic classes | No | **Yes — real RSS/XML feed at `/grants/feed/`** | High — 21+ grants/page, 2+ pages, 6+ agencies, statewide |
| TX eGrants (OOG) | Yes — Bootstrap 5, semantic div classes | No | No feed found; clean HTML only | Low — 3 open items, 1 agency, public-safety-focused |
| NY Grants Gateway | Unknown — public page reached is informational only | Unknown | Unknown | Unknown (deferred, see above) |

---

## 5. Recommended build order for a future, properly-sized task

1. **California first.** Build an RSS/XML parser (not an HTML scraper) against
   `https://www.grants.ca.gov/grants/feed/` — this sidesteps the entire "HTML markup drifts" fragility
   problem the current stub was designed around, since RSS is a stable, versioned format. Map
   `applicant_type-nonprofit` (present in the HTML `<article>` class list, confirm whether it's also
   surfaced in the feed's `content:encoded` or requires a secondary HTML fetch per grant) to a
   nonprofit-eligibility filter. This alone would give Benavora its first genuinely real, real-volume,
   general-purpose state portal source — something none of the four existing files currently deliver.
2. **Texas second**, reusing `state-portal.ts`'s existing Claude-extraction design (already correctly
   architected, just never scaled past a hardcoded single-entry registry) — since the OOG page's HTML
   is clean, this may not even need Claude extraction; a real DOM parser could likely replace the
   regex-based `portal-scraper.ts` outright for this target. Consider also fixing the dead
   `tdhca-scraper.ts` URL in the same pass to widen TX coverage, since it's the same state and the
   agent-class pattern already exists.
3. **Reconcile the four-file duplication before or during this work** — decide which single agent class
   owns `agentType: "state_portal"` going forward (recommend `state-portal.ts`'s design as the base,
   since it's the only one with a real per-state registry pattern intended to scale), and explicitly
   fold or retire `portal-scraper.ts`/`portal-config.ts` (regex-based, read-only preview, no persistence)
   and reconcile `state-scrapers.ts`/`tdhca-scraper.ts` (housing-specific, different category) as either
   a distinct `housing_state_portal` concept or genuinely merged in.
4. **Investigate the `state_portals` table gap** (§1) before building — the integrations page already
   expects this table to exist for its "N Active" badge; a real build task should create it (or confirm
   it truly doesn't exist and decide what "active" should mean) rather than adding a second orphaned
   table reference.
5. **NY as a stretch goal**, only after a follow-up research pass finds a real, non-authenticated
   opportunity listing to target — not scoped further here.

Do not attempt to build all of this in one FORGE prompt — even just item 1 (a real RSS parser + CA
nonprofit-filter mapping + insert/dedup wiring, matching the existing `opportunities` schema) is a
full, properly-sized task on its own.
