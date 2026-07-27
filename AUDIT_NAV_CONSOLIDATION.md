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
