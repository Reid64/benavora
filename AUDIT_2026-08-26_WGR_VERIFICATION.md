# Codebase Audit: WGR Claims vs. Actual State
**Date:** 2026-08-26
**Method:** Direct code inspection (grep, file reads, git log), no reliance on prior claims. Live-DB cross-check attempted via Supabase MCP but that connector is bound to unrelated projects (`tarritrix`, `tarritrix-audit`, `hail-intel-resurrected`), not `benavora` (`vbjplpquqxxfbpazyalt`) — DB-state claims below rely on migration files + committed `supabase/.temp/linked-project.json` + prior live-verification evidence files in the repo, not a fresh live query.

---

## 1. Draft Auto-Save (WGR-129) — **PARTIAL**

**Backend exists, but nothing calls it automatically.**
- `src/app/api/drafts/[id]/route.ts:56-120` — `PATCH /api/drafts/[id]` updates `applications.draft_content`, only while `pending_review = true`.
- Neither client page uses this route. Both `draft-generator/page.tsx:1085-1120` and `draft-generator/[id]/page.tsx:125-147` write directly via `supabase.from("applications").update(...)`.
- A `draft_versions` table (`supabase/migrations/009_draft_versions.sql:24-42`) gets a row appended automatically — but only as a side effect of AI *generation* (`src/app/api/ai/draft/route.ts`), not of in-progress editing.

**Frontend has zero keystroke/timer-driven save.**
- `src/components/draft-generator/DraftEditor.tsx:455` — `onChange` only lifts state to the parent, never fetches/saves.
- The only save path is `<Button onClick={onSave}>` at `DraftEditor.tsx:482-489`.
- Repo-wide grep for `useAutoSave`, `handleDraftSave`, `autosave`, `useDebounce`, `debounce(` — **zero hits**. No `setInterval` touches draft state anywhere.

**No `drafts` table exists.** Draft content lives on `applications.draft_content` / `draft_confidence_score` / `draft_template_type` / `pending_review` (`supabase/migrations/001_initial_schema.sql`). `draft_versions`, `draft_queue`, `draft_automation_config` exist but are history/cron-pipeline tables, not an editor-autosave table.

**Verdict:** Persistence plumbing is real; the actual feature ("saves your edits automatically as you type") does not exist — every save is a manual click or a side effect of AI generation.

---

## 2. Email / Mail Merge (WGR-007) — **PARTIAL**

**Real, working send infrastructure — three parallel, non-unified engines:**
- **Sales Outreach** — `src/lib/admin/sales-campaign-engine.ts` → raw `fetch("https://api.resend.com/emails")` (`:406-418`), reads `sales_campaigns`/`sales_campaign_steps`/`sales_sends`/`prospects`/`prospect_lists`.
- **Cold Outreach / Email Campaign Agent** — `src/lib/agents/email-campaign.ts` → Gmail send (`sender.ts:70-128`), reads `outreach_contacts`, `campaign_steps`.
- **Sequence Engine** — `src/lib/email/sequence-engine.ts:189` → `resend.emails.send`, reads `email_sequence_enrollments`.

**Implemented:** `{var}` template substitution (3 independent renderers — `template-engine.ts:17-30`, `email-campaign.ts:539-557`, `sales-campaign-engine.ts:57-59`), recipient filtering (state/revenue/NAICS), multi-step scheduling (`next_send_at`, `delay_days`), bulk send loops (capped, e.g. `MAX_SENDS_PER_RUN = 50`), and enforced suppression (`suppression_list` table, checked pre-send in `sales-campaign-engine.ts:322-339`, public unsubscribe flow at `src/app/api/unsubscribe/route.ts`).

