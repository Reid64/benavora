# Nav / Admin Surface Audit

Date: 2026-07-26
Scope: primary navigation definition, all pages under the platform-admin section, the org-facing Outreach feature, and the backing API routes. Read-only audit — no files were modified.

Sources read in full: `src/components/layout/DashboardShell.tsx`, `src/components/layout/Sidebar.tsx`, `src/components/layout/nav-items.ts`, all 12 files under `src/app/(dashboard)/admin/**`, all 26 files under `src/app/api/admin/**`, all 5 files under `src/app/(dashboard)/outreach/**`, plus the worker scheduler chain for the AG-38 verification.

Note on paths: the user's task described the admin/outreach trees as `src/app/admin/`, `src/app/outreach/`, `src/app/admin/sales-outreach/`, `src/app/admin/improvements/`, `src/app/admin/organizations/`. None of those exact paths exist. The real locations are `src/app/(dashboard)/admin/*` and `src/app/(dashboard)/outreach/*` (the `(dashboard)` route group doesn't appear in the URL), and the org list page is `src/app/(dashboard)/admin/orgs/` not `.../organizations/`. This audit covers the real files.

---

## 1. Primary nav definition

`src/components/layout/DashboardShell.tsx` composes `Header` + `Sidebar`; the actual nav item list lives in `src/components/layout/nav-items.ts` and is rendered by `src/components/layout/Sidebar.tsx`.

- **`NAV_ITEMS`** (main list, visible to all authenticated users, no role filtering applied by `navItemsForRole` since none of these items set a `roles` field): Alerts, Activity, Funders, Foundations, Contacts, Applications, Documents, Knowledge Base, Intelligence Library, Deadlines, Compliance, Outcomes & Analytics, Financials, Reports (children: Simulator, ROI Insights), Intelligence (11 children), Email, **Outreach** (children: Campaigns, Templates, Sequences).
- **`PROGRAMS_NAV_ITEMS`** / **`RESOURCES_NAV_ITEMS`**: SchoolFunder, Nonprofit Directory — always visible, not role-gated.
- **`PLATFORM_NAV_ITEMS`**: Command Center (`/command-center`), Organizations (`/admin/orgs`), System Health (`/admin/system`), Import (`/import`), Sales Outreach (`/admin/sales-outreach`), AutoApply Ops (`/admin/autoapply-ops`), Monitor (`/admin/monitor`), Improvements (`/admin/improvements`), Audit Log (`/admin/audit-log`).
- **Gating**: the entire Platform section is wrapped in `Sidebar.tsx` by `isPlatformAdmin = role === "owner" || role === "admin"` (line 243). This is a single blanket check for the whole section — none of the individual `PLATFORM_NAV_ITEMS` entries carry a per-item `roles` array. **This blanket gate does not match what the pages/routes behind it actually enforce** — see §4 below.

---

## 2. Admin dashboard pages (`src/app/(dashboard)/admin/**`)

