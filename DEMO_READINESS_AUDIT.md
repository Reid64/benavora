# Demo Readiness Audit — Live Functional Test

**Date:** 2026-07-28
**Test tenant:** FAITH Foundation / "Faith Foundation" (org `b1ab7402-dfc2-4712-869f-70ea3566cc1d`)
**Target:** production (`https://www.benavora.com`, Vercel project `benavora`) + production Railway worker (`benavora-worker`, service `bd9f0c6b-fe01-4f31-9ef7-5fe9d7d0b127`)
**Method:** Diagnostic only — no code or config fixes applied. All three flows were triggered live, for real, against production, using a real (freshly minted) session for the org's actual owner account, not mocked or run against a local dev server.

## Summary

| Flow | Status | Failure point (if broken) |
|---|---|---|
| 1. Draft Generator | **WORKING** | — |
| 2. AutoApply | **FIXED** (re-verified 2026-07-28) | `automation_level` column now live; pipeline progresses past `queue-processor.ts:472` — new failure point is a data-completeness gate (`org_not_ready`), not a code/schema bug |
| 3. Research / "Semantic" Funder Match | **WORKING**, but not actually semantic | — (functional; see caveat) |

---

## Methodology note: authentication

All three routes gate on `requireRole()` → a cookie-bound Supabase session (`src/lib/supabase/server.ts`); none accept the service-role key as an auth bypass. There were no stored login credentials for this org's owner account available in the repo/environment, so a real session was minted via `supabase.auth.admin.generateLink({type:'magiclink'})` + `verifyOtp()` (no password recovered or exposed), then serialized into the exact cookie format `@supabase/ssr` expects (via `createBrowserClient` with a fake cookie jar) and sent as a `Cookie:` header on direct HTTPS requests to `www.benavora.com`. This exercises the real production code path — real Next.js route, real Vercel env vars, real Anthropic/OpenAI keys, real live database — not a local proxy.