**Gaps:**
- `vercel.json` registers only 5 crons (`research`, `grantsgov`, `reminders`, `autoapply`, `domain-warmup`) — **`/api/cron/campaigns`, `/api/cron/sales-sends`, `/api/cron/email-sequences` are not registered**, despite header comments claiming Vercel Cron drives them. The scheduling logic is real; nothing fires it automatically today.
- `sequence-engine.ts` does **not** check `suppression_list` at all — only the Sales Outreach engine enforces suppression.
- **Not integrated with prospect intelligence.** Reads its own `prospects`/`outreach_contacts` tables; zero cross-references anywhere to `corporate_prospects` or `donor_discovery_directory`.
- Repo's own `OUTREACH_CONSOLIDATION_AUDIT.md` (2026-08-13) documents this as three overlapping, largely-duplicate systems, most tables at 0 rows in production.

**Verdict:** Functionally real per-engine, architecturally fragmented, and not actually scheduled in the deployed cron config.

---

## 3. State Machine (WGR-130/131) — **PARTIAL, inconsistently safe**

**Correction to task framing:** WGR-130/131 target `applications.stage` (the grant pipeline), not a table literally named "prospect." The actual prospect-shaped table with a stage/status column is `donor_discovery_prospects.pipeline_stage`.

**`applications.stage` — FIXED, atomic, live-verified.**
`supabase/migrations/141_application_stage_transition_trigger.sql:73-127` is a Postgres `BEFORE UPDATE` trigger enforcing the same `FORWARD` graph as `src/components/applications/pipeline.ts:getTransitionRule()`, raising `23514` on an illegal (OLD,NEW) pair — enforced inside the same statement, no read-then-write window. Live-verified: `test-evidence/remediation/migration-drift/wgr130-131-prod-verify.sql:36-51` (legal transition persists; illegal one raises and rolls back).

Before migration 141, validation lived only in one UI component (`StageTransitionModal.tsx`); `executeTransition()` and any raw `.update({stage})` enforced nothing — live-reproduced 10-stage illegal skip is documented in `WIRING_GAP_REGISTER.md:44-45`.

**`donor_discovery_prospects.pipeline_stage` — NO transition validation, race-prone.**
`src/app/api/donor-discovery/prospects/[id]/route.ts:88-101,120-150`:
```ts
// only checks enum membership, not legality of the transition:
if (!PIPELINE_STAGES.includes(pipeline_stage)) return 400;

const { data: existing } = await supabase
  .from("donor_discovery_prospects")
  .select("id")                         // note: not selecting current pipeline_stage
  .eq("id", id).eq("organization_id", organizationId)
  .maybeSingle();
if (!existing) return 404;

const { error } = await supabase
  .from("donor_discovery_prospects")
  .update(update)
  .eq("id", id)
  .eq("organization_id", organizationId);   // no .eq("pipeline_stage", expected) guard
```
No DB trigger exists on this table (confirmed absent from prod schema dump). Any stage can jump to any other in one PATCH (`new → archived` directly), and two concurrent PATCHes can stomp each other.

`corporate_prospects` has no state column at all. `pil_prospects.status` (`active/archived/merged`) is a soft-delete flag, not a workflow.

**Verdict:** As literally scoped (`applications.stage`), WGR-130/131 is done and safe. The actual "prospect" pipeline table has no state machine at all.

---

## 4. SAM.gov Parser (WGR-139/142/143) — **PARTIAL**

**The underlying bugs are fixed and live-verified** (real API responses, `shapeOk: true`, 100/10/678 records in `test-evidence/remediation/int-fix/wgr-{139,142,143}-*-live-after.json`). Files:
- `src/lib/sources/samgov-client.ts` (`searchSamGovOpportunities`, WGR-139)
- `src/lib/donor-discovery/adapters/samgov-adapter.ts` (`searchEntitiesByNaics`=WGR-142, `searchRecentAwardRecipients`=WGR-143)