| File | Route | Data source | In-page permission check | Functional? |
|---|---|---|---|---|
| `admin/page.tsx` | `/admin` | Server component, service-role: `organizations`, `profiles`, `subscriptions`, `opportunities` (cross-tenant aggregation) | **Server-side, owner-only**: `checkPermission(user.id, "owner", supabase)` → `redirect("/dashboard?notice=owner_required")` | Real — live cross-tenant queries and tables |
| `admin/sales-outreach/page.tsx` | `/admin/sales-outreach` | Client: `/api/admin/campaigns`, `/api/admin/domains`, `/api/admin/prospects[/​{id}]`, `/api/admin/suppression[/import]`, `/api/admin/sales-analytics` | **Client-side only**: `useProfile()`, owner/admin → else "Admins only" | Real — full CRUD/CSV/analytics against named routes |
| `admin/autoapply-ops/page.tsx` | `/admin/autoapply-ops` | None (dynamic `ssr:false` loader for the client component, code-split to avoid bundling recharts) | None (delegated) | Functional as a loader shim |
| `admin/autoapply-ops/AutoApplyOpsClient.tsx` | (same route) | Client: `/api/admin/autoapply-ops` (single GET) | **Client-side only**: owner/admin → else "Admins only" | Real — worker health, submission metrics, costs, portal health, tenant activity all from one real endpoint. `ALERT_RULES` table is static UI copy, not fetched. |
| `admin/improvements/page.tsx` | `/admin/improvements` | Client: `/api/admin/improvements[/​{id}]` (reads `improvement_proposals`, `agent_performance_metrics`) | **Client-side only**: owner/admin → else "Admins only" | Real — live fetch/PATCH, stats, per-agent table, approve/reject. Also the source of the AG-38 claim (§5). |
| `admin/monitor/page.tsx` | `/admin/monitor` | Client: `/api/admin/monitor` (30s poll; `automation_queue`), `/api/admin/jobs/{id}/retry` | **Client-side only**: owner/admin → else "Admins only" | Real — live polling dashboard with working retry action |
| `admin/orgs/page.tsx` | `/admin/orgs` | Server component, service-role: `organizations`, `subscriptions`, `agent_runs` (7-day window) | **Server-side, owner-only**: `checkPermission(user.id, "owner", supabase)` | Real |
| `admin/orgs/OrgsListClient.tsx` | (same route) | In-memory filtering over server-passed props; one live call: `/api/admin/orgs/{id}/impersonate` | None of its own (inherits parent's server redirect) | Real |
| `admin/orgs/[id]/page.tsx` | `/admin/orgs/[id]` | Server component, service-role, org-scoped: `organizations`, `subscriptions`, `profiles`, `opportunities`, `applications`, `knowledge_base`, `agent_runs`, `strategic_recommendations`, `org_autonomous_config` | **Server-side, owner-only**: same `checkPermission` | Real — 8 parallel real queries |
| `admin/orgs/[id]/OrgDetailTabs.tsx` | (same route) | Tabs over server-passed props; live POSTs: `/api/admin/orgs/{id}` (run_pipeline/reset_onboarding/upgrade_plan), `/api/admin/orgs/{id}/suspend` | None of its own (inherits parent) | Real — 6 tabs, working actions |
| `admin/system/page.tsx` | `/admin/system` | Client: `/api/admin/system` (10s poll: `worker_status` heartbeats, queue depths, running agents), POST `clear_stuck_jobs` | **Client-side only**: view = owner/admin; the destructive clear action further restricted to `role === "owner"` | Real |
| `admin/audit-log/page.tsx` | `/admin/audit-log` | Client: `/api/admin/audit-log` (`audit_logs`, `profiles`, `organizations`) | **Client-side only**, and the file's own comment states this is a "second barrier" — it explicitly documents that the real enforcement is expected to live in the API route | Real — filtering, CSV export, audit-logs-the-export-itself |

**Finding — owner-vs-admin mismatch (real bug, not a documentation gap):** `/admin`, `/admin/orgs`, and `/admin/orgs/[id]` use a server-side redirect gated to **owner only** (`checkPermission(user.id, "owner", ...)`), but the sidebar shows the entire Platform section — including "Organizations" and by implication `/admin` itself — to **admin** role as well (`isPlatformAdmin` in `Sidebar.tsx`). A logged-in `admin` (non-owner) will see and click "Organizations" in the nav and get bounced to `/dashboard?notice=owner_required`. The other six admin pages (`sales-outreach`, `autoapply-ops`, `improvements`, `monitor`, `system`, `audit-log`) correctly allow admin, matching the sidebar gate.

---

## 3. Admin API routes (`src/app/api/admin/**`)

Two structurally different, non-interoperable gating mechanisms are in use across the 26 route files:

- **`requireRole(role)`** (`src/lib/auth/role-gate.ts`) — real RBAC: reads `profiles.role`, checks against the owner/admin/writer/viewer hierarchy. Used by: `usage`, `autoapply-ops`, `jobs/[id]/retry`, `orgs*` (owner), `platform-metrics` (owner), `improvements*`, `monitor`, `system` (admin for GET, **owner** for the destructive POST), `audit-log`.
- **`requireAdmin(request)`** (`src/lib/admin/auth.ts`) — **not role-based at all**. It checks the caller's `user.id` against a hardcoded `Set` built from a single env var `PLATFORM_ADMIN_USER_ID`. The file's own comment: *"MVP: Reid's user ID is the only platform admin... A future iteration should check a platform_admins table instead."* Used by: `domains*`, `prospects*`, `suppression*`, `campaigns*`, `sales-analytics*` — i.e. every "sales outreach ops" route. One of these files (`orgs/[id]/suspend/route.ts`) explicitly flags this exact split as a known, deliberate divergence in its own comments, not an oversight.
- **Svix HMAC webhook verification** (no user session) — correctly used by `webhooks/email-events` and `webhooks/email-reply` (Resend calls these directly). Fails closed (500) if `RESEND_WEBHOOK_SECRET` is unset.

All 26 routes were confirmed genuinely functional (real Supabase queries/writes, real Stripe portal integration on `orgs/[id]`, real CSV parsing, real cross-table aggregation) — none is a stub that fakes success or silently swallows errors. Two notable non-bug caveats found:
- `orgs/[id]/impersonate` sets an audit-logged cookie but, per its own comment, doesn't rewire `organization_id` resolution anywhere else — it's intentionally scoped down from what "impersonate" implies, not broken.
- `platform-metrics`'s `revenue_this_month` uses a hardcoded `PLAN_PRICES` map rather than real Stripe amounts (commented as "hardcoded per task spec").

**Practical consequence of the gating split:** changing a user's `profiles.role` (the system's actual RBAC surface, and what the sidebar's Platform-section visibility is based on) has **zero effect** on 10 of these 26 routes. Someone who is `role = "admin"` but isn't the one hardcoded `PLATFORM_ADMIN_USER_ID` will see the Sales Outreach nav item and its page (client-gate passes), but every API call the page makes will 403.

---

## 4. Org-facing Outreach (`src/app/(dashboard)/outreach/**`)

This is a **separate system from admin Sales Outreach** — confirmed no shared tables or routes. Org-facing Outreach uses `outreach_contacts`, `email_campaigns`, `campaign_steps`, `campaign_sends`, `outreach_templates`, `followup_sequences` via `/api/outreach/*` and `/api/agents/campaigns*` / `/api/agents/outreach`. Admin Sales Outreach uses `sales_campaigns`, `prospects`, `suppression_list` via `/api/admin/*`. Don't conflate the two "outreach" concepts.

| File | Route | Data source | Permission check | Functional? |
|---|---|---|---|---|
| `outreach/page.tsx` | `/outreach` | Direct Supabase client query on `outreach_contacts`; "Scan company" POSTs `/api/agents/outreach` | View: none. `canEdit` (owner/admin/writer) gates the scan action only | Real |
| `outreach/campaigns/page.tsx` | `/outreach/campaigns` | Direct queries: `email_campaigns`, `campaign_steps`, `campaign_sends`; writes `email_campaigns.update` for activate/pause | View: none. `canEdit` gates mutation controls | Real — genuine multi-table aggregation, real CRUD |
| `outreach/campaigns/[id]/page.tsx` | `/outreach/campaigns/[id]` | `GET/PUT/POST /api/agents/campaigns/{id}` (detail, status change, run-sends-now); direct writes to `outreach_contacts`/`email_campaigns`/`campaign_steps` for the enroll/edit-step modals | View: none. `canEdit` gates all actions | Real — the most substantial of the five; live stats, real send trigger |
| `outreach/templates/page.tsx` | `/outreach/templates` | `GET/POST /api/outreach/templates` → verified server route does real CRUD on `outreach_templates`, org-scoped, `requireRole("viewer")`/`("writer")` | Page: none (relies on server route). Server route: real RBAC | Real — full CRUD confirmed at both layers |
| `outreach/sequences/page.tsx` | `/outreach/sequences` | `GET/POST /api/outreach/sequences` → verified server route does real CRUD on `followup_sequences`, org-scoped, `requireRole` gated | Page: none (relies on server route). Server route: real RBAC | Real |

**Mail-merge search**: one hit in the entire repo — `CORPORATE_INTELLIGENCE_ARCHITECTURE.md:379`, a single aspirational bullet ("route to physical mail merge") in a routing-logic doc. No page, API route, or component implements mail merge anywhere. The closest real feature is the `physical_mail` channel label on `outreach_templates` and the `mail` step type in `followup_sequences` — these are just channel tags on manually-authored bodies, with no merge-field engine behind them.

---

## 5. AG-38 "nightly improvement agent" — verdict: real and wired, target tables' live-prod status unresolved

**The claim is accurate at the code level.** AG-38 is not a dead reference — it's registered in an always-on scheduler inside the Railway worker process, not a Vercel/GitHub Actions cron:

1. `worker/Dockerfile` runs `node worker/dist/worker/index.js` as a persistent Railway service (`restartPolicyType: ON_FAILURE`), not a one-shot job.
2. `worker/index.ts` calls `scheduler.start(supabase)` unconditionally at boot.
3. `worker/scheduler.ts` registers `'AG-38 self-improvement pipeline'`, fires once daily at 4:00 AM America/Chicago (checked every 60s via `setInterval`, `lastFiredOnDateKey` guard prevents double-fire), and on fire calls `runSelfImprovementPipeline(supabase)`.
4. `worker/autonomous-orchestrator.ts`'s `runSelfImprovementPipeline` instantiates `SelfImprovementAgent` (`src/lib/agents/self-improvement-agent.ts`) and runs it.
5. `self-improvement-agent.ts` has real logic: computes per-agent metrics, upserts `agent_performance_metrics`, inserts `improvement_proposals`, applies confidence/dedup filtering, escalates via `alerts`. Not a stub.
6. `src/app/api/admin/improvements/route.ts` (backing the admin page) is read-only — it only selects from those two tables; it never triggers a run. The page's "AG-38 runs nightly..." copy is describing the worker-side scheduler, and that description is accurate.

**Unresolved caveat, consistent with existing project memory on the two-migrations-directory problem:** `improvement_proposals`, `agent_performance_metrics`, and the `ag-38-self-improvement` value on the `agent_type` enum are defined only in `src/supabase/migrations/{087,088,100}_*.sql`. The root `supabase/migrations/` track (087–106) has entirely different content for those numbers — no trace of these tables there. I attempted to check the live database directly via the connected Supabase MCP, but `list_projects` only returns unrelated "tarritrix" projects, not the live benavora project (ref `vbjplpquqxxfbpazyalt`) — consistent with prior sessions' note that live prod isn't reachable via this MCP. This was not re-resolved in this audit.

**If root `supabase/migrations/` is what's actually live**, the nightly job still runs every night, but its `.upsert()`/`.insert()` calls would fail against nonexistent tables — and that failure is swallowed: `runSelfImprovementPipeline`'s caller wraps it in try/catch and only `console.error`s. In that scenario the admin Improvements page would show permanently empty results not because AG-38 doesn't run, but because it runs and silently fails every night. This needs a direct prod query to settle definitively (out of scope for this read-only repo audit).

---

## 6. Summary of actionable findings

1. **Owner/admin mismatch** on 3 of 9 Platform nav items (`/admin`, `/admin/orgs`, `/admin/orgs/[id]` are owner-only server redirects; sidebar shows them to admin too).
2. **Two incompatible admin-route gates coexist**: `requireRole` (real RBAC) vs. `requireAdmin` (single hardcoded user ID via env var) — 10 of 26 admin API routes ignore `profiles.role` entirely.
3. **6 of 12 admin pages have no server-side permission check** — only a client-side `useProfile()` role check that renders an "Admins only" panel. The page shell and its JS bundle are reachable by any authenticated user; real enforcement (where it exists) is pushed down to whichever API routes the page calls.
4. **Mail merge doesn't exist** — one aspirational doc mention, no implementation.
5. **AG-38 is real and scheduled**, but whether its target tables exist on live prod is unresolved (same open question as `platform_learning_patterns` flagged in earlier project memory) — worth a direct prod check before trusting the Improvements page's contents.
6. **Org-facing Outreach and admin Sales Outreach are fully separate systems** with no shared tables/routes — safe to reason about independently.

---

## RESOLVED (2026-07-26) — findings #1, #2, #3 closed

Findings #1–#3 (the owner/admin mismatch, the `requireAdmin` env-var stopgap, and the
6 pages with client-only checks) are fixed. #4–#6 are unchanged/out of scope for this pass.

