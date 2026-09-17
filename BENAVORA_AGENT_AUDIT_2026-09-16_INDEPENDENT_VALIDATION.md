# BENAVORA — Independent Agent Audit & Validation of the 2026-09-15 Audit

**Audit date:** 2026-09-16 (session start 20:00 CDT)
**Auditor:** fresh Claude session, no inherited context from the prior chat
**Commit audited:** `ab584df` — *"[FORGE] Phase 5.6: Delete 4 confirmed-dead agents"*, authored 2026-09-15 23:13:33 -0500 (current HEAD)
**Method:** code execution, not code reading. Every number below came from a command that ran, a test that executed, or a SQL query against the live production database. Nothing was carried over from `AGENT_INVENTORY_COMPLETE.md`, `AGENT_AUDIT_COMPLETE.md`, `AGENTS_v2.md`, `STATE_OF_THE_BUILD.md`, or the 2026-09-15 audit summary.

---

## 1. Executive verdict

**NO-GO for AutoApply. Conditional GO for the research/intelligence layer.**

The 2026-09-15 audit's structural picture is broadly correct and its agent count is essentially right (147 claimed vs **154** counted here under a stated definition). Two of its five blockers are already closed at HEAD. But it was a code-reading audit, and three defect classes only visible through execution went undetected — one of them is a false-success defect in the revenue path, and one of them is a regression the audit itself caused.

| Rank | Finding | Confidence | Evidence class |
|---|---|---|---|
| **P0-1** | AutoApply records submissions as `'submitted'` that never reached the funder's portal | **[Certain]** | Reproduced in a live run + confirmed in production data |
| **P0-2** | `pnpm typecheck` and `pnpm build:worker` are broken on HEAD — your `deploy.ps1` fails at step 1 today | **[Certain]** | `tsc --noEmit` exit 2, 1 error |
| **P0-3** | `FormFillerAgent`'s primary fill path is dead — the `field_mapping` contract with `FormAnalyzerAgent` is inverted and type-incompatible, so fills depend entirely on a fallback that can populate at most 2–3 of 16 keys | **[Certain]** | Reproduced: 0 of 8 fields populated on a form with `required` attributes |
| **P1-1** | `success_probability` has failed **100 of 137** runs, all on the same persistence error, and is still failing | **[Certain]** | Live `agent_runs` |
| **P1-2** | `review` agent has run 4 times and **never once succeeded** | **[Certain]** | Live `agent_runs` |
| **P1-3** | `BEN-SUP-05` has failed **11 of 11** PIL runs on a missing-context error its caller never supplies | **[Certain]** | Live `pil_agent_runs` |
| **P1-4** | 97% of all agent activity in the platform's entire history is one agent (`ag-29-knowledge-indexer`) | **[Certain]** | Live `agent_runs` |
| **P2-1** | `corporate_prospects` table does not exist in production; 2 agents fail on it | **[Certain]** | Live errors + failing test |
| **P2-2** | `buildFillData()` queries a nonexistent table `knowledge_base_entries` (real table: `knowledge_base`), silently returning no data | **[Certain]** | Migration grep + code read |
| **P2-3** | `BaseAgent` default 60s timeout kills Claude-backed agents; 6 agent types have timeout failures | **[Certain]** | Live `agent_runs` error strings |
| **P2-4** | `DATABASE_URL`'s password is stale — `password authentication failed for user "postgres"`. The one test guarding the `success_probability` bug is skipped because of it | **[Certain]** | Local run on Reid's machine |

**The one number that should stop a launch decision:** your entire `autoapply_submissions` table contains **one row, ever** — dated 2026-06-19, `status='submitted'`, `confirmation_number` NULL, no confirmation screenshot, no pre-submit screenshot, no error message. And 50 of the 55 rows in `submission_queue` are `status='skipped'`. AutoApply has never demonstrably submitted a grant application.

### 1.1 Scale of the repair — this is not a rebuild

Nothing in this audit is architectural. The architecture is sound: `BaseAgent` gives every agent lifecycle logging and timeouts, the worker/scheduler/queue split is correct, the human-approval gate works, PIL's policy-and-audit spine is genuinely well designed. Every defect found is a wrong string, a wrong shape, a missing guard, or a number set too low.

| Fix | Files touched | Nature | Mode |
|---|---|---|---|
| P0-2 build break | 1 | Restore one deleted file, or delete one function | PowerShell, one command |
| P2-2 `knowledge_base_entries` → `knowledge_base` | 2 | Two string literals | PowerShell, two edits |
| P2-4 stale `DATABASE_URL` password | 0 | Credential rotation | Vercel CLI |
| P2-3 60s timeout | ~6 | One constructor arg each | Chat-based edits |
| Anthropic concurrency 429s | ~4 call sites | Wrap in `p-limit` (already a dependency) | Chat-based edits |
| P2-1 `corporate_prospects` | 1 migration | Apply or remove the dependency | SQL + 2 agents |
| `applications.knowledge_patterns_applied` | 1 migration | `ALTER TABLE ADD COLUMN` | SQL |
| P1-3 `BEN-SUP-05` missing context | 1 | Pass `targetAgentRunId` at the dispatch site | Chat-based edit |
| PIL `[object Object]` serializer | 1 | Use `.message` / `JSON.stringify` | Chat-based edit |
| **P0-1 + P0-3 AutoApply submit integrity** | **3 + 1 new test** | Field-mapping adapter, submit verification, pre-submit required-field gate, honest status | **Claude Code escalation** |
| P1-1 `success_probability` upsert | 1 | Fix the conflict target | Chat-based edit, after P2-4 |
| Test suite: real-Claude integration lane | 1 config + 1 setup | Opt-out of the global Anthropic mock for a named lane | Chat-based edit |

**One Claude Code run for AutoApply, a handful of PowerShell edits for everything else.** The 63 never-executed agents and the 27 dormant PIL agents are not bugs to fix — they are a product decision about what to wire, invoke, or delete, and that decision is yours, not an engineering emergency.

What is *not* a quick fix, and is the thing actually worth your attention: the reporting layer told you things had succeeded when they had not, and you made planning decisions on those reports. Fixing the ten items above takes a day. Building the habit that a status is not written until the evidence exists is the durable change — and that is exactly what the Six Laws' Law 6 already says. The code just wasn't honoring it.

---

## 2. What I could and could not execute

Full disclosure of environment, because an audit that hides its own limits is worthless.

| Capability | Status | Consequence |
|---|---|---|
| Repo at commit `ab584df` | ✅ Exact copy, `pnpm install --frozen-lockfile` against your real `pnpm-lock.yaml` | Dependency tree identical to yours |
| `vitest` unit + integration suite | ✅ Ran in full | Real per-test results, §3 |
| `tsc --noEmit` (app) | ✅ Ran | 1 error, §5.1 |
| `tsc -p worker/tsconfig.json` | ✅ Ran | Same 1 error |
| Real Chromium + real Playwright | ✅ Launched, drove a real form | §4 |
| Real Anthropic API calls | ✅ Live, keyed from your `.env.local` | Real Claude form extraction verified |
| Live production Postgres | ✅ Read via the Supabase connector | 63,180 `agent_runs` rows analysed |
| Playwright e2e — public/unauth | ✅ 11 of 13 passed | §4.3 |
| Playwright e2e — authed / AutoApply dashboard | ❌ **Blocked** — auth requires TCP to your Supabase project, which this container's egress policy denies | Cannot verify authed UI; run locally |
| 16 live-DB vitest integration files | ❌ Blocked here → ✅ **executed by Reid locally**, 15 of 16 passed | §3.1.c |
| Railway worker live behaviour | ❌ Not reachable | Inferred only from `worker_status` and `agent_runs` timestamps |

Where I could not execute, I say **UNVERIFIED** and do not inherit the prior audit's claim.

### Deviations I made, disclosed

1. Playwright `globalSetup` wants Chromium build v1223 from `cdn.playwright.dev`, which is blocked. I wrote `playwright.audit-session.config.ts` with `launchOptions.executablePath` pointed at the preinstalled v1194 Chromium and no `globalSetup`. Browser build differs from yours by 29 revisions.
2. The AutoApply smoke harness substitutes an in-memory recorder for the Supabase client, because the live project is unreachable from this container. Every DB call the code attempted was **recorded and reported**, never silently swallowed. All logic under test is your real, unmodified code.

---

## 3. Test execution — real results

### 3.1 Default vitest suite (`vitest run`, `vitest.config.ts`)

```
Test Files  16 failed | 81 passed | 1 skipped (98)
     Tests  14 failed | 819 passed | 50 skipped | 13 todo (896)
  Duration  67.75s
```

All 16 failing files fail on one cause: `Host not in allowlist: vbjplpquqxxfbpazyalt.supabase.co`. These are live-DB integration tests. **These 16 failures are environmental, not defects.** The files:

`ag19-relationship-builder-flag`, `agency-rls`, `agent-runs`, `autoapply-compliance`, `autoapply-mutual-exclusion`, `autoapply-queue`, `autoapply-risk-scoring`, `corporate-prospects`, `form-analyzer-filler`, `foundation-directory`, `organizations`, `platform-config-org-scope`, `relationship-scoring-consolidation`, `rls`, `storage-rls`, `success-probability-upsert-constraint`.

### 3.1.c Those 16 files, executed on the developer's own machine — CONFIRMED GREEN

Reid ran `npx vitest run src/__tests__/integration` locally at 20:25 CDT, where Supabase is reachable:

```
Test Files  1 failed | 15 passed (16)
     Tests  67 passed | 2 skipped (69)
  Duration  122.39s
```

**15 of 16 pass against live production.** The single failure is not a code defect either:

```
FAIL  src/__tests__/integration/success-probability-upsert-constraint.test.ts
error: password authentication failed for user "postgres"
  ❯ pg-protocol/src/parser.ts:394:9
```

That file connects via `DATABASE_URL` with `pg` rather than through the Supabase client, and **the password in `DATABASE_URL` is stale or wrong.** Its 2 tests were skipped, not failed. Fix is a credential rotation, not code.

**This materially improves the verdict and I am revising two earlier claims downward:**

1. `autoapply-queue`, `autoapply-risk-scoring`, `autoapply-compliance`, `autoapply-mutual-exclusion` and `form-analyzer-filler` **all pass against live production.** The AutoApply queue gating, risk scoring, compliance rules and mutual-exclusion guard are verified working — not merely wired.
2. `form-analyzer-filler.test.ts` passing means the filler **does** submit successfully on that test's target form. So "fills zero fields" is not universally true. See the corrected §4.2.

**Two structural findings about the test suite itself, which the prior audit did not surface:**

**3.1.a — Every "agentic" unit test is testing a mock, not a model.** `tests/setup.ts` is loaded as a global `setupFiles` entry for the whole default suite and contains:

```ts
vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "Mock Claude response" }], ... }) },
  },
}));
```

Consequence: no test in the 98-file default suite exercises real Claude reasoning. A test asserting an agent "produces a narrative" is asserting that the string `"Mock Claude response"` was handled. Your 819 passing tests prove plumbing, not agent quality. That is a legitimate and common tradeoff — but it means the agentic behaviour of 103 agentic modules is **untested by construction**, and no pass count can change that.

**3.1.b — `tests/setup.ts` loads `.env.test`, not `.env.local`.** `.env.test` contains only 6 keys and no `SUPABASE_SERVICE_ROLE_KEY` and no `ANTHROPIC_API_KEY`. So `pnpm test` on a clean shell cannot reach anything real even where the test intends to.

### 3.2 A test defect that masks a real code path

`src/__tests__/unit/government-grants-orchestration.test.ts` emits this **16 times** in a passing run:

```
[government-grants:education] search/persist failed: Error: [vitest] No "persistGrantsGovHits"
export is defined on the "@/lib/sources/grantsgov-sync" mock.
```

The test's own `vi.mock` omits an export the agent calls. Every persistence branch therefore throws, the agent's "fail open" handler catches it, and the test **passes** while never once exercising persistence. Fix: add `persistGrantsGovHits` to that mock factory and assert it was called.

### 3.3 Typecheck

```
$ npx tsc --noEmit
worker/autonomous-orchestrator.ts(628,7): error TS2307: Cannot find module
  '../src/lib/agents/renewal-tracker-agent.js' or its corresponding type declarations.

$ npx tsc -p worker/tsconfig.json --noEmit     # exit 2, same single error
```

### 3.4 Playwright

| Project | Result |
|---|---|
| `public` (landing, login theme, marketing nav, smoke) | **11 passed** |
| `tests/e2e/public/auth.spec.ts` → registration reaches dashboard | **FAILED** — `page.waitForURL("**/dashboard")` timeout; Supabase auth unreachable. Environmental. |
| `e2e/smoke.spec.ts` → all critical pages load | **FAILED** — sign-in cannot complete. Environmental. |
| `e2e/autoapply-dashboard.spec.ts` and 20 other authed specs | **NOT RUN** — depend on `auth.setup.ts`, which needs live Supabase |

**The AutoApply dashboard e2e spec you specifically asked about could not be executed here.** Run it on your machine — command in §9.

---

## 4. AutoApply subsystem — direct smoke testing

I built a harness that runs your unmodified AutoApply modules against a **real locally-served grant application form**, with **real Chromium** through your own `StealthBrowser`, and **real Anthropic API calls**. 27 of 28 checks passed; the 28th is a design defect I recorded deliberately. Then I ran a controlled two-case experiment that exposed P0-1 and P0-3.

### 4.1 What genuinely works — verified, not assumed

| Component | Result |
|---|---|
| `StealthBrowser.launch()` | ✅ Real Chromium launched, randomized fingerprint (UA/viewport/timezone/WebGL), `navigator.webdriver === false` |
| `FormAnalyzerAgent.analyzeAndStore()` | ✅ **Real Claude call, 6.3s**, extracted all 10 fields correctly: `org_name, ein, contact_email, contact_phone, amount, mission, project, focus, det_letter, certify`; correctly set `requires_file_upload=true`, `is_multi_step=false`, `requires_login=false` |
| Automation-prohibition scan | ✅ Real second Claude call ran, returned `prohibits_automation: false`, `scan_skipped_reason: null` |
| `parseConfirmationPage()` | ✅ Real Claude call correctly extracted `confirmation_number: "HFF-2026-04817"` and `expected_response_date: "Within 90 days"` from a real page |
| `assessSubmissionRisk()` | ✅ 4 scenarios, correct banding: clean 10/low/auto · manual-only 50/medium/assisted · worst-case 100/critical/manual · no-template 30/medium/assisted |
| `matchFunderToProfiles()` | ✅ Scored an aligned profile 1.00 with 4 correct reasons, correctly excluded a misaligned profile, correctly skipped an inactive profile |
| `getTimingScore()` | ✅ Differentiates by funder type (gov 0.9 / foundation 0.7 / corporate 0.6 in September) and responds to fiscal-year-end (0.9 at FY start, 0.8 at FY end) |
| `FormFillerAgent` approval gate | ✅ **Both bypass attempts blocked.** No `sessionId` → `Submission blocked: session not approved`. Session status `awaiting_approval` → same. BEHAVIORAL_CONTRACTS §18 holds. |
| All 10 worker entry modules | ✅ Import cleanly under `tsx` with required env present |

The AutoApply *perception* layer is genuinely good work. Claude-driven form analysis, confirmation parsing, risk scoring, and the human-approval gate are all real and all correct.

### 4.2 P0-1 + P0-3 — the controlled experiment

Two identical forms. The only difference: HTML5 `required` attributes. Approved session supplied. Real Claude, real Chromium.

| | CASE 1 — form **with** `required` (realistic portal) | CASE 2 — identical form **without** `required` |
|---|---|---|
| Threw an error? | **No** | **No** |
| Fields populated by the agent | **0 of 8** | **0 of 8** |
| Fields still failing HTML5 validation after fill | `org_name, ein, contact_email, amount, mission, project, focus, certify` — all 8 | n/a |
| Did the browser navigate? | **No** | Yes → `/submit` |
| POST bodies the portal received | **0** | **1** — `org_name=&ein=&contact_email=&amount=&mission=&project=&focus=` |
| `FillResult.confirmationNumber` | `null` | **`HFF-2026-04817`** |
| `FillResult.pagesCompleted` | **`1`** | `1` |
| What `queue-processor.ts` would record | **`status='submitted'`, `submitted_at=now()`** | **`status='submitted'`** with a confirmation number |

Read the second column again. **The agent POSTed a completely blank grant application to the funder, the portal issued a confirmation number, and the agent captured that number as proof of a successful submission.**

#### Correction and sharpening, after `form-analyzer-filler.test.ts` passed live

That test passes on Reid's machine, and it asserts real values (`custname`, `comments`) reach httpbin's echo endpoint. So the filler is **not** universally incapable of filling. The precise, reconciled picture:

- The **primary** fill path — `Object.entries(fieldMapping)` — is dead in all cases (§ root cause below). Certain.
- A **fallback** label-matching path (`AdvancedFieldHandler`) does fill fields, but only for keys `buildFillData()` actually populates: `organization.name`, the hardcoded `organization.tax_status`, and `request.description` / `request.type` / `request.narrative`. Everything else is empty because of P2-2 (§4.3).
- **httpbin.org/forms/post has no `required` attributes on any field.** That is the only reason the test can pass. The browser never refuses the submit, so a form filled 2/8 of the way still POSTs and still returns a confirmation page.

**So the integration test that is supposed to guard this path is structurally incapable of catching the failure.** Swap its target for a form with `required` attributes — as my CASE 1 did — and it fails exactly as CASE 1 failed. Real funder portals use `required`. This is the highest-value test change in the repo.

#### Root cause of P0-3 — inverted, type-incompatible contract between the two AutoApply agents

`FormAnalyzerAgent` writes `field_mapping` as an **array** (verified against real Claude output in my run, and it is the declared type in both analyzers):

```ts
// src/lib/autoapply/form-analyzer-agent.ts:205
function buildFieldMapping(fields: FormField[]): FieldMappingEntry[] {
  return fields.map((field) => ({
    fieldName: field.name, fieldLabel: field.label, fieldType: field.type,
    required: field.required, kbMapping: mapLabel(...), manualReviewRequired: ...,
  }));
}
```

`FormFillerAgent` explicitly **rejects arrays**:

```ts
// src/lib/autoapply/form-filler-agent.ts:585
const raw = template['field_mapping'];
const base: Record<string, string> =
  raw && typeof raw === 'object' && !Array.isArray(raw)   // ← array → discarded
    ? (raw as Record<string, string>)
    : {};
```

…and then iterates the empty object:

```ts
// src/lib/autoapply/form-filler-agent.ts:613
for (const [benavoraField, selector] of Object.entries(fieldMapping)) { ... }
// Object.entries({}) → zero iterations → zero fields filled, every time
```

They are not merely differently shaped — they are **inverted**. The analyzer produces `DOM field → KB key`. The filler wants `KB key → CSS selector`. No adapter exists.

Note for fairness: your own `src/__tests__/integration/form-analyzer-filler.test.ts` lines 376–386 **already document this exact finding** in a code comment and assert `Array.isArray(template["field_mapping"]) === true`. So this is a *known, accepted* defect, not a new discovery — it is simply still unfixed at HEAD, and the test that documents it is one of the 16 that cannot run in this environment.

#### Root cause of P0-1 — three independent failures of evidence discipline, stacked

**(a) `submitForm()` never verifies the submit happened.**

```ts
// src/lib/autoapply/form-filler-agent.ts:808
private async submitForm(page: Page): Promise<void> {
  for (const sel of ['input[type="submit"]', 'button[type="submit"]']) {
    const el = await page.$(sel);
    if (el) { await el.click(); return; }      // ← no waitForNavigation, no response check
  }
  ...
}
```

A click that HTML5 validation refuses is indistinguishable from a click that submitted.

**(b) Every submit failure is swallowed.**

```ts
// src/lib/autoapply/form-filler-agent.ts:357
try {
  await this.submitForm(page);
  await page.waitForTimeout(3000);
  const confirmData = await parseConfirmationPage(page).catch(() => null);
  confirmationNumber = confirmData?.confirmation_number ?? confirmData?.reference_id ?? null;
} catch {
  // Submission failed; screenshot captures the failure state    ← nothing propagates
}
```

**(c) The caller treats "returned" as "succeeded."**

```ts
// worker/queue-processor.ts:1385
const fillResult = await filler.fillAndSubmit({ ... });
confirmationNumber = fillResult.confirmationNumber;
requestDescription = fillResult.requestDescription;
submissionStatus = 'submitted';                 // ← UNCONDITIONAL
```

That value then propagates to `autoapply_submissions.status`, `submitted_at`, `finalizeAutomationSession(..., submissionStatus === 'submitted', ...)`, and `abTestEngine.recordOutcome(variantId, true)`. So a non-submission is recorded as a submission, closes the audit session as successful, **and trains your A/B optimizer on a phantom win.**

#### Production confirmation of P0-1

```sql
select status, confirmation_number, confirmation_data is not null, error_message,
       submitted_at, confirmation_screenshot_url is not null, pre_submit_screenshot_url is not null
from autoapply_submissions;
```

| status | confirmation_number | conf_data | error_message | submitted_at | conf_shot | pre_shot |
|---|---|---|---|---|---|---|
| `submitted` | **NULL** | false | NULL | 2026-06-19 03:05:32 | **false** | **false** |

One row. Marked submitted. Zero evidence of any kind that anything was submitted. This is the exact signature CASE 1 produces.

```sql
select status, count(*), max(created_at) from submission_queue group by status;
```

| status | n | latest |
|---|---|---|
| `skipped` | **50** | 2026-09-15 20:18 |
| `completed` | 3 | 2026-09-06 10:01 |
| `failed` | 2 | 2026-08-06 20:28 |

91% of queued submissions are skipped. And 3 queue rows are `completed` while only 1 `autoapply_submissions` row exists — **2 "completed" submissions produced no submission record at all.**

