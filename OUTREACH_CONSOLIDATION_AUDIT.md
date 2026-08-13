# Outreach Consolidation Audit

**Date:** 2026-08-13
**Scope:** Read-only audit of three overlapping "outreach"-flavored systems in the benavora codebase — (1) Sales Outreach (admin platform tool), (2) Outreach (org-facing cold-outreach + campaigns), (3) Email (org-facing Gmail-integrated inbox + sequences). All file paths verified to exist via Glob/Grep. All DB table claims below were verified live against the real Postgres instance at `DATABASE_URL` (from `.env.local`) using a one-off Node script (`pg` client, `to_regclass`, `information_schema.columns`, `count(*)`), run and then deleted this session — nothing in this report is inferred from migration files alone.

---

## System 1: Sales Outreach

**Location:** admin platform area, gated to `owner`/`admin` roles at the page level (nav gates to `owner` only — see Nav Reachability below).

### Files
- `src/app/(dashboard)/admin/sales-outreach/page.tsx` — server component, role check (`checkPermission`) wrapper
- `src/app/(dashboard)/admin/sales-outreach/SalesOutreachClient.tsx` — the actual UI, 5 tabs (Campaigns / Domains / Prospects / Suppression List / Analytics)
- `src/app/api/admin/campaigns/route.ts`, `src/app/api/admin/campaigns/[id]/route.ts`
- `src/app/api/admin/domains/route.ts`, `src/app/api/admin/domains/[id]/route.ts`
- `src/app/api/admin/prospects/route.ts`, `src/app/api/admin/prospects/[id]/route.ts`, `src/app/api/admin/prospects/stats/route.ts`
- `src/app/api/admin/suppression/route.ts`, `src/app/api/admin/suppression/import/route.ts`
- `src/app/api/admin/sales-analytics/route.ts`, `src/app/api/admin/sales-analytics/export/route.ts`
- `src/app/api/admin/webhooks/email-events/route.ts`, `src/app/api/admin/webhooks/email-reply/route.ts` (Resend webhooks, write to `sales_sends`/`suppression_list`/`prospects`)
- Lib engines actually doing the DB work: `src/lib/admin/sales-campaign-engine.ts`, `src/lib/admin/prospect-manager.ts`, `src/lib/admin/domain-manager.ts`, `src/lib/admin/warmup-engine.ts`, `src/lib/admin/unsubscribe-agent.ts`

A source comment at the top of `SalesOutreachClient.tsx` explicitly documents that this page was rewritten to map onto four real route groups after a prior path-mismatch bug (consistent with prior-session history).

### Tables (all live-verified)
| Table | Exists | Row count | Notes |
|---|---|---|---|
| `sales_campaigns` | yes | **0** | |
| `sales_campaign_steps` | yes | **0** | |
| `sales_sends` | yes | **0** | |
| `sending_domains` | yes | **0** | |
| `prospects` | yes | **0** | |
| `prospect_lists` | yes | **0** | |
| `suppression_list` | yes | **0** | shared — see cross-system section |