**1. `requireAdmin` replaced with `requireRole("owner")` on all 11 sales-ops route files**
(the 5 route groups named in the task — `domains`, `prospects`, `suppression`,
`campaigns`, `sales-analytics` — cover 11 files once `[id]`/sub-routes are counted):
`domains/route.ts`, `domains/[id]/route.ts`, `prospects/route.ts`,
`prospects/[id]/route.ts`, `prospects/stats/route.ts`, `suppression/route.ts`,
`suppression/import/route.ts`, `campaigns/route.ts`, `campaigns/[id]/route.ts`,
`sales-analytics/route.ts`, `sales-analytics/export/route.ts`. Each now opens with
`const gate = await requireRole("owner"); if ("error" in gate) return gate.error;` —
the same pattern already used by `orgs/[id]/suspend/route.ts`. `profiles.role` is now
the single source of truth for every admin API route; `PLATFORM_ADMIN_USER_ID` no
longer gates anything. `src/lib/admin/auth.ts` (the `requireAdmin` env-var check) had
zero remaining callers after this change and was deleted.
`tests/api/admin-sales.test.ts` was updated to mock `@/lib/auth/role-gate`'s
`requireRole` instead of the deleted module (one pre-existing, unrelated failure in
that file — `DomainManager throws` expecting the raw error message in the response —
predates this change and was left alone).