### 4.3 P2-2 — `buildFillData()` reads a table that does not exist

```ts
// src/lib/autoapply/form-filler-agent.ts:441
const { data: kbData } = await this.supabase
  .from('knowledge_base_entries')          // ← no such table
  .select('category, content')
  .eq('organization_id', organizationId);
```

Verified: `grep "CREATE TABLE.*knowledge_base" supabase/migrations/` returns exactly one table — `knowledge_base`. 59 call sites elsewhere in `src/` use the correct name. The query is wrapped in `try { } catch { }`, so it fails silently and `entries` stays `[]`.

Consequence: of the 16 fill keys `buildFillData()` can produce, **14 are KB-sourced and therefore permanently empty** — mission statement, vision, programs, EIN, address, phone, website, contact name, contact email, contact title, budget, staff count, year founded, service area. Only `organization.name`, the hardcoded `organization.tax_status` default, and `request.*` from the request profile ever have values. Even with P0-3 fixed, this filler cannot complete a real grant application.

**Second site, same bug:** `src/app/api/autoapply/templates/test/route.ts:95`. (`success-probability.ts` and `twin-completeness.ts` mention the wrong name only in comments and query `knowledge_base` correctly — not defects.)

### 4.4 One design defect recorded

`getTimingScore()` calls `getCurrentMonth()` → `new Date().getMonth() + 1` internally and accepts no month parameter. Its seasonal branches for 11 of 12 months are **unreachable by any unit test**, forever. Not a runtime bug; a testability defect. Add an optional `now?: Date` parameter.

---

## 5. Validating the 2026-09-15 audit, claim by claim

This is what you asked for. Verdicts are against HEAD `ab584df`.

### 5.1 ❌ REFUTED, and it caused a live regression — "DEAD-CODE: 4"

The audit classified `fit-analysis-agent.ts`, `renewal-tracker-agent.ts`, `src/lib/agents/scheduler.ts`, and `src/lib/pil/agents/qua/BEN-QUA-01.ts` as dead code. Commit `ab584df` deleted all four.

**`renewal-tracker-agent.ts` was not dead.** It is imported by the nightly autonomous sweep:

```ts
// worker/autonomous-orchestrator.ts:621-637
async function runRenewalTrackerStep(supabase, orgId, log): Promise<boolean> {
  try {
    const { RenewalTrackerAgent } = await import(
      '../src/lib/agents/renewal-tracker-agent.js'     // ← file deleted last night
    );
    const agent = new RenewalTrackerAgent(orgId, supabase);
    const result = await agent.run('schedule');
    log.push(`renewal_tracker: ${result.itemsQueued} renewal(s) created`);
    return result.itemsQueued > 0;
  } catch (err) {
    log.push(`renewal_tracker: FAILED - ${errMsg(err)}`);   // ← swallows it nightly
    return false;
  }
}
```

That import was added in commit `1416a05` ("AG-08 through AG-12 — renewal tracker, …") and was never removed. Results:

- `pnpm typecheck` fails → **your `deploy.ps1` stops at step 1 right now**
- `pnpm build:worker` fails identically
- At runtime the dynamic import is inside `try/catch`, so the nightly sweep logs `renewal_tracker: FAILED - Cannot find module …` and continues. Renewal tracking is silently dead in production, and nothing alerts.

`fit-analysis-agent.ts` deletion left no dangling reference (tsc found only the one error), so that classification held. **[Certain]**

### 5.2 ✅ CLOSED before this audit — Blocker #1 "EA pipeline entirely dark, enrichment-processor never started"

`worker/index.ts:173` calls `enrichmentProcessor.start(supabase)`. `git log -S` shows it was added in `ef5f986` — *"Phase 5.4: Wire all unwired agents, fix all blockers — 114→130+ operational"*. So the audit's headline blocker was fixed before HEAD.

**But the fix has not produced results.** The EA family has exactly 2 `agent_runs` rows in all of history — `ea01_giving_detector` (1 run) and `ea08_executive_biography_analyzer` (1 run), both on 2026-08-03, both before the wiring existed. **Zero EA runs since `enrichmentProcessor.start()` was added.** The wiring is present and the pipeline is still dark. Root cause named in §5.6.

### 5.3 ✅ CLOSED — Blocker #3 "draft generation dead path, chain-trigger string doesn't match dispatcher case"

`worker/autonomous-orchestrator.ts:1921` now has `case 'ag-05-draft':` with an in-code comment stating it was added precisely because `queueChainedAgent("ag-05-draft", …)` had no matching case. Closed.

**Partially vindicated anyway:** `ag-05-draft` has 3 runs, 1 success, 2 failures — and both failures are a schema mismatch: `Could not find the 'knowledge_patterns_applied' column of 'applications' in the schema cache`. Last run 2026-08-08. Wired now, still broken by schema drift.

### 5.4 ✅ CONFIRMED — Blocker #2, all three external-integration bugs

| Claim | Verdict | Evidence |
|---|---|---|
| `simpler-grants.ts` 401, no API key since 2026-08-05 | **CONFIRMED** | `SIMPLER_GRANTS_API_KEY` appears 0 times in your `.env.local`; the agent's own code at line 164 hard-fails when it is unset |
| `state-portal.ts` 404, stale TX portal URL | **CONFIRMED (URL)** | Hardcoded `https://egrants.gov.texas.gov/fundingopp` at line 31. Live reachability UNVERIFIED — egress blocked. `state_portal`: 11 runs, 9 ok, 2 failed, last success 2026-09-09 |
| `grants-gov.ts` hangs indefinitely | **PARTIALLY REFUTED** | `src/lib/sources/grantsgov-client.ts` has `signal: AbortSignal.timeout(30_000)` at lines 157 and 237, and the agent sets `timeoutMs: 60_000`. Timeouts exist. `grants_gov_research`: 29 runs, 27 ok, 2 failed — not a hang pattern. **[Likely]** the hang was fixed or was a one-off |

### 5.5 ✅ CONFIRMED and now quantified — "147 distinct agents"

Counting agents is definition-dependent, so here is mine, stated explicitly.

I inventoried **316 modules** across `src/lib/agents/`, `src/lib/pil/`, `src/lib/autoapply/`, `src/lib/intelligence/`, `src/lib/research/`, `src/lib/scraper/`, `worker/`, and `src/worker/jobs/`. Of those:

| Category | Count |
|---|---|
| Modules declaring an `agentType` / `agentId` / `AGENT_ID` | 90 |
| PIL `BEN-XXX-NN.ts` agent files | 51 |
| Top-level worker processes | 15 |
| **= agent units (deduplicated)** | **154** |
| Supporting modules with no agent identity (`stealth-browser`, `rate-limiter`, `proxy-manager`, field handlers, parsers, …) | 162 |

**154 vs the audit's 147.** The gap is explained: `pil_agent_registry` grew from 44 rows (at the 2026-09-08 inventory) to **51 today**, and Phase 5.4/5.5 added wiring. The audit's count is sound. I am confirming it, not contradicting it.

### 5.6 ⚠️ SUPERSEDED — "114/147 (78%) PRODUCTION-READY"

This is where a code-only audit and an execution audit diverge hardest. "Production-ready" in the prior audit meant *has a real caller in a dispatch table*. Against live execution data, here is what the same population looks like:

| Verdict (my definition) | Count of 316 | Definition |
|---|---|---|
| **OPERATIONAL** | 69 | Has executed successfully, attributable in `agent_runs` / `pil_agent_runs` |
| **DEGRADED** | 5 | More failures than successes |
| **BROKEN** | 1 | Has executed, never once succeeded |
| **UNPROVEN** | 63 | Wired, declares an agent id, **zero rows in `agent_runs`** — never executed |
| **UNATTRIBUTABLE** | 165 | No agent id declared, so execution cannot be traced at all (mostly supporting modules, plus every AutoApply agent) |
| **ORPHANED** | 13 | Zero production callers |

Both numbers are true of different questions. "114 are wired" and "69 have ever demonstrably worked" are compatible. **Do not present 78% production-ready to anyone without the execution column beside it.**

### 5.7 ✅ CONFIRMED with a correction — "7 PIL agents structurally unreachable"

Live `pil_agent_runs` (70 rows total) shows **24 of 51** registered PIL agents have ever run. So **27 have never executed** — more than the 7 claimed, though the audit's specific named 7 were about reachability, a narrower claim. Two of its named-unreachable agents **have in fact run**: `BEN-DIS-02` (1 run, completed, 2026-09-16) and `BEN-DIS-08` (1 run, still `running`, 2026-09-16). Those two are refuted; the reachability concern for the rest stands.

---

## 6. Live production ground truth

Queried directly against project `vbjplpquqxxfbpazyalt` on 2026-09-17 01:22 UTC.

```
agent_registry            43 rows
pil_agent_registry        51 rows
agent_runs            63,180 rows · 51 distinct agent_type values · latest 2026-09-17 01:22:50
pil_agent_runs            70 rows · 24 distinct agent_id values
submission_queue          55 rows
autoapply_submissions      1 row
automation_sessions       12 rows
form_templates            15 rows
worker_status              2 rows
```

The worker is alive — `ag-29-knowledge-indexer` logged a run minutes before this query.

### 6.1 P1-4 — the 97% problem

| Agent | Runs | Share |
|---|---|---|
| `ag-29-knowledge-indexer` | 61,300 | **97.02%** |
| Everything else combined | 1,880 | 2.98% |

One embedding loop is 97% of every agent run in your platform's history. The second-busiest agent, `eligibility_scoring`, has 969. Every "63,000 agent runs" figure is, functionally, an embedding counter.

### 6.2 Failing agents, with root causes from live error strings

| Agent type | Runs | Failed | Actual error in production | Root cause | Fix |
|---|---|---|---|---|---|
| `success_probability` | 137 | **100** | `Failed to save probability score.` | Upsert constraint mismatch — you have a test for it (`success-probability-upsert-constraint.test.ts`) that cannot run here | Fix the conflict target; run that test locally |
| `eligibility_scoring` | 969 | 122 | 60× `401 API key is invalid`, 59× `Failed to save the eligibility score.` | Historic bad key (Aug 2, resolved) + a second persistence bug | Same class as above |
| `foundation_research` | 30 | 16 | 12× `Orphaned: exceeded 60s timeout`, 3× `Agent timed out after 60s.` | `AGENT_TIMEOUT_MS = 60_000` is too low for Claude-backed research | Raise per-agent `timeoutMs` |
| `review` | 4 | **4 (100%)** | `Agent timed out after 60s.` | Same | Same — **this agent has never succeeded** |
| `budget_builder` | 4 | 3 | `Agent timed out after 60s.` | Same | Same |
| `narrative_drafting` | 88 | 25 | 11× 60s timeout, 7× `429 concurrent connections exceeded`, 2× `Missing ANTHROPIC_API_KEY` | Timeout + no concurrency limiter on Anthropic calls | Raise timeout; add `p-limit` (already a dependency) around Claude calls |
| `ag-32-relationship-graph` | 45 | 5 | `Could not find the table 'public.corporate_prospects'` | **Table never migrated to production** | §6.3 |
| `ag22_propensity_scoring` | 13 | 4 | `permission denied for table corporate_prospects` | Same table, plus missing grants | §6.3 |
| `ag-05-draft` | 3 | 2 | `Could not find the 'knowledge_patterns_applied' column of 'applications'` | Schema drift | Add the column |
| `local_sponsorship` | 9 | 5 | 60s timeout | Same timeout class | Same |

### 6.3 P2-1 — `corporate_prospects` does not exist in production

Two live agents fail on it, and `src/__tests__/integration/corporate-prospects.test.ts` contains a test literally titled *"documents that corporate_prospects does not exist in production (SCHEMA_REGISTRY_v2.md §36 was never migrated live)."* Confirmed from two independent directions. Either apply the migration or delete the two agents' dependency on it — leaving it is guaranteed nightly failure noise.

### 6.4 PIL layer — running, producing nothing

24 of 51 PIL agents have executed. But **27 of 41 `pil_*` tables are empty**, including every assessment output table:

`pil_mission_affinity_assessments` 0 · `pil_capacity_propensity_assessments` 0 · `pil_funding_eligibility_assessments` 0 · `pil_timing_readiness_assessments` 0 · `pil_priority_scores` 0 · `pil_prospect_classifications` 0 · `pil_prospect_dossiers` 0 · `pil_prospect_opportunities` 0 · `pil_cultivation_plans` 0 · `pil_submission_queue` 0 · `pil_application_profiles` 0 · `pil_source_registry` 0 · `pil_feature_flags` 0

Non-empty: `pil_audit_log` 140 · `pil_policy_decisions` 119 · `pil_evidence` 76 · `pil_agent_runs` 70 · `pil_cost_ledger` 49 · `pil_prospects` 31 · `pil_contradictions` 31 · `pil_delegated_tasks` 28 · `pil_graph_nodes` 26 · `pil_human_review_queue` 22 · `pil_graph_edges` 18 · `pil_research_runs` 7 · `pil_prospect_digital_twins` 1

Read that pattern: the PIL **orchestration and audit infrastructure works** — it logs, it decides, it bills, it queues for human review. The **assessment agents produce no output rows.** It is instrumented but not productive.

### 6.5 PIL failures, with root causes

| Agent | Runs | Status | Production error | Assessment |
|---|---|---|---|---|
| `BEN-SUP-05` | 11 | **11 failed, 0 ok** | `BEN-SUP-05 requires context.plan.targetAgentRunId identifying the run under review` | **Caller bug, not agent bug.** The orchestrator dispatches it without the required context, nightly, and has done so 11 times. The agent's contract validation is correct; nothing supplies the field. |
| `BEN-QLF-04` | 3 | 3 failed | `[object Object]` | **Logging defect destroys diagnosability.** The error serializer stringifies an object instead of `.message`/`JSON.stringify`. Root cause unknowable from logs. |
| `BEN-QLF-03` | 1 | 1 failed | `[object Object]` | Same |
| `BEN-SUP-01` | 6 | **6 stuck `running`** | — | Runs start and never finalize. `stuck-run-watchdog.ts` exists but is not reaping these. |
| `BEN-DIS-08`, `BEN-INT-03`, `BEN-INT-09`, `BEN-REL-03` | 1 each | stuck `running` | — | Same |
| `BEN-SUP-06` | 1 | `escalated` | null | Escalated with no reason recorded |
| `BEN-SUP-02` / `-03` / `-04` / `-07`, `BEN-DIS-01` / `-02`, `BEN-KNW-01`–`04`, `BEN-REL-01` / `-04`, `BEN-STR-04`, `BEN-INT-01`, `BEN-INT-08` | 1–9 | completed | — | **Genuinely working** |
| The other 27 registered PIL agents | 0 | — | — | **Never executed** |

---

## 7. Agentic-maturity scoring — the rubric

You asked for a percentage of agentic development per agent. A number without a stated rubric is decoration, so here is exactly how every percentage in §8 was computed, from measurable code signals — no judgement calls.

| Dimension | Weight | 100 points awarded when | Detected by |
|---|---|---|---|
| **Model invocation** | 30% | Direct Anthropic/OpenAI call in the module | `@anthropic-ai/sdk` import, `.messages.create(`, `callClaude*(`, `.chat.completions.create(` |
| **Trigger autonomy** | 20% | Scheduled or cron-driven (75 if worker-queue-driven, 25 if manual API only, 0 if no caller) | Presence in `scheduler.ts` / `index.ts` / orchestrators; `src/app/api/cron/` caller |
| **Tool use / world effect** | 15% | Writes DB **and** drives a browser (+20 external HTTP) | `.insert/.update/.upsert/.delete(`, `page.goto/click/fill`, `chromium.`, `fetch(` |
| **Decision authority** | 15% | Chains a downstream agent with **no** human approval gate (70 if gated, 30 if approval-only) | `agent_queue`, `enqueue`, `chained_from`, `next_action` vs `awaiting_approval`, `pending_review` |
| **Iteration / planning** | 10% | Model call inside a loop (+25 retries, +25 multi-pass/reflection) | loop constructs wrapping a model call; `maxRetries`, `refine`, `reflect`, `secondPass` |
| **Feedback / learning** | 10% | Reads its own run history **and** calibrates | `agent_runs … select` plus `calibrat/learning/accuracy/confidence_score` |

**Deterministic modules score 0% by definition** and are marked `—`. Scoring only the 125 modules that make a model call:

| Band | Modules | Reading |
|---|---|---|
| 80–89% | 4 | Genuinely agentic — autonomous, chaining, iterating, self-calibrating |
| 70–79% | 17 | Strongly agentic |
| 60–69% | 17 | Agentic |
| 50–59% | 32 | Mid — typically autonomous + tool-using, but single-shot and no feedback loop |
| 40–49% | 32 | Weak — mostly "a scheduled Claude call with a DB write" |
| 30–39% | 15 | Nominal |
| 10–29% | 8 | A prompt in a function |
| **Mean across all agentic modules** | | **52%** |
| **Mean across agent units only** | | **53%** |

**The honest reading of a 52% mean:** the majority of Benavora's "agents" are **scheduled single-shot LLM calls that write a row**. They do not plan, do not iterate toward a goal, do not evaluate their own output, and do not learn. That is a legitimate and often correct architecture — but it is not what "147 autonomous agents" implies, and you should not describe it that way to a customer or an investor. The 21 modules at 70%+ are the ones that earn the word *agentic*.

### Highest-leverage agentic upgrades, ranked

1. **Add a self-evaluation pass to the four highest-value writers** — `narrative_drafting`, `ag-05-draft`, `budget_builder`, `BEN-STR-*`. One extra Claude call that grades its own output against the funder's stated criteria and regenerates once below threshold. Lifts each from ~50% to ~70% and is the single biggest quality-per-token win available.
2. **Close the feedback loop on scoring agents.** `eligibility_scoring` (969 runs) and `success_probability` (137) produce scores and never learn whether they were right. You already have `agent_runs` and application outcomes. Feed outcome back as few-shot calibration examples. Lifts scoring accuracy and moves them 50% → 75%.
3. **Give `FormFillerAgent` a real agentic loop.** It is currently a blind mapper. It should: fill → screenshot → ask Claude "is this form correctly and completely filled?" → repair → re-check, max 3 iterations, and **refuse to submit** while required fields are empty. This fixes P0-1 and P0-3 together and moves it from ~45% to ~80%.
4. **Replace the 60s `AGENT_TIMEOUT_MS` with per-agent budgets.** Six agent types fail on it. A Claude-backed research agent needs 180–300s. This is a one-line change per agent and removes the single most common production failure.
5. **Add `p-limit` around every Anthropic call site.** `p-limit@7.3.0` is already in your dependencies. `narrative_drafting` has 7 production 429s from concurrent-connection limits.
6. **Make PIL failures diagnosable before optimising anything in PIL.** `[object Object]` errors mean you are flying blind on 4 of 16 PIL failures. Fix the serializer first; everything else in PIL is guesswork until then.

---

## 8. Full agent inventory

Every module in the agent-bearing directories, with classification, agentic percentage, purpose, production wiring, test coverage, and live execution evidence. 316 rows across 8 families.

*(Verdict legend: OPERATIONAL = has executed successfully · DEGRADED = more failures than successes · BROKEN = never succeeded · UNPROVEN = wired, zero runs · UNATTRIBUTABLE = declares no agent id, execution untraceable · ORPHANED = no production caller)*

### Railway worker process — 20 modules