**But the specific claim — "handles both old and new API response formats" — is not substantiated by the code.** Each parser hardcodes exactly one response shape with no version detection and no dual-format fallback:
```ts
// samgov-client.ts:45-47 — single fixed shape, no branching
interface SamGovSearchResponse { opportunitiesData?: RawOppHit[] }
```
```ts
// samgov-adapter.ts:231-243 — comment documents a bug FIX (flat→nested), not a compatibility shim:
// "The real API nests the awardee block under `award`, not top-level"
interface RawAwardOpportunity { award: { awardee: {...} } }  // only this shape handled
```
All three fail closed on parse error (empty array / thrown `SamGovError`) rather than retrying against an alternate shape.

Git history confirms this: commits `754fa98` and `1f03cd0` are about date-range/page-size **parameter boundary bugs** and one field-nesting correction — neither commit message nor any code comment anywhere mentions "old format"/"new format"/API versioning.

**Verdict:** The reported SAM.gov failures are genuinely resolved; the "dual-format" framing of the fix does not match what's in the code — there's one correct format handled, not two tolerated.

---

## 5. SSRF (WGR-108/109/110) — **FIXED**

All three originally-flagged sites now route through a shared, DNS-rebinding-resistant guard:

```ts
// src/lib/security/ssrf-guard.ts — canonical guard
// blocks non-http(s) schemes, RFC1918/loopback/CGNAT/link-local
// (incl. 169.254.169.254 cloud metadata), IPv4 + IPv6, fails closed
```
```ts
// src/lib/security/safe-fetch.ts — safeFetch(): pins TCP connection to the
// validated IP and re-validates every redirect hop (closes DNS-rebinding gap)
```

| Site | Status |
|---|---|
| `src/app/api/intelligence/ingest/route.ts:58-73` | `safeFetch(url)`, 422 `url_blocked` on `SsrfBlockedError` |
| `src/lib/autoapply/webhook-notifier.ts:122-136` | `safeFetch(config.webhook_url)`, logs+skips on block |
| `worker/queue-processor.ts:636-645` | `assertUrlSafe(portalUrl)` before health-check + headless `page.goto` |

Unit tests: `src/__tests__/unit/ssrf-guard.test.ts`. Live-verification evidence: `test-evidence/remediation/ssrf-fix/*` (real loopback listener + real DNS).

**Adjacent gap found (not WGR-108/109/110):** `src/app/api/integrations/custom-api/test/route.ts:14-73,139` reimplements its own weaker, non-pinned validator (`assertSafeTargetUrl`) instead of importing `safeFetch` — its own comment admits: *"Resolve-then-check has a DNS-rebinding gap … acceptable for this admin-only, low-volume 'test connection' action."* Recommend migrating it to `safeFetch` for consistency.

**Verdict:** All three named P0s fixed and evidenced. One unrelated, lower-severity SSRF gap remains in an admin-only "test connection" endpoint.

---

## 6. Migrations (WGR-163/164) — Confirmed present, but split across two diverging directories

**`supabase/migrations/` (repo root):** 166 files, 001→164. Last 10: `155_pil_agent_registry.sql` … `164_pil_rel_07_08_registry.sql`.
**`src/supabase/migrations/`:** 57 files, 072→127. Last 10 end at `127_fix_marketplace_rls_recursion.sql`.

These are **diverged, not duplicates** — root is 30+ migrations ahead and on an entirely different feature track (`pil_*` Prospect Intelligence Layer) that `src/supabase/migrations/` never received; `src/` continues its own independent track (marketplace, personalization) that root doesn't have.

**`pil_prospect_dossiers`** — found only in `supabase/migrations/163_pil_prospect_dossiers_and_feature_flags.sql`:
```sql
CREATE TABLE IF NOT EXISTS pil_prospect_dossiers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  prospect_id       uuid NOT NULL REFERENCES pil_prospects(id) ON DELETE CASCADE,
  research_run_id   uuid REFERENCES pil_research_runs(id),
  dossier           jsonb NOT NULL,
  narrative_text    text NOT NULL,
  generated_at      timestamptz NOT NULL DEFAULT now(),
  version           integer NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now()
);
```