**2. Server-side `owner`-only gate added to the 6 pages that previously relied on a
client-side-only `useProfile()` check:**
`admin/sales-outreach/page.tsx`, `admin/autoapply-ops/page.tsx`,
`admin/improvements/page.tsx`, `admin/monitor/page.tsx`, `admin/system/page.tsx`,
`admin/audit-log/page.tsx`. Each was split into a thin `async` Server Component
`page.tsx` (calls `checkPermission(user.id, "owner", supabase)` and
`redirect("/dashboard?notice=owner_required")` on failure — the identical pattern
`admin/page.tsx` and `admin/orgs/page.tsx` already used) plus a sibling
`*Client.tsx`/`*Loader.tsx` holding the original client component unchanged.
`autoapply-ops` needed an extra `AutoApplyOpsLoader.tsx` hop because
`next/dynamic(..., { ssr:false })` requires a Client Component boundary, and the new
`page.tsx` has to stay a Server Component to run the redirect. The pre-existing
client-side `useProfile()` checks were left in place as defense-in-depth/UX (instant
"Admins only" panel while the server round-trip is in flight for anyone who somehow
still reaches the client bundle) — the server redirect is what actually blocks access
now, per finding #3's own recommendation.

**3. Sidebar's Platform section gated to `owner` only.** `isPlatformAdmin` in
`src/components/layout/Sidebar.tsx` was `role === "owner" || role === "admin"`; it's
now `role === "owner"`, matching every page/route behind it (all 9 `PLATFORM_NAV_ITEMS`
are owner-only server-side after this fix, closing the exact mismatch finding #1
described for `/admin`, `/admin/orgs`, and `/admin/orgs/[id]` — now extended
consistently to the other 6).

