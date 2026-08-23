# BENAVORA MARKETING SITE BLUEPRINT

Version 1.1 - 2026-08-21
Status: DRAFT v1.1 - design direction approved; pending Section 10 dates
Scope: public marketing, education, and demo-funnel layer. Zero changes to platform features, data model, or agents.
Governance: this document is the FORGE source of truth for all `(marketing)` route group work. FEATURE_REGISTRY_v2.md and BLUEPRINT_v2.md continue to govern the application.

---

## 1. Objective

Build a multi-page, interactive marketing and education site that funnels visitors to a booked demo or a sign-up by showing, not describing, what the platform does. The measure of success is demo bookings per unique visitor, not page count.

Non-goals for v1: customer logos, testimonials, case studies, press (deferred until two external paying orgs consent to be named), integration detail pages, careers.

## 2. Architecture decisions (binding)

| ID | Decision | Rationale |
|---|---|---|
| M-001 | Marketing site stays in the benavora repo under `src/app/(marketing)/` | At 22 pages the build cost is seconds; keeps recordings, fixtures, and screenshots beside the code that produced them |
| M-002 | Content separated from code: one MDX file per page under `content/marketing/` | Copy edits never require a code change; FORGE generates pages from templates |
| M-003 | Interactive demos run on frozen fixtures and recorded event streams, never live AutoApply, draft generation, or scraping | Anonymous visitors must never trigger real submissions under Faith Foundation identity; zero per-view API cost |
| M-004 | Two live backend surfaces only: chatbot (`/api/public/assist`) and demo booking | Everything else is client-side |
| M-005 | Chatbot is one knowledge service, two surfaces: public (corpus only, demo CTA) and in-app (corpus + tenant tool calls) | Same embeddings and retrieval; different system prompt and permission scope |
| M-006 | Corpus lives in a dedicated `knowledge` schema in the Benavora Supabase project, pgvector, RLS deny-all for tenant roles, read via service role only | Public traffic never touches tenant schemas |
| M-007 | Every corpus document carries `rights` = `host`, `index`, or `link`; chatbot retrieval answers only from `host` and `index`; public library pages render `host` inline and `link` as curated link + original summary | One tag per row, decided at seed time, enforced in code |
| M-008 | App shell untouched; marketing uses its own theme tokens | Product UI and marketing are different moods on purpose |
| M-009 | All colors inline `style={{}}` hex | globals.css compatibility layer overrides Tailwind color classes and CSS vars (standing constraint) |
| M-010 | Zero emoji. ASCII-only source files | Standing constraint |

## 3. Design direction (APPROVED 2026-08-21 - "Forest and paper")

Deliberately distinct from the application's navy/gold/bronze system. The gold wordmark is the only shared element.

Marketing theme tokens (new file `src/lib/marketing/theme.ts`, exported constants, consumed as inline hex):

| Token | Hex | Use |
|---|---|---|
| `forest` | `#1F3A2E` | Hero band, footer, H1/H2, primary text on light |
| `sage` | `#8FA68E` | Secondary buttons, icons, dividers on forest |
| `paper` | `#F7F5EF` | Page background |
| `surface` | `#FFFFFF` | Cards, panels |
| `terracotta` | `#B85A2E` | Primary CTA only, active-nav underline |
| `terracottaHover` | `#A9532C` | CTA hover |
| `ink` | `#2B2B28` | Body text |
| `muted` | `#6F6F69` | Captions, secondary text |
| `line` | `#DDD8CC` | Borders, dividers |
| `tint` | `#E8EDE6` | Alternating section background |
| `heroText` | `#F7F5EF` | Text on forest |
| `heroMuted` | `#B9C8B8` | Secondary text on forest |
| `wordmarkGold` | `#B88A2E` | Logo only - never used elsewhere on marketing pages |

Section differentiation is by layout and tint alternation (`paper` / `tint` / `surface`), not by per-section hue. One accent (terracotta) sitewide; no app action colors on marketing pages.

Typography: serif display face for H1/H2 (Fraunces via `next/font/google`, fallback Source Serif 4); existing sans for body and UI. Product screenshots keep their native dark app shell and sit on `surface` cards with a 1px `line` border and 24px radius; the contrast between forest marketing chrome and navy app screenshots is intentional - it reads as "the product lives inside."