| # | Module / primary export | File | Det/Agentic | Agentic % | Purpose & capabilities | Wiring (production callers) | Unit/integration test | Live execution evidence | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `handleEnrichDonorProspectJob` | `src/worker/jobs/enrich-donor-prospect.ts` | DET | — | _no header comment_ | `worker/queue-processor.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 2 | `handleProcessDiscoveryRequestJob` | `src/worker/jobs/process-discovery-request.ts` | DET | — | _no header comment_ | **none found** | **none** | no agent id declared — cannot be attributed in `agent_runs` | ORPHANED — zero production callers |
| 3 | `processFollowups` | `src/worker/jobs/process-followups.ts` | DET | — | _no header comment_ | `worker/scheduler.ts` | **none** | `follow_up_generator`: 1 runs, 1 ok, 0 failed, last ok 2026-09-16 | OPERATIONAL |
| 4 | `handleRunConnectorEnrichmentJob` | `src/worker/jobs/run-connector-enrichment.ts` | DET | — | _no header comment_ | `worker/queue-processor.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 5 | `claimNextScoreDonorProspectJob` | `src/worker/jobs/score-donor-prospect.ts` | DET | — | _no header comment_ | `worker/queue-processor.ts` | `score-donor-prospect-website-gate.test.ts` | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 6 | `runAutonomousAutoApply` | `worker/autoapply-autonomous-orchestrator.ts` | DET | — | AutoApply autonomous overnight orchestrator — Phase 2 "AutoApply Full Autonomous Mode" per AUTONOMOUS_PLATFORM_VISION.md, which extends the existing AG-12 AutoApply pipeline (worker/queue-processor.ts, submission_queue) rather than introduc | `worker/scheduler.ts` | **none** | no `agent_runs` rows for `autoapply_autonomous_orchestrator` → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 7 | `runAutonomousPipeline` | `worker/autonomous-orchestrator.ts` | DET | — | Autonomous agent orchestrator — nightly per-org pipeline + the on-demand agent_queue processor, both built on migration 080's schema (src/supabase/migrations/080_autonomous_agent_infrastructure.sql: autonomous_triggers, agent_queue, agent_d | `worker/index.ts`, `worker/scheduler.ts` | `ag19-relationship-builder-flag.test.ts`, `ag19-org-scoping.test.ts` | `autonomous_orchestrator`: 38 runs, 29 ok, 0 failed, last ok 2026-09-16 | OPERATIONAL |
| 8 | `scoreAndReorderQueue` | `worker/batch-scorer.ts` | DET | — | Scores and reorders pending submission_queue items for an organization so the highest-value submissions execute first if the worker is interrupted. Composite score (0–100): timing 15% — seasonal conversion window for this funder type funder | `worker/queue-processor.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 9 | `DdRequestProcessor` | `worker/dd-request-processor.ts` | DET | — | _no header comment_ | `src/worker/jobs/process-discovery-request.ts`, `worker/index.ts` | `dd-dispatcher-routing.test.ts` | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 10 | `runEnrichmentBatch` | `worker/enrichment-processor.ts` | DET | — | Corporate Intelligence enrichment pipeline orchestrator (CORPORATE_INTELLIGENCE_ARCHITECTURE.md §2C, "Enrichment Pipeline"): corporate_prospects (unenriched) -> Enrichment Queue (Railway worker) -> EA-01 through EA-10 run sequentially per c | `worker/index.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 11 | `register` | `worker/heartbeat.ts` | DET | — | _no header comment_ | `worker/index.ts`, `worker/queue-processor.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 12 | `index` | `worker/index.ts` | AGENTIC (indirect) | 44% | _no header comment_ | `worker/rate-limiter.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 13 | `start` | `worker/knowledge-indexer-processor.ts` | DET | — | _no header comment_ | `worker/index.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 14 | `quickHealthCheck` | `worker/portal-health.ts` | DET | — | _no header comment_ | `worker/queue-processor.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 15 | `ProxyManager` | `worker/proxy-manager.ts` | DET | — | ProxyManager — residential proxy pool for AutoApply submissions. Prevents WAF/Cloudflare blocks by routing each submission through a different IP. 'static' provider reads PROXY_LIST env var; API-based providers (brightdata, smartproxy, ipro | `worker/queue-processor.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 16 | `QueueProcessor` | `worker/queue-processor.ts` | DET | — | _no header comment_ | `worker/index.ts` | `autoapply-queue-gating.test.ts` | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 17 | `RateLimiter` | `worker/rate-limiter.ts` | DET | — | _no header comment_ | `worker/queue-processor.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 18 | `start` | `worker/scheduler.ts` | DET | — | Scheduler — fires the nightly autonomous pipeline and the morning digest pipeline at fixed wall-clock times in America/Chicago (CST/CDT), matching WORKER_ARCHITECTURE_v2.md section 4's "2:00 AM CST" nightly trigger and "7:00 AM — Morning di | `worker/index.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 19 | `StreamServer` | `worker/stream-server.ts` | DET | — | _no header comment_ | `worker/index.ts`, `worker/queue-processor.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 20 | `start` | `worker/stuck-run-watchdog.ts` | DET | — | _no header comment_ | `worker/index.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |

### AutoApply subsystem — 40 modules

| # | Module / primary export | File | Det/Agentic | Agentic % | Purpose & capabilities | Wiring (production callers) | Unit/integration test | Live execution evidence | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `ABTestEngine` | `src/lib/autoapply/ab-testing.ts` | DET | — | _no header comment_ | `src/app/api/autoapply/ab-tests/route.ts`, `worker/queue-processor.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 2 | `AdvancedFieldHandler` | `src/lib/autoapply/advanced-field-handler.ts` | DET | — | _no header comment_ | `src/lib/autoapply/document-attacher.ts`, `src/lib/autoapply/form-filler-agent.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 3 | `checkAlerts` | `src/lib/autoapply/alerting.ts` | DET | — | _no header comment_ | **none found** | **none** | no agent id declared — cannot be attributed in `agent_runs` | ORPHANED — zero production callers |
| 4 | `getOptimalAskAmount` | `src/lib/autoapply/amount-optimizer.ts` | DET | — | Request types that carry no dollar amount — return null for these. | `src/components/autoapply/SubmissionPreview.tsx`, `worker/queue-processor.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 5 | `populateQueue` | `src/lib/autoapply/auto-queue-populator.ts` | DET | — | _no header comment_ | `src/app/api/autoapply/queue-populate/route.ts`, `src/app/api/cron/autoapply/route.ts`, `src/components/autoapply/QueuePreview.tsx` +2 | `autoapply-compliance.test.ts` | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 6 | `CaptchaSolver` | `src/lib/autoapply/captcha-solver.ts` | DET | — | _no header comment_ | `src/lib/autoapply/form-filler-agent.ts`, `src/lib/scraper/stealth-engine.ts`, `worker/queue-processor.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 7 | `ComplianceGuard` | `src/lib/autoapply/compliance-guard.ts` | DET | — | _no header comment_ | `src/lib/autoapply/auto-queue-populator.ts` | `autoapply-compliance.test.ts` | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 8 | `runConfirmationMonitorCycle` | `src/lib/autoapply/confirmation-monitor.ts` | AGENTIC | 65% | Gmail Confirmation Monitor — AUTOAPPLY_ARCHITECTURE_V2.md §10A. Read-only poller against exactly one dedicated, Benavora-owned inbox (apply@benavora.com). This is a SEPARATE OAuth grant from the per-org Gmail integrations at src/lib/email/g | `worker/index.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 9 | `parseConfirmationPage` | `src/lib/autoapply/confirmation-parser.ts` | AGENTIC | 50% | _no header comment_ | `src/lib/autoapply/form-filler-agent.ts`, `src/lib/autoapply/receipt-generator.ts`, `worker/queue-processor.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 10 | `CredentialManager` | `src/lib/autoapply/credential-manager.ts` | DET | — | _no header comment_ | `src/lib/autoapply/confirmation-monitor.ts`, `worker/queue-processor.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 11 | `sendAutoapplyDigest` | `src/lib/autoapply/digest-email.ts` | DET | — | _no header comment_ | `src/app/api/cron/autoapply/route.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 12 | `DocumentAttacher` | `src/lib/autoapply/document-attacher.ts` | AGENTIC | 49% | _no header comment_ | `src/lib/autoapply/form-filler-agent.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 13 | `checkDocumentCompliance` | `src/lib/autoapply/document-compliance.ts` | DET | — | _no header comment_ | **none found** | **none** | no agent id declared — cannot be attributed in `agent_runs` | ORPHANED — zero production callers |
| 14 | `DocumentVault` | `src/lib/autoapply/document-vault.ts` | DET | — | _no header comment_ | `src/app/api/autoapply/documents/readiness/route.ts`, `src/app/api/autoapply/documents/route.ts`, `src/lib/autoapply/document-attacher.ts` +2 | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 15 | `submitViaEmail` | `src/lib/autoapply/email-submitter.ts` | DET | — | _no header comment_ | `worker/queue-processor.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 16 | `annotateErrorScreenshot` | `src/lib/autoapply/error-annotator.ts` | AGENTIC | 50% | _no header comment_ | `worker/queue-processor.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 17 | `scheduleFollowUps` | `src/lib/autoapply/follow-up-scheduler.ts` | AGENTIC | 62% | _no header comment_ | `src/app/api/autoapply/follow-ups/[id]/route.ts`, `src/app/api/cron/follow-ups/route.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 18 | `FormAnalyzerAgent` | `src/lib/autoapply/form-analyzer-agent.ts` | AGENTIC | 56% | Analyzes a funder's giving portal, extracts form structure via Claude, and persists a reusable form_template record. This ports the logic in src/lib/agents/form-analyzer.ts (the BaseAgent- driven implementation used by the Vercel API route) | `worker/queue-processor.ts` | `form-analyzer-filler.test.ts` | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 19 | `DeferredSubmissionError` | `src/lib/autoapply/form-filler-agent.ts` | AGENTIC | 67% | _no header comment_ | `worker/queue-processor.ts` | `form-analyzer-filler.test.ts` | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 20 | `matchFunderToProfiles` | `src/lib/autoapply/funder-matcher.ts` | DET | — | Funder-to-RequestProfile capability matching engine. Scores each (funder, profile) pair 0.0-1.0 across four factors and returns ranked results filtered to >= 0.3 (meaningful alignment threshold). | `src/lib/autoapply/auto-queue-populator.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 21 | `MultiPageFormHandler` | `src/lib/autoapply/multi-page-handler.ts` | AGENTIC | 50% | _no header comment_ | `src/lib/autoapply/form-filler-agent.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 22 | `mapOrgToSubmissionProfile` | `src/lib/autoapply/org-profile-mapper.ts` | AGENTIC | 38% | Maps organization + Knowledge Base data to a standardized SubmissionProfile consumed by the portal adapter system (src/lib/autoapply/portal-adapters.ts). Real-schema note: `organizations` (root supabase/migrations, migration 001) has no exe | `src/lib/autoapply/portal-adapters.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 23 | `personalizePitch` | `src/lib/autoapply/pitch-personalizer.ts` | AGENTIC | 62% | _no header comment_ | `worker/queue-processor.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 24 | `CyberGrantsAdapter` | `src/lib/autoapply/portal-adapters.ts` | AGENTIC | 36% | Typed adapter system for corporate/foundation donation portal types. Each PortalAdapter turns a portal's raw HTML into a structured SubmissionPayload the AutoApply worker (worker/queue-processor.ts via form-filler-agent.ts) can drive a fill | **none found** | **none** | no agent id declared — cannot be attributed in `agent_runs` | ORPHANED — zero production callers |
| 25 | `QueueControlPlane` | `src/lib/autoapply/queue-controls.ts` | DET | — | Queue Control Plane — pause/resume controls at platform, domain, funder, and tenant level. Governs: AUTOAPPLY_ARCHITECTURE_V2.md §8F. Control levels are checked in descending precedence: platform → domain → funder → tenant All state is pers | `src/app/api/autoapply/controls/route.ts`, `worker/queue-processor.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 26 | `populateSubmissionQueue` | `src/lib/autoapply/queue-populator.ts` | DET | — | _no header comment_ | **none found** | **none** | no agent id declared — cannot be attributed in `agent_runs` | ORPHANED — zero production callers |
| 27 | `generateReceipt` | `src/lib/autoapply/receipt-generator.ts` | DET | — | Generates a PDF submission receipt, uploads it to Supabase Storage, and records it in the submission_receipts table. Called by the AutoApply worker after every successful form submission. | `worker/queue-processor.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 28 | `RegistrationAgent` | `src/lib/autoapply/registration-agent.ts` | AGENTIC | 62% | _no header comment_ | `worker/queue-processor.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 29 | `RelationshipManager` | `src/lib/autoapply/relationship-manager.ts` | DET | — | _no header comment_ | `worker/queue-processor.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 30 | `getResponseTimeStats` | `src/lib/autoapply/response-analytics.ts` | DET | — | --------------------------------------------------------------------------- Return types --------------------------------------------------------------------------- | **none found** | **none** | no agent id declared — cannot be attributed in `agent_runs` | ORPHANED — zero production callers |
| 31 | `assessSubmissionRisk` | `src/lib/autoapply/risk-engine.ts` | DET | — | _no header comment_ | `worker/queue-processor.ts` | `autoapply-queue.test.ts`, `autoapply-risk-scoring.test.ts` | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 32 | `ScreenshotManager` | `src/lib/autoapply/screenshot-manager.ts` | DET | — | _no header comment_ | `src/lib/autoapply/form-filler-agent.ts`, `worker/queue-processor.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 33 | `getStateRegistration` | `src/lib/autoapply/state-registration-data.ts` | DET | — | State charitable solicitation registration reference data. 41 jurisdictions (40 states + the District of Columbia) require a charity to register BEFORE soliciting donations from their residents. The remaining 10 jurisdictions — Arizona, Del | `src/app/(dashboard)/autoapply/compliance/page.tsx` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 34 | `StealthBrowser` | `src/lib/autoapply/stealth-browser.ts` | DET | — | StealthBrowser — a single hardened Playwright launcher for the AutoApply agents (form analysis + form filling). Wraps playwright-extra + the stealth plugin and layers on per-session fingerprint randomization and human-behavior helpers so au | `src/app/api/autoapply/templates/test/route.ts`, `src/lib/agents/form-analyzer.ts`, `src/lib/agents/form-filler.ts` +2 | `form-analyzer-filler.test.ts` | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 35 | `SubmissionControls` | `src/lib/autoapply/submission-controls.ts` | DET | — | _no header comment_ | `src/lib/autoapply/auto-queue-populator.ts`, `worker/queue-processor.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 36 | `runRetrySweep` | `src/lib/autoapply/submission-retry.ts` | DET | — | _no header comment_ | `src/app/api/cron/autoapply-retry/route.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 37 | `SubmissionValidator` | `src/lib/autoapply/submission-validator.ts` | AGENTIC | 55% | _no header comment_ | `src/app/api/agents/automation/route.ts`, `worker/queue-processor.ts` | `autoapply-mutual-exclusion.test.ts`, `autoapply-queue.test.ts`, `regressions.test.ts` | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 38 | `getTimingScore` | `src/lib/autoapply/timing-optimizer.ts` | DET | — | Seasonal timing optimizer for AutoApply submission scheduling. Returns how optimal the current month is for submitting to a given funder type. | `src/components/autoapply/SubmissionPreview.tsx`, `worker/batch-scorer.ts`, `worker/queue-processor.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 39 | `UsageMeter` | `src/lib/autoapply/usage-meter.ts` | AGENTIC (indirect) | 38% | Usage metering and tier-cap enforcement for AutoApply submissions. Reads tier limits from the `tier_limits` table and tracks monthly/daily counts in `submission_usage`. Enforces hard daily caps regardless of overages. | `src/app/api/autoapply/usage/route.ts`, `src/lib/agents/ag-22-propensity-scoring.ts`, `worker/queue-processor.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 40 | `WebhookNotifier` | `src/lib/autoapply/webhook-notifier.ts` | DET | — | _no header comment_ | `src/lib/autoapply/form-filler-agent.ts`, `src/lib/pil/research-orchestrator.ts`, `worker/queue-processor.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |

### Core agents (src/lib/agents) — 106 modules