**Verification:** `pnpm tsc --noEmit` passes clean. Non-owner-admin access was verified
two ways: (a) a new e2e spec, `e2e/admin-owner-gate.spec.ts`, drives a real
non-owner `admin`-role account (helper `ensureAdminNonOwnerAccount` in
`tests/e2e/helpers.ts`) to `/admin/orgs` and `/admin/sales-outreach` and asserts the
`/dashboard?notice=owner_required` redirect, plus asserts the Platform nav items are
absent from the DOM; (b) because this sandbox's shell could not reach a freshly
spawned `next dev` server over localhost (pre-existing dev servers from other
sessions on :3000/:3001 were reachable; a new one on an unused port was not — a
sandbox networking quirk, unrelated to this change), the fix was additionally
verified directly against the real Supabase project: `checkPermission(userId,
"owner", supabase)` — the exact call every converted `page.tsx` makes — returns
`{ allowed: false, userRole: "admin" }` for the real non-owner test account and
`{ allowed: true, userRole: "owner" }` for the owner test account. The e2e spec is
committed and will run normally in a non-sandboxed dev environment or CI.

**Not touched (per task scope):** page content, styling, and the
Improvements/SchoolFunder items. `admin/orgs/[id]/suspend/route.ts` already used
`requireRole("owner")` before this pass; only its comment (which referenced the
now-removed `requireAdmin` split as if still current) was updated for accuracy.

---

## AG-38 STATUS (2026-07-26 follow-up — supersedes §5/§6 point 5)

**Note on requested path:** the task asked for `src/lib/worker/scheduler.ts`. That path
doesn't exist. The real file is `worker/scheduler.ts` (confirmed via `find`; the only
`scheduler.ts` files in the repo are `worker/scheduler.ts`, `src/lib/agents/scheduler.ts`,
and `src/lib/agents/research/scheduler.ts` — the latter two are unrelated agent-internal
schedulers, not the worker cron). Read in full.

**Schedule:** `worker/scheduler.ts` lines 59–68, job name `'AG-38 self-improvement
pipeline'`, `hour: 4, minute: 0` — fires once daily at **4:00 AM America/Chicago**. Not a
real cron string: the scheduler checks wall-clock time every 60s (`CHECK_INTERVAL_MS`)
against every job's fixed `hour`/`minute`, guarded by `lastFiredOnDateKey` so it can't
double-fire the same calendar day. On fire it calls `runSelfImprovementPipeline(supabase)`
→ `worker/autonomous-orchestrator.ts:973` → `new SelfImprovementAgent(supabase).run('schedule')`.