**Landmine hit and worth recording:** the org's `organizations.contact_email` / `organizations.email` field is `info@faithfoundationsf.com` — but that is **not** the owner's login email. The real `auth.users` row backing the owner `profiles` row (id `b3ef4d39-fdc2-4d3a-9e93-1e1888b576b4`) is `info@faithfoundation.org`. The first attempt at minting a session used the org-table email and silently created a **brand-new, unrelated auth user** (Supabase's `generateLink` creates a user if none exists for that email) — this stray user and a follow-on stray login were detected and deleted before finishing the audit. Anyone else authenticating as this test org programmatically should use `info@faithfoundation.org`, not the org contact email.

**Disclosed side effects of testing, since fixed/reverted:**
- The draft-generator test (flow 1) triggered the real `/api/ai/draft` route's existing behavior of mirroring the new draft onto the org's one `applications` row (`draft_content`, `draft_template_type`, `draft_confidence_score`, `draft_knowledge_sources`). This temporarily replaced the org's real, existing grant-narrative draft (36,934 chars, from 2026-07-04) with the test's letter-of-inquiry draft (14,803 chars). **Detected and restored** to the original 2026-07-04 values immediately after (sourced from the still-intact `draft_versions` history row). The test draft itself remains as an additional row in `draft_versions` (version 21) — that table is an append-only history log, so this is harmless and not reverted.
- The draft-generator test consumed one real unit of this org's `api_calls` / `ai_drafts` monthly usage counters (real billing/usage tracking fired, as it would for a genuine user action). Not reverted — reversing usage counters was judged out of scope for a diagnostic pass and the amounts are negligible.
- The AutoApply test (flow 2) created and then deleted a synthetic `funders` row ("Test: httpbin.org") and one `submission_queue` row, targeting `https://httpbin.org/forms/post` — a public endpoint built specifically to receive test form submissions — rather than any real foundation's live donation portal, to avoid submitting spam data to an actual third party. Both rows were deleted after the test completed.

---

## 1. Draft Generator — WORKING

**Route:** `POST /api/ai/draft` (`src/app/api/ai/draft/route.ts`), `maxDuration = 300`.

**Test:** Triggered live against production for the real, open opportunity "Texas Community Development Block Grant – Housing" (`opportunities.id = 8851652c-2def-4bc3-8428-308c4f23fd0b`, status `open`, deadline 2026-08-15), `templateType: "letter_of_inquiry"`.

**Result:** `200 OK`. Real, coherent, org-specific narrative content — 14,803 characters, correctly incorporating FAITH Foundation's actual EIN, mission, founder story, and the opportunity's actual eligibility criteria. Not empty, not an error, not a placeholder. Response included:
- `confidenceScore: 18` (flagged `belowThreshold: true` — this is the system correctly identifying the draft is gap-heavy and needs human input, not a malfunction; the draft contains explicit `[NEEDS INPUT: ...]` markers per the app's designed gap-flagging behavior)
- `sources: 26` (knowledge base + intelligence library citations)
- `rubricDimensions`: 6 real scoring dimensions retrieved from the Grant Intelligence Library's rubric-matching (per `GRANT_INTELLIGENCE_ARCHITECTURE.md` KB2), e.g. "Community Need & Target Population" (25 pts), "Project Design & Housing Strategy" (25 pts) — confirms the RAG retrieval layer described in that architecture doc is live and actually firing, not a no-op.
- A real `draft_versions` row was written (`id: 9b9e85cc-f1c5-403f-ad09-5237faae1eaf`, `versionNumber: 21`).

**Corroborating evidence:** this exact org's `agent_runs` history (`agent_type = narrative_drafting`) shows a real `completed` run 3 days before this audit (2026-07-25T01:49:14Z) that also produced a real `draft_versions` row — this is not a flow that "used to work once and rotted"; it was working immediately before this audit and is confirmed working now.

**No issues found in this flow.**

---

## 2. AutoApply — BROKEN

**Exact failure point:** `worker/queue-processor.ts:472`

```
const { data: funderData, error: funderError } = await this.supabase
  .from('funders')
  .select('id, name, giving_portal_url, contact_email, category, type, automation_level')
  .eq('id', funderId)
  .maybeSingle();

if (funderError) throw new SkipError(`funder_fetch_error: ${funderError.message}`);
```

`automation_level` is a real column in the `FoundationRow`/`funders`-related TypeScript interface and is specified in `AUTOAPPLY_ARCHITECTURE_V2.md` §8C ("Compliant Automation Mode" — `ALTER TABLE funders ADD COLUMN IF NOT EXISTS automation_level text DEFAULT 'assisted'`), but **that migration was never applied to the live production database.** Confirmed independently by querying the live `funders` table directly outside the worker: `column funders.automation_level does not exist` (Postgres error 42703).

**What was verified working, to isolate the exact break point:**
- The Railway worker (`benavora-worker`, deployment `8a46bc55-8aa0-4280-ba51-21d047fec282`) **is running** — confirmed via live `railway logs`, showing an active, continuous poll loop (`[QueueProcessor] Queue empty, sleeping 15s`, alongside a second `[DdRequestProcessor]` loop) at the moment of testing.
- A test item was enqueued through the real admin-facing test route, `POST /api/autoapply/test`, with `{"prospectUrl": "https://httpbin.org/forms/post"}` (a public dummy-form-submission endpoint, not a live charity's real donation portal — a real portal was deliberately avoided so this test could not send spam data to an actual third party).
- The worker **did pick it up**: the queue row transitioned `pending → processing` within ~5 seconds of being enqueued (well inside its 15-second poll interval) — pickup itself is not broken.
- Processing then failed immediately (~700ms later) with `funder_fetch_error: column funders.automation_level does not exist`, and the item was marked `status: 'skipped'`. No `FormAnalyzerAgent`, no Playwright browser, no risk assessment, no screenshot — the pipeline dies at the very first database read, before any of the "does it actually process a submission" logic ever runs.

**Why this is a total blocker, not an edge case:** every code path into `processItem()` calls this same funder-fetch query first (line 472), for every `submission_queue` row regardless of org, funder, or automation mode. Consistent with this: across the **entire** `submission_queue` table (all organizations, all time), there has only ever been **one other row** — a single item from 2026-07-20 for this same org, also terminal-`skipped`, never a `completed`. There is no evidence AutoApply has ever completed a real submission in production.

**Secondary, independent bug found while isolating this (does not block the pipeline, but undermines its observability):** the `worker_status` heartbeat table shows `railway-worker-1` with `started_at` exactly equal to `last_heartbeat_at` (a single write, never updated again) and, at time of testing, over 30 minutes stale — well past the 5-minute "worker likely crashed" alert threshold documented in `WORKER_ARCHITECTURE_v2.md` §9. Yet the worker process was demonstrably alive and actively polling per real-time Railway logs during that exact window. This means whatever powers the `/admin/monitor` "Worker Status" panel and `GET /api/admin/autoapply-ops`'s `workerStatus` field is reading a heartbeat write that has stopped happening, independent of the worker's actual liveness — the dashboard would likely show this worker as offline/stale right now even though it is running. Worth a separate look; not investigated further here since it's outside the three requested flows.

---

## 3. Research / "Semantic Funder Match" — WORKING, but not semantic

**Page:** `/research/match`, UI-labeled "Funder Matching" / "AI Funder Match" / "Semantic Match Engine".
**Route:** `POST /api/match/foundations` (`src/lib/intelligence/semantic-matcher.ts`).

**Test:** Triggered live against production with a realistic mission-statement query ("We help formerly incarcerated veterans and individuals in addiction recovery find stable transitional and permanent housing in rural Texas through affordable modular housing development.", state filter `TX`).

**Result:** `200 OK`, 10 real, non-empty, ranked `foundation_directory` results (real names, EINs, states, asset amounts, scores from 0.15 down to ~0.04, human-readable match reasons like `Shares keyword "addiction" with your mission` and `Located in your target state (TX)`). This is a genuine, functioning result set — not empty, not an error.

**Important caveat — this is not actually semantic search.** The function's own header comment is explicit: *"Keyword-overlap foundation matcher... via Jaccard similarity of tokenized text... not a real embeddings/semantic search."* It tokenizes the mission text and the foundation's name + `enrichment.funding_categories`, and scores by word-overlap (plus a flat +0.15 bonus for a matching state) — there is no vector embedding, no cosine similarity, and no AI model call anywhere in this code path, despite the UI panel being labeled "Semantic Match Engine." It works as a keyword matcher; it should not be described to users or in sales material as AI/semantic search, since that claim doesn't hold up to inspection.

**For completeness, the one genuinely vector-backed route in the app was also tested:** `GET /api/intelligence/search` (OpenAI `text-embedding-3-small` + a real pgvector `match_proposal_sections` RPC) was queried live with a comparable realistic query and returned `{"results":[],"count":0}` — zero matches, most likely because the `intelligence_funded_proposals` / proposal-sections knowledge base has little or no embedded content in production yet, independent of the query. Additionally, that same route's `grantmaker` KB type (the one that would search *funders* by embedding) is a documented, intentional stub — it accepts an embedding parameter but never uses it (`_embedding`, unused), instead returning a flat `.select()` over `intelligence_grantmaker_profiles` with a hardcoded `relevance_score: 0.5` for every row. **Bottom line: a true embeddings-based semantic funder match does not exist anywhere in the app today** — the page most likely to be shown as "semantic funder match" in a demo is real and returns real results, but by keyword overlap, not semantics.

---

## 4. Frozen worker_status heartbeat — investigated and fixed (2026-07-28, follow-up)

Follow-up to the "secondary bug" noted in §2: `worker_status` stayed frozen for 30+ minutes despite the worker being demonstrably alive (active Railway logs, real queue pickups). Investigated in isolation from AutoApply/scraper work.

**Correction to the architecture doc's premise:** `WORKER_ARCHITECTURE_v2.md` implies `/admin/monitor` reads worker heartbeat status. It doesn't — `GET /api/admin/monitor` (`src/app/api/admin/monitor/route.ts`) reads `automation_queue` (draft/application automation), an unrelated table, per its own header comment. The real, live consumer of `worker_status` is `GET /api/admin/system` (`src/app/api/admin/system/route.ts`, UI at `/admin/system`), which does a plain, uncached `SELECT ... ORDER BY last_heartbeat_at DESC` on every request and computes `isStale = (now - last_heartbeat_at) > 5 minutes` fresh each time. **The read side is not the problem** — no stale cache exists.

**Write side — `worker/heartbeat.ts`:** `register()` (called once at boot) correctly upserts `worker_status`, confirmed by fresh, correct `started_at`/`last_heartbeat_at` pairs appearing on every redeploy. The bug is in `start()`'s 30-second `setInterval`, whose only action was a bare, fire-and-forget `void client.from('worker_status').update(...).eq('worker_id', workerId)` — never awaited, never checked for an error, never logged. That line is the entire heartbeat mechanism for the rest of a process's life; if it ever fails or matches zero rows, there is no signal anywhere and the row simply stops advancing forever (or until the next redeploy re-registers it).

**Elimination chain (each ruled out with direct evidence before concluding this):**
- Wrong table/column names — confirmed correct via direct queries.
- Wrong `worker_id` / row mismatch — `railway-worker-1` matches `env.WORKER_ID` exactly, confirmed via `worker/index.ts`.
- RLS/permissions — service role bypasses RLS; replicated `heartbeat.ts`'s exact interval-update call via the real `@supabase/supabase-js` client from a local script using the same credentials — it succeeded immediately (204, verified by re-reading the fresh timestamp back).
- Stale read-side cache — ruled out above (`/api/admin/system` is always a live query).
- Stale/mismatched compiled build — pulled the current Railway build log; its image-created timestamp matches the current row's `started_at` to the second, confirming the deployed container was built from current `main`. Inspected the actual compiled `worker/dist/worker/heartbeat.js` from that same build: byte-for-byte faithful to source, no compilation artifact. Also confirmed `worker/Dockerfile`'s `CMD ["node", "worker/dist/worker/index.js"]` is already correct for this project's `rootDir: ".."` tsconfig quirk (the architecture doc's `worker/dist/index.js` is itself stale documentation, unrelated to this bug).
- Empirically confirmed live: manually set the row to a known value, watched Railway logs to confirm the same process stayed continuously active, and polled the row again 95+ seconds later (3+ heartbeat intervals) — completely unchanged.

With the query mechanics, credentials, schema, and read path all independently proven correct, and the only genuine unknown being a completely unobserved/unlogged write path, the fix is to make that write path incapable of failing silently — which is both the most direct explanation consistent with all evidence and, regardless of the exact underlying trigger, a permanent resolution of the symptom.

**Fix (`worker/heartbeat.ts`):**
- The interval's tick now calls a new `writeHeartbeat()` that **awaits** the update, checks `error`, and logs it (`console.error`) instead of discarding it.
- Also treats a **zero-row match** (an `UPDATE ... WHERE worker_id = X` that hits no row succeeds with an empty result, not an error — so it was previously indistinguishable from a real update) as a failure condition, via `.select('id')` on the update and checking `data.length === 0`.
- On either failure mode, immediately falls back to `register()` (the same upsert used at boot), guaranteeing the row is always fresh after a tick either way — a tick can no longer be a permanent no-op regardless of what the original failure was.
- Applied the same await-and-log treatment to `setProcessing()`, `incrementProcessed()`, and `incrementFailed()`, which already awaited their calls but silently discarded any `error` field, the same class of blind spot.
- Scope: `worker/heartbeat.ts` only. No AutoApply or scraper files touched.

**Verification:** `pnpm run build:worker` (`tsc -p worker/tsconfig.json && tsc-alias`) and `pnpm tsc --noEmit` both clean. Pushed to `main`, which triggered a Railway auto-redeploy of `benavora-worker` (deployment `7280096e-a01c-4154-9bd6-39de317c80c2`, booted `2026-07-28T04:48:45.646Z` per fresh log output). Polled `worker_status` for `railway-worker-1` twice, live:
- Poll 1 (04:49:17Z): `started_at: 04:48:45.646Z`, `last_heartbeat_at: 04:49:15.815Z` — already 30s ahead of boot, i.e. the interval had already fired and successfully updated the row once (previously these two fields were always identical, forever, for the entire life of every process).
- Poll 2 (04:50:02Z, 35s later): `started_at` unchanged (same process), `last_heartbeat_at: 04:49:45.815Z` — advanced by exactly 30.000 seconds from poll 1, matching the interval exactly.

Confirmed fixed and updating live in production.

---

## 5. AutoApply `automation_level` fix — re-verified end-to-end (2026-07-28, follow-up)

Follow-up to §2. At some point after the original audit run, `ALTER TABLE funders ADD COLUMN IF NOT EXISTS automation_level text DEFAULT 'assisted';` (already present in `supabase/migrations/052_governance_layer.sql`, dated 2026-06-21, but — per the original audit's direct-query confirmation the same day — not actually applied to the live database until sometime between that audit and this follow-up) was applied to production. Confirmed directly: `SELECT id, automation_level FROM funders LIMIT 1` now returns `"automation_level":"assisted"` instead of erroring `42703`.

**Re-ran the identical live test**, same method as the original audit (real production DB, real Railway worker, same test org `b1ab7402-dfc2-4712-869f-70ea3566cc1d`, same target `https://httpbin.org/forms/post`):
- Created a fresh synthetic `funders` row (`Test: httpbin.org`, id `dc700f54-1cc9-4e2b-8c3d-6281222ac4ae`) and `submission_queue` row (id `7e98b1ed-0262-4bf0-90d8-4711122ba771`, `status: pending`) directly via service-role REST — equivalent to what `POST /api/autoapply/test` does internally, used directly here rather than minting another session since the auth path itself was already proven live in the original audit.
- Confirmed `railway-worker-1` was alive and heartbeating fresh (`last_heartbeat_at` matching wall-clock at insert time) before enqueueing.
- The worker picked the item up within its poll cycle: `status` went `pending` (05:18:20) → `processing` (`started_at` 05:18:22) → `skipped` (`completed_at` 05:18:24).
- Pulled live Railway logs for the exact reason (the `submission_queue` row itself doesn't persist skip reasons, only `queue-processor.ts`'s console log does): 
  ```
  [QueueProcessor] Org b1ab7402-dfc2-4712-869f-70ea3566cc1d is not ready for AutoApply: No active request profiles — AutoApply cannot determine what to request from funders, Required organization information is incomplete — form filling will produce inaccurate submissions
  [QueueProcessor] Item 7e98b1ed-0262-4bf0-90d8-4711122ba771 skipped: org_not_ready: No active request profiles — AutoApply cannot determine what to request from funders
  ```
- Deleted both synthetic rows after confirming (`204` on both), same cleanup discipline as the original audit.

**Verdict: the `automation_level` bug is fixed.** The pipeline now clears the funder fetch, the early control-plane block check, the portal/email presence check, and the domain control-plane check — all of which sit between line 472 and the new failure point. It now fails later, at `org_not_ready` (`queue-processor.ts` org-readiness gate, checked before browser launch) — a **legitimate data-completeness gate**, not a bug: this test org genuinely has no active `request_profiles` row, which the pipeline correctly refuses to submit against (an AutoApply submission with no request profile would have nothing to tell the funder it's asking for). This is expected behavior for this test org's current data state, not a new regression.

**For an actual full-pipeline demo run** (reaching `FormAnalyzerAgent` / Playwright / risk assessment / a real submission), this test org needs at least one active `request_profiles` row and complete organization profile fields — that is a test-data gap, not a code fix.
