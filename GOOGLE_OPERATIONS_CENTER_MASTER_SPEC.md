# GOOGLE OPERATIONS CENTER — MASTER PLANNING DOCUMENT
**Status: PLANNING ONLY — no code, no schema applied, no agents built. This document exists to be reconciled against the live Tarritrix repo before any implementation begins.**

**Governing principle, inherited directly from the source specification and treated as non-negotiable throughout this document:** Tarritrix must never represent Google-API-sourced data as more complete than Google actually provides, and must never label a Tarritrix-native substitute (crawl, sample, or estimate) as if it were a direct Google feed. Every module below is tagged **[GOOGLE API]**, **[TARRITRIX-NATIVE]**, or **[HUMAN WORKFLOW]** for exactly this reason.

---

## PART 1 — PRODUCT REQUIREMENTS DOCUMENT

### 1.1 Vision
The Google Operations Center is not a mirror of Google Search Console and Google Business Profile's own interfaces. It is the canonical data and control layer sitting above every other layer of Tarritrix — the system every agent, dashboard, and client report ultimately draws from for "is this real, is this current, is this ours." Per the source spec's own framing, this becomes one of the platform's highest-order functions: the thing that determines whether a page, a lead, a review, or a ranking change is even attributable to a specific client/location in the first place.

### 1.2 Scope
1. **GSC Control Center** — property administration, Search Performance data (clicks/impressions/CTR/position across every supported dimension), Query Intelligence, Page Intelligence, URL Inspection/Indexing Operations, Sitemap Operations, and explicit Tarritrix-native substitutes for the reports Google does not expose via API (Page Indexing, Core Web Vitals, HTTPS, structured-data enhancements, manual actions/security issues, Links).
2. **GBP Operations Center** — account/access management, the Location Master Record, Profile Completeness scoring, a Location Edit Control Panel with mandatory approval workflow, Category/Attribute Intelligence, Performance Analytics (the full daily metric family), Review Management, Posts, Media (including the mobile photo-capture requirement), Q&A, Verification/Status/Duplicate management, and Pub/Sub notification ingestion.
3. **Unified Entity Graph** connecting Client → Brand → Domain → GSC Property → GBP Account → GBP Location → Physical Address → Service Area → Website URL → Landing/Location/City/Service Page → Tracking Phone Number → GA4 Property → Schema Entity → Review → Post → Query → Lead. This is explicitly called out as essential infrastructure, not a nice-to-have — without it, Tarritrix cannot reliably attribute any signal to the correct client/location.
4. **Next Best Action Engine** — the prioritized, continuously-issued recommendation layer sitting on top of all the above.