**Every table this system owns is empty in production.** The UI, API routes, and lib engines are real and fully wired (confirmed by reading `sales-campaign-engine.ts`'s full send/step/suppression-check logic), but nothing has ever actually been created through them — no campaign, no sending domain, no prospect import, no suppression entry. This is a fully-built, never-used feature, not a stub.

### Nav reachability
**Reachable.** `PLATFORM_NAV_ITEMS` in `src/components/layout/nav-items.ts` includes `{ label: "Sales Outreach", href: "/admin/sales-outreach", icon: Megaphone }`. `Sidebar.tsx` renders `PLATFORM_NAV_ITEMS` only when `role === "owner"` (line 245), which is stricter than the page's own gate (`owner` OR `admin`) — an `admin`-role user could load the page by typing the URL but won't see it in the sidebar.

### Actual purpose (from reading the code)
A cold-email B2B sales tool for Benavora's own platform team (not for org customers) to prospect nonprofits: import prospect lists (CSV), configure warmed-up sending domains with per-domain daily limits and Resend API keys, run multi-step drip campaigns with a 24h step gap and daily-send caps, track opens/replies/bounces, and manage a global suppression list. Name matches purpose — it genuinely is "sell/recruit orgs onto the platform via email," distinct from the other two systems which serve an already-onboarded org's own outreach.

---

## System 2: Outreach

**Location:** org-facing dashboard, under `/outreach`, all roles per `requireRole("viewer")`/`("writer")` gates.

### Files
- `src/app/(dashboard)/outreach/page.tsx` — contact list ("Cold outreach contact list ... BLUEPRINT §4.11")
- `src/app/(dashboard)/outreach/campaigns/page.tsx`, `src/app/(dashboard)/outreach/campaigns/[id]/page.tsx`
- `src/app/(dashboard)/outreach/templates/page.tsx`
- `src/app/(dashboard)/outreach/sequences/page.tsx`
- `src/app/api/outreach/send/route.ts`, `src/app/api/outreach/sequences/route.ts`, `src/app/api/outreach/templates/route.ts`, `src/app/api/outreach/templates/[id]/variants/route.ts`, `.../[variantId]/route.ts`, `src/app/api/outreach/humanize-step/route.ts`
- `src/app/api/agents/outreach/route.ts` — "Agent 11" / Cold Outreach Agent trigger endpoint
- Lib: `src/lib/agents/cold-outreach.ts` (writes `outreach_contacts`), `src/lib/agents/humanizer-agent.ts` (reads/writes `outreach_contacts`), `src/lib/agents/funder-relationship.ts` (reads/writes `funder_relationship_scores`, `funders`; triggered best-effort after a send), `src/lib/billing/tier-enforcer.ts` (no DB table access), `src/lib/ai/claude.ts`
- Component: `src/components/outreach/OutreachContactTable.tsx`

### Tables (all live-verified)
| Table | Exists | Row count | Notes |
|---|---|---|---|
| `outreach_contacts` | yes | **1** | shared — see cross-system section |
| `email_campaigns` | yes | **1** | note: NOT `outreach_campaigns` despite the "Outreach" system name |
| `campaign_steps` | yes | **2** | |
| `campaign_sends` | yes | **1** | see cross-system section (unused hook from Email's `sender.ts`) |
| `followup_sequences` | **NO — does not exist** | n/a | see finding below |
| `outreach_templates` | yes | **0** | |
| `outreach_template_variants` | yes | **0** | |
| `knowledge_base` | yes | 53 | shared platform table, read-only for template variable resolution |
| `organizations` | yes | 128 | shared platform table |
| `funder_relationship_scores` | yes | 4 | written by Agent 23 trigger on send |
| `funders` | yes | 28 | shared platform table |

**Finding — broken feature:** `src/app/(dashboard)/outreach/sequences/page.tsx` and its backing `src/app/api/outreach/sequences/route.ts` both query `.from("followup_sequences")`. That table **does not exist** in the live database (`to_regclass('public.followup_sequences')` returns `null`). Every GET/POST to this route returns a 500 (`db_error`). The Outreach → Sequences nav item is live-linked and reachable but functionally broken end-to-end. This is a genuine bug, not a stale-doc issue — verified against the running route code and the live DB in the same session.

### Nav reachability
**Reachable — all four pages.** `NAV_ITEMS` has a top-level "Outreach" entry (`/outreach`) with three children rendered in the sidebar: Campaigns (`/outreach/campaigns`), Templates (`/outreach/templates`), Sequences (`/outreach/sequences`). Also cross-linked from `src/components/funders/FunderDetail.tsx` (two `Link`/`href` references to `/outreach`).

### Actual purpose (from reading the code)
Org-level cold outreach to companies that don't have a public "giving page" — an AI agent (Cold Outreach Agent / Agent 11) scans a company website for emails/contact-forms/personnel and stores them as `outreach_contacts`; a human can then run them through a drip `email_campaigns`/`campaign_steps` sequence via Resend (sent directly through the `resend` SDK in `send/route.ts`, independent of the Email system's Gmail-first sender), with an AI "humanizer" step and template variants, and can convert a promising contact into a tracked `funders` record (triggering the relationship-scoring agent). The page header text ("Contacts extracted from companies without a giving page. Convert the promising ones into funders.") accurately describes what the code does.

---

## System 3: Email

**Location:** org-facing dashboard, under `/email`.

### Files
- `src/app/(dashboard)/email/page.tsx` — "Email Hub": Gmail-synced thread inbox, linked to funders/contacts
- `src/app/(dashboard)/email/campaigns/page.tsx`, `src/app/(dashboard)/email/campaigns/[id]/page.tsx` — sequence builder/detail (labelled "Campaigns" in the UI but operates on `email_campaign_sequences`, not `email_campaigns`)
- `src/app/(dashboard)/email/templates/page.tsx`
- `src/app/api/email/{analytics,auth,callback,contacts,link,send,summarize,sync,threads}/route.ts`
- `src/app/api/email/sequences/route.ts`, `src/app/api/email/sequences/[id]/route.ts`, `.../[id]/analytics/route.ts`, `.../[id]/enroll/route.ts`
- `src/app/api/email/templates/route.ts`, `src/app/api/email/templates/generate/route.ts`
- Lib: `src/lib/email/gmail-auth.ts`, `gmail-sync.ts`, `sender.ts`, `sequence-engine.ts`, `contact-extractor.ts`, `thread-linker.ts`, `template-engine.ts`, `encryption.ts`

### Tables (all live-verified)
| Table | Exists | Row count | Notes |
|---|---|---|---|
| `synced_email_messages` | yes | **0** | |
| `synced_email_threads` | yes | **0** | |
| `email_thread_links` | yes | **0** | has an `outreach_contact_id` column, but is empty |
| `email_campaign_sequences` | yes | **0** | this is what the "Email → Campaigns" UI actually reads/writes |
| `email_sequence_enrollments` | yes | **0** | |
| `email_sequence_steps` | yes | **0** | |
| `email_templates` | yes | **0** | separate from Outreach's `outreach_templates` |
| `email_connections` | yes | **0** | zero orgs have ever connected Gmail |
| `contacts` | yes | 5 | shared general-purpose funder-contacts table (also used elsewhere in the app, not email-specific) |
| `outreach_contacts` | yes | **1** | shared — see cross-system section; read by `email/campaigns/page.tsx`'s contact-picker |

**Every Email-system-specific table (everything except the generic `contacts` table) is empty.** Zero Gmail connections exist, so the entire Gmail-sync path (`gmail-sync.ts`, `thread-linker.ts`, `contact-extractor.ts`) has never run against real data in production.

### Nav reachability
**Partially reachable.** `NAV_ITEMS` has a top-level "Email" entry (`/email`) with **no children** — it links only to the thread-inbox page. `src/app/(dashboard)/email/campaigns/page.tsx` and `src/app/(dashboard)/email/templates/page.tsx` are real, fully-built pages, but nothing links *into* them: grepped the entire `src/` tree for `href="/email/campaigns"` and `href="/email/templates"` and found zero incoming links — both pages only contain outbound links back to `/email`. They are **orphaned**: reachable only by typing the URL directly, not from any nav or in-app link.

### Actual purpose (from reading the code)
A Gmail-integrated inbox: OAuth-connect a Google account, sync threads/messages into `synced_email_threads`/`synced_email_messages`, auto-link threads to funders/contacts by matching sender email, reply in-app (falls back to Resend if Gmail send fails or is unconfigured), AI-summarize a thread, and separately run "sequences" (multi-step automated follow-up emails to `contacts`/`funders`, gated by reply-detection) via `email_campaign_sequences`. Despite the shared word "Campaigns" in its nav label and folder name, this is architecturally a **different concept** from Sales Outreach's or Outreach's "campaigns" — it's an automated relationship-nurture sequence layered on top of an existing Gmail inbox, not a cold-prospecting drip.

---

## Cross-System Comparison

### Sales Outreach × Outreach
- **Shared DB table:** None. Live-verified table sets are disjoint: Sales Outreach owns `sales_campaigns`/`sales_campaign_steps`/`sales_sends`/`sending_domains`/`prospects`/`prospect_lists`; Outreach owns `outreach_contacts`/`email_campaigns`/`campaign_steps`/`campaign_sends`/`outreach_templates`/`outreach_template_variants`. The one apparent near-miss is `suppression_list`, which only Sales Outreach's code path (`prospect-manager.ts`, `unsubscribe-agent.ts`, `sales-campaign-engine.ts`, and the admin suppression routes) actually touches — Outreach's code never references it.
- **Shared UI concept:** Both are "cold email a list of external contacts through a multi-step drip with subject/body templates," and both independently reimplement: a campaign entity, a per-campaign ordered step list, a per-recipient send-tracking table, and a suppression/opt-out concept (Sales Outreach: `suppression_list`; Outreach: contact `status` values including `unresponsive`). No shared component, type, or lib import between them — `grep`'d for cross-imports between `src/app/(dashboard)/admin/sales-outreach`, `src/app/api/admin/{campaigns,domains,prospects,suppression,sales-analytics}`, and Outreach's file set; found zero. They are two independently-built, structurally-parallel drip-campaign engines with different DB schemas — not currently sharing code, but conceptually near-duplicate.
- **Verdict:** Independent implementations of a similar concept, zero code/table sharing today.

### Sales Outreach × Email
- **Shared DB table:** None found. Sales Outreach never touches any `email_*`, `synced_email_*`, or `contacts` table; Email never touches `sales_*`, `sending_domains`, `prospects`, or `suppression_list`.
- **Shared UI concept:** Both send email and both track a "sent/opened/replied/bounced" per-message state (`sales_sends.status` vs implicit status derived from `email_sequence_enrollments`/`synced_email_messages`), but the implementations are unrelated — Sales Outreach sends via Resend only (raw `fetch` to the Resend API in `sales-campaign-engine.ts`); Email sends via Gmail-first with a Resend fallback (`src/lib/email/sender.ts`). No shared send path, no shared type.
- **Verdict:** Genuinely independent. No table overlap, no shared send/tracking logic, no cross-imports found.

### Outreach × Email
- **Shared DB table: `outreach_contacts` — a real, live-verified overlap.** Outreach's own pages (`src/app/(dashboard)/outreach/page.tsx` line 32, `campaigns/[id]/page.tsx` lines 500/529, `src/app/api/outreach/send/route.ts` lines 93/309, `src/lib/agents/cold-outreach.ts`, `src/lib/agents/humanizer-agent.ts`) read/write `outreach_contacts` as their primary entity. Email's `src/app/(dashboard)/email/campaigns/page.tsx` (line 323) independently queries the *same* `outreach_contacts` table (filtered `status != converted`) to populate a contact-picker when building a new Email sequence. `email_thread_links` also carries an `outreach_contact_id` foreign-key-shaped column, though the table is currently empty so that link path is unexercised in practice.
- **Near-miss shared table:** `campaign_sends` (Outreach's send-tracking table) has an unused write hook inside Email's `src/lib/email/sender.ts` (lines 216–226: `if (options.campaign_send_id) { ...update campaign_sends... }`). Grepped the whole repo for `campaign_send_id` and found it is **never actually passed** by any caller — it's dead/vestigial wiring, not a live shared write path today, but it shows the two systems were at some point designed with awareness of each other's schema.
- **Shared UI concept:** Both independently reimplement a "sequence of automated follow-up steps sent to a contact, gated on reply/no-reply" — Outreach's `campaign_steps`/`campaign_sends` (via `email_campaigns`) vs. Email's `email_sequence_steps`/`email_sequence_enrollments` (via `email_campaign_sequences`). Both use a very similar `formatRelative` util and `canEdit`/`useProfile` role-gate pattern (same imports, same hook), but no shared sequence/campaign type or component.
- **Verdict:** These two are the pair with genuine, live, unintentional-looking overlap — same underlying contact table (`outreach_contacts`), parallel-but-separate campaign/sequence engines, and a vestigial cross-reference in the send code. This is the strongest consolidation candidate of the three pairs.

---

## Summary

Based purely on the evidence gathered this session:

- **Sales Outreach** is a genuinely distinct feature (platform-team B2B prospecting) with zero table or code overlap with the other two — **safe to leave separate**. Its main problem isn't overlap, it's that every table it owns has 0 rows in production (fully built, never used).
- **Outreach × Email is the real consolidation candidate.** They already share their core contact entity (`outreach_contacts`, live-verified, actively queried by both), both reimplement an almost-identical "multi-step automated follow-up sequence" concept on separate schemas (`campaign_steps`/`campaign_sends`/`email_campaigns` vs. `email_sequence_steps`/`email_sequence_enrollments`/`email_campaign_sequences`), and there's a dead code hook in Email's sender (`campaign_send_id`) suggesting a prior/abandoned integration attempt between them. Consolidating onto one sequence engine (most likely Email's, since it already has Gmail-aware sending, reply detection, and richer step/enrollment modeling) would remove a duplicated engine and close the gap where `outreach_contacts` is read by two unrelated code paths.
- **Sales Outreach × Email have no meaningful overlap** — safe to leave separate.
- Independent of consolidation: **`followup_sequences` is a live bug** — the Outreach → Sequences page/route reference a table that doesn't exist in the database, so that nav-reachable page is currently broken for every org. And **`/email/campaigns` and `/email/templates` are orphaned pages** — fully built but linked from nowhere in the app, reachable only by typing the URL. Both are worth fixing regardless of any consolidation decision.

---

## Consolidation Candidates

Only the Outreach × Email pair produced real (table- or code-level) overlap in this audit — Sales
Outreach × Outreach and Sales Outreach × Email were both live-verified as zero shared tables and
zero cross-imports (see Cross-System Comparison above), so neither pair produced a candidate below.
"Structurally similar but independently built with no shared table/code" is not the same thing as
overlap, and is excluded on that basis, not on a leniency judgment call.

### Candidate 1 — Dead write hook: `campaign_send_id` in `src/lib/email/sender.ts`

**Classification: SAFE (zero behavior change)**

`SendOptions.campaign_send_id` (declared `src/lib/email/sender.ts:21`) exists solely to drive a
conditional `campaign_sends` update at `src/lib/email/sender.ts:216-226`:

```ts
// Update campaign_sends when this email is part of a campaign step
if (options.campaign_send_id) {
  try {
    await admin
      .from("campaign_sends")
      .update({ status: "sent", sent_at: now })
      .eq("id", options.campaign_send_id);
  } catch {
    // Non-fatal: campaign tracking failure must not fail the send
  }
}
```

Repo-wide grep for the only identifier that can trigger this branch found it referenced nowhere
outside its own declaration and use, in this same file:

**Grep command:**
```
grep -rn "campaign_send_id" src/
```
**Output:**
```
src/lib/email/sender.ts:21:  campaign_send_id?: string;
src/lib/email/sender.ts:217:      if (options.campaign_send_id) {
src/lib/email/sender.ts:222:            .eq("id", options.campaign_send_id);
```

A second pass over `worker/` (the only other TypeScript entry point in this repo besides `src/`)
found zero matches:
```
grep -rn "campaign_send_id" worker/
```
```
(no output — zero matches)
```

No caller anywhere in `src/` or `worker/` ever constructs a `SendOptions` object with
`campaign_send_id` set — every call site of `emailSender.send(...)` omits the field, so
`options.campaign_send_id` is always `undefined` and this branch never executes in production
today. Deleting the field from `SendOptions` and the dead `if` block changes zero observable
behavior for any real caller, by definition of "zero callers." (This does not resolve the broader
Candidate 2 question below — it only removes vestigial, already-inert wiring.)

### Candidate 2 — Parallel outreach/follow-up sequence engines (Outreach × Email)

**Classification: NEEDS REID'S DECISION**

Outreach and Email each independently implement "queue of automated follow-up steps sent to a
contact, gated on reply/no-reply," on disjoint schemas that both hold real production data today:

- Outreach: `email_campaigns` (1 row) → `campaign_steps` (2 rows) → `campaign_sends` (1 row)
- Email: `email_campaign_sequences` (0 rows) → `email_sequence_steps` (0 rows) →
  `email_sequence_enrollments` (0 rows)

This is not provably dead code on either side: `email_campaigns`/`campaign_steps`/`campaign_sends`
already have real rows, `src/app/api/outreach/send/route.ts` is a live, nav-reachable send path
independent of Email's sender, and Email's sequence engine (`sequence-engine.ts`) is real, wired
code even though its tables are still at 0 rows (per this audit's own tier definitions elsewhere in
this repo, 0 rows means "never exercised in prod," not "dead code" — the code path and its API
routes are real and reachable). Picking either engine as the sole "winner" would require migrating
or discarding the other's real send-tracking history and choosing one data model over the other for
every future org's outreach data — a product/data decision, not a code-cleanup one. Explicitly out
of the SAFE bar per this task's own definition ("two systems that both write real user-facing data
with any difference in schema, behavior, or UI").

### Candidate 3 — Parallel template systems (Outreach × Email)

**Classification: NEEDS REID'S DECISION**

Outreach owns `outreach_templates`/`outreach_template_variants` (variant/A-B-testing model, read by
`src/app/(dashboard)/outreach/templates/page.tsx` and the `/api/outreach/templates/...` routes).
Email owns a separate `email_templates` table plus a generation route
(`/api/email/templates/generate`), read by `src/app/(dashboard)/email/templates/page.tsx`. Both are
live, nav-reachable-or-typeable pages backed by real (if currently empty) tables with different
schemas (`outreach_template_variants` supports per-template content variants; nothing in
`email_templates` was found to have an equivalent). No byte-for-byte duplicate function was found
between `src/lib/email/template-engine.ts` and Outreach's template/variant routes — they are
separate implementations, not one copy-pasted into the other. Because the two schemas are not
equivalent (variant support exists on only one side) and both are wired into live, user-reachable
UI, merging them would change what template management looks like for a real org, not just remove
duplication. NEEDS REID'S DECISION.

### Candidate 4 — Shared `outreach_contacts` table (Outreach × Email)

**Classification: NEEDS REID'S DECISION**

`outreach_contacts` (1 real row) is Outreach's primary entity (`src/app/(dashboard)/outreach/page.tsx`,
`campaigns/[id]/page.tsx`, `src/app/api/outreach/send/route.ts`, `src/lib/agents/cold-outreach.ts`,
`src/lib/agents/humanizer-agent.ts`) and is also read live by Email's sequence-builder contact
picker (`src/app/(dashboard)/email/campaigns/page.tsx:323`, filtered `status != converted`). This
is not a consolidation opportunity in the "delete a duplicate" sense — there is only one table, and
it is a real, intentional shared read across two systems, not two parallel copies of the same data.
It's listed here because it's the one place the two systems already overlap today, and any
restructuring of either system's contact model (e.g., merging into `contacts`, changing `status`
enum values, changing ownership) would directly affect the other system's live query. Any change to
this table's shape needs Reid's sign-off, not because it's unsafe code, but because two live
features currently depend on its exact current shape.

---

## 2026-08-13 findings: `followup_sequences` investigation

**Scope:** Follow-up investigation on this doc's own `followup_sequences` finding (Outreach →
Sequences page, previously reported as referencing a nonexistent table). Confirmed live via a
one-off `psql "$DATABASE_URL"` query (per DIRECTIVE-017), then deleted, matching this doc's own
"nothing inferred from migration files alone" standard.

