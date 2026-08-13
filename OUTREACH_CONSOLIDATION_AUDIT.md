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