**`pil_feature_flags`** — same file:
```sql
CREATE TABLE IF NOT EXISTS pil_feature_flags (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_key      text NOT NULL,
  scope_type    text NOT NULL DEFAULT 'platform' CHECK (scope_type IN ('platform','org','agent')),
  scope_id      text,
  enabled       boolean NOT NULL DEFAULT false,
  reason        text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (flag_key, scope_type, scope_id)
);
```
Migration 163's own header notes these tables "did not exist anywhere in migrations 150-162."

**Which directory is live:** the repo root has a **committed, tracked** `supabase/.temp/linked-project.json` → `{"ref":"vbjplpquqxxfbpazyalt","name":"benavora",...}`, written by `supabase link`. No equivalent artifact exists under `src/supabase/`. This is strong (not conclusive) evidence root is the applied directory. Could not independently confirm against the live DB — the connected Supabase MCP session has no access to project `vbjplpquqxxfbpazyalt`.

**Verdict:** Both tables exist in the migration files (root directory only). Live-apply status is inferred, not directly confirmed.

---

## 7. Database Schema — `drafts` table / prospect state column

**No `drafts` table exists in either migrations directory** — confirmed via case-insensitive search, only incidental comment mentions turned up (e.g. `013_alerts.sql`, `057_draft_automation_pipeline.sql`). Draft content is a set of columns on `applications` (see §1), plus the separate `draft_versions` history table (`009_draft_versions.sql:24-42`).

**Prospect state column:** `donor_discovery_prospects.pipeline_stage donor_discovery_pipeline_stage` — enum `(new, reviewing, contacted, applied, received, rejected, archived)` defined in `supabase/migrations/067_donor_discovery_foundation.sql:18-20,103-114`. Live presence confirmed via `test-evidence/remediation/migration-drift/prod-schema-baseline-20260821-174317.sql:2455-2469` (despite the migration file itself carrying a stale "File only — not applied to production" comment). No transition-legality trigger exists on it (see §3).

---

## Verdict Summary

| ID | Feature | Verdict |
|---|---|---|
| WGR-129 | Draft auto-save | **PARTIAL** — save plumbing real, no automatic/keystroke trigger exists |
| WGR-007 | Email / mail merge | **PARTIAL** — 3 real but disconnected engines, cron not registered, not integrated with prospect intel |
| WGR-130 | `applications.stage` transitions | **FIXED** — atomic DB trigger, live-verified |
| WGR-131 | (same fix as WGR-130) | **FIXED** — see above |
| — | `donor_discovery_prospects` state (the actual "prospect" table) | **MISSING** — enum-only validation, no transition legality, race-prone |
| WGR-139 | SAM.gov opportunities parser | **FIXED** (bug), dual-format claim **not substantiated** |
| WGR-142 | SAM.gov entity parser | **FIXED** (bug), dual-format claim **not substantiated** |
| WGR-143 | SAM.gov award-notices parser | **FIXED** (bug), dual-format claim **not substantiated** |
| WGR-108 | SSRF: intelligence ingest | **FIXED**, live-verified |
| WGR-109 | SSRF: AutoApply webhook notifier | **FIXED**, live-verified |
| WGR-110 | SSRF: worker portal health/goto | **FIXED**, live-verified |
| — | SSRF: custom-api "test connection" (adjacent, unflagged) | **PARTIALLY MITIGATED** — weaker bespoke validator, DNS-rebinding gap |
| WGR-163 | `pil_prospect_dossiers` migration | **PRESENT** in root `supabase/migrations/163_*.sql`; live-apply status inferred, not directly confirmed |
| WGR-164 | `pil_feature_flags` migration | **PRESENT**, same file/caveat as WGR-163 |
| — | Two migrations directories reconciled | **UNRESOLVED** — genuinely diverged, not just stale copies; root inferred live via linked-project.json |
| — | `drafts` table exists | **MISSING** — no such table anywhere; drafts live on `applications.*` + `draft_versions` |