### 1. Exact route/page and what it's trying to show

- `src/app/(dashboard)/outreach/sequences/page.tsx` — a library UI for admin-configured, reusable
  "follow-up sequence" templates: a name, a `trigger_stage` (submitted / follow_up_due / awarded /
  denied / renewal_opportunity), and an ordered list of steps (`offset_days`, `channel`, `note`)
  stored as a single `steps jsonb` array on the sequence row. Includes a create form.
- `src/app/api/outreach/sequences/route.ts` — `GET` lists `followup_sequences` rows for the org,
  `POST` inserts a new one. Both operate directly on `followup_sequences`, no fallback.
- `supabase/migrations/083_followup_sequences.sql` (root tree) — defines exactly the schema the
  page/route expect: `followup_sequences` (id, organization_id, name, trigger_stage, steps jsonb,
  created_at) plus a sibling `followup_enrollments` table (per-application progress through a
  sequence), both with org-scoped RLS.

### 2. Confirmed via live `psql`: the table genuinely does not exist

```sql
SELECT to_regclass('public.followup_sequences') AS followup_sequences,
       to_regclass('public.followup_enrollments') AS followup_enrollments,
       to_regclass('public.application_followups') AS application_followups;
```
Result: all three columns returned `NULL`. A broader sweep,
`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name ILIKE '%followup%'`,
returned **zero rows** — connected to the real `postgres` database (`current_database()` = `postgres`,
`now()` matched the live session clock). **None** of `followup_sequences`, `followup_enrollments`,
or `application_followups` exist in production today, despite all three being defined in committed
migration files on disk.

### 3. Git history — this is drift-by-never-applied, not a renamed table