### 1.3 Explicit Non-Goals (stated directly in the source spec, preserved here as hard constraints)
- Tarritrix must **not** promise "Request Indexing" as an automatable action — the API does not expose it. Deep-link to Search Console + human workflow only.
- Tarritrix must **not** claim direct API access to Page Indexing, Video Indexing, Core Web Vitals (Search Console's version), HTTPS report, Manual Actions, Security Issues, or Links report — none of these are exposed via API. Tarritrix-native substitutes only, clearly labeled as such.
- Tarritrix must **not** promise access to Google Business Profile message history or call history — **Google discontinued GBP chat and call-history features in July 2024.**
- Tarritrix must **not** automate irreversible or high-risk GBP changes (business name, address, primary category) without explicit two-person approval.
- Tarritrix must **not** auto-publish AI-generated review responses for 1-2 star reviews or reviews alleging fraud, injury, discrimination, criminal activity, legal threats, privacy issues, employee accusations, or regulated-service complaints — human approval required, no exceptions.
- Tarritrix must **not** automatically interpret every abrupt metric change as an SEO event — Google's own data-anomalies record means some swings are Google-side reporting artifacts, not real signals. Anomalies must be annotated against known Google incidents before being surfaced as alerts.

### 1.4 Success Criteria
- Every clickable number in the Command Overview drills down: Portfolio → Client → Website/Property → Location → URL/Query/Review/Post/Task, with zero dead ends.
- Zero instances anywhere in the UI of a Tarritrix-native substitute being presented without its provenance tag.
- 100% of sensitive GBP changes (name, address, category) pass through two-person approval before reaching Google.
- Manual-action/security-issue human verification never lapses past its required cadence (weekly/monthly per the sync architecture) without triggering a critical incident.

---

## PART 2 — ARCHITECTURE

### 2.1 Integration Layer (three distinct data sources, never conflated)
| Layer | Source | Examples |
|---|---|---|
| **[GOOGLE API]** | Official Search Console API + Business Profile APIs (Account Management, Business Information, Performance, Posts, Reviews, Media, Q&A, Notifications, Verification) | Search Analytics, URL Inspection, Sitemaps, GBP Performance, Reviews, Posts, Media, Q&A |
| **[TARRITRIX-NATIVE]** | Tarritrix's own crawlers, PageSpeed/CrUX API, structured-data validators, backlink crawler, server-log analysis | Page Indexing substitute, Core Web Vitals (real, CrUX-based), HTTPS/mixed-content monitoring, structured-data validation, Links report substitute |
| **[HUMAN WORKFLOW]** | Operator-executed, Tarritrix-tracked case/evidence system, no API equivalent exists | Manual Actions, Security Issues, GBP verification/appeals, "Request Indexing" |

### 2.2 Unified Entity Graph
Canonical join keys, per the source spec's own list: Client, Brand, Domain, GSC Property, GBP Account, GBP Location, Physical Address, Service Area, Website URL, Canonical Landing/Location/City/Service Page, Tracking Phone Number, Primary Phone Number, Google Place/Location ID, GSC Property ID, GA4 Property, Google Ads Account/Campaign, Content Asset, Schema Entity, Review, Local Post, Query, Keyword Cluster, Conversion, Lead.

**This graph is a prerequisite, not a parallel workstream.** No GSC or GBP dashboard section can be built correctly until entity resolution exists — otherwise a click, a call, or a lead cannot be reliably tied to the right location.

### 2.3 Sync Architecture & Cadence (as specified)
- GBP notifications (Pub/Sub): near real-time
- GBP profile information: several times daily + event-driven after Pub/Sub events
- GBP reviews/Q&A: event-driven + reconciliation polling
- GBP performance: daily
- GBP search-keyword impressions: **monthly** (this is a real API constraint, not a Tarritrix choice — do not build a daily keyword chart)
- GSC Search performance: daily, with recent dates re-fetched (Google backfills late data)
- Sitemap status: daily
- URL Inspection: quota-aware priority queue, not blanket polling
- Technical crawling (Tarritrix-native): daily or weekly by page importance
- Manual-interface verification tasks: weekly/monthly/immediately-on-critical-alert

### 2.4 Notification Infrastructure
Google Cloud Pub/Sub topic (one topic/subscription per account, per Google's own constraint), webhook consumer service, dead-letter queue, idempotency keys, event replay, full audit log, reconciliation job to catch anything Pub/Sub missed.

### 2.5 Dashboard Navigation (supersedes the current prototype's flat section list — reconcile before next build pass)
Command Overview · Client/Location Selector · Organic Search Performance · Query Intelligence · Page Intelligence · Indexing & URL Inspection · Sitemap Operations · Technical Search Health · Business Profile Performance · Location Information · Categories & Attributes · Reviews · Q&A · Posts · Media · Verification & Profile Status · Alerts & Incidents · Recommendations & Tasks · Change Approval Queue · Google Account & Permission Administration · API/Quota/Sync Health · Audit Log · Client Reports.

---

## PART 3 — SCHEMA (Essential Database Domains)

All table names below are as specified in the source document. **These must be checked against SCHEMA_REGISTRY.md for naming collisions before any migration is written** — several likely overlap with existing tables (e.g., a `gbp_reviews` table may already exist under a different name tied to A-14 Review Velocity Engine).

**GSC domain:** `gsc_properties`, `gsc_permissions`, `gsc_search_analytics_daily`, `gsc_query_dimensions`, `gsc_page_dimensions`, `gsc_url_inspections`, `gsc_sitemaps`, `gsc_manual_check_attestations`

**GBP domain:** `gbp_accounts`, `gbp_locations`, `gbp_location_snapshots`, `gbp_categories`, `gbp_attributes`, `gbp_hours`, `gbp_special_hours`, `gbp_services`, `gbp_performance_daily`, `gbp_search_keywords_monthly`, `gbp_reviews`, `gbp_review_replies`, `gbp_questions`, `gbp_answers`, `gbp_posts`, `gbp_post_metrics`, `gbp_media`, `gbp_notifications`

**Shared/system domain:** `google_connections`, `google_accounts`, `google_api_requests`, `google_api_quotas`, `google_sync_runs`, `google_data_incidents`, `google_change_requests`, `recommendations`, `tasks`, `alerts`, `approvals`, `audit_events`

**Critical architectural requirement:** raw API payloads must be retained separately from normalized records, so Tarritrix can reprocess historical data if Google changes a schema or metric definition. Do not build a normalize-on-ingest-only pipeline that discards the raw response.

---

## PART 4 — BEHAVIORAL CONTRACTS (new, pending renumbering against live BEHAVIORAL_CONTRACTS.md)

**GOC-Contract-A — No False API Attribution.** Every data point in the UI must carry its provenance tag ([GOOGLE API] / [TARRITRIX-NATIVE] / [HUMAN WORKFLOW]). A Tarritrix-native substitute may never be styled or labeled identically to a direct Google feed.

**GOC-Contract-B — Two-Person Approval on Sensitive GBP Fields.** Business name, address, and primary category changes require two distinct approvers before submission to Google, regardless of operator tier or urgency.

**GOC-Contract-C — Sensitive Review Response Gate.** AI-drafted review responses must not auto-publish for 1-2 star reviews or any review alleging fraud, injury, discrimination, criminal activity, legal threats, privacy issues, employee accusations, or regulated-service complaints. Human approval required, no override.

**GOC-Contract-D — Manual Action / Security Issue Freeze.** Detection of a Manual Action or Security Issue on any client property immediately freezes automated publishing for that client and creates a critical incident. Resuming requires executive override with a documented remediation plan attached.

**GOC-Contract-E — Anomaly Annotation Before Alert.** Before any Search-performance anomaly is surfaced as an actionable alert, it must be checked against Google's own data-incidents record. Known Google-side reporting errors must be annotated, not treated as an SEO event.

**GOC-Contract-F — Quota-Aware Inspection Queue.** URL Inspection API calls are never issued as blanket/unthrottled polling. All inspection requests flow through the priority queue (Part 2.3) with quota budget enforcement and exponential backoff.

**GOC-Contract-G — Raw Payload Retention.** Every Google API response is archived in raw form before normalization, retained independently of the derived/normalized tables.

**GOC-Contract-H — No Overwriting Unrelated Fields.** All GBP location edits use field masks and conflict detection. A change to one field (e.g., hours) must never risk overwriting unrelated pending data (e.g., a Google-suggested edit to categories).

---

## PART 5 — AGENT DEFINITIONS (new; IDs are placeholders pending reconciliation against live AGENTS.md — several of these likely extend existing agents rather than requiring new ones)

**Reconciliation flag, read before assigning real IDs:** A-08 (Indexation Tracker) already has real GSC OAuth integration shipped. A-46 (Directory Registration) and A-47 (LLM Citation Tracker) already exist. A-14 (Review Velocity Engine) already covers some review-workflow ground. **Do not build duplicate agents — extend these first, and only assign new agent IDs for genuinely new capability.**

| Placeholder ID | Name | Data source | Core job |
|---|---|---|---|
| NEW-ENTITY | Google Entity Resolution Agent | Tarritrix-native, joins existing tables | Builds and maintains the unified entity graph (Part 2.2) — prerequisite for every other agent below |
| NEW-GSC-SYNC | GSC Sync Agent | [GOOGLE API] | Daily Search Analytics pull across all dimensions; likely an extension of A-08, not a new agent |
| NEW-GBP-SYNC | GBP Sync Agent | [GOOGLE API] | Daily performance pull, several-times-daily profile pull, Pub/Sub consumer |
| NEW-QUERY-INTEL | Query Intelligence Agent | [GOOGLE API] + derived | Classification, cannibalization detection, opportunity generation per Part 1's Query Intelligence spec |
| NEW-PAGE-INTEL | Page Intelligence Agent | [GOOGLE API] + [TARRITRIX-NATIVE] | Per-page alert conditions (impressions/clicks/position drops, indexing state changes, doorway-page risk) |
| NEW-URL-INSPECT | URL Inspection Queue Agent | [GOOGLE API], quota-aware | Manages the prioritized inspection queue per Contract F |
| NEW-SITEMAP-OPS | Sitemap Operations Agent | [GOOGLE API] | Submit/validate/compare-to-inventory, likely extends A-07 |
| NEW-GBP-REVIEW | Review Response Agent | [GOOGLE API], gated by Contract C | Drafts responses, routes sensitive reviews to human approval; likely extends A-14 |
| NEW-GBP-QA | Q&A Agent | [GOOGLE API] | Drafts answers, flags recurring questions as content opportunities |
| NEW-GBP-POST | Post Scheduling Agent | [GOOGLE API] | Internal scheduling engine (Google does not natively schedule all post types) |
| NEW-MEDIA-INGEST | Media Ingestion Agent | [GOOGLE API] upload + mobile capture pipeline | Handles the mobile photo-capture workflow discussed separately; quality/duplicate/resolution checks before upload |
| NEW-PUBSUB | Notification Consumer Agent | [GOOGLE API] Pub/Sub | Webhook consumer, idempotent event processing, reconciliation |
| NEW-NBA | Next Best Action Engine | Derived, cross-domain | Priority-scored recommendation generation per Part 1.4's formula |
| NEW-MANUAL-VERIFY | Manual Verification Task Agent | [HUMAN WORKFLOW] | Tracks Manual Actions/Security Issues human-check cadence, triggers Contract D freeze |
| NEW-TECH-CRAWL | Technical Search Health Agent | [TARRITRIX-NATIVE] | Page Indexing substitute, HTTPS/mixed-content monitoring, structured-data validation |

---

## PART 6 — OPEN RECONCILIATION ITEMS (must be resolved by CC against the live repo before any build queue is written)

1. Confirm whether `gbp_reviews`/similar tables already exist under different names tied to A-14.
2. Confirm current highest agent ID and Contract number — do not assume A-4X/Contract-9X ranges are free.
3. Confirm A-08's actual current scope — does it already cover any of NEW-GSC-SYNC's responsibilities?
4. Confirm whether a Pub/Sub topic/GCP project already exists (ties to the still-open GBP API access question from earlier this session).
5. This entire document assumes GBP API access is eventually granted — none of Part 5's [GOOGLE API]-tagged agents can move past architecture until that access is confirmed.

---

**This document is planning only.** Next step, when you're ready: confirm the reconciliation items in Part 6, then this becomes a real CC prompt sequence — entity graph first (it's the dependency root), everything else after.