| # | Module / primary export | File | Det/Agentic | Agentic % | Purpose & capabilities | Wiring (production callers) | Unit/integration test | Live execution evidence | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `PropensityBatchScorer` | `src/lib/agents/ag-22-propensity-scoring.ts` | AGENTIC | 57% | AG-22 Propensity Scoring Agent (CORPORATE_INTELLIGENCE_ARCHITECTURE.md §3, AGENTS_v2.md AG-22). Computes the 10 donation-propensity scores (PS-01..PS-10, §3A) for one corporate_prospects row and writes them into its `scores` jsonb (canonica | `src/app/api/agents/propensity-scoring/route.ts`, `worker/enrichment-processor.ts` | **none** | `ag22_propensity_scoring`: 13 runs, 9 ok, 4 failed, last ok 2026-09-11 | OPERATIONAL (with failures) |
| 2 | `agent-registry-seed` | `src/lib/agents/agent-registry-seed.ts` | AGENTIC (indirect) | 12% | Static seed data for the `agent_registry` table (migration 094, Pillar 17 - Agent Marketplace, AGENTS_v2.md). Used by a one-time/idempotent seed step and by the registry API route as a fallback label source. Not a substitute for the DB tabl | **none found** | **none** | no `agent_runs` rows for `ag-01`/`ag-02`/`ag-05`/`ag-13`/`ag-15`/`ag-16`/`ag-17`/`ag-18`/`ag-19`/`ag-22`/`ag-24`/`ag-25`/`ag-26`/`ag-27`/`ag-28`/`ag-23` → NEVER EXECUTED | ORPHANED — zero production callers |
| 3 | `ApplicationClonerAgent` | `src/lib/agents/application-cloner.ts` | AGENTIC | 41% | Application Cloning Agent - AGENTS.md Agent 26. Clones an existing (ideally awarded) application to a new target opportunity. Copies draft_content, draft_template_type, and linked application_documents, then adapts the draft via Claude to f | `src/app/api/agents/application-cloner/route.ts` | **none** | no `agent_runs` rows for `application_cloning` → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 4 | `AutomationWorkerAgent` | `src/lib/agents/automation-worker.ts` | DET | — | Automation Worker Agent — AGENTS.md Agent 29, BEHAVIORAL_CONTRACTS §23. Processes the next queued item from automation_queue by invoking the browser automation pipeline. Enforces: - Stale item reaping: items stuck in 'processing' >5 minutes | `src/app/api/automation/process/route.ts` | **none** | no `agent_runs` rows for `automation_worker` → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 5 | `autonomous-base` | `src/lib/agents/autonomous-base.ts` | DET | — | AutonomousAgent - shared infrastructure for agents that act without a human in the loop between nightly/chained runs (migration 080: autonomous_triggers, agent_queue, agent_decisions, org_autonomous_config). Every autonomous action must be  | `src/lib/agents/autonomous-digest-agent.ts`, `src/lib/agents/board-packet-agent.ts`, `src/lib/agents/change-monitor-agent.ts` +23 | `agent-silent-failure-alert.test.ts`, `regressions.test.ts`, `autonomous-base.test.ts` | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 6 | `AutonomousDigestAgent` | `src/lib/agents/autonomous-digest-agent.ts` | AGENTIC | 71% | Autonomous Digest Agent — FULL AGENTIC UPGRADE (July 2026). This is no longer a data dump of overnight counts. It is a curated, prioritized briefing: it pulls candidate items from every autonomous signal source in the platform, scores each  | `worker/autonomous-orchestrator.ts` | **none** | `ag-digest`: 90 runs, 90 ok, 0 failed, last ok 2026-09-16 | OPERATIONAL |
| 7 | `AgentError` | `src/lib/agents/base-agent.ts` | DET | — | BaseAgent - shared infrastructure for every Benavora agent (AGENTS.md "Agent Architecture"). Provides, once, the cross-cutting concerns every agent must honor: - Structured logging to the agent_runs table (a row is written BEFORE work start | `src/app/api/agents/application-cloner/route.ts`, `src/app/api/agents/automation/[sessionId]/approve/route.ts`, `src/app/api/agents/automation/[sessionId]/route.ts` +87 | `agent-silent-failure-alert.test.ts` | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 8 | `BoardPacketAgent` | `src/lib/agents/board-packet-agent.ts` | AGENTIC | 81% | AG-27 Board Meeting Packet Agent (AutonomousAgent, migration 078/105: board_meetings, board_meeting_packets, RLS added migration 105; this build's own migration adds the 'ag-27-board-packet' agent_type enum value and a UNIQUE(meeting_id) co | `worker/autonomous-orchestrator.ts` | **none** | `ag-27-board-packet`: 2 runs, 2 ok, 0 failed, last ok 2026-08-03 | OPERATIONAL |
| 9 | `BrowserAutomationAgent` | `src/lib/agents/browser-automation.ts` | DET | — | Browser Automation Agent - AGENTS.md Agent 16 (Phase 3), BEHAVIORAL_CONTRACTS §18. Drives a headless browser to pre-fill a funder's online donation/grant application form, then STOPS at `awaiting_approval`. It never submits on its own - a h | `src/app/api/agents/automation/[sessionId]/approve/route.ts`, `src/app/api/agents/automation/[sessionId]/route.ts`, `src/lib/agents/automation-worker.ts` +1 | **none** | `browser_automation`: 3 runs, 3 ok, 0 failed, last ok 2026-09-08 | OPERATIONAL |
| 10 | `BudgetAgent` | `src/lib/agents/budget-agent.ts` | AGENTIC | 52% | Budget Agent - dedicated agent for /api/ai/budget (AGENTS.md Agent 06). Enhanced successor to BudgetBuilderAgent that: - Targets one specific program by programId rather than all org programs. - Incorporates Knowledge Base budget_justificat | `src/app/api/ai/budget/route.ts` | **none** | `budget_builder`: 4 runs, 1 ok, 3 failed, last ok 2026-08-07 | DEGRADED — more failures than successes |
| 11 | `BudgetBuilderAgent` | `src/lib/agents/budget-builder.ts` | AGENTIC | 76% | Budget Builder Agent - AGENTS.md Agent 06. Creates a project budget (structured line items by standard grant category) and a budget narrative for a grant application, using ONLY the organization's program financial data (BEHAVIORAL_CONTRACT | `worker/autonomous-orchestrator.ts` | **none** | no `agent_runs` rows for `budget_builder_worker` → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 12 | `ChangeMonitorAgent` | `src/lib/agents/change-monitor-agent.ts` | AGENTIC | 77% | AG-42 Change Monitor Agent (CM-01) (AutonomousAgent, migration 077: corporate_monitoring_events / pig_nodes / pig_edges, RLS added migration 105; this build adds the 'ag-42-change-monitor' agent_type enum value via migration 111). Enterpris | `worker/autonomous-orchestrator.ts` | **none** | `ag-42-change-monitor`: 47 runs, 47 ok, 0 failed, last ok 2026-09-16 | OPERATIONAL |
| 13 | `ColdOutreachAgent` | `src/lib/agents/cold-outreach.ts` | AGENTIC | 56% | Cold Outreach Agent - AGENTS.md Agent 11. Extracts contact information from companies that have no corporate giving page (funders with has_giving_page = false, or an ad-hoc company scan). It fetches the company website server-side, asks Cla | `src/app/api/agents/outreach/route.ts`, `src/lib/agents/research/local-sponsorship.ts` | **none** | no `agent_runs` rows for `cold_outreach` → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 14 | `CommunityNeedPredictorAgent` | `src/lib/agents/community-need-predictor-agent.ts` | AGENTIC | 70% | AG-35 Community Need Predictor Agent (AutonomousAgent, migration 090: community_need_signals). Phase 3 per AUTONOMOUS_PLATFORM_VISION.md §7 ("Community Need Prediction") and AGENTS_v2.md's Phase 2-5 spec section. Purpose: ingests census, ho | `src/app/api/intelligence/community-need/route.ts`, `worker/autonomous-orchestrator.ts` | **none** | no `agent_runs` rows for `ag-35-community-need` → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 15 | `CompetitorIntelAgent` | `src/lib/agents/competitor-intel.ts` | AGENTIC | 47% | Competitor Intelligence Agent (AGENTS.md Agent 24, BEHAVIORAL_CONTRACTS §27). Loads funder_giving_history for a target funder (last 3 fiscal years), sends the recipient list to Claude to identify organizations most similar to the client in  | `src/app/api/agents/competitor-intel/route.ts` | **none** | no `agent_runs` rows for `competitor_intelligence` → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 16 | `ComplianceChecker` | `src/lib/agents/compliance-checker.ts` | AGENTIC | 59% | Compliance Check Agent - AGENTS.md Agent 07. Verifies an application package is complete before submission. Combines deterministic checks with an optional AI content review: - Required documents (opportunity.required_documents) are matched  | `src/app/api/compliance/check/route.ts`, `worker/autonomous-orchestrator.ts` | **none** | `compliance_check`: 21 runs, 21 ok, 0 failed, last ok 2026-08-23 | OPERATIONAL |
| 17 | `buildValidationPrompt` | `src/lib/agents/consensus-validator.ts` | AGENTIC | 50% | Cross-provider consensus validation (api/ai/validate, migration 014). After the research agents discover an opportunity, each finding is sent to two INDEPENDENT AI providers - Anthropic Claude and the free-tier Google Gemini - which each ju | `src/app/api/ai/validate/route.ts`, `src/lib/agents/research/orchestrator.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 18 | `sleep` | `src/lib/agents/corporate-enrichment-shared.ts` | DET | — | Shared helpers for the Corporate Intelligence enrichment agents (CORPORATE_INTELLIGENCE_ARCHITECTURE.md §2B/§2C, Agents EA-01..EA-05). All five EA-0X agents read one corporate_prospects row, merge new fields into its `enrichment` jsonb (can | `src/lib/agents/ag-22-propensity-scoring.ts`, `src/lib/agents/ea-01-giving-detector.ts`, `src/lib/agents/ea-02-community-outreach-detector.ts` +9 | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 19 | `CorporateScraperAgent` | `src/lib/agents/corporate-scraper.ts` | AGENTIC | 50% | Corporate Scraper Agent — scrapes major corporate foundation and giving pages, extracts structured grant opportunity data via Claude, and inserts new records. Fetches 5 corporate URLs with a 1-second delay between each, sends each page's HT | `src/app/api/agents/corporate-research/route.ts`, `src/app/api/agents/research/route.ts` | **none** | `corporate_research`: 16 runs, 11 ok, 5 failed, last ok 2026-09-09 | OPERATIONAL (with failures) |
| 20 | `CustomApiResearchAgent` | `src/lib/agents/custom-api.ts` | DET | — | Custom API Research Agent — AGENTS.md Agent 19. Polls client-configured REST API connections for grant opportunities. For each active connection: 1. Validates field_mapping includes at least a "name" mapping (Contracts §20) 2. Re-checks the | `src/app/api/agents/custom-api/route.ts`, `src/app/api/integrations/custom-api/route.ts` | **none** | `custom_api_research`: 7 runs, 6 ok, 1 failed, last ok 2026-08-18 | OPERATIONAL (with failures) |
| 21 | `CustomScrapeResearchAgent` | `src/lib/agents/custom-scrape.ts` | AGENTIC | 50% | Custom Scrape Research Agent — AGENTS.md Agent 20. Fetches client-assigned URLs server-side and uses Claude to extract structured grant opportunity data (BEHAVIORAL_CONTRACTS §21). Per-target behaviour: 1. Re-check the org's domain allowlis | `src/app/api/agents/custom-scrape/route.ts` | **none** | no `agent_runs` rows for `custom_scrape_research` → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 22 | `DeadlineExtractor` | `src/lib/agents/deadline-extractor.ts` | DET | — | Deadline Extraction Agent - AGENTS.md Agent 03. Deterministic, NO AI. Reads an opportunity's dates and recurrence and creates the corresponding deadline records: - the application_deadline itself (from opportunity.deadline) - follow_up_date | `worker/autonomous-orchestrator.ts` | **none** | no `agent_runs` rows for `deadline_extraction` → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 23 | `DeadlinePredictionAgent` | `src/lib/agents/deadline-prediction-agent.ts` | AGENTIC | 67% | Deadline Prediction Agent — AGENTS_v2.md AG-25 (per this task's naming; AGENTS_v2.md's own AG-25 slot is Disaster Response — this agent is scoped exactly as given in this build's task prompt) — built on AutonomousAgent (migration 080 infras | **none found** | **none** | `ag-25-deadline-prediction`: 1 runs, 1 ok, 0 failed, last ok 2026-08-02 | ORPHANED — zero production callers |
| 24 | `DeadlinePredictionAgent` | `src/lib/agents/deadline-prediction.ts` | DET | — | Deadline Prediction Agent - predicts future deadlines based on historical patterns found in the organization's opportunity records. Scans past opportunities (optionally filtered by category) to find recurring deadline patterns: annual (same | `src/app/api/agents/deadline-prediction/route.ts`, `worker/autonomous-orchestrator.ts` | **none** | `deadline_prediction`: 30 runs, 30 ok, 0 failed, last ok 2026-09-16 | OPERATIONAL |
| 25 | `pollFEMADeclarations` | `src/lib/agents/disaster-response-agent.ts` | DET | — | Disaster Response Agent — PLATFORM_VISION_ARCHITECTURE.md Pillar 10, AGENTS_v2.md AG-25 ("5:00 AM — Disaster Response Agent (poll FEMA)"). Two plain functions, matching the sendMorningDigest pattern (no agent_type enum value, no Claude call | `src/app/api/agents/disaster/route.ts`, `src/app/api/autonomous/decisions/route.ts`, `worker/autonomous-orchestrator.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 26 | `DocumentExpiryAgent` | `src/lib/agents/document-expiry-agent.ts` | DET | — | AG-10 Document Expiry Agent (AutonomousAgent, migration 080 infrastructure). Runs nightly - registered unconditionally in worker/autonomous-orchestrator.ts's runOrgPipeline (every 2AM run). Deviation from the task-given spec, checked agains | `worker/autonomous-orchestrator.ts` | **none** | `ag-10-document-expiry`: 1 runs, 1 ok, 0 failed, last ok 2026-09-16 | OPERATIONAL |
| 27 | `DonorIntentMonitorAgent` | `src/lib/agents/donor-intent-monitor-agent.ts` | AGENTIC | 75% | AG-30 Donor Intent Monitor Agent (AutonomousAgent, migration 093: corporate_intent_signals). Phase 2 per AUTONOMOUS_PLATFORM_VISION.md section "AI Donor Intent Engine" and AGENTS_v2.md's Phase 2-5 spec section ("AG-30: Donor Intent Monitor" | `src/app/api/intelligence/donor-intent/route.ts`, `worker/autonomous-orchestrator.ts` | **none** | `ag-30-donor-intent`: 32 runs, 31 ok, 1 failed, last ok 2026-09-16 | OPERATIONAL (with failures) |
| 28 | `DraftGenerationAgent` | `src/lib/agents/draft-generation-agent.ts` | AGENTIC | 74% | Draft Generation Agent — AGENTS_v2.md's Phase 1 list calls this "AG-06: Draft Generator Agent (Already implemented)", but the literal agent_id already wired into agent_queue chaining is "ag-05-draft" (see src/lib/agents/probability-scoring- | `worker/autonomous-orchestrator.ts` | `draft-generation.test.ts` | `ag-05-draft`: 3 runs, 1 ok, 2 failed, last ok 2026-08-08 | DEGRADED — more failures than successes |
| 29 | `EA01GivingDetectorAgent` | `src/lib/agents/ea-01-giving-detector.ts` | AGENTIC | 45% | EA-01 Corporate Giving Detector (CORPORATE_INTELLIGENCE_ARCHITECTURE.md §2B/§6). Fetches a corporate prospect's /giving, /csr, and /community pages via StealthEngine (src/lib/scraper/stealth-engine.ts — same engine foundation-scraper.ts and | `worker/enrichment-processor.ts` | **none** | `ea01_giving_detector`: 1 runs, 1 ok, 0 failed, last ok 2026-08-03 | OPERATIONAL |
| 30 | `EA02CommunityOutreachDetectorAgent` | `src/lib/agents/ea-02-community-outreach-detector.ts` | AGENTIC | 51% | EA-02 Community Outreach Detector (CORPORATE_INTELLIGENCE_ARCHITECTURE.md §2B/§6). Fetches a corporate prospect's about page via StealthEngine, then grounds a single Claude call with live web search (callClaudeWithWebSearch, src/lib/ai/clau | `worker/enrichment-processor.ts` | **none** | no `agent_runs` rows for `ea02_community_outreach_detector` → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 31 | `EA03SponsorshipDetectorAgent` | `src/lib/agents/ea-03-sponsorship-detector.ts` | AGENTIC | 45% | EA-03 Sponsorship Detector (CORPORATE_INTELLIGENCE_ARCHITECTURE.md §2B/§6). Trigger: POST-EA-01 — must run after EA-01 (Corporate Giving Detector) has completed for this prospect. Enforced below by checking that `enrichment.has_giving_progr | `worker/enrichment-processor.ts` | **none** | no `agent_runs` rows for `ea03_sponsorship_detector` → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 32 | `EA04FoundationDetectorAgent` | `src/lib/agents/ea-04-foundation-detector.ts` | DET | — | EA-04 Foundation Detector (CORPORATE_INTELLIGENCE_ARCHITECTURE.md §2B/§6). Cross-references the prospect against `nonprofits` — the live IRS Business Master File import (migrations 098/099, ~1.97M records, confirmed live per STATE_OF_THE_BU | `worker/enrichment-processor.ts` | **none** | no `agent_runs` rows for `ea04_foundation_detector` → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 33 | `EA05CareerPageAnalyzerAgent` | `src/lib/agents/ea-05-career-page-analyzer.ts` | AGENTIC | 45% | EA-05 Career Page Analyzer (CORPORATE_INTELLIGENCE_ARCHITECTURE.md §2B/§6). Fetches a corporate prospect's /careers and /jobs pages via StealthEngine (same fetch layer as every other EA-0X agent) and asks Claude to infer a headcount bracket | `worker/enrichment-processor.ts` | **none** | no `agent_runs` rows for `ea05_career_page_analyzer` → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 34 | `EA06PressReleaseAnalyzerAgent` | `src/lib/agents/ea-06-press-release-analyzer.ts` | AGENTIC | 45% | EA-06 Press Release Analyzer (CORPORATE_INTELLIGENCE_ARCHITECTURE.md §2B/§6). Fetches a corporate prospect's /news and /press pages via StealthEngine (same fetch layer every other EA-0X agent uses), then grounds a single Claude call with li | `worker/enrichment-processor.ts` | **none** | no `agent_runs` rows for `ea06_press_release_analyzer` → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 35 | `EA07EsgAnalyzerAgent` | `src/lib/agents/ea-07-esg-analyzer.ts` | AGENTIC | 45% | EA-07 ESG Analyzer (CORPORATE_INTELLIGENCE_ARCHITECTURE.md §2B/§6). Fetches a corporate prospect's /sustainability and /esg pages via StealthEngine and asks Claude to extract stated ESG initiatives and environmental commitments. Unlike EA-0 | `worker/enrichment-processor.ts` | **none** | no `agent_runs` rows for `ea07_esg_analyzer` → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 36 | `EA08ExecutiveBiographyAnalyzerAgent` | `src/lib/agents/ea-08-executive-biography-analyzer.ts` | AGENTIC | 51% | EA-08 Executive Biography Analyzer (CORPORATE_INTELLIGENCE_ARCHITECTURE.md §2B/§6). Fetches a corporate prospect's /leadership and /about/team pages via StealthEngine and asks Claude to extract decision-maker names/titles, board memberships | `worker/enrichment-processor.ts` | **none** | `ea08_executive_biography_analyzer`: 1 runs, 1 ok, 0 failed, last ok 2026-08-03 | OPERATIONAL |
| 37 | `EA09ContactExtractorAgent` | `src/lib/agents/ea-09-contact-extractor.ts` | AGENTIC | 45% | EA-09 Contact Extractor (CORPORATE_INTELLIGENCE_ARCHITECTURE.md §2B/§6). Fetches a corporate prospect's /contact page via StealthEngine and asks Claude to extract verified emails, phone, and whether the on-file address is corroborated by th | `worker/enrichment-processor.ts` | **none** | no `agent_runs` rows for `ea09_contact_extractor` → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 38 | `EA10SocialMediaAnalyzerAgent` | `src/lib/agents/ea-10-social-media-analyzer.ts` | AGENTIC | 51% | EA-10 Social Media Analyzer (CORPORATE_INTELLIGENCE_ARCHITECTURE.md §2B/§6). Unlike EA-01/EA-02/EA-05/EA-07/EA-08/EA-09, this agent has no reliable same-origin URL to fetch: corporate_prospects does not yet store the company's own LinkedIn/ | `worker/enrichment-processor.ts` | **none** | no `agent_runs` rows for `ea10_social_media_analyzer` → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 39 | `searchEducationTrainingGrants` | `src/lib/agents/education-training-grants.ts` | DET | — | Thin Grants.gov agent scoped to Department of Education funding and related education/workforce-training categories. Reuses the shared `grantsgov-client.ts` search2 client (extended with `agencies`/ `fundingCategories` filters) rather than  | `src/lib/agents/research/government-grants.ts` | `education-training-grants.test.ts` | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 40 | `EligibilityScorer` | `src/lib/agents/eligibility-scorer.ts` | AGENTIC | 62% | Eligibility Scoring Agent - AGENTS.md Agent 02. Evaluates whether the organization qualifies for an opportunity by comparing the verified organization profile against the opportunity's eligibility requirements, then writes a 0-100 score, an | `src/app/api/agents/eligibility/route.ts`, `src/app/api/agents/research/route.ts`, `src/app/api/grants/[id]/rescore/route.ts` +5 | `government-grants-orchestration.test.ts` | `eligibility_scoring`: 969 runs, 847 ok, 122 failed, last ok 2026-09-16 | OPERATIONAL (with failures) |
| 41 | `EmailCampaignAgent` | `src/lib/agents/email-campaign.ts` | DET | — | Email Campaign Agent - AGENTS.md Agent 18 (BLUEPRINT Phase 4 / §4.11). Executes drip email campaigns for cold outreach. One run sweeps the organization's active campaigns and, for each enrolled outreach contact, figures out which step they' | `src/app/api/agents/campaigns/route.ts`, `src/app/api/cron/campaigns/route.ts` | **none** | no `agent_runs` rows for `email_campaign` → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 42 | `EmailParserAgent` | `src/lib/agents/email-parser.ts` | AGENTIC | 50% | Email Parser Agent - classifies inbound emails, extracts structured metadata, matches funders, and logs to email_activity. Phase 3: processes email data passed to it directly. Phase 4 will wire in actual Gmail API integration (AGENTS.md Age | `src/app/api/agents/email-parser/route.ts`, `src/components/dashboard/EmailParserWidget.tsx` | **none** | `email_parser`: 1 runs, 1 ok, 0 failed, last ok 2026-08-13 | OPERATIONAL |
| 43 | `searchEnvironmentalClimateGrants` | `src/lib/agents/environmental-climate-grants.ts` | DET | — | Thin Grants.gov agent scoped to environment/climate/natural-resources agencies and funding categories. Reuses the shared `grantsgov-client.ts` search2 client (extended with `agencies`/`fundingCategories` filters) rather than a second, separ | `src/lib/agents/research/government-grants.ts` | `environmental-climate-grants.test.ts` | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 44 | `FinalAssemblyAgent` | `src/lib/agents/final-assembly.ts` | AGENTIC | 47% | Final Assembly Agent - AGENTS.md Agent 09. Assembles the complete application package. It orders the attached documents to match the opportunity's stated requirements, builds a submission checklist, compiles a package summary (applicant + c | `src/app/api/agents/final-assembly/route.ts` | **none** | no `agent_runs` rows for `final_assembly` → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 45 | `FollowUpGeneratorAgent` | `src/lib/agents/follow-up-generator.ts` | AGENTIC | 65% | Follow-Up Generator Agent (AGENTS.md Agent 28, BEHAVIORAL_CONTRACTS §28). After a grant application is submitted, this agent generates a 3-step humanized follow-up email sequence: thank-you (day 1), check-in (day 14), and status request (da | `src/app/(dashboard)/follow-ups/page.tsx`, `src/app/api/agents/follow-up/route.ts`, `src/worker/jobs/process-followups.ts` +1 | **none** | `follow_up_generator`: 1 runs, 1 ok, 0 failed, last ok 2026-09-16 | OPERATIONAL |
| 46 | `FollowupGeneratorAgent` | `src/lib/agents/followup-generator-agent.ts` | AGENTIC | 76% | HARD LIMIT: This agent schedules follow-ups only. It never sends emails directly. All records created have status='scheduled'. AG-28 Follow-Up Generator Agent (event-driven, agent_queue infrastructure - migration 080: src/supabase/migration | `worker/autonomous-orchestrator.ts` | **none** | `ag-28-followup`: 1 runs, 1 ok, 0 failed, last ok 2026-08-02 | OPERATIONAL |
| 47 | `FormAnalyzerAgent` | `src/lib/agents/form-analyzer.ts` | AGENTIC | 68% | Form Analyzer Agent - visits a funder's giving portal via Playwright, sends the HTML to Claude to extract form structure, builds a field mapping to Benavora KB columns, and inserts the result into form_templates. Also scans the full page te | `src/app/api/agents/form-analyzer/route.ts`, `src/lib/agents/form-filler.ts` | **none** | no `agent_runs` rows for `form_analyzer` → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 48 | `FormFillerAgent` | `src/lib/agents/form-filler.ts` | AGENTIC | 71% | Form Filler Agent — fills and submits a corporate giving form using Playwright and a stored form_template. Uploads screenshots to Supabase Storage and creates an autoapply_submissions record with full audit trail. NOTE: Playwright requires  | `src/app/api/agents/form-filler/route.ts` | **none** | no `agent_runs` rows for `form_filler` → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 49 | `FoundationFinderAgent` | `src/lib/agents/foundation-finder.ts` | AGENTIC | 50% | Foundation Finder Agent - free alternative to the (paid) Candid API. Fetches free foundation-directory pages, sends the HTML to Claude for structured extraction, and inserts discovered private-foundation grant opportunities. Same pattern as | `src/app/api/agents/foundation-finder/route.ts` | **none** | no `agent_runs` rows for `foundation_research_finder` → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 50 | `FundabilityScorerAgent` | `src/lib/agents/fundability-scorer-agent.ts` | AGENTIC | 81% | AG-29 Fundability Scorer Agent (AutonomousAgent, migration 091: fundability_scores). Phase 2 per AUTONOMOUS_PLATFORM_VISION.md section "Fundability Intelligence Score" and AGENTS_v2.md's Phase 2-5 spec section. Numbering note: AGENTS_v2.md' | `src/app/api/intelligence/fundability/route.ts`, `worker/autonomous-orchestrator.ts` | **none** | `ag-29-fundability`: 1 runs, 1 ok, 0 failed, last ok 2026-09-16 | OPERATIONAL |
| 51 | `FunderIntelAgent` | `src/lib/agents/funder-intel.ts` | AGENTIC | 50% | Funder Intelligence Agent - extracts structured funding intelligence from a funder's public website and upserts it into funder_intelligence. The agent fetches the funder's website (best-effort, falls back to any existing description), sends | `src/app/api/agents/funder-intel/route.ts` | **none** | `funder_intel`: 1 runs, 1 ok, 0 failed, last ok 2026-08-23 | OPERATIONAL |
| 52 | `FunderRelationshipAgent` | `src/lib/agents/funder-relationship.ts` | DET | — | Funder Relationship Agent - AGENTS.md Agent 23. CONSOLIDATED onto the canonical event-sourced formula in src/lib/intelligence/relationship-scorer.ts (see BEHAVIORAL_CONTRACTS.md's "Relationship Scoring" contract). This agent used to run its | `src/app/api/agents/funder-relationship/route.ts`, `worker/autonomous-orchestrator.ts` | `relationship-scoring-consolidation.test.ts` | `funder_relationship`: 4 runs, 3 ok, 1 failed, last ok 2026-09-11 | OPERATIONAL (with failures) |
| 53 | `FundingForecastAgent` | `src/lib/agents/funding-forecast-agent.ts` | AGENTIC | 77% | AG-26 Funding Forecast Agent (AutonomousAgent, migration 078/105: funding_forecasts, RLS added migration 105; migration 110 adds the UNIQUE(org_id, forecast_date, forecast_period) idempotency constraint and the 'ag-26-forecast' agent_type e | `src/app/api/reports/forecast/route.ts`, `worker/autonomous-orchestrator.ts` | **none** | `ag-26-forecast`: 7 runs, 7 ok, 0 failed, last ok 2026-09-01 | OPERATIONAL |
| 54 | `GivingHistoryAgent` | `src/lib/agents/giving-history.ts` | DET | — | Giving History Agent - extracts IRS 990-PF giving history from ProPublica Nonprofit Explorer by EIN. Parses per-year aggregate stats (grants paid, total revenue, total assets) from filings_with_data, calculates trend, and upserts into funde | `src/app/api/agents/giving-history/route.ts` | **none** | no `agent_runs` rows for `giving_history_extractor` → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 55 | `GrantDnaAgent` | `src/lib/agents/grant-dna-agent.ts` | AGENTIC | 86% | AG-10 Grant DNA Analysis Agent (AutonomousAgent, migration 106: funder_dna_profiles). Enterprise spec: AGENTS_v2.md §5, AG-10 "Grant DNA Analysis Agent" (written 2026-08-03). Purpose: analyzes what a funder tends to require and reward, prod | `worker/autonomous-orchestrator.ts` | **none** | `ag-10-grant-dna`: 17 runs, 17 ok, 0 failed, last ok 2026-09-13 | OPERATIONAL |
| 56 | `GrantSummaryAgent` | `src/lib/agents/grant-summary.ts` | AGENTIC | 50% | Grant Summary Agent - AGENTS.md Agent 01. Turns a raw opportunity (a URL and/or pasted description) into structured, actionable fields. It optionally fetches the source page server-side, sends the text to Claude for extraction, then patches | `src/app/api/agents/research/route.ts`, `src/app/api/ai/summarize/route.ts` | **none** | `grant_summary`: 70 runs, 69 ok, 1 failed, last ok 2026-09-15 | OPERATIONAL (with failures) |
| 57 | `GrantsGovResearchAgent` | `src/lib/agents/grants-gov.ts` | DET | — | Grants.gov Research Agent — AGENTS.md Agent 15. Polls the public Grants.gov API (no auth required) for federal grant opportunities matching search profile keywords (BEHAVIORAL_CONTRACTS §17). Per-run behaviour: 1. Runs multiple keyword sear | `src/app/api/agents/grants-gov/route.ts`, `src/app/api/agents/research/route.ts` | **none** | `grants_gov_research`: 29 runs, 27 ok, 2 failed, last ok 2026-09-09 | OPERATIONAL (with failures) |
| 58 | `searchHealthGrants` | `src/lib/agents/health-grants.ts` | DET | — | Thin Grants.gov agent scoped to HHS-family agencies and the Health funding category. Reuses the shared `grantsgov-client.ts` search2 client (extended with `agencies`/`fundingCategories` filters) rather than a second, separate API client — t | `src/lib/agents/research/government-grants.ts` | `health-grants.test.ts` | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 59 | `HousingSpecificScrapersAgent` | `src/lib/agents/housing-specific-scrapers.ts` | AGENTIC | 50% | Housing-Specific Scrapers Agent - NeighborWorks + Federal Home Loan Banks. These are housing-specific funders directly relevant to housing nonprofits. Same pattern as the TDHCA scraper: fetch HTML, send to Claude for structured extraction,  | `src/app/api/agents/housing-specific/route.ts` | **none** | no `agent_runs` rows for `government_research_housing_scrapers` → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 60 | `HudMonitorAgent` | `src/lib/agents/hud-monitor.ts` | AGENTIC | 56% | HUD Monitor Agent — fetches HUD's funding opportunities page and uses Claude to extract structured grant data. Per-run behaviour: 1. Fetches HTML from the HUD funding opportunities page (no auth required). 2. Sends the HTML to Claude which  | `src/app/api/agents/hud-monitor/route.ts`, `src/app/api/agents/research/route.ts`, `src/lib/agents/research/government-grants.ts` | `government-grants-orchestration.test.ts` | no `agent_runs` rows for `hud_monitor` → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 61 | `stripMarkdown` | `src/lib/agents/humanizer-agent.ts` | AGENTIC | 44% | AI Humanizer Agent - second-pass anti-detection rewrite (BLUEPRINT §4.8). After the Narrative Drafting Agent (Agent 05) produces a grounded draft, the Humanizer runs a SECOND, specialized Claude pass that rewrites the text to read like an e | `src/app/api/ai/humanize/route.ts`, `src/app/api/outreach/humanize-step/route.ts`, `src/app/api/reports/board/route.ts` +2 | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 62 | `ImpactSimulationAgent` | `src/lib/agents/impact-simulation-agent.ts` | AGENTIC | 60% | AG-41 Impact Simulation Agent (AutonomousAgent, migration 078/105: impact_simulations, RLS added migration 105; this build's own migration 112 adds the 'ag-41-impact-simulation' agent_type enum value). Enterprise spec: AGENTS_v2.md §5, AG-4 | `src/app/api/agents/simulate/route.ts` | **none** | `ag-41-impact-simulation`: 9 runs, 9 ok, 0 failed, last ok 2026-08-07 | OPERATIONAL |
| 63 | `getPresentKbCategories` | `src/lib/agents/knowledge-base-completeness.ts` | DET | — | Shared Knowledge Base completeness primitives. Extracted from AG-11 (Knowledge Gap Agent, knowledge-gap-agent.ts) so its org-wide weekly sweep and the per-opportunity Narrative Gap Analysis (src/lib/intelligence/narrative-gap-analysis.ts, r | `src/lib/agents/knowledge-gap-agent.ts`, `src/lib/intelligence/gap-recommendations.ts`, `src/lib/intelligence/narrative-gap-analysis.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 64 | `KnowledgeGapAgent` | `src/lib/agents/knowledge-gap-agent.ts` | AGENTIC | 50% | AG-11 Knowledge Gap Agent (AutonomousAgent, migration 080 infrastructure). Runs weekly - registered in worker/autonomous-orchestrator.ts's runOrgPipeline, gated to Sundays (America/Chicago) since the worker only has a single fixed 2AM night | `worker/autonomous-orchestrator.ts` | **none** | no `agent_runs` rows for `ag-11-knowledge-gap` → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 65 | `KnowledgeIndexerAgent` | `src/lib/agents/knowledge-indexer-agent.ts` | DET | — | AG-29 Knowledge Engine Indexer Agent (AutonomousAgent, migration 080 infra + migration 111 enum value + migration 107 embedding columns). Per AGENTS_v2.md's AG-29 spec: continuously generates and stores pgvector embeddings for intelligence_ | `src/app/api/autonomous/knowledge-indexer-trigger/route.ts`, `src/lib/scraper/foundation-scraper.ts`, `src/scripts/ingest-nih-proposals.ts` +2 | `knowledge-indexer-agent.test.ts` | `ag-29-knowledge-indexer`: 61300 runs, 61300 ok, 0 failed, last ok 2026-09-17 | OPERATIONAL |
| 66 | `LearningNetworkAggregatorAgent` | `src/lib/agents/learning-network-aggregator-agent.ts` | AGENTIC | 75% | AG-36 Learning Network Aggregator Agent (AutonomousAgent, migration 080 infrastructure + migration 083 substrate: platform_learning_patterns, org_learning_contributions; migration 099 hardening: confidence, weight, anonymized, source_hash c | `worker/autonomous-orchestrator.ts` | **none** | `ag-36-learning-network`: 6 runs, 6 ok, 0 failed, last ok 2026-09-13 | OPERATIONAL |
| 67 | `searchMinorityFarmerGrants` | `src/lib/agents/minority-farmer-grants.ts` | DET | — | Thin Grants.gov agent scoped to USDA-NIFA and the real "Section 2501" program family — Outreach and Assistance for Socially Disadvantaged and Veteran Farmers and Ranchers. Reuses the shared `grantsgov-client.ts` search2 client, same pattern | `src/lib/agents/research/government-grants.ts` | `minority-farmer-grants.test.ts` | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 68 | `sendMorningDigest` | `src/lib/agents/morning-digest.ts` | DET | — | Morning Digest — PLATFORM_VISION_ARCHITECTURE.md Pillar 2 (AI Opportunity Discovery Engine), AGENTS_v2.md AG-17 nightly pipeline's final step ("7:00 AM — Morning digest notification sent to users"). Rolls up overnight discovery and relation | `src/app/api/agents/morning-digest/route.ts`, `worker/autonomous-orchestrator.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 69 | `NofaParserAgent` | `src/lib/agents/nofa-parser.ts` | AGENTIC | 47% | NOFA Parser Agent — downloads federal grant PDFs from opportunity_documents and extracts structured data to enrich opportunity records. Per-run behaviour: 1. Loads the target opportunity and its PDF document URLs. 2. Downloads each document | `src/app/api/agents/nofa-parser/route.ts` | **none** | `government_research_nofa_parser`: 7 runs, 6 ok, 1 failed, last ok 2026-09-09 | OPERATIONAL (with failures) |
| 70 | `OpportunityDiscoveryAgent` | `src/lib/agents/opportunity-discovery-agent.ts` | DET | — | Opportunity Discovery Agent — PLATFORM_VISION_ARCHITECTURE.md Pillar 2 (AI Opportunity Discovery Engine), AGENTS_v2.md AG-17. Autonomous rewrite: extends AutonomousAgent (migration 080 infrastructure — autonomous_triggers, agent_queue, agen | `src/app/api/agents/discovery/route.ts`, `worker/autonomous-orchestrator.ts` | **none** | `ag-17-discovery`: 34 runs, 33 ok, 1 failed, last ok 2026-09-16 | OPERATIONAL (with failures) |
| 71 | `getDefaultResearchKeywords` | `src/lib/agents/org-defaults.ts` | DET | — | Shared default-parameter resolution for connector "Run Now" triggers (Settings → Integrations). These routes are invoked with an empty body from the settings page — the card has no keyword/state/query input — so each route needs a sensible  | `src/app/api/agents/grants-gov/route.ts`, `src/app/api/agents/propublica/route.ts`, `src/app/api/agents/sam-gov/route.ts` +1 | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 72 | `OutcomeAnalyzerAgent` | `src/lib/agents/outcome-analyzer-agent.ts` | AGENTIC | 76% | AG-09 Outcome Analyzer Agent (AutonomousAgent, migration 080 infrastructure). Event-driven (accepts triggerSource "event" - intended to fire on outcome insert) and also runs weekly - registered in worker/autonomous-orchestrator.ts's runOrgP | `worker/autonomous-orchestrator.ts` | **none** | no `agent_runs` rows for `ag-09-outcome-analyzer` → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 73 | `PlaywrightAgent` | `src/lib/agents/playwright-agent.ts` | AGENTIC | 46% | PlaywrightAgent - URL-based browser automation for corporate giving portals. Unlike BrowserAutomationAgent (which starts from an applicationId and fills a pre-linked portal), this agent starts from a raw URL. It is the entry point for ad-ho | `src/app/api/agents/playwright/route.ts` | **none** | `browser_automation`: 3 runs, 3 ok, 0 failed, last ok 2026-09-08 | OPERATIONAL |
| 74 | `ProbabilityScoringAgent` | `src/lib/agents/probability-scoring-agent.ts` | AGENTIC | 76% | Grant Probability Scoring Agent — PLATFORM_VISION_ARCHITECTURE.md Pillar 5 (Grant Probability Engine), AGENTS_v2.md AG-15. FULL AGENTIC UPGRADE (July 2026): this agent no longer just wraps the deterministic computeGrantProbability() and pas | `worker/autonomous-orchestrator.ts` | **none** | `ag-15-probability`: 1 runs, 1 ok, 0 failed, last ok 2026-08-02 | OPERATIONAL |
| 75 | `ProPublicaMiningAgent` | `src/lib/agents/propublica.ts` | DET | — | ProPublica 990 Mining Agent — AGENTS.md Agent 17. Queries the ProPublica Nonprofit Explorer API (no auth required) to mine IRS 990 and 990-PF filing data for nonprofits. Supports lookup by EIN or free-text organization name search. Per-run  | `src/app/api/agents/propublica/route.ts` | **none** | no `agent_runs` rows for `propublica_mining` → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 76 | `RecursiveLearningAgent` | `src/lib/agents/recursive-learning.ts` | AGENTIC | 57% | Recursive Learning Agent - AGENTS.md Agent 10. Triggered when an outcome is recorded. It closes the learning loop: from an AWARDED (or PARTIAL) application it extracts the reusable narrative sections that won, records them as proven_narrati | `src/app/api/agents/learning/route.ts`, `src/app/api/outcomes/route.ts` | **none** | `recursive_learning`: 2 runs, 1 ok, 1 failed, last ok 2026-08-15 | OPERATIONAL (with failures) |
| 77 | `RelationshipBuilderAgent` | `src/lib/agents/relationship-builder-agent.ts` | AGENTIC | 70% | Relationship Builder Agent — PLATFORM_VISION_ARCHITECTURE.md Pillar 4 (Autonomous Relationship Builder), AGENTS_v2.md AG-19. Phase A: nightly, per-funder pass that scores the funder relationship, then (above the auto-draft threshold, reused | `src/app/api/funders/[id]/relationship-builder/route.ts`, `worker/autonomous-orchestrator.ts` | `relationship-scoring-consolidation.test.ts` | `ag-digest`: 90 runs, 90 ok, 0 failed, last ok 2026-09-16; `ag-19-relationship`: 10 runs, 10 ok, 0 failed, last ok 2026-09-11 | OPERATIONAL |
| 78 | `RelationshipGraphBuilderAgent` | `src/lib/agents/relationship-graph-builder-agent.ts` | AGENTIC | 70% | Relationship Graph Builder Agent — AUTONOMOUS_PLATFORM_VISION.md Phase 3 ("Corporate Relationship Graph"), AGENTS_v2.md AG-32. Not part of the relationship-scoring consolidation (see BEHAVIORAL_CONTRACTS.md's "Relationship Scoring" contract | `src/app/api/intelligence/relationship-graph/route.ts`, `worker/autonomous-orchestrator.ts` | **none** | `ag-32-relationship-graph`: 45 runs, 40 ok, 5 failed, last ok 2026-09-11 | OPERATIONAL (with failures) |
| 79 | `getResearchAgentConfig` | `src/lib/agents/research/agent-configs.ts` | DET | — | Research agent configs - the runnable registry behind parallel orchestration. Each config is one "lane" the orchestrator (orchestrator.ts) launches at once: it names the underlying agent class, the search specialization (ResearchFocus) that | `src/lib/agents/research/orchestrator.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 80 | `CorporateGivingResearchAgent` | `src/lib/agents/research/corporate-giving.ts` | DET | — | Corporate Giving Research Agent - AGENTS.md Agent 12. Discovers companies with active donation / community-giving programs and turns them into opportunity (and funder) records the rest of Benavora can work. It drives off the organization's  | `src/app/api/agents/research/route.ts`, `src/app/api/cron/research/route.ts`, `src/lib/agents/research/agent-configs.ts` | **none** | `corporate_research`: 16 runs, 11 ok, 5 failed, last ok 2026-09-09 | OPERATIONAL (with failures) |
| 81 | `checkDuplicate` | `src/lib/agents/research/deduplicator.ts` | DET | — | Opportunity de-duplication for the research pipeline (BEHAVIORAL_CONTRACTS §17: "Deduplication required before creating any opportunity: check URL exact match, then fuzzy name+funder"). Two passes, in priority order: 1. Exact URL match - th | `src/lib/agents/research/corporate-giving.ts`, `src/lib/agents/research/foundation-grants.ts`, `src/lib/agents/research/government-grants.ts` +2 | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 82 | `applyQuerySuffix` | `src/lib/agents/research/focus.ts` | DET | — | Per-run specialization for the research agents (parallel orchestration). A ResearchFocus lets the orchestrator run the SAME agent class under several specialized configurations at once - e.g. the Government agent once against the Grants.gov | `src/lib/agents/research/agent-configs.ts`, `src/lib/agents/research/foundation-grants.ts`, `src/lib/agents/research/government-grants.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 83 | `FoundationGrantsResearchAgent` | `src/lib/agents/research/foundation-grants.ts` | DET | — | Foundation Grant Research Agent - AGENTS.md Agent 13. Discovers private- and corporate-foundation grant opportunities and turns them into opportunity (and funder) records. It drives off the organization's active foundation-flavored search_p | `src/app/api/agents/research/route.ts`, `src/app/api/cron/research/route.ts`, `src/lib/agents/research/agent-configs.ts` | **none** | `foundation_research`: 30 runs, 14 ok, 16 failed, last ok 2026-09-09 | DEGRADED — more failures than successes |
| 84 | `GovernmentGrantsResearchAgent` | `src/lib/agents/research/government-grants.ts` | AGENTIC | 67% | Government Grant Research Agent - AGENTS.md Agent 14. (Note on naming: a task brief once referred to this as "Agent 12" — per AGENTS.md's real registry, Agent 12 is the Corporate Giving Research Agent (src/lib/agents/research/corporate-givi | `src/app/api/agents/research/route.ts`, `src/app/api/cron/research/route.ts`, `src/lib/agents/research/agent-configs.ts` | `government-grants-orchestration.test.ts` | `government_research`: 49 runs, 36 ok, 13 failed, last ok 2026-09-09 | OPERATIONAL (with failures) |
| 85 | `fetchWithRetry` | `src/lib/agents/research/http-retry.ts` | DET | — | Shared retry/backoff helper for research-agent HTTP calls. Retries only transient failures — network errors, timeouts, 429, and 5xx — never 4xx client errors (bad request, auth), which will not succeed on retry. Used by the government resea | `src/lib/agents/hud-monitor.ts`, `src/lib/agents/sam-gov.ts`, `src/lib/sources/grantsgov-client.ts` +1 | `http-retry.test.ts` | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 86 | `buildOrgFocusText` | `src/lib/agents/research/kb-relevance.ts` | DET | — | KB semantic-relevance filtering for the research agents. Builds one embedding for the organization's real, configured focus (active search_profiles' keywords + weighted focus areas + populations served, enriched with any `knowledge_base` ro | `src/lib/agents/research/government-grants.ts`, `src/lib/opportunities/relevance.ts` | `government-grants-orchestration.test.ts`, `kb-relevance.test.ts`, `relevance.test.ts` | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 87 | `LocalSponsorshipResearchAgent` | `src/lib/agents/research/local-sponsorship.ts` | DET | — | Local Business Sponsorship Research Agent - AGENTS.md Agent 15. Finds local businesses likely to sponsor community initiatives and turns them into funder records - plus sponsorship opportunities when a page advertises a program, and outreac | `src/app/api/agents/research/route.ts`, `src/app/api/cron/research/route.ts`, `src/lib/agents/research/agent-configs.ts` | **none** | `local_sponsorship`: 9 runs, 4 ok, 5 failed, last ok 2026-09-09 | DEGRADED — more failures than successes |
| 88 | `runResearchAgentsInParallel` | `src/lib/agents/research/orchestrator.ts` | DET | — | Parallel research orchestration (BLUEPRINT §3.1, BEHAVIORAL_CONTRACTS §17). "Run all active" launches every research lane in RESEARCH_AGENT_CONFIGS AT ONCE via Promise.allSettled - the four base families plus the four specialized source-typ | `src/app/api/agents/research/route.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 89 | `parseOpportunity` | `src/lib/agents/research/result-parser.ts` | AGENTIC | 47% | Structured-extraction stage for the research pipeline (AGENTS.md Agent 01 "Grant Summary", reused by the research agents 12-15). Takes the raw text of a candidate funding page and asks Claude to pull out a single structured opportunity. Per | `src/lib/agents/research/corporate-giving.ts`, `src/lib/agents/research/foundation-grants.ts`, `src/lib/agents/research/government-grants.ts` +1 | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 90 | `effectiveCategories` | `src/lib/agents/research/scheduler.ts` | DET | — | Search-profile scheduling for the research agents (BLUEPRINT §4.12, BEHAVIORAL_CONTRACTS §14 + §17). Decides which saved search_profiles should drive a research run and turns each into concrete search queries. Responsibilities: - Read only  | `src/lib/agents/opportunity-discovery-agent.ts`, `src/lib/agents/research/corporate-giving.ts`, `src/lib/agents/research/foundation-grants.ts` +3 | `kb-relevance.test.ts` | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 91 | `search` | `src/lib/agents/research/search-engine.ts` | DET | — | Search-source layer for the research agents (AGENTS.md Agents 12-15). Turns a query string into candidate result URLs across several sources: - Google ("google") - fetches the public results page and extracts the organic result links. - Gra | `src/lib/agents/research/corporate-giving.ts`, `src/lib/agents/research/focus.ts`, `src/lib/agents/research/foundation-grants.ts` +2 | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 92 | `fetchRaw` | `src/lib/agents/research/web-fetcher.ts` | DET | — | Shared web-fetch infrastructure for the research agents (AGENTS.md Agents 12-15, BEHAVIORAL_CONTRACTS §17). Every research agent reaches the open web through this module so the cross-cutting rules live in exactly one place: - Native `fetch` | `src/lib/agents/research/corporate-giving.ts`, `src/lib/agents/research/foundation-grants.ts`, `src/lib/agents/research/government-grants.ts` +2 | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 93 | `ReviewAgent` | `src/lib/agents/review-agent.ts` | AGENTIC | 47% | Review Agent - AGENTS.md Agent 08. Performs a critical quality review of an application's draft before submission: section-by-section scores, specific issues, suggested improvements, and an overall readiness score. It grounds the review in  | `src/app/api/ai/review/route.ts` | **none** | `review`: 4 runs, 0 ok, 4 failed, last ok NEVER | BROKEN — has run, never once succeeded |
| 94 | `RoiOptimizerAgent` | `src/lib/agents/roi-optimizer-agent.ts` | AGENTIC | 65% | AG-39 ROI Optimizer Agent (AutonomousAgent, migration 089: submission_variables + roi_insights). Phase 5 per AUTONOMOUS_PLATFORM_VISION.md §7 ("ROI Optimization Engine"). Two responsibilities, deliberately not both wrapped the same way: - t | `src/app/api/autonomous/track-submission/route.ts`, `worker/autonomous-orchestrator.ts` | **none** | no `agent_runs` rows for `ag-39-roi-optimizer` → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 95 | `SamGovResearchAgent` | `src/lib/agents/sam-gov.ts` | DET | — | SAM.gov Research Agent — AGENTS.md Agent 16. Polls the SAM.gov federal opportunities API for records matching search profile keywords (BEHAVIORAL_CONTRACTS §18). Per-run behaviour: 1. Runs multiple keyword searches (housing-focused phrases  | `src/app/api/agents/research/route.ts`, `src/app/api/agents/sam-gov/route.ts`, `src/lib/agents/research/government-grants.ts` | `government-grants-orchestration.test.ts` | `sam_gov_research`: 8 runs, 7 ok, 1 failed, last ok 2026-09-09 | OPERATIONAL (with failures) |
| 96 | `SearchProfileOptimizerAgent` | `src/lib/agents/search-profile-optimizer-agent.ts` | AGENTIC | 56% | AG-12 Search Profile Optimizer Agent (AutonomousAgent, migration 080 infrastructure). Runs monthly - registered in worker/autonomous-orchestrator.ts's runOrgPipeline, gated on the 1st of the month (America/Chicago) since the worker only has | `worker/autonomous-orchestrator.ts` | **none** | no `agent_runs` rows for `ag-12-search-optimizer` → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 97 | `SelfImprovementAgent` | `src/lib/agents/self-improvement-agent.ts` | AGENTIC | 73% | HARD LIMIT: This agent NEVER modifies production code, prompts, configs, or database schema. It ONLY creates improvement_proposals records requiring explicit human approval. Any proposal of type 'code_change' or 'schema_change' is automatic | `worker/autonomous-orchestrator.ts` | **none** | `ag-38-self-improvement`: 3 runs, 2 ok, 1 failed, last ok 2026-09-16 | OPERATIONAL (with failures) |
| 98 | `SemanticMatchingAgent` | `src/lib/agents/semantic-matching.ts` | AGENTIC | 46% | Semantic Matching Agent - uses Claude to score semantic alignment between the organization profile and each funder, returning a ranked list with reasoning. | `src/app/api/agents/semantic-matching/route.ts` | **none** | `semantic_matching`: 4 runs, 4 ok, 0 failed, last ok 2026-09-05 | OPERATIONAL |
| 99 | `SimplerGrantsResearchAgent` | `src/lib/agents/simpler-grants.ts` | DET | — | Simpler Grants Research Agent — polls the public Simpler.Grants.gov v1 API. Sends a POST search request for federal opportunities matching the supplied keywords. Deduplicates by name and url before inserting new records into the opportuniti | `src/app/api/agents/research/route.ts`, `src/app/api/agents/simpler-grants/route.ts` | **none** | no `agent_runs` rows for `simpler_grants_research` → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 100 | `SimulationAgent` | `src/lib/agents/simulation-agent.ts` | AGENTIC | 86% | AG-37 Simulation Agent (AutonomousAgent, migration 080 infrastructure + migration 085_fundraising_simulator.sql substrate: simulation_scenarios). AUTONOMOUS_PLATFORM_VISION.md Phase 4, "Predictive Fundraising Simulator": what-if modeling (b | `src/app/api/reports/simulate/route.ts` | **none** | no `agent_runs` rows for `ag-37-simulation` → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 101 | `StatePortalResearchAgent` | `src/lib/agents/state-portal.ts` | AGENTIC | 50% | State Portal Research Agent — AGENTS.md Agent 18. Fetches and parses HTML from state grant portals, using Claude to extract structured opportunity data (BEHAVIORAL_CONTRACTS §21). Per-run behaviour: 1. Looks up the target state in the built | `src/app/api/agents/state-portals/route.ts` | **none** | `state_portal`: 11 runs, 9 ok, 2 failed, last ok 2026-09-09 | OPERATIONAL (with failures) |
| 102 | `StateScrapersAgent` | `src/lib/agents/state-scrapers.ts` | AGENTIC | 50% | State Housing Agency Scraper — fetches grant pages from five state housing agencies and extracts funding opportunities via Claude. Scrapes each agency URL with User-Agent "Benavora Grant Research Bot", sends HTML to Claude for structured ex | `src/app/api/agents/state-scrapers/route.ts` | **none** | no `agent_runs` rows for `state_portal_housing_scrapers` → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 103 | `StrategicAdvisorAgent` | `src/lib/agents/strategic-advisor-agent.ts` | AGENTIC | 70% | AG-40 Strategic Advisor Agent (AutonomousAgent, migration 080 infrastructure + migration 086_strategic_advisor.sql substrate: strategic_recommendations). AUTONOMOUS_PLATFORM_VISION.md Phase 5, "AI Strategic Advisor": the capstone agent -- i | `src/app/api/intelligence/strategic-advisor/route.ts`, `worker/autonomous-orchestrator.ts` | **none** | no `agent_runs` rows for `ag-40-strategic-advisor` → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 104 | `SuccessProbabilityAgent` | `src/lib/agents/success-probability.ts` | DET | — | Success Probability Agent - AGENTS.md Agent 22. Calculates per-application funding probability using 6 data-driven factors (BEHAVIORAL_CONTRACTS §25). No Claude call required — purely data arithmetic. Factor weights (max points sum to 100): | `src/app/api/agents/success-probability/route.ts`, `worker/autonomous-orchestrator.ts` | **none** | `success_probability`: 137 runs, 37 ok, 100 failed, last ok 2026-09-16 | DEGRADED — more failures than successes |
| 105 | `TdhcaScraperAgent` | `src/lib/agents/tdhca-scraper.ts` | AGENTIC | 50% | TDHCA Scraper Agent — fetches Texas Department of Housing and Community Affairs grant pages and extracts housing grant opportunities via Claude. Scrapes two TDHCA pages with User-Agent "Benavora Grant Research Bot", sends HTML to Claude for | `src/app/api/agents/research/route.ts`, `src/app/api/agents/tdhca/route.ts` | **none** | no `agent_runs` rows for `state_portal_tdhca` → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 106 | `UsaspendingAgent` | `src/lib/agents/usaspending.ts` | DET | — | USAspending.gov Historical Awards Agent. Queries the public USAspending.gov award-search API (no key required) for historical federal awards matching the organization's research keywords, and stores them in historical_awards. This is compet | `src/app/api/agents/usaspending/route.ts` | **none** | no `agent_runs` rows for `government_research_usaspending` → NEVER EXECUTED | UNPROVEN — wired, never executed |

### PIL / BEN (Prospect Intelligence Layer) — 76 modules

| # | Module / primary export | File | Det/Agentic | Agentic % | Purpose & capabilities | Wiring (production callers) | Unit/integration test | Live execution evidence | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `AgentNotFoundError` | `src/lib/pil/agent-registry-service.ts` | DET | — | _no header comment_ | `src/app/api/pil/agents/route.ts`, `src/lib/pil/agent-runner.ts`, `src/lib/pil/research-orchestrator.ts` | `pil-workflow.test.ts` | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 2 | `ToolNotPermittedError` | `src/lib/pil/agent-runner.ts` | DET | — | _no header comment_ | `src/lib/autoapply/queue-populator.ts`, `src/lib/pil/agents/app/BEN-APP-01.ts`, `src/lib/pil/agents/app/BEN-APP-02.ts` +60 | `pil-dis-agents.test.ts`, `pil-int-agents.test.ts`, `pil-workflow.test.ts` | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 3 | `ApplicationProfileOrchestratorAgent` | `src/lib/pil/agents/app/BEN-APP-01.ts` | DET | — | _no header comment_ | `src/lib/pil/agents/app/BEN-APP-02.ts`, `src/lib/pil/agents/app/BEN-APP-03.ts`, `src/lib/pil/agents/index.ts` | `pil-app-agents.test.ts` | no `pil_agent_runs` rows → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 4 | `RecommendationPriorityScorerAgent` | `src/lib/pil/agents/app/BEN-APP-02.ts` | DET | — | _no header comment_ | `src/lib/pil/agents/index.ts` | `pil-app-agents.test.ts` | no `pil_agent_runs` rows → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 5 | `SubmissionOrchestratorAgent` | `src/lib/pil/agents/app/BEN-APP-03.ts` | DET | — | _no header comment_ | `src/lib/autoapply/queue-populator.ts`, `src/lib/pil/agents/index.ts` | **none** | no `pil_agent_runs` rows → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 6 | `IndividualProspectDiscoveryAgent` | `src/lib/pil/agents/dis/BEN-DIS-01.ts` | AGENTIC (indirect) | 26% | _no header comment_ | `src/lib/pil/agents/index.ts` | `pil-dis-agents.test.ts` | `BEN-DIS-01`: 2 PIL runs, 2 ok, 0 failed, last 2026-09-15 | OPERATIONAL |
| 7 | `MajorDonorDiscoveryAgent` | `src/lib/pil/agents/dis/BEN-DIS-02.ts` | AGENTIC (indirect) | 34% | _no header comment_ | `src/lib/pil/agents/index.ts` | `pil-dis-agents.test.ts` | `BEN-DIS-02`: 1 PIL runs, 1 ok, 0 failed, last 2026-09-16 | OPERATIONAL |
| 8 | `FoundationDiscoveryAgent` | `src/lib/pil/agents/dis/BEN-DIS-03.ts` | DET | — | _no header comment_ | `src/lib/pil/agents/index.ts` | `pil-dis-agents.test.ts` | no `pil_agent_runs` rows → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 9 | `CorporateGivingDiscoveryAgent` | `src/lib/pil/agents/dis/BEN-DIS-04.ts` | AGENTIC (indirect) | 26% | _no header comment_ | `src/lib/pil/agents/index.ts` | `pil-dis-agents.test.ts` | no `pil_agent_runs` rows → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 10 | `ExecutiveProspectDiscoveryAgent` | `src/lib/pil/agents/dis/BEN-DIS-05.ts` | AGENTIC (indirect) | 26% | _no header comment_ | `src/lib/pil/agents/index.ts` | `pil-dis-agents.test.ts` | no `pil_agent_runs` rows → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 11 | `GeographicFundingDiscoveryAgent` | `src/lib/pil/agents/dis/BEN-DIS-06.ts` | DET | — | _no header comment_ | `src/lib/pil/agents/index.ts` | `pil-dis-agents.test.ts` | no `pil_agent_runs` rows → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 12 | `CauseAlignedProspectDiscoveryAgent` | `src/lib/pil/agents/dis/BEN-DIS-07.ts` | AGENTIC (indirect) | 26% | _no header comment_ | `src/lib/pil/agents/index.ts` | `pil-dis-agents.test.ts` | no `pil_agent_runs` rows → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 13 | `HiddenProspectAndCrmRediscoveryAgent` | `src/lib/pil/agents/dis/BEN-DIS-08.ts` | DET | — | _no header comment_ | `src/lib/pil/agents/index.ts` | `pil-dis-agents.test.ts` | `BEN-DIS-08`: 1 PIL runs, 0 ok, 0 failed, last 2026-09-16 | OPERATIONAL |
| 14 | `parseGoalCriteria` | `src/lib/pil/agents/dis/shared.ts` | DET | — | _no header comment_ | `src/lib/pil/agents/dis/BEN-DIS-01.ts`, `src/lib/pil/agents/dis/BEN-DIS-02.ts`, `src/lib/pil/agents/dis/BEN-DIS-03.ts` +5 | `pil-dis-agents.test.ts` | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 15 | `loadAgentImpl` | `src/lib/pil/agents/index.ts` | AGENTIC (indirect) | 43% | _no header comment_ | **none found** | **none** | no agent id declared — cannot be attributed in `agent_runs` | ORPHANED — zero production callers |
| 16 | `IndividualIntelligenceAgent` | `src/lib/pil/agents/int/BEN-INT-01.ts` | AGENTIC (indirect) | 26% | _no header comment_ | `src/lib/pil/agents/index.ts` | `pil-int-agents.test.ts` | `BEN-INT-01`: 1 PIL runs, 1 ok, 0 failed, last 2026-09-09 | OPERATIONAL |
| 17 | `EmploymentCareerIntelligenceAgent` | `src/lib/pil/agents/int/BEN-INT-02.ts` | DET | — | _no header comment_ | `src/lib/pil/agents/index.ts` | `pil-int-agents.test.ts` | no `pil_agent_runs` rows → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 18 | `BusinessOwnershipIntelligenceAgent` | `src/lib/pil/agents/int/BEN-INT-03.ts` | DET | — | _no header comment_ | `src/lib/pil/agents/index.ts` | `pil-int-agents.test.ts` | `BEN-INT-03`: 1 PIL runs, 0 ok, 0 failed, last 2026-09-09 | OPERATIONAL |
| 19 | `EducationAlumniIntelligenceAgent` | `src/lib/pil/agents/int/BEN-INT-04.ts` | DET | — | _no header comment_ | `src/lib/pil/agents/index.ts` | `pil-int-agents.test.ts` | no `pil_agent_runs` rows → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 20 | `NonprofitBoardIntelligenceAgent` | `src/lib/pil/agents/int/BEN-INT-05.ts` | AGENTIC (indirect) | 26% | _no header comment_ | `src/lib/pil/agents/index.ts` | `pil-int-agents.test.ts` | no `pil_agent_runs` rows → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 21 | `FoundationIntelligenceAgent` | `src/lib/pil/agents/int/BEN-INT-06.ts` | DET | — | _no header comment_ | `src/lib/pil/agents/index.ts` | `pil-int-agents.test.ts` | no `pil_agent_runs` rows → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 22 | `GivingHistoryIntelligenceAgent` | `src/lib/pil/agents/int/BEN-INT-07.ts` | DET | — | _no header comment_ | `src/lib/pil/agents/index.ts` | `pil-int-agents.test.ts` | no `pil_agent_runs` rows → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 23 | `WealthCapacityIntelligenceAgent` | `src/lib/pil/agents/int/BEN-INT-08.ts` | AGENTIC (indirect) | 25% | _no header comment_ | `src/lib/pil/agents/index.ts` | `pil-int-agents.test.ts` | `BEN-INT-08`: 7 PIL runs, 1 ok, 0 failed, last 2026-09-16 | OPERATIONAL |
| 24 | `WealthOriginLiquidityEventAgent` | `src/lib/pil/agents/int/BEN-INT-09.ts` | DET | — | _no header comment_ | `src/lib/pil/agents/index.ts` | `pil-int-agents.test.ts` | `BEN-INT-09`: 1 PIL runs, 0 ok, 0 failed, last 2026-09-09 | OPERATIONAL |
| 25 | `ContactIntelligenceAgent` | `src/lib/pil/agents/int/BEN-INT-10.ts` | DET | — | _no header comment_ | `src/lib/pil/agents/index.ts` | `pil-int-agents.test.ts` | no `pil_agent_runs` rows → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 26 | `getProspectById` | `src/lib/pil/agents/int/shared.ts` | DET | — | _no header comment_ | `src/lib/pil/agents/int/BEN-INT-01.ts`, `src/lib/pil/agents/int/BEN-INT-02.ts`, `src/lib/pil/agents/int/BEN-INT-03.ts` +7 | `pil-int-agents.test.ts` | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 27 | `ProspectDigitalTwinAgent` | `src/lib/pil/agents/knw/BEN-KNW-01.ts` | DET | — | _no header comment_ | `src/lib/pil/agents/index.ts` | `pil-qlf-knw-agents.test.ts` | `BEN-KNW-01`: 2 PIL runs, 2 ok, 0 failed, last 2026-09-15 | OPERATIONAL |
| 28 | `EntityResolutionAgent` | `src/lib/pil/agents/knw/BEN-KNW-02.ts` | DET | — | _no header comment_ | `src/lib/pil/agents/index.ts`, `src/lib/pil/agents/knw/BEN-KNW-01.ts`, `src/lib/pil/agents/knw/BEN-KNW-04.ts` | `pil-qlf-knw-agents.test.ts` | `BEN-KNW-02`: 1 PIL runs, 1 ok, 0 failed, last 2026-09-15 | OPERATIONAL |
| 29 | `EvidenceProvenanceAgent` | `src/lib/pil/agents/knw/BEN-KNW-03.ts` | DET | — | _no header comment_ | `src/lib/pil/agents/index.ts`, `src/lib/pil/agents/knw/BEN-KNW-04.ts` | `pil-qlf-knw-agents.test.ts` | `BEN-KNW-03`: 2 PIL runs, 1 ok, 0 failed, last 2026-09-15 | OPERATIONAL |
| 30 | `ContradictionFreshnessInvestigatorAgent` | `src/lib/pil/agents/knw/BEN-KNW-04.ts` | AGENTIC (indirect) | 32% | _no header comment_ | `src/lib/pil/agents/index.ts` | `pil-qlf-knw-agents.test.ts` | `BEN-KNW-04`: 1 PIL runs, 1 ok, 0 failed, last 2026-09-15 | OPERATIONAL |
| 31 | `AgentFleetPerformanceAndLearningAgent` | `src/lib/pil/agents/ops/BEN-OPS-01.ts` | DET | — | _no header comment_ | `src/lib/pil/agents/index.ts` | `pil-ops-agents.test.ts` | no `pil_agent_runs` rows → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 32 | `MissionAffinityAgent` | `src/lib/pil/agents/qlf/BEN-QLF-01.ts` | AGENTIC (indirect) | 32% | _no header comment_ | `src/lib/pil/agents/index.ts` | `pil-qlf-knw-agents.test.ts` | no `pil_agent_runs` rows → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 33 | `FundingEligibilityAgent` | `src/lib/pil/agents/qlf/BEN-QLF-02.ts` | DET | — | _no header comment_ | `src/lib/pil/agents/index.ts` | `pil-qlf-knw-agents.test.ts` | no `pil_agent_runs` rows → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 34 | `PhilanthropicCapacityPropensityAgent` | `src/lib/pil/agents/qlf/BEN-QLF-03.ts` | AGENTIC (indirect) | 40% | _no header comment_ | `src/lib/pil/agents/index.ts` | `pil-qlf-knw-agents.test.ts` | `BEN-QLF-03`: 1 PIL runs, 0 ok, 1 failed, last 2026-09-09 | OPERATIONAL |
| 35 | `OpportunityQualificationAgent` | `src/lib/pil/agents/qlf/BEN-QLF-04.ts` | AGENTIC (indirect) | 37% | _no header comment_ | `src/lib/pil/agents/app/BEN-APP-01.ts`, `src/lib/pil/agents/app/BEN-APP-02.ts`, `src/lib/pil/agents/index.ts` +9 | `pil-qlf-knw-agents.test.ts` | `BEN-QLF-04`: 3 PIL runs, 0 ok, 3 failed, last 2026-09-15 | OPERATIONAL |
| 36 | `TimingReadinessAgent` | `src/lib/pil/agents/qlf/BEN-QLF-05.ts` | DET | — | _no header comment_ | `src/lib/pil/agents/index.ts` | `pil-qlf-knw-agents.test.ts` | no `pil_agent_runs` rows → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 37 | `RelationshipDiscoveryAgent` | `src/lib/pil/agents/rel/BEN-REL-01.ts` | DET | — | _no header comment_ | `src/lib/pil/agents/index.ts` | `pil-rel-agents.test.ts` | `BEN-REL-01`: 1 PIL runs, 1 ok, 0 failed, last 2026-09-09 | OPERATIONAL |
| 38 | `BoardRelationshipMappingAgent` | `src/lib/pil/agents/rel/BEN-REL-02.ts` | DET | — | _no header comment_ | `src/lib/pil/agents/index.ts` | `pil-rel-agents.test.ts` | no `pil_agent_runs` rows → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 39 | `CorporateRelationshipMappingAgent` | `src/lib/pil/agents/rel/BEN-REL-03.ts` | AGENTIC (indirect) | 34% | _no header comment_ | `src/lib/pil/agents/index.ts` | `pil-rel-agents.test.ts` | `BEN-REL-03`: 1 PIL runs, 0 ok, 0 failed, last 2026-09-09 | OPERATIONAL |
| 40 | `OrganizationalOverlapAgent` | `src/lib/pil/agents/rel/BEN-REL-04.ts` | DET | — | _no header comment_ | `src/lib/pil/agents/index.ts` | `pil-rel-agents.test.ts` | `BEN-REL-04`: 1 PIL runs, 1 ok, 0 failed, last 2026-09-09 | OPERATIONAL |
| 41 | `WarmIntroductionPathfindingAgent` | `src/lib/pil/agents/rel/BEN-REL-05.ts` | DET | — | _no header comment_ | `src/lib/pil/agents/index.ts` | `pil-rel-agents.test.ts` | no `pil_agent_runs` rows → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 42 | `RelationshipStrengthAgent` | `src/lib/pil/agents/rel/BEN-REL-06.ts` | DET | — | _no header comment_ | `src/lib/pil/agents/index.ts` | `pil-rel-agents.test.ts` | no `pil_agent_runs` rows → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 43 | `FoundationRelationshipMappingAgent` | `src/lib/pil/agents/rel/BEN-REL-07.ts` | DET | — | _no header comment_ | `src/lib/pil/agents/index.ts` | **none** | no `pil_agent_runs` rows → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 44 | `ProfessionalConnectionMappingAgent` | `src/lib/pil/agents/rel/BEN-REL-08.ts` | DET | — | _no header comment_ | `src/lib/pil/agents/index.ts` | **none** | no `pil_agent_runs` rows → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 45 | `getProspectById` | `src/lib/pil/agents/rel/shared.ts` | DET | — | _no header comment_ | `src/lib/pil/agents/rel/BEN-REL-01.ts`, `src/lib/pil/agents/rel/BEN-REL-02.ts`, `src/lib/pil/agents/rel/BEN-REL-03.ts` +5 | `pil-rel-agents.test.ts` | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 46 | `ProspectEngagementStrategyAgent` | `src/lib/pil/agents/str/BEN-STR-01.ts` | AGENTIC (indirect) | 32% | _no header comment_ | `src/lib/pil/agents/index.ts` | `pil-str-agents.test.ts` | no `pil_agent_runs` rows → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 47 | `BestFirstAskAgent` | `src/lib/pil/agents/str/BEN-STR-02.ts` | AGENTIC (indirect) | 37% | _no header comment_ | `src/lib/pil/agents/index.ts` | `pil-str-agents.test.ts` | no `pil_agent_runs` rows → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 48 | `CultivationStrategyAgent` | `src/lib/pil/agents/str/BEN-STR-03.ts` | AGENTIC (indirect) | 32% | _no header comment_ | `src/lib/pil/agents/index.ts` | `pil-str-agents.test.ts` | no `pil_agent_runs` rows → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 49 | `NextBestActionAgent` | `src/lib/pil/agents/str/BEN-STR-04.ts` | DET | — | _no header comment_ | `src/lib/pil/agents/index.ts` | `pil-str-agents.test.ts` | `BEN-STR-04`: 1 PIL runs, 1 ok, 0 failed, last 2026-09-15 | OPERATIONAL |
| 50 | `findWarmEdge` | `src/lib/pil/agents/str/shared.ts` | DET | — | _no header comment_ | `src/lib/pil/agents/str/BEN-STR-03.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 51 | `ChiefProspectIntelligenceOrchestrator` | `src/lib/pil/agents/sup/BEN-SUP-01.ts` | DET | — | _no header comment_ | `src/lib/pil/agents/index.ts` | `pil-sup-agents.test.ts` | `BEN-SUP-01`: 6 PIL runs, 0 ok, 0 failed, last 2026-09-15 | OPERATIONAL |
| 52 | `ResearchStrategyArchitect` | `src/lib/pil/agents/sup/BEN-SUP-02.ts` | DET | — | _no header comment_ | `src/lib/pil/agents/index.ts` | `pil-sup-agents.test.ts` | `BEN-SUP-02`: 9 PIL runs, 9 ok, 0 failed, last 2026-09-16 | OPERATIONAL |
| 53 | `CrossAgentResearchPlanner` | `src/lib/pil/agents/sup/BEN-SUP-03.ts` | DET | — | _no header comment_ | `src/lib/pil/agents/index.ts` | `pil-sup-agents.test.ts` | `BEN-SUP-03`: 8 PIL runs, 1 ok, 0 failed, last 2026-09-16 | OPERATIONAL |
| 54 | `ResearchPortfolioAllocator` | `src/lib/pil/agents/sup/BEN-SUP-04.ts` | DET | — | _no header comment_ | `src/lib/pil/agents/index.ts` | `pil-sup-agents.test.ts` | `BEN-SUP-04`: 6 PIL runs, 6 ok, 0 failed, last 2026-09-16 | OPERATIONAL |
| 55 | `ProspectResearchCriticAgent` | `src/lib/pil/agents/sup/BEN-SUP-05.ts` | DET | — | _no header comment_ | `src/lib/pil/agents/index.ts` | `pil-sup-agents-2.test.ts` | `BEN-SUP-05`: 11 PIL runs, 0 ok, 11 failed, last 2026-09-16 | OPERATIONAL |
| 56 | `ResearchRecoveryInvestigatorAgent` | `src/lib/pil/agents/sup/BEN-SUP-06.ts` | DET | — | _no header comment_ | `src/lib/pil/agents/index.ts` | `pil-sup-agents-2.test.ts` | `BEN-SUP-06`: 1 PIL runs, 0 ok, 0 failed, last 2026-09-15 | OPERATIONAL |
| 57 | `AutonomyGovernorAgent` | `src/lib/pil/agents/sup/BEN-SUP-07.ts` | DET | — | _no header comment_ | `src/lib/pil/agents/index.ts` | `pil-sup-agents-2.test.ts` | `BEN-SUP-07`: 1 PIL runs, 1 ok, 0 failed, last 2026-09-15 | OPERATIONAL |
| 58 | `ExecutiveIntelligenceNarrativeAgent` | `src/lib/pil/agents/sup/BEN-SUP-08.ts` | DET | — | _no header comment_ | `src/lib/pil/agents/index.ts` | `pil-sup-agents-2.test.ts` | no `pil_agent_runs` rows → NEVER EXECUTED | UNPROVEN — wired, never executed |
| 59 | `logAction` | `src/lib/pil/audit.ts` | DET | — | _no header comment_ | `src/lib/pil/agent-runner.ts`, `src/lib/pil/agents/app/BEN-APP-01.ts`, `src/lib/pil/agents/app/BEN-APP-02.ts` +45 | `pil-app-agents.test.ts`, `pil-dis-agents.test.ts`, `pil-ops-agents.test.ts`, `pil-qlf-knw-agents.test.ts`, `pil-str-agents.test.ts`, `pil-sup-agents-2.test.ts`, `pil-sup-agents.test.ts` | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 60 | `BudgetExceededError` | `src/lib/pil/cost.ts` | DET | — | _no header comment_ | `src/app/api/pil/cost/summary/route.ts`, `src/lib/pil/agent-runner.ts`, `src/lib/pil/agents/sup/BEN-SUP-03.ts` +1 | `pil-sup-agents.test.ts`, `pil-workflow.test.ts` | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 61 | `getPilClient` | `src/lib/pil/db.ts` | DET | — | _no header comment_ | `src/app/api/pil/agents/[agentCode]/runs/route.ts`, `src/app/api/pil/agents/route.ts`, `src/app/api/pil/monitoring/subscribe/route.ts` +55 | `pil-app-agents.test.ts`, `pil-dis-agents.test.ts`, `pil-int-agents.test.ts`, `pil-ops-agents.test.ts`, `pil-qlf-knw-agents.test.ts`, `pil-rel-agents.test.ts`, `pil-str-agents.test.ts`, `pil-sup-agents-2.test.ts`, `pil-sup-agents.test.ts`, `pil-tools.test.ts`, `pil-workflow.test.ts` | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 62 | `recordEvidence` | `src/lib/pil/evidence.ts` | DET | — | _no header comment_ | `src/app/api/pil/prospects/[id]/route.ts`, `src/lib/pil/agents/app/BEN-APP-01.ts`, `src/lib/pil/agents/app/BEN-APP-02.ts` +30 | `pil-app-agents.test.ts`, `pil-dis-agents.test.ts`, `pil-int-agents.test.ts`, `pil-qlf-knw-agents.test.ts`, `pil-str-agents.test.ts`, `pil-sup-agents-2.test.ts`, `pil-sup-agents.test.ts` | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 63 | `upsertNode` | `src/lib/pil/graph.ts` | DET | — | _no header comment_ | `src/app/api/pil/prospects/[id]/route.ts`, `src/lib/pil/agents/app/BEN-APP-01.ts`, `src/lib/pil/agents/app/BEN-APP-02.ts` +34 | `pil-app-agents.test.ts`, `pil-dis-agents.test.ts`, `pil-int-agents.test.ts`, `pil-qlf-knw-agents.test.ts`, `pil-rel-agents.test.ts`, `pil-str-agents.test.ts`, `pil-sup-agents-2.test.ts` | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 64 | `HumanReviewError` | `src/lib/pil/human-review.ts` | DET | — | _no header comment_ | `src/app/api/pil/review-queue/[itemId]/decision/route.ts`, `src/app/api/pil/review-queue/route.ts`, `src/lib/pil/agent-runner.ts` +18 | `pil-app-agents.test.ts`, `pil-int-agents.test.ts`, `pil-ops-agents.test.ts`, `pil-qlf-knw-agents.test.ts`, `pil-str-agents.test.ts`, `pil-sup-agents-2.test.ts`, `pil-sup-agents.test.ts` | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 65 | `createSubscription` | `src/lib/pil/monitoring.ts` | DET | — | _no header comment_ | `src/app/api/pil/monitoring/events/route.ts`, `src/app/api/pil/monitoring/subscribe/route.ts`, `src/lib/pil/agents/qlf/BEN-QLF-04.ts` +2 | `pil-qlf-knw-agents.test.ts`, `pil-str-agents.test.ts` | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 66 | `PolicyViolationError` | `src/lib/pil/policy.ts` | DET | — | _no header comment_ | `src/lib/pil/agent-runner.ts` | `pil-workflow.test.ts` | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 67 | `ResearchOrchestrationError` | `src/lib/pil/research-orchestrator.ts` | DET | — | _no header comment_ | `src/app/api/cron/pil-research/route.ts`, `src/app/api/pil/research/route.ts` | `cron-pil-research-auth.test.ts`, `pil-poll-skips-discovery-runs.test.ts` | `BEN-SUP-01`: 6 PIL runs, 0 ok, 0 failed, last 2026-09-15 | OPERATIONAL |
| 68 | `getSource` | `src/lib/pil/sources.ts` | DET | — | _no header comment_ | `src/lib/pil/agents/sup/BEN-SUP-02.ts`, `src/lib/pil/agents/sup/BEN-SUP-06.ts` | `pil-sup-agents-2.test.ts`, `pil-sup-agents.test.ts` | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 69 | `entity-lookup` | `src/lib/pil/tools/entity-lookup.ts` | DET | — | _no header comment_ | `src/lib/pil/tools/index.ts` | `pil-tools.test.ts` | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 70 | `getTool` | `src/lib/pil/tools/index.ts` | DET | — | _no header comment_ | **none found** | **none** | no agent id declared — cannot be attributed in `agent_runs` | ORPHANED — zero production callers |
| 71 | `irs-990-tool` | `src/lib/pil/tools/irs-990-tool.ts` | DET | — | _no header comment_ | `src/lib/pil/tools/index.ts` | `pil-tools.test.ts` | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 72 | `news-search` | `src/lib/pil/tools/news-search.ts` | AGENTIC | 50% | _no header comment_ | `src/lib/pil/tools/index.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 73 | `web-crawler` | `src/lib/pil/tools/web-crawler.ts` | DET | — | _no header comment_ | `src/lib/pil/tools/index.ts` | `pil-tools.test.ts` | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 74 | `extractRawSearchResults` | `src/lib/pil/tools/web-search.ts` | AGENTIC | 62% | _no header comment_ | `src/lib/pil/tools/index.ts`, `src/lib/pil/tools/news-search.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 75 | `types` | `src/lib/pil/types.ts` | AGENTIC (indirect) | 42% | Prospect Intelligence Layer (PIL) — TypeScript interfaces mirroring supabase/migrations/150-161_pil_*.sql exactly. Column names match the live schema verbatim; see PROSPECT_INTELLIGENCE_SCHEMA.md for the design rationale behind each table. | `src/app/(dashboard)/autoapply/queue/page.tsx`, `src/app/(dashboard)/intelligence/pil/agents/page.tsx`, `src/app/(dashboard)/intelligence/pil/page.tsx` +76 | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 76 | `WorkflowError` | `src/lib/pil/workflow.ts` | DET | — | _no header comment_ | `src/app/api/discovery/pil-trigger/route.ts`, `src/app/api/pil/discover/route.ts`, `src/app/api/pil/research/route.ts` +4 | `pil-sup-agents-2.test.ts`, `pil-sup-agents.test.ts`, `pil-workflow.test.ts` | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |

### Intelligence layer — 49 modules

| # | Module / primary export | File | Det/Agentic | Agentic % | Purpose & capabilities | Wiring (production callers) | Unit/integration test | Live execution evidence | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `BudgetPatternLibrary` | `src/lib/intelligence/budget-patterns.ts` | AGENTIC | 46% | _no header comment_ | `src/app/api/intelligence/budget-patterns/route.ts`, `src/lib/drafts/generator.ts`, `src/lib/intelligence/unified-search.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 2 | `getCompetitorIntel` | `src/lib/intelligence/competitor-intel.ts` | DET | — | _no header comment_ | **none found** | **none** | no agent id declared — cannot be attributed in `agent_runs` | ORPHANED — zero production callers |
| 3 | `ComplianceLibrary` | `src/lib/intelligence/compliance-library.ts` | DET | — | _no header comment_ | `src/app/api/intelligence/compliance/route.ts`, `src/lib/drafts/generator.ts`, `src/lib/intelligence/unified-search.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 4 | `compliance-requirements` | `src/lib/intelligence/data/compliance-requirements.ts` | DET | — | _no header comment_ | `src/lib/intelligence/compliance-library.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 5 | `evaluation-templates` | `src/lib/intelligence/data/evaluation-templates.ts` | DET | — | _no header comment_ | `src/lib/intelligence/evaluation-library.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 6 | `outcome-benchmarks` | `src/lib/intelligence/data/outcome-benchmarks.ts` | DET | — | _no header comment_ | `src/lib/intelligence/outcome-benchmarks.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 7 | `predictDeadlines` | `src/lib/intelligence/deadline-predictor.ts` | DET | — | Predicts a deadline for every one of an organization's opportunities that doesn't have one on file yet (opportunities.deadline IS NULL). Preference order per opportunity: 1. Funder history - if this org has past opportunities from the same  | `src/app/api/intelligence/deadline-predictions/route.ts` | `deadline-predictor.test.ts` | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 8 | `buildDigitalTwin` | `src/lib/intelligence/digital-twin-builder.ts` | DET | — | Organizational Digital Twin Builder (PLATFORM_VISION_ARCHITECTURE.md Pillar 6 / AGENTS_v2.md AG-16). Deterministic (non-Claude) precursor to the full AG-16 agent: assembles a twin object from organizations, knowledge_base, board_members, ou | `src/app/api/intelligence/digital-twin/route.ts`, `src/app/api/knowledge-base/route.ts`, `src/lib/intelligence/twin-auto-populate.ts` +1 | `digital-twin-builder.test.ts` | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 9 | `generateEmbedding` | `src/lib/intelligence/embeddings.ts` | AGENTIC | 47% | _no header comment_ | `src/app/api/intelligence/ingest/route.ts`, `src/lib/agents/knowledge-indexer-agent.ts`, `src/lib/agents/research/kb-relevance.ts` +9 | `kb-relevance.test.ts`, `knowledge-indexer-agent.test.ts` | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 10 | `EvaluationLibrary` | `src/lib/intelligence/evaluation-library.ts` | AGENTIC | 49% | _no header comment_ | `src/app/api/intelligence/evaluation/route.ts`, `src/lib/drafts/generator.ts`, `src/lib/intelligence/unified-search.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 11 | `findMatchingFoundations` | `src/lib/intelligence/foundation-matcher.ts` | DET | — | Foundation Matcher — multi-factor NTEE/geographic/asset/prior-giving scoring engine, used by src/lib/agents/opportunity-discovery-agent.ts (AG-17) to surface foundation_directory records worth pursuing for a given org, independent of the ke | `src/lib/agents/opportunity-discovery-agent.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 12 | `computeFoundationProfile` | `src/lib/intelligence/foundation-profiler.ts` | DET | — | _no header comment_ | `src/app/api/foundations/[id]/profile/route.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 13 | `FunderRecommender` | `src/lib/intelligence/funder-recommender.ts` | AGENTIC | 46% | _no header comment_ | `src/app/api/intelligence/recommendations/explain/route.ts`, `src/app/api/intelligence/recommendations/route.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 14 | `computePortfolioGapAnalysis` | `src/lib/intelligence/gap-recommendations.ts` | DET | — | Gap Recommendations (FEATURE_REGISTRY_v2.md row #146: "Gap Recommendations - specific improvement actions per gap"). This is a synthesis/display layer over two real, already-computed data sources - it is NOT a new autonomous agent (no agent | `src/app/api/intelligence/gap-analysis/route.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 15 | `geographicTextsOverlap` | `src/lib/intelligence/geographic-gap-analysis.ts` | DET | — | Geographic Gap Detection (FEATURE_REGISTRY_v2.md row #145: "Geographic Gap Detection - funder portfolio geographic analysis"). Real schema constraint (checked src/types/database.ts + migration 093 directly before writing this, per this proj | `src/lib/intelligence/gap-recommendations.ts`, `src/lib/scan/scoring-engine.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 16 | `buildGivingDnaFacts` | `src/lib/intelligence/giving-dna.ts` | AGENTIC | 47% | Corporate Giving DNA generator (FEATURE_REGISTRY_v2.md row #92). Synthesizes a short, honest per-company giving profile from whatever real data already exists on a corporate_prospects row -- the identity/ classification columns (107_corpora | `src/app/api/intelligence/corporate-prospects/[id]/giving-dna/route.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 17 | `GrantDNAScorer` | `src/lib/intelligence/grant-dna.ts` | AGENTIC | 61% | _no header comment_ | `src/app/api/intelligence/grant-dna/route.ts`, `src/components/intelligence/GrantDNACard.tsx` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 18 | `computeGrantProbability` | `src/lib/intelligence/grant-probability-engine.ts` | DET | — | Grant Probability Engine (PLATFORM_VISION_ARCHITECTURE.md Pillar 5 / AG-15). Deterministic (non-Claude) precursor to the full AG-15 agent: computes a weighted 0-100 probability score from opportunity + Digital Twin + outcomes data alone, an | `src/app/api/intelligence/grant-probability/route.ts`, `src/lib/agents/probability-scoring-agent.ts` | `grant-probability-engine.test.ts` | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 19 | `deriveFunderType` | `src/lib/intelligence/grant-style-guide.ts` | DET | — | Grant Style Guide Enforcer — deterministic, funder-type-specific narrative rules run on the fully assembled, humanized draft, before the applications INSERT. Called by src/lib/agents/draft-generation-agent.ts (ag-05-draft) immediately after | `src/lib/agents/draft-generation-agent.ts`, `src/lib/intelligence/pattern-extractor.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 20 | `GrantmakerProfileBuilder` | `src/lib/intelligence/grantmaker-profiles.ts` | DET | — | _no header comment_ | `src/lib/intelligence/unified-search.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 21 | `ingestNihProposals` | `src/lib/intelligence/ingest-nih-proposals.ts` | DET | — | _no header comment_ | `src/app/api/intelligence/ingest/route.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 22 | `queryKnowledgeEngine` | `src/lib/intelligence/knowledge-engine.ts` | DET | — | _no header comment_ | `src/app/api/intelligence/knowledge-query/route.ts`, `src/lib/agents/draft-generation-agent.ts`, `src/lib/drafts/generator.ts` | `knowledge-engine.test.ts` | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 23 | `generateLogicModel` | `src/lib/intelligence/logic-model-generator.ts` | AGENTIC | 41% | _no header comment_ | `src/app/api/intelligence/logic-model/route.ts`, `src/lib/drafts/generator.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 24 | `computeMatchFeed` | `src/lib/intelligence/match-feed.ts` | DET | — | Personalized Match Feed (FEATURE_REGISTRY_v2.md #85, Phase 2 Pillar 2 — "per-org scoring of opportunities against the org's Digital Twin"). Deterministic (non-Claude), following the same design principle as AG-15's grant-probability-engine. | `src/app/api/intelligence/match-feed/route.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 25 | `computeNarrativeGapAnalysis` | `src/lib/intelligence/narrative-gap-analysis.ts` | DET | — | Per-opportunity Narrative Gap Analysis (FEATURE_REGISTRY_v2.md row #144: "Narrative Gap Analysis - KB completeness scoring vs funder requirements"). AG-11 (Knowledge Gap Agent, src/lib/agents/knowledge-gap-agent.ts) already does real, live, | `src/app/api/opportunities/[id]/narrative-gap-analysis/route.ts`, `src/lib/intelligence/gap-recommendations.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 26 | `scoreNarrativeQuality` | `src/lib/intelligence/narrative-humanizer.ts` | AGENTIC | 61% | Narrative Humanizer — post-processes an autonomously drafted grant narrative to remove common AI writing tells, inject organization-specific detail in place of vague boilerplate, enforce a consistent first-person active voice, and score the | `src/app/api/drafts/[id]/humanize/route.ts`, `src/lib/agents/draft-generation-agent.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 27 | `NeedStatementEngine` | `src/lib/intelligence/need-statement-engine.ts` | AGENTIC | 44% | _no header comment_ | `src/app/api/intelligence/need-data/route.ts`, `src/lib/drafts/generator.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 28 | `OutcomeBenchmarkEngine` | `src/lib/intelligence/outcome-benchmarks.ts` | AGENTIC | 38% | _no header comment_ | `src/app/api/intelligence/benchmarks/route.ts`, `src/lib/intelligence/unified-search.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 29 | `NarrativePatternEngine` | `src/lib/intelligence/pattern-engine.ts` | AGENTIC | 36% | _no header comment_ | **none found** | **none** | no agent id declared — cannot be attributed in `agent_runs` | ORPHANED — zero production callers |
| 30 | `extractGrantPatterns` | `src/lib/intelligence/pattern-extractor.ts` | AGENTIC | 61% | Grant Pattern Extraction Engine — turns the Intelligence Library (intelligence_funded_proposals) into actionable, org- and opportunity- specific guidance for the draft generation pipeline (see src/lib/agents/draft-generation-agent.ts, which | `src/lib/agents/draft-generation-agent.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 31 | `deriveFunderBucket` | `src/lib/intelligence/proposals-query.ts` | DET | — | Shared query/filter logic for the Grant Intelligence Library (intelligence_funded_proposals — supabase/migrations/048_grant_intelligence.sql). migration 106_intelligence_library_schema_upgrade.sql adds funder_category/ ntee_major/geographic | `src/app/api/intelligence/library/search/route.ts`, `src/app/api/intelligence/proposals/route.ts`, `src/lib/intelligence/pattern-extractor.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 32 | `retrieveIntelligence` | `src/lib/intelligence/rag-retrieval.ts` | DET | — | _no header comment_ | `src/lib/drafts/generator.ts`, `src/lib/intelligence/unified-search.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 33 | `findShortestPath` | `src/lib/intelligence/relationship-graph-pathfinder.ts` | DET | — | FEATURE_REGISTRY_v2.md row #82 "Path Finder" — shortest/strongest path between any two real pig_nodes over the org's real pig_edges graph, the same graph src/app/api/intelligence/relationship-graph/route.ts's loadRelationshipGraph() already | `src/components/intelligence/RelationshipGraphViz.tsx` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 34 | `scoreFromEvents` | `src/lib/intelligence/relationship-scorer.ts` | DET | — | _no header comment_ | `src/app/api/funders/[id]/relationship/route.ts`, `src/app/api/funders/relationship-scores/route.ts`, `src/lib/agents/funder-relationship.ts` +1 | `relationship-scoring-consolidation.test.ts`, `relationship-scorer.test.ts` | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 35 | `ReputationIntelligenceAgent` | `src/lib/intelligence/reputation-agent.ts` | AGENTIC | 79% | Reputation Intelligence Agent — PLATFORM_VISION_ARCHITECTURE.md Pillar 15 (Reputation Intelligence), AGENTS_v2.md AG-18. Searches DuckDuckGo's free Instant Answer API for an entity's name paired with risk keywords, has Claude classify each  | `src/app/api/intelligence/reputation/route.ts`, `src/lib/intelligence/signal-monitor.ts`, `worker/autonomous-orchestrator.ts` | **none** | `ag-18-reputation`: 4 runs, 4 ok, 0 failed, last ok 2026-08-07 | OPERATIONAL |
| 36 | `matchResourcesForSignal` | `src/lib/intelligence/resource-matcher.ts` | DET | — | Community Resource Matcher — row #226 "Community Resource Graph" MVP, scoped down per the queue-37 preflight (SESSION_STATE.md): AG-35's real output (community_need_signals, migration 090) has no lat/lng and no structured location join, and | `src/app/api/intelligence/community-resources/route.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 37 | `extractRubricFromText` | `src/lib/intelligence/rubric-extractor.ts` | AGENTIC | 38% | _no header comment_ | `src/scripts/ingest-rubrics-from-opportunities.ts` | `rubric-extractor.test.ts` | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 38 | `extractSections` | `src/lib/intelligence/section-extractor.ts` | AGENTIC | 44% | _no header comment_ | `src/app/api/intelligence/ingest/route.ts`, `src/lib/intelligence/ingest-nih-proposals.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 39 | `matchFunders` | `src/lib/intelligence/semantic-matcher.ts` | DET | — | Keyword-overlap foundation matcher — scores foundation_directory records against an org's mission statement via Jaccard similarity of tokenized text (mission vs. foundation name + enrichment.funding_categories), not a real embeddings/semant | `src/app/api/match/foundations/route.ts` | `semantic-matcher.test.ts` | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 40 | `watchLinkedInSignals` | `src/lib/intelligence/signal-monitor.ts` | AGENTIC | 47% | Signal Monitoring — FEATURE_REGISTRY_v2.md #99 ("LinkedIn + news + 990 watching"). This pass scopes the feature to NEWS + 990 ONLY. LinkedIn is explicitly OUT of scope here — not a technical gap, a policy decision. LinkedIn scraping carries | `src/app/api/intelligence/signal-monitor/route.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 41 | `BlsDataSource` | `src/lib/intelligence/sources/bls-api.ts` | DET | — | _no header comment_ | `src/lib/intelligence/need-statement-engine.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 42 | `CdcDataSource` | `src/lib/intelligence/sources/cdc-api.ts` | DET | — | _no header comment_ | `src/lib/intelligence/need-statement-engine.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 43 | `CensusDataSource` | `src/lib/intelligence/sources/census-api.ts` | DET | — | _no header comment_ | `src/lib/intelligence/need-statement-engine.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 44 | `HudDataSource` | `src/lib/intelligence/sources/hud-api.ts` | DET | — | _no header comment_ | `src/lib/intelligence/need-statement-engine.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 45 | `types` | `src/lib/intelligence/sources/types.ts` | DET | — | _no header comment_ | `src/app/api/intelligence/need-data/route.ts`, `src/lib/drafts/generator.ts`, `src/lib/intelligence/need-statement-engine.ts` +4 | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 46 | `computeSuccessProbability` | `src/lib/intelligence/success-probability.ts` | DET | — | Opportunity-scoped success probability calculator. Lighter-weight than the application-scoped agent at src/lib/agents/success-probability.ts (which persists to success_probability_scores keyed by application_id). This variant answers "how p | `src/app/api/opportunities/[id]/probability/route.ts` | `success-probability.test.ts` | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 47 | `autoPopulateTwin` | `src/lib/intelligence/twin-auto-populate.ts` | AGENTIC | 50% | Digital Twin Auto-Population (AUTONOMOUS_PLATFORM_VISION.md Phase 2 "Fundability Intelligence Score" / AGENTS_v2.md AG-16 Digital Twin Builder, AG-29 Fundability Scorer). Companion to twin-completeness.ts's calculateTwinCompleteness() and d | `src/app/api/intelligence/twin/auto-populate/route.ts`, `src/app/api/onboarding/complete-setup/route.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 48 | `calculateTwinCompleteness` | `src/lib/intelligence/twin-completeness.ts` | AGENTIC | 57% | Digital Twin Completeness Engine (AUTONOMOUS_PLATFORM_VISION.md Phase 2 "Fundability Intelligence Score" / AGENTS_v2.md AG-16 Digital Twin Builder). There is no `OrganizationalDigitalTwin` or `KnowledgeBaseProfile` type or table anywhere in | `src/app/(dashboard)/intelligence/twin/page.tsx`, `src/app/api/intelligence/twin/completeness/route.ts`, `src/app/api/knowledge-base/route.ts` +1 | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 49 | `UnifiedIntelligenceSearch` | `src/lib/intelligence/unified-search.ts` | DET | — | _no header comment_ | `src/app/api/intelligence/briefing/route.ts`, `src/app/api/intelligence/search/route.ts`, `src/components/intelligence/IntelligenceBriefingPanel.tsx` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |

### Research pipeline — 6 modules

| # | Module / primary export | File | Det/Agentic | Agentic % | Purpose & capabilities | Wiring (production callers) | Unit/integration test | Live execution evidence | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `checkDataQuality` | `src/lib/research/data-quality.ts` | DET | — | Research data quality — overnight-006. Provides a lightweight quality-scoring pass that runs on already-discovered opportunity rows and flags low-quality records for review or removal. Unlike result-parser's per-extraction confidence (which | `src/app/api/agents/research/quality/route.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 2 | `families` | `src/lib/research/families.ts` | DET | — | Research agent families - client-safe schedule metadata for the Research UI. Pure data only (no imports), so it is safe to use in client components. The category lists MIRROR the authoritative `*_CATEGORIES` constants exported by each agent | `src/app/(dashboard)/search-profiles/configure/SearchConfiguration.tsx`, `src/lib/agents/research/agent-configs.ts` | **none** | `government_research`: 49 runs, 36 ok, 13 failed, last ok 2026-09-09; `corporate_research`: 16 runs, 11 ok, 5 failed, last ok 2026-09-09; `foundation_research`: 30 runs, 14 ok, 16 failed, last ok 2026-09-09; `local_sponsorship`: 9 runs, 4 ok, 5 failed, last ok 2026-09-09 | OPERATIONAL (with failures) |
| 3 | `expandKeywords` | `src/lib/research/keyword-expander.ts` | AGENTIC | 41% | Keyword expansion for search profiles — overnight-006. Given an existing search profile's keywords, mission statement, and focus areas, asks Claude to suggest additional high-signal search terms that would surface more relevant grant opport | `src/app/api/agents/keyword-expansion/route.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 4 | `generateOrgResearchConfig` | `src/lib/research/org-research-config.ts` | AGENTIC | 41% | _no header comment_ | `src/app/api/agents/research-config/route.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 5 | `parseSourceTypeFilters` | `src/lib/research/profile-config.ts` | DET | — | Search-profile advanced configuration - shared, client-safe shapes + parsers. Migration 011 added several structured (jsonb / array) configuration columns to search_profiles. This module is the single source of truth for their TypeScript sh | `src/app/(dashboard)/search-profiles/configure/SearchConfiguration.tsx`, `src/app/api/agents/keyword-expansion/route.ts`, `src/app/api/cron/research/route.ts` +1 | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 6 | `resource-registry` | `src/lib/research/resource-registry.ts` | AGENTIC (indirect) | 31% | Research resource registry - static catalog backing the Research page's resource directory (BLUEPRINT.md Directive 5: pinned enterprise grid + searchable long tail). Pure data only, safe for client components. | `src/app/(dashboard)/research/page.tsx` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |

### Scrapers — 3 modules

| # | Module / primary export | File | Det/Agentic | Agentic % | Purpose & capabilities | Wiring (production callers) | Unit/integration test | Live execution evidence | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `EnginePool` | `src/lib/scraper/foundation-scraper.ts` | DET | — | Foundation directory enrichment agent — STANDING_DIRECTIVES.md Directive 1, enrichment waterfall sources #1 (IRS 990 XML), #5 (foundation website scraper), and the "web enrichment never run at scale" gap it calls out. Enriches `foundation_d | `src/lib/scraper-v2/templates/foundation-990-template.ts`, `worker/autonomous-orchestrator.ts`, `worker/scheduler.ts` | `regressions.test.ts` | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 2 | `runNonprofitScraper` | `src/lib/scraper/nonprofit-scraper.ts` | DET | — | Nonprofit contact-enrichment agent — StealthEngine-based sibling to scripts/scrape-website-contacts.ts (CheerioCrawler, plain HTTP, no browser) and scripts/enrich-website-contacts.ts (Claude-powered extraction). Both existing scripts give u | `worker/scheduler.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 3 | `StealthEngine` | `src/lib/scraper/stealth-engine.ts` | DET | — | StealthEngine — next-generation stealth scraper core (STANDING_DIRECTIVES.md Directive 1, enrichment source #5 "Foundation website scraper"). Playwright-based, built on the same playwright-extra + puppeteer-extra stealth-plugin combination  | `src/lib/agents/change-monitor-agent.ts`, `src/lib/agents/ea-01-giving-detector.ts`, `src/lib/agents/ea-02-community-outreach-detector.ts` +9 | `regressions.test.ts` | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |

### Other — 16 modules

| # | Module / primary export | File | Det/Agentic | Agentic % | Purpose & capabilities | Wiring (production callers) | Unit/integration test | Live execution evidence | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `SalesCampaignEngine` | `src/lib/admin/sales-campaign-engine.ts` | DET | — | _no header comment_ | `src/app/api/admin/campaigns/[id]/route.ts`, `src/app/api/admin/campaigns/route.ts`, `src/app/api/cron/sales-sends/route.ts` | `admin-sales.test.ts` | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 2 | `UnsubscribeAgent` | `src/lib/admin/unsubscribe-agent.ts` | AGENTIC | 50% | _no header comment_ | `src/app/api/admin/webhooks/email-events/route.ts`, `src/app/api/admin/webhooks/email-reply/route.ts` | `unsubscribe-agent.test.ts` | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 3 | `WarmupEngine` | `src/lib/admin/warmup-engine.ts` | DET | — | _no header comment_ | `src/app/api/cron/domain-warmup/route.ts`, `src/lib/admin/sales-campaign-engine.ts` | `warmup-engine.test.ts` | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 4 | `ChallengeDetectedError` | `src/lib/automation/browser-agent.ts` | DET | — | BrowserAgent - base class for Phase 3 browser automation agents. (AGENTS.md Agent 16, BEHAVIORAL_CONTRACTS §18) Wraps BrowserEngine with retry logic for flaky selectors, an auto-incrementing step counter for screenshot naming, and structure | **none found** | **none** | `browser_automation`: 3 runs, 3 ok, 0 failed, last ok 2026-09-08 | ORPHANED — zero production callers |
| 5 | `BrowserEngineError` | `src/lib/automation/browser-engine.ts` | DET | — | BrowserEngine - Playwright lifecycle manager for Phase 3 browser automation (AGENTS.md Agent 16, BEHAVIORAL_CONTRACTS §18). One BrowserEngine drives one automation session: it launches Chromium, owns a single browsing context + page, naviga | `src/lib/agents/browser-automation.ts`, `src/lib/agents/playwright-agent.ts`, `src/lib/automation/browser-agent.ts` +1 | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 6 | `ReminderEngine` | `src/lib/calendar/reminder-engine.ts` | DET | — | Follow-up reminder scheduling engine. scheduleFollowUpReminders: creates calendar events (or in-app notifications) at 14, 30, and 60 days after submission for each submitted/follow_up_due application, skipping dates already covered. process | `src/app/api/cron/reminders/route.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 7 | `useChatbotEngine` | `src/lib/chatbot/useChatbotEngine.ts` | DET | — | _no header comment_ | `src/components/ChatbotAssistant.tsx` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 8 | `EnrichmentAgent` | `src/lib/donor-discovery/agents/enrichment-agent.ts` | AGENTIC | 57% | _no header comment_ | `src/lib/donor-discovery/scoring-engine.ts`, `src/worker/jobs/enrich-donor-prospect.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 9 | `ScoringEngine` | `src/lib/donor-discovery/scoring-engine.ts` | AGENTIC | 62% | _no header comment_ | `src/worker/jobs/score-donor-prospect.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 10 | `DraftQueueEngine` | `src/lib/drafts/draft-queue-engine.ts` | DET | — | _no header comment_ | `src/app/api/agents/eligibility/route.ts`, `src/app/api/cron/draft-automation/route.ts`, `src/app/api/cron/draft-queue-check/route.ts` +3 | `knowledge-tools.test.ts` | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 11 | `SequenceEngine` | `src/lib/email/sequence-engine.ts` | DET | — | _no header comment_ | `src/app/api/cron/email-sequences/route.ts`, `src/app/api/email/sequences/[id]/enroll/route.ts`, `src/app/api/email/sequences/route.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 12 | `EmailTemplateEngine` | `src/lib/email/template-engine.ts` | AGENTIC | 44% | _no header comment_ | `src/app/api/email/templates/generate/route.ts`, `src/app/api/email/templates/route.ts`, `src/lib/email/sequence-engine.ts` | `template-engine.test.ts` | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 13 | `EnrichmentEngine` | `src/lib/enrichment/engine.ts` | DET | — | EnrichmentEngine — orchestrates the waterfall enrichment pipeline. Designed to run as a long-lived Node.js process. All progress is written to Supabase so the web UI can poll for updates. | `src/lib/enrichment/runner.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 14 | `WebsiteScraper` | `src/lib/enrichment/sources/website-scraper.ts` | DET | — | _no header comment_ | `src/lib/enrichment/engine.ts` | **none** | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 15 | `computeFundingPotentialScan` | `src/lib/scan/scoring-engine.ts` | DET | — | Funding Potential Scan — scoring engine (follow-up to migration 172's intake-only scope; see supabase/migrations/172_scan_submissions.sql and src/app/(marketing)/scan/ScanClient.tsx, both of which explicitly defer "the scoring engine" to th | `src/app/(marketing)/scan/ScanClient.tsx`, `src/app/(marketing)/scan/ScanEmailCapture.tsx`, `src/app/(marketing)/scan/ScanReport.tsx` +3 | `funding-potential-scan-scoring.test.ts` | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
| 16 | `scrapePortal` | `src/lib/sources/state-portals/portal-scraper.ts` | DET | — | State grant portal scraper — best-effort text scan, not a real HTML parser. State portals are fragile and change markup without notice (BLUEPRINT.md §15), so this deliberately does basic string search rather than depending on a DOM/CSS sele | `src/app/api/sources/state-portals/route.ts` | `wgr-155-state-portals-gate.test.ts` | no agent id declared — cannot be attributed in `agent_runs` | UNATTRIBUTABLE — no agent id to trace |
---

## 9. Remediation sequence — run in this order

Every command assumes a **standalone PowerShell window from the Windows Start menu**, not the Cursor terminal.

### Step 1 — unbreak the build (do this first, nothing else matters until it's green)

```powershell
cd C:\Users\manag\Documents\benavora; npx tsc --noEmit 2>&1 | Tee-Object -FilePath .\tsc.log | Out-Null; Get-Content .\tsc.log -Tail 20
```

Two options. Restore the agent (correct if renewal tracking is a real feature):

```powershell
cd C:\Users\manag\Documents\benavora; git checkout ab584df~1 -- src/lib/agents/renewal-tracker-agent.ts; npx tsc --noEmit 2>&1 | Tee-Object -FilePath .\tsc.log | Out-Null; Get-Content .\tsc.log -Tail 20
```

Or remove the caller (correct only if you are certain renewal tracking is out of scope) — delete `runRenewalTrackerStep` at `worker/autonomous-orchestrator.ts:621-637` **and** its call site in the nightly pipeline.

### Step 2 — ✅ DONE. Rotate the stale `DATABASE_URL` password

The 16-file integration run is complete: 15 passed, 1 blocked on credentials. Get the current password from Supabase → Project Settings → Database → Connection string, then:

```powershell
cd C:\Users\manag\Documents\benavora; npx vercel env rm DATABASE_URL production; npx vercel env add DATABASE_URL production
```

Then re-run only the blocked file to confirm:

```powershell
cd C:\Users\manag\Documents\benavora; npx vitest run src/__tests__/integration/success-probability-upsert-constraint.test.ts 2>&1 | Tee-Object -FilePath .\spuc.log | Out-Null; Get-Content .\spuc.log -Tail 30
```

That test is the WGR-170 regression guard for the `success_probability` bug that has failed 100 of 137 production runs. It cannot help you while it is skipped.

### Step 3 — run the AutoApply e2e I could not reach

```powershell
cd C:\Users\manag\Documents\benavora; npx playwright test e2e/autoapply-dashboard.spec.ts --reporter=list 2>&1 | Tee-Object -FilePath .\pw-autoapply.log | Out-Null; Get-Content .\pw-autoapply.log -Tail 40
```

### Step 4 — P0: make AutoApply incapable of lying

This is a Claude Code escalation (4+ files, cross-cutting), not a chat-based single-file edit. Scope:

- `src/lib/autoapply/form-filler-agent.ts` — accept the array `field_mapping` shape (map `fieldName` → selector, `kbMapping` → fill key); `submitForm()` awaits navigation or an HTTP response and **throws** when neither occurs; add a pre-submit gate that throws if any `required` field is still empty; remove the bare `catch {}` and surface a typed failure; fix `knowledge_base_entries` → `knowledge_base`
- `worker/queue-processor.ts` — `submissionStatus = 'submitted'` **only** when a submission was verified; introduce `'submit_unverified'` for the ambiguous case; never call `recordOutcome(…, true)` without verification
- `src/app/api/autoapply/templates/test/route.ts` — `knowledge_base_entries` → `knowledge_base`
- New test asserting a blank-required-field form is **refused**, not submitted

### Step 5 — P1 sweep

`success_probability` upsert constraint · per-agent `timeoutMs` for the 6 timeout-failing types · `p-limit` around Claude calls · `corporate_prospects` migrate-or-remove · `applications.knowledge_patterns_applied` column · supply `context.plan.targetAgentRunId` to `BEN-SUP-05` · fix the PIL `[object Object]` error serializer · make `stuck-run-watchdog` reap stuck `pil_agent_runs`.

### Every Claude Code prompt for the above must close with

1. **GOVERNANCE UPDATE** — audit the live codebase and update `STATE_OF_THE_BUILD.md`, `SESSION_STATE.md`, `BLUEPRINT.md`, `AGENTS.md`, `queue.yaml`, `SCHEMA_REGISTRY.md` before the session ends
2. **INCREMENTAL TESTING** at logical mid-run checkpoints
3. **END-OF-RUN VERIFICATION** that what was built actually works

---

## 10. Against the Six Laws

| Law | AutoApply | Research / intelligence layer | PIL |
|---|---|---|---|
| 1 SCHEMA | ⚠️ tables exist and RLS tests pass live; `corporate_prospects` missing, `applications.knowledge_patterns_applied` missing | ⚠️ same gaps | ✅ 41 tables exist |
| 2 API | ✅ routes exist, session-scoped; `agency-rls`, `rls`, `storage-rls` all pass live | ✅ | ✅ |
| 3 UI | ⚠️ UNVERIFIED — authed e2e unreachable from this container | ⚠️ UNVERIFIED | ⚠️ UNVERIFIED |
| 4 DATA | ❌ primary `field_mapping` path dead; `knowledge_base_entries` nonexistent → 14 of 16 fill keys always empty | ⚠️ real data, high failure rates | ❌ 27 of 41 tables empty, every assessment output empty |
| 5 WIRING | ✅ worker, scheduler, queue all wired; queue gating + risk scoring verified live | ✅ | ✅ orchestration wired, 27 of 51 agents never invoked |
| 6 VERIFICATION | ❌ **1 lifetime submission, no confirmation number, no screenshot**; the guarding test uses a form with no `required` fields and so cannot fail | ⚠️ partial | ❌ no assessment output to verify |

**AutoApply fails Law 4 and Law 6. It is UNVERIFIED and must not be described as operational.**

---

## 11. Bottom line

What you actually have, stated plainly:

**Real and good.** The AutoApply perception layer — Claude form analysis, confirmation parsing, risk scoring, funder/profile matching, timing, stealth browser fingerprinting — all verified working with real Claude and real Chromium. The human-approval gate is genuinely unbypassable; I attacked it twice and it held. 15 of 16 live-DB integration files pass against production, including queue gating, risk scoring, compliance rules, mutual exclusion, and all three RLS suites. `ag-29-knowledge-indexer` is a real, high-volume, zero-failure production agent. 13 PIL agents complete cleanly. 886 tests pass across both suites. PIL's audit/policy/cost infrastructure is well built.

**Real and broken.** AutoApply's primary fill path is dead and it cannot tell you when a submission failed. One agent has never succeeded. 100 of 137 `success_probability` runs fail on the same error, and the test that guards it is skipped on a stale DB password. HEAD does not typecheck because last night's cleanup deleted a live agent.

**Not real yet.** 63 wired agents have never executed. 27 of 51 PIL agents have never executed. Every PIL assessment table is empty. The mean agentic maturity across 125 model-calling modules is 52%, which means most of these are scheduled single-shot prompts, not agents.

The prior audit was competent work that reached the limit of what reading code can tell you. Its count was right, two of its blockers were already fixed, one of its four "dead" agents was alive and deleting it broke your build. The gap between "wired" (114) and "has ever demonstrably worked" (69) is the gap between a code audit and an execution audit — and it is where your remaining launch risk lives.

---

*Every claim above is traceable to a command that ran in this session. Where I could not execute, the row says UNVERIFIED. No status was inherited from a prior session's report.*