- `page.tsx`, `route.ts`, and `supabase/migrations/083_followup_sequences.sql` were all authored
  together in the same commit, `b75b25e` ("feat: relationship scores on funder surfaces - Tier 6
  complete", 2026-07-14). This is not a case of the route being written first and a table renamed
  out from under it later — the route was built directly against this migration, in the same commit,
  and (per `src/types/database.ts`'s `followup_sequences` block, comment "Migration 083:
  followup_sequences") the generated types were built against it too. The gap is that migration 083
  itself was apparently never actually run against production.
- Five days later, commit `9e6b427` ("feat: AG-28 follow-up generator", 2026-07-19) added
  `src/supabase/migrations/081_application_followups.sql` (a *different* tree — see this repo's
  known two-parallel-migrations-directories issue) with an explicit deviation note: it *deliberately
  avoided* the `followup_sequences`/`follow_up_sequences` name because that migration file "already
  exists" and has an incompatible shape (template+enrollment pair vs. AG-28's per-application
  scheduled-item design), so it created a new table, `application_followups`, instead.
  `src/lib/agents/followup-generator-agent.ts` (AG-28) writes to `application_followups` exclusively.
- **New finding, not previously documented anywhere in this repo's audit trail:** `application_followups`
  *also* does not exist in production (confirmed in the same query above). So AG-28's own
  deviation — built specifically to avoid colliding with `followup_sequences` — targets a table that
  is itself unmigrated. This directly contradicts `FEATURE_REGISTRY_v2.md` row #202 ("AG-28
  Autonomous Follow-Up Generator... Enum-gap-fixed and re-verified live 2026-08-02
  (`AGENT_VERIFICATION_LOG.md`): completes a real run with zero `agent_type` enum errors"): the enum
  precondition may be fine, but every real call to `insertFollowup()` (the only way this agent writes
  anything) must fail on `application_followups` not existing — meaning no real verification of an
  actual insert succeeding was possible on 2026-08-02, only that the enum no longer blocks the
  `agent_runs`/`agent_decisions` bookkeeping rows. This is a live production gap independent of the
  Outreach → Sequences page and worth a future session's attention.

### 4. No existing table is an equivalent under a different name

Checked both parallel drip-campaign schemas this doc already documents:

- **Email system** (`email_campaign_sequences` / `email_sequence_steps` / `email_sequence_enrollments`,
  `supabase/migrations/054_email_calendar_integration.sql`): steps live in a *separate* table keyed
  by `template_id` (FK to `email_templates`) with `delay_days`/`delay_hours`/`condition_type`, and
  enrollment is per-`contact_id`/`funder_id`/`email_address` — there is no `trigger_stage` concept at
  all; the closest analog, `trigger_type`/`trigger_config jsonb`, defaults to `'manual'` and is never
  populated with an application-pipeline-stage value anywhere in the codebase (checked: no caller
  sets it to anything stage-related).
- **Outreach system** (`email_campaigns` / `campaign_steps` / `campaign_sends`,
  `supabase/migrations/001_initial_schema.sql`): keyed off `outreach_contacts` (companies without a
  giving page), no `trigger_stage`/application-stage concept either — this is a cold-prospecting
  drip, not a post-submission follow-up.

Neither is a rename target: routing the page at either would mean a full schema-shape rewrite (steps
move to a child table, template FKs replace freeform step notes, enrollment keys change from
`organization_id` to `contact_id`/`funder_id`), not a one-line query fix. That's designing
new/different behavior, not fixing a drifted reference — outside this task's SAFE bar.

### Fix applied (SAFE, UI-only)

Per this task's own fix criteria, no safe rename target exists, so no schema/route change was made.
`src/app/(dashboard)/outreach/sequences/page.tsx` was simplified to a static "Not available yet"
`EmptyState` instead of firing a `GET /api/outreach/sequences` request that always 500s and showing a
generic "Could not load follow-up sequences" error (which read as a transient bug rather than an
unbuilt feature). No table, route, or schema was touched; `src/app/api/outreach/sequences/route.ts`
is left as-is (still real, still correctly-written against the migration-083 schema, just currently
unreachable from the UI).

### NEEDS REID'S DECISION

Two real, already-designed options exist — this needs a product call, not more investigation:

1. **Apply the dormant `supabase/migrations/083_followup_sequences.sql`.** The schema is already
   fully written, reviewed, committed, matches the live route/page code exactly, and the generated
   TypeScript types were already built against it — this is a "run the migration that was already
   authored," not a new design. Restores the Outreach → Sequences page to fully working with zero
   code changes beyond reverting this session's page simplification.
2. **Retire the Outreach → Sequences page/route entirely and rely on AG-28's `application_followups`
   model instead** (once *that* migration, `src/supabase/migrations/081_application_followups.sql`,
   is also applied — it's equally unmigrated per sections 2/3 above). This is a materially different
   product: AG-28 auto-generates one follow-up per application per stage transition with no
   user-configurable template library, versus the Sequences page's admin-defined, reusable,
   named-template model. Not a drop-in substitute, a different feature.

Whichever is chosen, note `application_followups` needs the same live-apply treatment regardless —
it's a second, independently-broken instance of the same "migration file committed, never applied to
production" pattern this doc's sections 2/3 surfaced, not specific to option 1 or 2.

---

## 2026-08-13 findings: `/email/campaigns` and `/email/templates` are orphaned pages, not broken ones

**Scope:** Follow-up investigation on this doc's own finding that `/email/campaigns` and
`/email/templates` are fully built but linked from nowhere in the app. Read both page files in full,
walked `git log`/`git show` on both page files and on `src/components/layout/nav-items.ts`'s complete
history to determine whether the missing nav link is a regression or an intentional/ambiguous
omission.

### 1. Both pages are genuinely functional — confirmed by full read, not a `followup_sequences`-style trap

- `src/app/(dashboard)/email/campaigns/page.tsx` (782 lines): lists `email_campaign_sequences` rows
  via `GET /api/email/sequences`, activate/pause via `PATCH /api/email/sequences/[id]`, and a real
  4-pane creation wizard (Details → Steps → Enrollment → Review) that reads real `email_templates`
  rows (`GET /api/email/templates`) for step 2 and real `outreach_contacts` rows (direct Supabase
  client query, `neq("status", "converted")`) for step 3, then on save POSTs the sequence and enrolls
  contacts via `POST /api/email/sequences/[id]/enroll`. No reference to any nonexistent table — every
  table this page touches (`email_campaign_sequences`, `email_templates`, `outreach_contacts`) is
  confirmed live in this doc's own earlier live-`psql` pass.
- `src/app/(dashboard)/email/templates/page.tsx` (663 lines): full CRUD against `email_templates` via
  `GET`/`POST`/`PATCH`/`DELETE /api/email/templates`, a variable-insertion toolbar
  (`{company_name}`, `{contact_name}`, etc.) with live preview rendering against sample data, and a
  real "Generate with AI" sub-form that calls `POST /api/email/templates/generate`. Also references
  only confirmed-live tables.
- Both pages' own header comments describe accurate, narrow scope (e.g. templates page: "Templates
  are referenced by email_sequence_steps") — no aspirational or stale claims found. **Verdict: both
  are real, complete, working pages, not stubs and not victims of an unmigrated-table bug.**

### 2. Git history: children were added, removed same day in a wholesale nav rewrite, and never restored — evidence is genuinely mixed, not a clean regression

- `2be6b32` ("[FORGE] p4-013 - PASSED", **Jun 21 2026 13:55:55**) added the Email nav item's
  `children: [Campaigns, Templates]` array for the first time.
- `64eec4d` ("[FORGE] ui-002 - PASSED", **Jun 21 2026 23:07:38**, ~9 hours later, same day) removed
  those two children — but not in isolation. This single commit is a wholesale nav-architecture
  rewrite: it also deleted `AutoApply`'s entire 11-item children array, deleted `Draft Generator`
  entirely (a top-level item with its own child), deleted the top-level `Dashboard` and `Research`
  items outright, added a new `Contacts` item, and introduced the `SETTINGS_NAV_ITEM` /
  `PLATFORM_NAV_ITEMS` structures that still exist today. Its new file-header comment explicitly
  states *why* Dashboard/Research/AutoApply/Draft Generator are gone ("live in the top header bar —
  they are intentionally absent here") — but says nothing about Email specifically, and Email's own
  top-level item (unlike AutoApply/Draft Generator) was not removed, only its two children.
- `3c21a7f` ("fix: add email hub to nav, fix playwright config and stale specs", **Jul 3 2026
  19:19:28**, ~12 days later) is a dedicated fix commit for exactly this nav gap — its own message
  says "add email hub to nav" — and it restored only the plain `{ label: "Email", href: "/email",
  icon: Mail }` entry. It did **not** restore the `Campaigns`/`Templates` children, despite being a
  session specifically focused on repairing the Email nav entry. If the children's removal had been
  an unnoticed accident, this is the commit where restoring them would have been the natural, in-scope
  fix — it wasn't done.

**Why this doesn't clear the SAFE bar for restoring the link:** the removal happened inside a large,
clearly intentional nav-restructuring commit (11+ AutoApply children and an entire Draft Generator
item were dropped in the same commit, with an explicit design-intent comment), not an isolated,
unexplained drop of just these two lines — so it does not read as "a nav refactor commit that dropped
it with no related feature-removal reasoning." But it's also not clearly *intentional* for Email
specifically: unlike AutoApply/Draft Generator, Email's parent item stayed in the sidebar (nothing
says its children moved to the header or elsewhere), the page files were never deleted or flagged
deprecated, and a later dedicated "fix the email nav" commit had the exact opportunity to restore
them and chose not to — which could mean "deliberately left out" or could just as easily mean "the
person doing that fix only checked that `/email` itself was linked and didn't audit sub-pages."
**No commit message, code comment, or removed-feature marker anywhere in this history states a reason
to leave `/email/campaigns` and `/email/templates` unlinked.** Per this task's own fix criteria, this
ambiguity means the nav link is not restored speculatively.

### 3. Current nav-items.ts (unchanged by this session)

`src/components/layout/nav-items.ts` today has `{ label: "Email", href: "/email", icon: Mail }` as a
plain, childless entry (line 110) sitting directly above the `Outreach` item, which *does* have a
`children` array (`Campaigns`, `Templates`, `Sequences` — the Outreach system's own pages, a separate
system per this doc). No commented-out or dead code referencing `/email/campaigns` or
`/email/templates` exists anywhere in the file.

### NEEDS REID'S DECISION

`/email/campaigns` and `/email/templates` are fully functional, real pages — real API routes, real
tables (all confirmed live), no missing-dependency bugs — sitting one `children` array edit away from
being reachable in the sidebar. Whether they were deliberately soft-launched, quietly abandoned in
favor of the Outreach system's parallel sequence/template pair (see Candidates 2/3 above), or simply
missed by two different nav-touching sessions is not determinable from git history alone. No nav
change was made this session. Restoring the link is a one-line change
(`children: [{ label: "Campaigns", href: "/email/campaigns" }, { label: "Templates", href:
"/email/templates" }]` back on the `Email` item, `src/components/layout/nav-items.ts:110`) whenever
Reid decides these should go live — including as a deliberate choice between them and/or the Outreach
system's near-duplicate pair, per Candidates 2/3 above, rather than exposing both in parallel.

---

## 2026-08-13 findings: consolidation execution — system mapping

**Scope:** Reid has decided to consolidate onto the Email sequence engine
(`email_campaign_sequences`/`email_sequence_steps`/`email_sequence_enrollments`), deprecating
Outreach's parallel drip schema. Before touching any code, this section resolves one specific
ambiguity: does this doc's original overlap finding (Outreach's `campaign_steps`/`campaign_sends`/
`email_campaigns`) describe the same feature as this morning's `followup_sequences` finding
(`/outreach/sequences`), or are they two separate things? **Answer: two genuinely separate systems.**
They share a nav parent (`/outreach`) and a "multi-step sequence of emails" concept in the abstract,
but different tables, different data models, different trigger concepts, built five weeks apart by
different commits, and only one of the two currently holds live production data. Full evidence below.
A third, also-distinct concept (`application_followups`, AG-28) surfaced during this investigation and
is explicitly **not** part of the consolidation plan either — see §4.

### 1. `src/app/(dashboard)/outreach/sequences/page.tsx` + `src/app/api/outreach/sequences/route.ts` — full read

Per this morning's investigation (already in this doc), this page/route pair queries
`followup_sequences` exclusively — a table that does not exist in production. The page was simplified
today to a static "Not available yet" `EmptyState` (commit `2510ed2`) rather than firing a
request that always 500s; a code comment at the top of the page file now points here for the full
investigation. The route (`src/app/api/outreach/sequences/route.ts`) is untouched and still queries
`followup_sequences` directly — real code, unreachable table.

**Data model** (per `supabase/migrations/083_followup_sequences.sql`, confirmed live-absent below):
`followup_sequences` — `id, organization_id, name, trigger_stage, steps jsonb, created_at`. `steps` is
a single jsonb array of `{offset_days, channel, note}` objects on the sequence row itself (no child
table). `trigger_stage` is a free-form pipeline-stage string (`submitted` / `follow_up_due` /
`awarded` / `denied` / `renewal_opportunity`, per the page's own dropdown). A sibling table,
`followup_enrollments`, tracks one **application's** progress through a sequence
(`application_id`, `sequence_id`, status) — the enrollment unit is an `application`, not a contact.

### 2. Every real call site of `campaign_steps`/`campaign_sends`/`email_campaigns` — full read

Grepped the whole repo (excluding docs/migrations, already covered above) for these three table
names. Every real (non-doc, non-migration) call site is part of the same feature, "Outreach →
Campaigns":

- `src/app/(dashboard)/outreach/campaigns/page.tsx` — list view, reads `email_campaigns` +
  `campaign_steps` + `campaign_sends` directly via the browser Supabase client, drives
  activate/pause via `email_campaigns.status`.
- `src/app/(dashboard)/outreach/campaigns/[id]/page.tsx` — detail view, calls
  `GET/PUT /api/agents/campaigns/[campaignId]`, plus direct client-side reads/writes on
  `outreach_contacts`/`email_campaigns`/`campaign_steps` for the "Add contacts"/"Edit steps" modals.
- `src/app/api/agents/campaigns/route.ts` (`GET`/`POST`) and
  `src/app/api/agents/campaigns/[campaignId]/route.ts` (`GET`/`PUT`) — the real backing API, reads/
  writes `email_campaigns`/`campaign_steps`/`campaign_sends` directly, and `POST` on the collection
  route runs `EmailCampaignAgent` (Agent 18).
- `src/lib/agents/email-campaign.ts` (`EmailCampaignAgent`, `agentType: "email_campaign"`,
  migration 007) — the actual send engine: sweeps active `email_campaigns`, walks each contact's
  `campaign_steps`/`campaign_sends` history to find the next due step, sends via the org's Gmail
  connection (falls back to nothing — no Resend fallback in this file), records a `campaign_sends`
  row. Its own header comment explicitly cites "AGENTS.md Agent 18 (BLUEPRINT Phase 4 / §4.11)."
- `src/app/api/outreach/send/route.ts` (`POST /api/outreach/send`) — a second, independent send path
  for the same three tables (Resend-based, not Gmail-based), used for a single on-demand step send
  rather than a full sweep; both this route and `EmailCampaignAgent` write the same `campaign_sends`
  shape.
- `src/components/outreach/CampaignBuilder.tsx` / `CampaignStatus.tsx` — creation/status UI
  components used by the pages above.
- `supabase/migrations/001_initial_schema.sql` — defines all three tables together, `email_campaigns`
  → `campaign_steps` (FK `campaign_id`) → `campaign_sends` (FK `campaign_step_id`), with cascading
  org-scoped RLS (`campaign_sends`' policy traverses through `campaign_steps` → `email_campaigns` to
  reach `organization_id`, since `campaign_sends` itself has no `organization_id` column — confirmed
  by direct column read in §3 below).
- `supabase/migrations/007_email_campaign_agent.sql` — adds the `email_campaign` agent-run wiring;
  its own header comment states outright: "The campaign tables themselves (email_campaigns,
  campaign_steps, campaign_sends) and outreach_contacts were created in migration 001 — nothing [new
  here]."

**No file anywhere references both `campaign_steps`/`campaign_sends`/`email_campaigns` AND
`followup_sequences`/`followup_enrollments`.** These are disjoint code paths with zero shared files,
confirming they are not two names for the same feature.

### 3. Git history — five weeks apart, additive not replacing

- `email_campaigns`/`campaign_steps`/`campaign_sends` (`supabase/migrations/001_initial_schema.sql`)
  and the pages/routes that use them were **all first committed together** in `db364b6`
  ("Benavora complete - audit grade B", **2026-06-12**) — this is original Phase-1-era schema, not a
  later addition.
- `followup_sequences`/`followup_enrollments` (`supabase/migrations/083_followup_sequences.sql`) and
  the `/outreach/sequences` page/route were **all first committed together**, separately, in `b75b25e`
  ("feat: relationship scores on funder surfaces - Tier 6 complete", **2026-07-14**) — five weeks
  later. `src/types/database.ts`'s generated types were built against this migration in the same
  commit too (comment: "Migration 083: followup_sequences"), meaning the table was expected to exist,
  not a copy-paste leftover.
- The two commits touch **completely disjoint files** — no commit modifies both feature's files, and
  neither commit message references the other feature. This is two independent builds five weeks
  apart, not a rename, refactor, or migration-in-place of one into the other.
- `src/app/(dashboard)/outreach/sequences/page.tsx` has exactly 2 commits total in its history:
  its `2026-07-14` creation and today's `2026-08-13` simplification (`2510ed2`) — it was never
  otherwise touched, including never wired to read from `campaign_steps`/`campaign_sends` at any
  point.

### 4. Live `psql` schema/existence check (DIRECTIVE-017) — confirms disjoint tables, and rules out any hidden equivalence

Ran directly against `DATABASE_URL` via a one-off Node script (`pg` client), then deleted, per this
doc's own established method:

```
=== existence ===
email_campaigns: 'email_campaigns'
campaign_steps: 'campaign_steps'
campaign_sends: 'campaign_sends'
followup_sequences: null
followup_enrollments: null
application_followups: null
email_campaign_sequences: 'email_campaign_sequences'
email_sequence_steps: 'email_sequence_steps'
email_sequence_enrollments: 'email_sequence_enrollments'
```

`campaign_steps`/`campaign_sends`/`email_campaigns` are **live**, with real production rows
(`email_campaigns`: 1, `campaign_steps`: 2, `campaign_sends`: 1 — matching this doc's earlier count).
`followup_sequences`/`followup_enrollments` are confirmed **still absent**, re-confirming this
morning's finding independently. **New finding this pass**: `application_followups` (AG-28's table,
`src/supabase/migrations/081_application_followups.sql`) is *also* confirmed absent — independently
re-verifying this morning's separate finding under this section's own fresh query, not reused from
memory.

Exact columns, confirming `campaign_steps`/`campaign_sends`/`email_campaigns` is a genuinely different
shape from `followup_sequences`' `steps jsonb` design (which never got the chance to be applied, but
whose *design* is on disk in migration 083 for comparison) and is structurally close to the Email
engine's live schema:

```
email_campaigns:  id, organization_id, name, status, total_steps, total_contacts,
                   created_by, created_at, updated_at
campaign_steps:    id, campaign_id, step_number, subject_template, body_template,
                   delay_days, created_at
campaign_sends:    id, campaign_step_id, outreach_contact_id, status, sent_at,
                   opened_at, replied_at, created_at   (no organization_id — RLS traverses parent)

email_campaign_sequences (Email engine, target of consolidation):
                   id, organization_id, name, description, trigger_type, trigger_config (jsonb),
                   status, total_enrolled, total_completed, total_replied, created_by,
                   created_at, updated_at
email_sequence_steps:
                   id, sequence_id, step_number, template_id, subject_override, body_override,
                   delay_days, delay_hours, condition_type, condition_config (jsonb), created_at
```

This confirms the pairing this doc's own "Candidate 2" already named:
`campaign_steps`/`campaign_sends`/`email_campaigns` (step-per-row, template text inline on the step)
maps structurally onto `email_sequence_steps`/`email_sequence_enrollments`/`email_campaign_sequences`
(step-per-row, template referenced by `template_id` FK instead of inline text — the one real schema
difference to design around during migration). Neither table set has any column resembling
`trigger_stage` or a `steps jsonb` blob — `followup_sequences`' design has no structural analog on
either side of the consolidation and would need to be designed from scratch if ever built, not merged
in as part of this migration.

### Conclusion — does the consolidation plan need adjusting?

**No adjustment needed to the core plan** (migrate `campaign_steps`/`campaign_sends`/`email_campaigns`
→ `email_sequence_steps`/`email_sequence_enrollments`/`email_campaign_sequences`), but the next
prompt must scope it correctly:

1. **`campaign_steps`/`campaign_sends`/`email_campaigns` is the correct, sole target of this
   consolidation.** It is real, live, holds real production rows, and is exactly the system named in
   this doc's original "Candidate 2" finding — confirmed unambiguously by disjoint files, disjoint git
   history, and disjoint live schema from every other "follow-up"-flavored table in the repo.
2. **`followup_sequences`/`followup_enrollments` (the `/outreach/sequences` page) is NOT part of this
   consolidation and must not be touched by it.** It is a separate, never-applied, application-stage-
   triggered template-library concept with no live data, no structural equivalent in either the
   Outreach or Email schema, and its own still-open "NEEDS REID'S DECISION" (apply migration 083, or
   retire in favor of AG-28) from this morning's findings, unaffected by today's consolidation
   decision either way.
3. **A third, also out-of-scope system was confirmed during this pass**: `application_followups`
   (AG-28, `src/supabase/migrations/081_application_followups.sql`, consumed by
   `src/worker/jobs/process-followups.ts`, commit `2f822b1`) — a per-application, auto-generated
   follow-up-item model with no user-facing template library, independently confirmed still absent
   from production by this session's own fresh query (not reused from this morning's memory). It is
   the actual subject of `FEATURE_REGISTRY_v2.md` row #74 ("Follow-Up Sequences... Commit 2f822b1"),
   which is a mislabeled row — that commit touches `application_followups`, not `followup_sequences`
   — worth a future doc-correction pass but irrelevant to the consolidation plan itself, since neither
   its table nor its worker job touches any of `campaign_steps`/`campaign_sends`/`email_campaigns`/
   `email_sequence_*`.