Homepage hero: `forest` band, top 640px, carrying the wordmark, headline, AutoApply replay, and three doors; everything below is `paper`.

Nav: sticky, `paper` background with 1px `line` bottom border, `forest` text, terracotta underline on active; Sign In (ghost) and Book Demo (terracotta) pinned right. Nav is light so the gold wordmark sits on paper, not on forest.

Contrast check required in mkt-00 gate: terracotta on white >= 4.5:1 for 14px text, heroMuted on forest >= 4.5:1, ink on paper >= 7:1.

2026-08-22 (mkt-003): `scripts/marketing/contrast-check.mjs` measured the original `terracotta` (`#C4663A`) on `surface` at 3.96:1, below the 4.5:1 gate. Darkened in 4-unit-per-channel steps to `#B85A2E` (15 steps), which measures 4.63:1 and passes. No other token was changed. See `test-evidence/marketing/mkt-003/contrast.json` for the full measured table.

## 4. Information architecture (22 pages, v1)

```
/                                   Home (gateway)
/platform                           Platform overview + mega-menu landing
/platform/funding-intelligence
/platform/opportunity-discovery
/platform/ai-grant-writer
/platform/autoapply
/platform/pipeline-crm
/platform/analytics
/how-it-works                       Funding Lifecycle explorer (11 stages, one page)
/agents                             Ten agent families + human-in-the-loop controls
/solutions                          Solutions landing
/solutions/faith-based
/solutions/human-services
/solutions/housing
/solutions/veterans
/solutions/education
/solutions/community-development
/why-benavora                       Manual vs autonomous comparison
/trust                              Security, governance, human approval, audit, provenance
/pricing                            Plans + ROI calculator
/company                            About, mission, responsible AI, contact
/resources                          Library shell + chatbot + (Phase B) tools
/demo                               Book a demo
```

Redirects: existing `(marketing)` routes map 1:1 or 301 to the nearest new page. `/login`, `/signup`, `/onboarding` unchanged.

## 5. Page templates

### 5.1 Platform page template (6 instances)

1. Hero: H1, one-sentence outcome, primary CTA (Book Demo), secondary CTA (See it run)
2. Interactive: the page's demo component (Section 6)
3. Problem solved: 3 short blocks, the manual way vs this
4. Key capabilities: 5 items, each one line, no marketing adjectives
5. How the AI works: 3-step diagram, names the agent family and the human control point
6. Sample output: rendered from fixture, expandable
7. Related capabilities: 3 cards linking across Platform pages
8. FAQ: 5 questions, sourced from real objections
9. CTA band

### 5.2 Solutions page template (6 instances)

1. Hero: org type named in H1, the funding types that matter most to them
2. The three funding problems this org type actually has
3. Which platform capabilities answer each (links)
4. A sample opportunity list for this org type (fixture, 8 rows)
5. Sample draft excerpt for this org type (fixture)
6. FAQ, CTA

### 5.3 Single pages

How It Works, Agents, Why Benavora, Trust, Pricing, Company, Resources, Demo each have a bespoke layout specified in `content/marketing/<slug>.mdx` front-matter with `layout:` key.

## 6. Interactive components (the wow layer)

| ID | Component | Page(s) | Data source | Live backend |
|---|---|---|---|---|
| IX-01 | AutoApply Replay | Home, /platform/autoapply | Recorded event stream JSON from a real Faith Foundation run; 60-90s loop; scrubbable; click any step to see what the agent read and the value chosen | No |
| IX-02 | Draft Generator Theater | /platform/ai-grant-writer | 4 frozen drafts for 4 real opportunities; token-stream animation; section citations expand | No |
| IX-03 | Opportunity Analysis | /platform/opportunity-discovery, /platform/funding-intelligence | Visitor picks 1 of 6 sample orgs (or enters an EIN that maps to a fixture); eligibility scoring and ranked list assemble | No |
| IX-04 | Funding Lifecycle Explorer | /how-it-works, Home strip | 11 stages; each reveals agent family, human gate, live-app screenshot | No |
| IX-05 | Agent Explorer | /agents | 10 families; inputs, tasks, outputs, governance gate | No |
| IX-06 | Pipeline Walk-through | /platform/pipeline-crm | Real 6-stage funnel with real (org-scoped) counts frozen at capture; click a stage | No |
| IX-07 | ROI Calculator | /pricing | Visitor inputs; client math | No |
| IX-08 | Assist (chatbot) | All pages, floating | `/api/public/assist` | Yes |
| IX-09 | Book a Demo | /demo, CTA bands | Calendar embed | Yes |