**Enabled/gated:** no feature flag or env var gates this job — unlike the
`foundation-enrichment-weekly` entry two slots below it (gated on
`process.env['ENABLE_SCRAPER'] === 'true'`), AG-38 has no such check in `scheduler.ts`,
and `self-improvement-agent.ts` is platform-wide (not `AutonomousAgent`-based, no
`org_autonomous_config` toggle applies to it — see the class's own header comment). It
runs unconditionally whenever the worker process is up and the clock hits 4:00 AM CST.

**Conditions to write `agent_performance_metrics`:** `calculateAgentMetrics()`
(self-improvement-agent.ts:416) upserts one row per distinct `agent_type` seen in
yesterday's (UTC calendar day) `agent_runs`, keyed on `(agent_id, metric_date)` —
condition is simply `metricRows.length > 0`, i.e. at least one `agent_runs` row existed
yesterday for any agent.

**Conditions to write `improvement_proposals`:** two independent paths —
1. Claude-generated proposals (steps 3–5): `generateProposals()` calls Claude with the
   trailing metrics/underperformer/pattern summary; each returned proposal must (a) not
   be one of the three hard-forbidden types (`code_change`/`schema_change`/
   `permission_change` — rejected before insertion, no exceptions), (b) pass field
   validation (non-empty title/description/evidence, recognized `proposal_type`), (c)
   have `confidence_score >= 70` (`MIN_CONFIDENCE_TO_PROPOSE`), and (d) not match an
   existing proposal of the same `(proposal_type, affected_agent_id)` within the last 30
   days, nor a *rejected* one within the last 90 days. Only survivors get inserted with
   `status: 'proposed'`.
2. The weekly performance report (`generateWeeklyReport()`, step 7): unconditionally
   inserted every **Sunday, America/Chicago** (`isSundayChicago()`), regardless of
   whether any Claude proposals were generated — `proposal_type: 'performance_report'`,
   `confidence_score: 100`, not subject to the confidence/dedup filters above.

**Railway execution check — AG-38 has never run in production:**

- `railway status` shows the linked `benavora-worker` service (project
  `1d79d4e6-f529-4903-9577-7085b3ab126b`) currently in status **`Failed`**.
- `railway deployment list --limit 1000 --json` returned all 321 deployments on record
  (back to 2026-06-20). **Zero have status `SUCCESS`.** Every deployment from
  2026-07-19 05:38 UTC onward is `FAILED`; the most recent attempt is
  **2026-07-21 05:59:43 UTC (00:59:43 CDT)**, also `FAILED`, and there have been **no
  deploy attempts since** (checked through today, 2026-07-26 — a 5-day gap).
- The failing build (`railway logs` on the latest deployment) errors during
  `pnpm run build:worker`, unrelated to AG-38 itself: TypeScript `TS18048`
  (`'prospect' is possibly 'undefined'`) in `worker/autoapply-autonomous-orchestrator.ts`
  and `TS2339` (missing `matched`/`found` properties on `AutonomousAgentResult`) in
  `worker/autonomous-orchestrator.ts`. The Docker build never completes, so the container
  never starts.
- The last deployment that wasn't a build failure is `7379f5a5-10be-44b0-bf6a-dbe78397a9e6`,
  created **2026-07-19T05:38:38Z**, commit `1d3bf1a` ("feat: autonomous config,
  decisions, queue, and trigger API routes"). Pulling its full runtime logs
  (`railway logs <id> -d --filter "Scheduler" --since 30d`) turns up **exactly one**
  scheduler line in its entire run history: `[Scheduler] 2:00 CST reached — starting
  nightly autonomous pipeline.` No `AG-38`, no `4:00`, ever.
- **Why:** AG-38 was added to `worker/scheduler.ts` in commit `acc80e9`, dated
  **2026-07-19 16:39:41 -0500** — over 16 hours *after* commit `1d3bf1a` (2026-07-19
  00:38:28 -0500), the last commit whose build actually succeeded. Every deploy attempt
  since `acc80e9` landed has failed to build, for reasons unrelated to AG-38's own code.
  The container that was last (and may still be) running on Railway is built from source
  that predates AG-38's existence entirely.

**Conclusion:** AG-38 has **never executed in production, not even once**, since it was
written. This supersedes §5's "the claim is accurate at the code level... the nightly job
still runs every night" and §6 point 5 ("AG-38 is real and scheduled") — the code is real
and correctly wired, but it has never had a deployed build to run inside. The open
question in §5 about whether `improvement_proposals`/`agent_performance_metrics` exist on
live prod is now moot as a blocker for this job specifically (it can't fail against the
wrong tables if it never runs), but the underlying **worker deployment has been fully
broken for 7 days (2026-07-19 → 2026-07-21 build failures, then no deploy attempts through
2026-07-26)** — every job in `worker/scheduler.ts` added after commit `1d3bf1a` (AG-38,
and potentially others depending on their own add-commit dates) is equally non-functional
in production, and even the pre-existing 2AM/7AM jobs are only running if that stale
`7379f5a5` container is somehow still alive rather than crash-looped out by Railway's
`ON_FAILURE` restart policy. This is a build-breakage issue blocking the whole worker, not
an AG-38-specific bug — worth fixing `worker/autoapply-autonomous-orchestrator.ts` and
`worker/autonomous-orchestrator.ts`'s TS errors and redeploying before trusting *any*
worker-side automation is live.

---

## WORKER BUILD FIX (2026-07-27 follow-up)

**What was broken:** the exact same two files and errors identified in the AG-38 STATUS
section above, reproduced locally via `pnpm tsc -p worker/tsconfig.json --noEmit`
(worker's own tsconfig — `strict: true` + `noUncheckedIndexedAccess: true` inherited from
root `tsconfig.json`) and confirmed byte-for-byte identical to the 2026-07-21 Railway
build log:

1. `worker/autoapply-autonomous-orchestrator.ts` — 10× `TS18048: 'prospect' is possibly
   'undefined'` (lines 417, 439, 441, 453, 461, 471, 477, 478, 479, 486). Cause:
   `const prospect = prospectRows[i]` inside a `for` loop, indexed under
   `noUncheckedIndexedAccess`, types as `ProspectRow | undefined`; nothing narrowed it
   before first use.
2. `worker/autonomous-orchestrator.ts` — 5× `TS2339: Property 'matched'/'found' does not
   exist on type 'AutonomousAgentResult'` (lines 322 ×2, 323, 1068 ×2). Cause: both call
   sites read `result.matched` / `result.found` from `runOpportunityDiscovery()`'s return
   value, but `AutonomousAgentResult` (`src/lib/agents/autonomous-base.ts:28`) has never
   had those fields — it's `success, itemsFound, itemsProcessed, itemsQueued, decisions,
   nextActions, errors`. This was dead-on-arrival code that had never actually compiled;
   it just never got caught because the worker build has been failing since before these
   lines could ever run.

**What changed (targeted compile fix only — no scheduler/AG-38/logic changes):**

- `worker/autoapply-autonomous-orchestrator.ts`: added `if (!prospect) continue;`
  immediately after `const prospect = prospectRows[i];`, narrowing the type for the rest
  of the loop body. Behaviorally a no-op — `prospectRows[i]` is never actually undefined
  at runtime (loop bound is `i < prospectRows.length`); this only satisfies the compiler.
- `worker/autonomous-orchestrator.ts`: both call sites changed `result.matched` →
  `result.itemsFound` and `result.found` → `result.itemsProcessed`, matching the real
  `AutonomousAgentResult` shape and `OpportunityDiscoveryAgent`'s actual semantics
  (`itemsFound` = new opportunities discovered, `itemsProcessed` = found + duplicates
  skipped). Log message wording (`"X matched / Y found"`) preserved verbatim.

**Local verification:** `pnpm tsc -p worker/tsconfig.json --noEmit` → zero errors, zero
output. `pnpm run build:worker` (the exact command Railway's `worker/Dockerfile` runs —
`tsc -p worker/tsconfig.json && tsc-alias -p worker/tsconfig.json`) → completes clean, no
errors. `git diff -- worker/*.ts` confirms only these 2 files changed, 8 lines total
(2 insertions in the AutoApply file, 4 lines changed across 2 call sites in the
orchestrator file) — `worker/scheduler.ts` and every AG-38 file untouched.

**Deploy result: BLOCKED, not attempted/verified.** Triggering a Railway deploy for
service `bd9f0c6b-fe01-4f31-9ef7-5fe9d7d0b127` failed before any build could start:

```
railway up -s bd9f0c6b-... --detach --json
  → {"code":"UPLOAD_FAILED","error":"Your trial has expired. Please select a plan to continue using Railway.","hint":null}
railway redeploy -s bd9f0c6b-... --from-source --json
  → Your trial has expired. Please select a plan to continue using Railway.
```

Both the local-upload path (`railway up`) and the pull-latest-commit path
(`railway redeploy --from-source`) are blocked identically — this is an account/billing
gate, not a build or code issue, and it blocks **every** deploy trigger, not just this
one. Reid confirmed (2026-07-27) to skip attempting the deploy and land the code fix +
this doc update only; Railway plan selection and the actual deploy trigger are left for
him to do separately at railway.app (project `1d79d4e6-f529-4903-9577-7085b3ab126b`).
`railway status` still reports service `benavora-worker` as **`Failed`** (deployment
`058c9321-14d2-4778-b029-d958bf9899d1`, the same 2026-07-21 failed build from the AG-38
STATUS section) — unchanged by this fix until a new deploy actually runs.

**Every worker-side feature/job merged after commit `1d3bf1a` (2026-07-19 05:38 UTC, the
last build that ever succeeded) — none of these have executed in production, and none
will until a deploy actually succeeds post-billing-fix:**

| Merged (commit, CDT) | Feature / job | Runtime entry point |
|---|---|---|
| `cca8236`, 07-19 00:59 | Autonomous morning digest agent | `worker/scheduler.ts` 7:00 AM job → `runDigestPipeline()` |
| `9e6b427`, 07-19 01:26 | AG-28 FollowUpGeneratorAgent | Queue-only, routed via `agent_queue` in the nightly sweep |
| `1416a05`, 07-19 01:56 | AG-08–AG-12 (RenewalTracker, OutcomeAnalyzer, DocumentExpiry, KnowledgeGap, SearchProfileOptimizer) | Steps inside the existing 2:00 AM per-org nightly sweep |
| `325746a`, 07-19 16:14 | AG-40 StrategicAdvisorAgent | Step inside the 2:00 AM nightly sweep |
| `acc80e9`, 07-19 16:39 | **AG-38 self-improvement pipeline** (this session's original ask) | `worker/scheduler.ts` 4:00 AM job |
| `ffd97be`, 07-19 19:34 | AutoApply autonomous overnight orchestrator (batch queuer, the file fixed above) | `worker/scheduler.ts` 3:00 AM job |
| `4833c8b`, 07-19 20:24 | Broad "21 queues Phase 2-5" pass — substantial rewrites to `autoapply-autonomous-orchestrator.ts`, `autonomous-orchestrator.ts`, and `scheduler.ts` itself (364/221/76 lines) | Multiple — same jobs as above, hardened |
| `2260662`, 07-20 09:40 | "12 queues enterprise hardening" pass — +180 lines to `autoapply-autonomous-orchestrator.ts` (digital twin, Faith Foundation setup, etc.) | AutoApply 3:00 AM job |
| `e50f557`, 07-20 17:45 | DdRequestProcessor null-composite dequeue bug fix + failed-item backoff | `worker/dd-request-processor.ts` (donor-discovery request queue — continuously running, not scheduler-based) |
| `6ffd4fd`, 07-20 18:43 | AG-29 FundabilityScorerAgent, AG-30 DonorIntentMonitorAgent, AG-35 CommunityNeedPredictorAgent, AG-39 ROIOptimizerAgent, **AG-36 LearningNetworkAggregatorAgent** wired in | AG-29/30/35/39: steps inside the 2:00 AM nightly sweep. AG-36: `worker/scheduler.ts` 6:00 AM job (Sunday-gated) |
| `224f731`, 07-20 19:19 | Spark Good account pre-creation guide (human-in-loop email verification) | New code path inside `worker/queue-processor.ts` |
| `56e209d`, 07-21 13:39 | Additional TS-error/wiring fixes to `autonomous-orchestrator.ts` (+105 lines) | Same nightly-sweep steps as above |
| `2f822b1`, 07-21 14:40 | AG-28 `application_followups` sweep, full implementation | Folded into the 2:00 AM nightly job per `scheduler.ts`'s own comment |
| `d161b99`, 07-26 16:41 | Foundation directory enrichment scraper (`foundation-enrichment-weekly`) | `worker/scheduler.ts` 3:00 AM job (Sunday-gated, `ENABLE_SCRAPER`-gated) |

Not included above: `worker/dd-request-processor.ts` and `worker/queue-processor.ts`
themselves predate `1d3bf1a` and were already running in the last-known-good container
(`7379f5a5`) — only the specific additions/fixes to them listed above are new-since-break.
Also worth noting: **the 2:00 AM nightly per-org sweep and the AutoApply 3:00 AM job's
*base* wiring predate the break**, but nearly every step folded into them (AG-08–12,
AG-28, AG-29/30/35/39, AG-40, the followups sweep) was added after it — so even once the
worker redeploys successfully, this will be most of these agents' first production run
ever, not a resumption.