4. **Net: three separate "follow-up sequence"-shaped concepts exist in this repo, only one of which
   is live and in scope for today's consolidation.** The next prompt should proceed against
   `campaign_steps`/`campaign_sends`/`email_campaigns` → the Email engine only, and must not fold in
   `followup_sequences` or `application_followups` under the assumption they're the same work.

---

## 2026-08-13 findings: consolidation execution — data migration

**Scope:** Executed the migration named in the section above — copy the 4 real rows
(`email_campaigns`: 1, `campaign_steps`: 2, `campaign_sends`: 1) into the Email engine's schema
(`email_campaign_sequences`/`email_sequence_steps`/`email_sequence_enrollments`) where the shapes
allow it, without forcing anything lossy. Live counts were re-confirmed via a fresh `psql`/`pg`
query immediately before writing (not trusted from the mapping section above): unchanged at
`email_campaigns`=1, `campaign_steps`=2, `campaign_sends`=1, and all three Email-side tables
confirmed still at 0 before the migration ran.

### Correction to this doc's own prior framing: this is E2E test fixture data, not customer data

While pulling the rows to migrate, their content made this unambiguous: the organization is named
`Benavora E2E Test Org`, the row's `created_by` profile is `owner.e2e@benavora-test.dev`, the
campaign is named `Spring Construction Outreach (E2E Seed)`, the contact is `Bluebonnet Builders
(E2E Seed)`, and the contact's email domain is `bluebonnet.example` — the RFC 2606 reserved
test-only TLD, incapable of receiving real mail. This doc's earlier sections referred to these as
"real production rows" (accurate in the narrow sense that they are live rows in the production
database, not seed-script leftovers sitting in a dev branch) but they are not genuine customer
data — they're E2E test fixtures that were written directly into production, most likely by a
Playwright/Vitest run against `DATABASE_URL` rather than a local/branch database. Per this session's
task instruction, they were migrated with the same care real customer data would get regardless of
this finding — but future sessions should not read "1 real row" in the sections above as "a real
funder used this feature."

### What migrated cleanly (field-for-field, no interpretation required)

- **`email_campaigns` → `email_campaign_sequences`**: clean 1:1 map. Both use the identical
  `campaign_status` Postgres enum (`draft`/`active`/`paused`/`completed`), so `status` copied
  directly with no cast logic. `name`, `organization_id`, `created_by`, `created_at`, `updated_at`
  copied verbatim. `trigger_type` set to `'manual'` (the schema's own default, and an accurate
  description of how this campaign was actually operated — no autonomous trigger existed in the
  Outreach engine). `total_enrolled`/`total_completed`/`total_replied` were deliberately left at
  their default `0` rather than backfilled from `total_contacts`/`total_steps`, since no
  corresponding `email_sequence_enrollments` row was created (see below) — setting them to non-zero
  would have misrepresented a sequence with zero real enrollments as having one.
- **`campaign_steps` → `email_sequence_steps`**: clean 1:1 map for both rows. `step_number`,
  `delay_days`, `created_at` copied directly. `subject_template`/`body_template` (free text inline
  on the step) mapped to `subject_override`/`body_override` — the Email schema's own override
  columns exist precisely to hold step-specific text when no `template_id` is set, so this is not a
  workaround, it's the schema's intended path for un-templated content. `template_id` left `NULL`
  (no corresponding `email_templates` row exists to reference — `email_templates` has 0 rows).
  `delay_hours` defaulted to `0`, `condition_type` defaulted to `'always'` (both schema defaults;
  Outreach's model has no hour-granularity or conditional-branch concept to map from).
- Migration ran inside a single Postgres transaction with a `BEGIN`/`COMMIT`, re-selecting the
  source rows live inside the transaction (not from cached values already printed earlier in this
  session) and guarded by a `WHERE trigger_config->>'migrated_from_email_campaigns_id' = ...` check
  that aborts if this campaign was already migrated — safe to re-run without creating duplicates.
  The new sequence's `trigger_config` jsonb permanently records
  `migrated_from_email_campaigns_id: "442f31f9-ca89-4f3a-8f53-cae149d4ccf8"` for traceability.
- **Verified, not just inserted**: re-read both new tables fresh (separate script, separate
  connection) after commit and diffed every field against the source rows —
  `name`/`organization_id`/`status`/`created_by`/`created_at` on the sequence and
  `subject`/`body`/`delay_days` on both steps all matched exactly. Post-migration counts:
  `email_campaign_sequences`=1, `email_sequence_steps`=2, `email_sequence_enrollments`=0 (unchanged
  by design, see below). **Source rows were left in place, not deleted** — `email_campaigns`=1,
  `campaign_steps`=2, `campaign_sends`=1 are all still live post-migration. Retiring the old tables,
  removing the Outreach → Campaigns nav entry, or repointing `src/app/api/outreach/send/route.ts`
  and `EmailCampaignAgent` are separate, not-yet-made product decisions, out of scope for a
  data-only migration.

### What did NOT migrate: `campaign_sends` (1 row), exported instead

`campaign_sends` → `email_sequence_enrollments` is a genuine shape mismatch, not an edge case that
could be forced with a little interpretation:

- `campaign_sends` is a **per-step send-event log** — one row per (contact, step) send, carrying
  per-step `sent_at`/`opened_at`/`replied_at`. A campaign with 2 steps sent to 1 contact would
  eventually have up to 2 `campaign_sends` rows, each independently trackable.
- `email_sequence_enrollments` is a **single per-contact aggregate state row per sequence** — no
  per-step child table exists on this side at all (confirmed via `information_schema.columns` and a
  full FK sweep: its only FKs are to `contacts`, `funders`, `organizations`, and
  `email_campaign_sequences`). It tracks one `current_step` pointer, one `last_sent_at`, one
  `next_send_at`, and a single boolean `reply_detected` — there is no way to represent "step 1 was
  opened but step 2 wasn't" once more than one step has been sent. It also carries a genuine
  `UNIQUE(sequence_id, email_address)` constraint (confirmed via `pg_constraint`), meaning exactly
  one enrollment row can ever exist per contact per sequence — consistent with "aggregate state,"
  inconsistent with "event log."
- Reconstructing an enrollment row for this specific contact would require **inventing** three
  fields with no literal source value: `enrolled_at` (Outreach has no distinct enrollment event — a
  contact is simply linked to a `campaign_id` the moment it's created, there's no separate
  "enrolled" timestamp to copy), `current_step` (derivable only by inference — "the highest
  `step_number` with a `sent`-status `campaign_sends` row" — not a value that exists anywhere in the
  source data), and `next_send_at` (would require computing `sent_at` + the next step's
  `delay_days`, i.e. re-implementing the *scheduling logic* of a different engine rather than
  copying data). Writing fabricated values into `next_send_at` specifically risks the live Email
  sequence worker (`sequence-engine.ts`) acting on invented state — e.g. sending step 2 at a time
  this migration guessed rather than a time any real system actually scheduled.
- In this specific case `opened_at`/`replied_at` are both `null` on the one real `campaign_sends`
  row, so no per-step history is actually being lost in the *narrow* sense — but the shape mismatch
  itself (event-log vs. aggregate-state, no per-step child table on the target side) is structural,
  not specific to this row's currently-empty fields, so it was treated as non-migratable per this
  task's own instruction rather than special-cased as "safe this one time."
- **Exported instead**: `campaign_sends`' one row, plus its full resolving context (the
  `campaign_steps` row it references, the `outreach_contacts` row it references, and the parent
  `email_campaigns` row), written verbatim to
  `OUTREACH_ROWS_PRE_CONSOLIDATION_2026-08-13.json` in the repo root. Nothing was deleted from
  `campaign_sends` itself — the export exists so the send history isn't *only* reachable by knowing
  to query the deprecated tables, not as a replacement for keeping the source row.

### NEEDS REID'S DECISION

The `campaign_sends` → `email_sequence_enrollments` gap is a modeling decision, not a technical one:
if/when this contact should be represented as "enrolled" in the new Email sequence engine, someone
needs to decide what `current_step`/`next_send_at` should actually be (resume mid-sequence at step
2? restart at step 1? treat as already-contacted and not auto-resume at all?) — that's a real
behavioral choice about whether/how a real world (or in this case, test-fixture) contact gets
emailed again, not something this migration should guess at. `OUTREACH_ROWS_PRE_CONSOLIDATION_2026-08-13.json`
has everything needed to make that call whenever it's made. Given the E2E-fixture finding above,
this may also simply be moot — worth confirming with Reid whether this row needs any live
enrollment counterpart at all, or whether the export alone (as a record) is sufficient and the
source tables can eventually be dropped once the nav/route retirement questions from the sections
above are also resolved.

---

## 2026-08-13 findings: consolidation execution — UI/nav retirement

**Scope:** Made Email's sequence engine (`/email/campaigns`, `/api/email/sequences`) the sole
*UI-reachable* path for this feature, per Reid's decision recorded above. `pnpm run build` was run
after each change and confirmed clean throughout.

### Changes made

1. **`/outreach/sequences`** (`src/app/(dashboard)/outreach/sequences/page.tsx`) — was a static
   "Not available yet" empty state (this morning's fix, since `followup_sequences` doesn't exist).
   Now a server component that unconditionally `redirect("/email/campaigns")`s. This is a different,
   still-unbuilt concept from the Email/Outreach campaign consolidation (see the `followup_sequences`
   section above) — redirecting it here is a UI simplification per today's instruction, not a claim
   that its data model was ever equivalent to `email_campaign_sequences`.
