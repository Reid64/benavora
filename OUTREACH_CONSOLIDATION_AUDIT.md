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