Fixture capture: one CC session records IX-01 and IX-06 from production as Faith Foundation using the magic-link Playwright pattern, exports JSON + PNG to `public/demo/`. IX-02 and IX-03 fixtures are generated once from the real draft and scoring endpoints and frozen. Fixtures are versioned; a `fixtures.json` manifest carries capture date and commit SHA.

IX-01 event stream schema:

```
{ "run_id", "opportunity", "captured_at", "app_sha",
  "steps": [ { "t_ms", "kind": "navigate|read|fill|select|validate|review|submit",
               "selector_label", "value_shown", "rationale", "screenshot" } ] }
```

## 7. Knowledge service (Benavora Assist)

### 7.1 Schema (`knowledge` schema, Benavora Supabase)

```
knowledge.sources      id, name, publisher, tier, rights(host|index|link), license_note, url, topics text[], format, added_at
knowledge.documents    id, source_id, title, canonical_url, storage_path (host only), sha256, fetched_at, status
knowledge.chunks       id, document_id, ordinal, content, token_count, embedding vector(1536), metadata jsonb
knowledge.queries      id, surface(public|app), org_id null, question, answer, chunk_ids uuid[], created_at
```

RLS: all four tables deny for `authenticated` and `anon`; accessed only via service role from the API route.

### 7.2 Ingestion pipeline (one command)

`pnpm run knowledge:ingest` reads `content/knowledge/CORPUS_SEED.yaml`, fetches `host` documents to Supabase Storage bucket `knowledge-host`, fetches `index` documents to a temp dir, chunks at ~800 tokens with 120 overlap, embeds, upserts by sha256 (idempotent), writes a run report to `test-evidence/knowledge/ingest-<date>.json`. `link` rows are inserted into `sources` only.

### 7.3 Retrieval and answer

Hybrid: pgvector cosine top-20 + Postgres full-text top-20, reciprocal rank fusion, top-8 to the model. Public surface: system prompt restricts to corpus, cites source title + URL on every claim, refuses legal/tax determinations with a pointer to the source document, ends with a contextual CTA at most once per session. In-app surface: adds tool calls to the tenant's opportunities, deadlines, drafts, and pipeline, scoped by org_id through the existing authenticated routes.

Model routing: haiku-class for query rewriting and CTA decision, sonnet-class for answers. Budget guard: per-IP 30 questions/day on public surface, Upstash-style counter in Supabase.

### 7.4 Seed corpus tiers

| Tier | Rights | Examples | Public library | Chatbot |
|---|---|---|---|---|
| 1 Government / public domain | host | IRS pubs 557, 4220, 4221-PC/PF, 598, 1771, 561, 526, 1828, 4302; Grants.gov 101, lifecycle, quick start, eligibility, terminology, policies, reporting, fraud; SAM.gov assistance listings; USAspending; FAC; State Dept NGO Handbook; federal agency grant guides (HUD, NIH, HHS, ED, DOJ, USDA RD, FEMA, AmeriCorps, EDA, NEA); Census, ACS, BLS, HUD User/Exchange, CDC, County Health Rankings, Data.gov | Inline | Yes |
| 2 Open-licensed | host | Intro to the Nonprofit Sector (CC BY-NC), OpenStax, LibreTexts, Open Textbook Library selections, FEP public-domain tools | Inline with attribution | Yes |
| 3 Associations and research | index | NCN, AFP ethics resources, Independent Sector Principles, BoardSource, Council on Foundations, GPA, FEP reports, GivingTuesday Data Commons, Urban Institute/NCCS, CEP, Bridgespan, SSIR, TechSoup, Candid Learning, NonprofitReady, Nonprofit Learning Lab guides | Curated link + original summary | Yes |
| 4 Vendor / competitor | index | Bloomerang, Neon One, Donorbox, Givebutter, Funraise, Qgiv, DonorDock, Double the Donation | Not listed | Yes (knowledge only, never cited by vendor name) |

`CORPUS_SEED.yaml` row format:

```
- name: IRS Publication 557
  publisher: Internal Revenue Service
  tier: 1
  rights: host
  url: https://www.irs.gov/pub/irs-pdf/p557.pdf
  format: pdf
  topics: [formation, tax-exempt-status, compliance]
```

## 8. Resources / Benavora University (Phase B detail)

Public library shell ships in Phase A with Tier 1-3 browsable by topic and format. Phase B adds original tools, each a React page with no backend, each ending in an optional "save to your workspace" handoff:

Priority order by search demand x build cost: grant-readiness checklist, donor-retention calculator, grant-win-rate calculator, cost-to-raise-a-dollar calculator, gift-range chart, grant budget builder, logic-model builder, capital-campaign pyramid, Census evidence generator (uses Census API, read-only, cached), fundraising calendar generator.

Glossary and guides: generated through the Tarritrix programmatic-SEO engine rather than a second pipeline; scoped in Phase C.

## 9. FORGE queue plan

Queue files at `C:\Users\manag\Documents\FORGE\projects\benavora\queue-mkt-<nn>.yaml`, flat `prompts:` list, one queue per row, each gated on `pnpm run build` exit 0 and a Playwright smoke that renders every route in the queue with zero console errors and getComputedStyle evidence for theme tokens.

| Queue | Scope | Gate evidence | Status |
|---|---|---|---|
| mkt-00 | Theme tokens, marketing layout shell, nav + mega-menu, footer, MDX loader, route skeletons for all 22 pages, redirects from old routes | All 22 routes 200; nav computed styles; contrast ratios from Section 3 | **COMPLETE** - commit `e8639632bc65bc0e2802c1d7329ea75a5b5a3be0`, evidence `test-evidence/marketing/mkt-001-inventory.md`, `test-evidence/marketing/mkt-001/` |
| mkt-01 | Fixture capture session: IX-01 and IX-06 recorded from prod as Faith Foundation; IX-02/IX-03 fixtures generated and frozen; `public/demo/fixtures.json` | Files present, schema-validated | NOT STARTED - queue prompt `mkt-005` staged at `C:\Users\manag\Documents\FORGE\projects\benavora\queue-mkt-01-fixtures-20260822.yaml`, deliberately not armed (see Section 13 / SESSION_STATE.md - blocked on the discovery grantmaker run producing real prospects first) |
| mkt-02 | IX-01 AutoApply Replay component + Home page | Replay loops, scrub works, zero network calls in Playwright HAR | NOT STARTED |
| mkt-03 | Platform template + 6 platform pages with IX-02, IX-03, IX-06 | 6 routes, each demo renders, HAR shows no app API calls | NOT STARTED (note: the home-page rewrite that also carries the `mkt-003` queue id, `64bd13e5db33b00c9a93ba985000dff5eaebd5be`, is the Home/Forest-and-paper rewrite, not this platform-template row) |
| mkt-04 | IX-04 Lifecycle Explorer + /how-it-works; IX-05 Agent Explorer + /agents | Interaction smoke | NOT STARTED |
| mkt-05 | Solutions template + 6 solutions pages | 6 routes | NOT STARTED |
| mkt-06 | /why-benavora, /trust, /company, /pricing with IX-07 | 4 routes | NOT STARTED |
| mkt-07 | Knowledge schema migration, ingestion script, CORPUS_SEED.yaml Tier 1-2, first ingest run | Ingest report, chunk count, RLS test | **COMPLETE** - commit `8df79025773f2215c88016dc362f61d73f7bdc33`, evidence `test-evidence/knowledge/knw-001-verify.txt`; corpus + ingestion pipeline landed in a follow-on commit `f5bea0a69b31a92ce8d366fcbb6f539883870710`, evidence `test-evidence/knowledge/knw-002-verify.txt`, `test-evidence/knowledge/ingest-20260822-1735.json`. Idempotent re-run confirmed 2026-08-22 with 0 new embeddings / 0 new failures beyond the 13 already-recorded (`test-evidence/knowledge/ingest-sync.log`, `test-evidence/knowledge/ingest-20260822-2225.json`). |
| mkt-08 (Assist) | `/api/public/assist` + IX-08 floating widget on all marketing pages; in-app surface wiring behind existing auth | Public answers cite sources; tenant tool calls org-scoped (vitest) | **COMPLETE (public surface), LIVE DEFECT FOUND** - commit `512e87431c82975d6c9b92e55b0157f33245f37b`, evidence `test-evidence/knowledge/knw-003-verify.txt`, `test-evidence/knowledge/knw-003/resources-inline-assist.png`, unit tests in `src/__tests__/unit/knowledge-assist.test.ts` (14/14 passing). Live-verified against production 2026-08-22/23: `POST https://www.benavora.com/api/public/assist` returns HTTP 500 - Vercel prod was missing `DATABASE_URL` (fixed live this session) and, after that fix, `src/lib/knowledge/db.ts`'s direct-Postgres connection to `db.<ref>.supabase.co:5432` cannot resolve from Vercel's serverless runtime (IPv6-only host, no outbound IPv6 route) - unresolved, needs the Supabase pooler connection string. Full root-cause writeup: `test-evidence/marketing/mkt-004/live-assist-root-cause.md`; error screenshot `test-evidence/marketing/mkt-004/resources-assist-error.png`. In-app tool-calling surface (`answerApp`, `src/lib/knowledge/tools.ts`) is present in the working tree but uncommitted as of this session - out of this session's scope, left untouched. |
| mkt-09 | /resources library shell, /demo booking, sitemap, OG images, analytics events on every CTA | Lighthouse SEO >= 95, sitemap valid | NOT STARTED (note: `/resources` and `/demo` route shells already exist from mkt-00/mkt-02 content work; this row is the dedicated library/booking/SEO polish pass) |
| mkt-10 | Live smoke on www.benavora.com after `npx vercel deploy --prod`; screenshots of all 22 pages; register rows for any defect | 22/22 PASS evidence | PARTIAL - `npx vercel deploy --prod` run 2026-08-22/23 (deployment `dpl_Gk4bE3TNbjPNA5eB4xemsX3aDd5b`); `scripts/marketing/smoke-routes.mjs` against production reports 23/23 (nav.ts now lists 23 routes, one more than this section's original count of 22); full per-page screenshot pass and defect-register rows not yet done - see `test-evidence/marketing/mkt-004/` for the subset captured this session |

Pre-launch sync and launch commands are the canonical ones in memory. `CLAUDE.md` gains a "Marketing layer" section pointing to this blueprint and M-001..M-010.

## 10. Phasing and dates

| Phase | Queues | Gate to start |
|---|---|---|
| A | mkt-00 to mkt-06, mkt-09, mkt-10 | Open P0s closed and migration-drift batch applied (estimated 3-5 CC sessions) |
| A' (parallel-safe) | mkt-01 fixture capture, mkt-07 knowledge ingest | Can run during P0 work; no app code touched |
| B | Tools (Section 8), mkt-08 in-app surface polish | Phase A live |
| C | Glossary/guides via Tarritrix, integration detail pages, customers section | Two external consenting customers |

Target dates: TBD - Reid to supply investor demo / first external onboarding date.

## 11. Copy standards

- No unverifiable claims. Any number on the site traces to a fixture, a register row, or a public source.
- No adjectives doing the work of evidence ("powerful", "seamless", "revolutionary" are banned).
- Capabilities described as what happens, in present tense: "Reads the NOFO, scores eligibility on 14 criteria, flags the two you fail."
- Human control named on every page that shows an agent acting.
- FAQ answers under 80 words.

## 12. Measurement

Events: `cta_demo_click`, `demo_booked`, `replay_started`, `replay_scrubbed`, `replay_step_opened`, `draft_theater_started`, `assist_opened`, `assist_question`, `assist_cta_shown`, `resource_opened`, `tool_completed`, `tool_saved_to_workspace`. Weekly funnel: visitor -> interactive engaged -> assist or tool -> demo click -> booked.

## 13. Open items for Reid

1. (Closed) Design direction approved: Forest and paper.
2. Supply target dates for Section 10.
3. Confirm the six org types in Section 4 are the six you want first.
4. Confirm calendar provider for IX-09 (Cal.com, Calendly, or Google Calendar appointment schedule).
5. Decide whether the in-app Assist surface ships with Phase A or B.

---

Supersedes: none. Referenced by: CLAUDE.md (Marketing layer section, to be added in mkt-00).