2. **`/outreach/campaigns`** and **`/outreach/campaigns/[id]`** (`src/app/(dashboard)/outreach/campaigns/{page.tsx,[id]/page.tsx}`)
   — these were the other real, currently-functioning UI entry points onto
   `email_campaigns`/`campaign_steps`/`campaign_sends` found this session (full read of both files
   above): a list page with create/activate/pause controls, and a detail page with a "Run sends now"
   button, step editor, and contact enrollment modal. Both replaced with server components that
   `redirect("/email/campaigns")`, matching the Sequences pattern. The detail page redirects to the
   list rather than an equivalent per-item URL — no id mapping exists between `email_campaigns` and
   `email_campaign_sequences` (different primary keys, and the migration section above only mapped
   the one E2E test-fixture row, not a general id scheme).
3. **Nav** (`src/components/layout/nav-items.ts`): `Email` (previously a childless top-level entry,
   orphaned per this morning's findings) now has `children: [Campaigns → /email/campaigns,
   Templates → /email/templates]`. `Outreach`'s children shrank to `[Templates → /outreach/templates]`
   only — `Campaigns` and `Sequences` were removed from the Outreach submenu rather than left pointing
   at pages that immediately bounce elsewhere, which would read as a broken/confusing nav item.
   `/outreach/templates` (`outreach_templates`/`outreach_template_variants`) is a genuinely different
   table pair from this consolidation's scope (Candidate 3 in this doc, still its own open
   NEEDS REID'S DECISION) — left untouched, not folded into Email.
4. **`/api/outreach/send`** (`src/app/api/outreach/send/route.ts`) — removed outright, not just
   unlinked. Full read confirmed it was a second, independent send path for
   `campaign_steps`/`campaign_sends`/`email_campaigns` (Resend-based, parallel to
   `EmailCampaignAgent`'s Gmail-based sends). Repo-wide grep for `/api/outreach/send` found it
   referenced nowhere else in `src/`, `worker/`, or any test — not even from the two pages redirected
   above, which called `/api/agents/campaigns`/`/api/agents/campaigns/[campaignId]` instead. This
   route had zero real callers *before* this session's changes too — it meets this audit's own SAFE
   bar for removal (Candidate 1, "no caller anywhere... changes zero observable behavior for any real
   caller, by definition of zero callers") independent of today's UI work.

### Left in place, deliberately, with reasoning

- **`/api/agents/campaigns`** (GET/POST) **and `/api/agents/campaigns/[campaignId]`** (GET/PUT) — real,
  correctly RLS-scoped, org-derived API routes that ran `EmailCampaignAgent`
  (`src/lib/agents/email-campaign.ts`) and read/wrote `email_campaigns`/`campaign_steps`. These
  *were* called from the two redirected pages and now have zero UI callers, but were not deleted:
  removing a whole agent-trigger API surface is a larger, less-reversible change than a nav-focused
  task should make in the same pass, and this repo's own established precedent (this morning's
  `followup_sequences` fix) is "cut the UI, leave the real backend code in place" rather than delete
  it outright. Matches the task's own "left in place but no longer called from the UI" option.
- **`/api/webhooks/resend/route.ts`** — a live, externally-configured Resend webhook receiver that
  updates `campaign_sends.opened_at`/`status` on `email.opened`/`email.bounced` events. Not a UI entry
  point at all (Resend's servers call it directly via a webhook URL configured outside this repo), so
  it falls outside both this task's "UI entry points" framing (item 2) and its own "or no longer
  called from the UI" framing (item 3 — it was never UI-called to begin with). Left untouched:
  removing or disabling it would be guessing at live third-party webhook configuration this session
  has no visibility into, not a nav/route change.

### New finding this session, not previously documented anywhere in this audit: a live autonomous consumer of the deprecated schema

While tracing every real caller of `EmailCampaignAgent` to decide the API-route question above, found
**`src/app/api/cron/campaigns/route.ts`**, registered as a real Vercel Cron job in `vercel.json`
(`{ "path": "/api/cron/campaigns", "schedule": "0 */2 * * *" }` — every 2 hours, confirmed by direct
read of both files). On each fire it queries every organization with
`platform_config.key = 'feature.cold_outreach_email'` set `true`, then runs a real, unmodified
`EmailCampaignAgent.run({ force: false })` per org via the service-role admin client — reading
`email_campaigns`/`campaign_steps`, sending real email via each org's connected Gmail mailbox, and
writing real `campaign_sends` rows and `outreach_contacts` status updates. This is **entirely
independent of any UI path** — it is not reachable from, triggered by, or in any way downstream of
`/outreach/campaigns`, `/api/agents/campaigns`, or anything else this session touched.

**This was not disabled or modified.** It sits outside this task's given scope (UI entry points and
UI-called API routes) and outside this session's authority to decide alone: stopping a scheduled job
that may be actively sending real email on behalf of a real org — even one styled after an
E2E-fixture org, per the "correction" note earlier in this doc — is an operationally live behavior
change, not a nav/route cleanup, and the consequence of guessing wrong (silently orphaning an
in-flight drip campaign an org is relying on, or conversely leaving a legacy autonomous sender live
indefinitely alongside the new canonical engine) is exactly the kind of thing this doc's own
"NEEDS REID'S DECISION" convention exists for.

**Practical effect of today's changes on this job: none.** The cron endpoint calls
`EmailCampaignAgent` directly, not through any of the routes or pages touched above, so nothing done
today starts, stops, or alters its behavior — it will continue to fire every 2 hours regardless.

### NEEDS REID'S DECISION

**Item 5 (new):** `/api/cron/campaigns` is a live, scheduled, autonomous writer to the
now-UI-deprecated `email_campaigns`/`campaign_steps`/`campaign_sends` schema, running independently
of every change made in this pass. "Email's sequence engine is the sole live path for this feature"
is true for every UI and UI-triggered path as of today, but not yet true end-to-end while this cron
job remains registered and enabled. Options, not decided here:
1. Leave it running as-is (accept that the deprecated engine still autonomously operates for any org
   with `feature.cold_outreach_email` enabled, even though no UI can create/manage a campaign for it
   anymore going forward).
2. Remove the cron entry from `vercel.json` and retire `/api/cron/campaigns` (stops the sweep
   entirely; safe to reverse via git, but silently ends any real org's in-flight drip campaign with no
   migration path to the new engine's `email_sequence_enrollments` model — same modeling gap as
   Item 4 above, at cron-execution scale rather than one row).
3. Point the cron at a new equivalent sweep for `email_campaign_sequences`/`email_sequence_enrollments`
   instead (a real feature-parity build, not a config change — `sequence-engine.ts` was not audited
   this session for whether it already has an unscheduled equivalent sweep function).
Whichever is chosen, check whether any real organization currently has
`platform_config.key = 'feature.cold_outreach_email'` set `true` before deciding — this session did
not query that live, and it materially changes the urgency/risk of options 1–3.

---

## 2026-08-13 findings: deprecation comments applied; write-path check confirms Item 5 is still live, not resolved

**Scope:** Applied `COMMENT ON TABLE` (via DIRECTIVE-017's `psql`/`DATABASE_URL` path) marking
`email_campaigns`, `campaign_steps`, and `campaign_sends` deprecated as of this date in favor of
`email_sequence_steps`/`email_sequence_enrollments`/`email_campaign_sequences`, then re-ran a
repo-wide grep to confirm no code path still writes to them. **It did not confirm that** — this is
the same gap already recorded above as "NEEDS REID'S DECISION Item 5," re-confirmed live this
session rather than newly discovered. Documenting per this task's own instruction rather than
silently treating the deprecation as complete.

### SQL comments applied and verified live

```sql
COMMENT ON TABLE email_campaigns IS 'DEPRECATED 2026-08-13: superseded by email_campaign_sequences. Do not write to this table going forward. See OUTREACH_CONSOLIDATION_AUDIT.md.';
COMMENT ON TABLE campaign_steps IS 'DEPRECATED 2026-08-13: superseded by email_sequence_steps. Do not write to this table going forward. See OUTREACH_CONSOLIDATION_AUDIT.md.';
COMMENT ON TABLE campaign_sends IS 'DEPRECATED 2026-08-13: superseded by email_sequence_enrollments. Do not write to this table going forward. See OUTREACH_CONSOLIDATION_AUDIT.md.';
```

Re-read back via `pg_class`/`obj_description` in the same session, confirmed all three comments are
live in production. SQL file kept at `scripts/deprecate-outreach-campaign-tables.sql` for the record;
tables were **not** dropped or truncated, per this task's explicit instruction. This is metadata only
— `COMMENT ON TABLE` does not block writes at the database level, so it documents intent, it does not
enforce it.

### Repo-wide grep: real, currently-active write paths still exist

Grepped `src/` and `worker/` for `campaign_steps`/`campaign_sends`/`email_campaigns`, then read every
match to separate real hits from false positives (`sales_campaign_steps`/`sales_sends` in the
unrelated Sales Outreach system substring-matched and were excluded; `src/types/database.ts` and the
`ag19-relationship-builder-flag.test.ts` org-scoping table list are non-write references and were
excluded). Confirmed already-redirected: `src/app/(dashboard)/outreach/campaigns/page.tsx` and
`.../campaigns/[id]/page.tsx` are both server components that unconditionally `redirect`, no query.
`CampaignBuilder.tsx`/`CampaignStatus.tsx` are now orphaned (zero remaining imports anywhere in
`src/`) — dead but harmless, not a write path themselves.

**Real, active write paths confirmed still present, none disabled by this session:**

1. **`POST /api/agents/campaigns`** (`src/app/api/agents/campaigns/route.ts:115-124`) — instantiates
   `EmailCampaignAgent` and calls `.run({ campaignIds, force: true })` on a live authenticated
   request. No UI caller remains, but the route itself is unmodified and reachable.
2. **`PUT /api/agents/campaigns/[campaignId]`** (`src/app/api/agents/campaigns/[campaignId]/route.ts:214-220`)
   — a real `.update({ status: target, ... })` against `email_campaigns` on a live authenticated
   request, gated only by `EDITOR_ROLES`, not by anything related to today's consolidation.
3. **`/api/cron/campaigns`** — registered in `vercel.json` (`"schedule": "0 */2 * * *"`, confirmed
   still present, unmodified), fires every 2 hours regardless of any UI change made today, and calls
   `EmailCampaignAgent.run({ force: false })` directly for every org with
   `platform_config.key = 'feature.cold_outreach_email'` enabled.
4. **`src/lib/agents/email-campaign.ts`** (`EmailCampaignAgent`) — the engine both callers above
   invoke. Confirmed real inserts/updates: `.from("campaign_sends").insert(row)` (line 381),
   `.from("email_campaigns")` reads/updates, `.from("campaign_steps")` reads. Unmodified.
5. **`src/app/api/webhooks/resend/route.ts`** — a live, externally-configured Resend webhook (not a
   UI path at all) that updates `campaign_sends.opened_at`/`status` on real
   `email.opened`/`email.bounced` events. Unmodified, and outside this repo's control to disable
   without also reconfiguring Resend's webhook destination.

**This is exactly the gap already named "NEEDS REID'S DECISION Item 5" above** — re-confirmed live
this session with exact file/line citations rather than newly found. None of these five were touched:
per this task's own scope, the instruction was to stop and document a still-active write path, not to
silently disable one. **The tables now carry a live `COMMENT ON TABLE` telling any future reader they
are deprecated and should not be written to, while five real code paths continue writing to them
today** — this inconsistency is the actual state of the system as of 2026-08-13, not fully resolved,
and should not be read as "consolidation complete" until Item 5 is decided and acted on.

### NEEDS REID'S DECISION (unchanged from Item 5 above, re-flagging)

No new options beyond what's already listed under Item 5: leave the cron/API/webhook writers running
as-is, retire them, or repoint them at the new `email_sequence_*` schema. This session did not query
whether any real org has `feature.cold_outreach_email` enabled — that check (noted as outstanding
above) still materially changes the urgency here and remains undone.

---

## Final Summary — Before/After (2026-08-13, ties together all prior sections in this doc)

This section is a single reference picture of the whole consolidation, spanning every prompt run
today. Nothing below is a new finding — it is a synthesis of the sections above, with pointers back
to the section that has the actual evidence for each claim.

### Before (start of day, 2026-08-13)

Three independently-built "outreach"-flavored systems, two of which (Outreach and Email) shared a
contact table and reimplemented near-identical drip-sequence/template concepts on disjoint schemas:

- **Sales Outreach** (admin, platform-team B2B prospecting) — fully built, zero rows in every table
  it owns, zero overlap with the other two. Untouched by this consolidation; correctly out of scope
  (see Cross-System Comparison).
- **Outreach** (`email_campaigns`/`campaign_steps`/`campaign_sends`, migration 001, 2026-06-12) —
  the org's cold-prospecting drip engine, UI-reachable at `/outreach/campaigns`,
  `/outreach/campaigns/[id]`, and (for an unrelated, separately-broken template-library concept)
  `/outreach/sequences`. Held 1 real `email_campaigns` row, 2 `campaign_steps`, 1 `campaign_sends` —
  later confirmed to be E2E test-fixture data, not genuine customer data (see "Correction to this
  doc's own prior framing" under Data Migration).
- **Email** (`email_campaign_sequences`/`email_sequence_steps`/`email_sequence_enrollments`,
  migration 054) — the Gmail-integrated engine, structurally similar but schema-incompatible
  (event-per-step-row send log vs. per-contact aggregate-state enrollment). All three of its tables
  held 0 rows. Its `/email/campaigns` and `/email/templates` pages were fully functional but
  orphaned — reachable only by typing the URL, linked from nowhere (see "orphaned pages" findings).
- A dead, never-triggered write hook (`campaign_send_id` in `src/lib/email/sender.ts`) hinted at a
  prior, abandoned attempt to bridge the two systems.
- Independent of any consolidation question: `/outreach/sequences` 500'd on every load
  (`followup_sequences` migration never applied to production — a genuine live bug, not a stale-doc
  issue), and `application_followups` (a third, unrelated "follow-up" concept, AG-28) was separately
  confirmed also-unmigrated.
- `FEATURE_REGISTRY_v2.md` row #36 ("Cold Outreach Sequences") and row #38 ("Email Parsing Agent")
  both carried a bare, undated "BUILT" with no live-verification citation.

### Decision (Reid, recorded mid-session)

Consolidate onto Email's sequence engine. Outreach's parallel schema is deprecated, not deleted;
table drops are explicitly deferred to a future decision.

### After (end of day, 2026-08-13)

- **Data migrated, not discarded.** The 1 real `email_campaigns` row and its 2 `campaign_steps`
  copied 1:1 into `email_campaign_sequences`/`email_sequence_steps` inside a single transaction,
  idempotency-guarded, verified by an independent post-commit re-read (see "Data Migration"). The 1
  `campaign_sends` row was **not** force-migrated — a genuine event-log-vs-aggregate-state shape
  mismatch, not a corner case — and was instead exported verbatim to
  `OUTREACH_ROWS_PRE_CONSOLIDATION_2026-08-13.json`. Source rows were left in place throughout;
  nothing was deleted from `email_campaigns`/`campaign_steps`/`campaign_sends`.
- **UI redirected, not deleted.** `/outreach/campaigns`, `/outreach/campaigns/[id]`, and
  `/outreach/sequences` are now server components that unconditionally `redirect("/email/campaigns")`
  (see "UI/nav retirement"). `/api/outreach/send` (a second, zero-caller Resend send path) was
  removed outright — it met this doc's own SAFE bar (Candidate 1) independent of today's UI work.
  `/email` gained `Campaigns`/`Templates` as reachable nav children for the first time; `Outreach`'s
  nav shrank to `Templates` only (a genuinely different, still-separate table pair — Candidate 3,
  still open). `/outreach/templates` (`outreach_templates`) was deliberately left alone.
- **Tables marked deprecated, not dropped.** `COMMENT ON TABLE` applied and read back live on all
  three source tables via `scripts/deprecate-outreach-campaign-tables.sql` (DIRECTIVE-017's
  `psql`/`DATABASE_URL` path). No `DROP`/`TRUNCATE` was run or considered — matches this session's
  explicit instruction and Reid's stated decision that table drops remain deferred.
- **Five live write paths were found still active against the "deprecated" tables and were
  deliberately left untouched**, per this task's own scope (document, don't silently disable):
  `POST`/`PUT /api/agents/campaigns[...]`, a 2-hourly Vercel Cron job
  (`/api/cron/campaigns` → `EmailCampaignAgent`), and the `/api/webhooks/resend` receiver. This is
  the one place "consolidation" is not yet end-to-end true — the UI is fully cut over, the backend
  is not. See "NEEDS REID'S DECISION Item 5," unresolved as of this doc's last entry.
- **Governance docs corrected with dated, cited evidence**, not just re-labeled: `FEATURE_REGISTRY_v2.md`
  row #36 now documents the deprecation, the migration, the export, and the still-live write paths
  in one place; row #38 was split into its three real sub-capabilities per
  `EMAIL_PARSER_VERIFICATION_2026-08-13.md` rather than left as one blanket "BUILT" (see that
  document and this session's `STATE_OF_THE_BUILD.md`/`SESSION_STATE.md` updates for the
  email-parser findings specifically — that verification was a parallel, independent piece of work
  this same session, not part of the outreach/email consolidation itself, and is not re-derived
  here).
- **Build/type gates:** `pnpm run build` and `pnpm tsc --noEmit` both clean as of the final commit
  in this queue.

### What is still open (not resolved by any prompt in this queue)

1. **NEEDS REID'S DECISION Item 5** — retire, keep, or repoint the 3 still-live autonomous/backend
   writers to the deprecated schema (`/api/cron/campaigns`, the two `/api/agents/campaigns` routes,
   `EmailCampaignAgent`, the Resend webhook). Whether any real org has
   `platform_config.key = 'feature.cold_outreach_email'` enabled was never checked this session and
   materially changes the urgency.
2. **`campaign_sends` → `email_sequence_enrollments` modeling gap** — if the one exported E2E-fixture
   contact should ever be represented as "enrolled" in the new engine, someone has to decide
   `current_step`/`next_send_at` semantics; not attempted here by design.
3. **`/outreach/sequences`' own underlying feature (`followup_sequences`)** — still a separate,
   never-applied, application-stage-triggered template-library concept with its own open decision
   (apply migration 083, or retire in favor of AG-28's `application_followups`, which is itself also
   unmigrated) — unaffected by today's redirect, which only changed where the URL points, not
   whether the underlying concept should exist.
4. **Template consolidation (Candidate 3, `outreach_templates` vs. `email_templates`)** — explicitly
   left un-merged this session; still two live, different-shaped template systems.
5. **`row_count = 0` across nearly every table in this doc except the migrated E2E fixture** — this
   consolidation reduced *systems*, not *usage*. No real customer has used any of these features yet;
   don't read this doc's completion as evidence of production traffic.
