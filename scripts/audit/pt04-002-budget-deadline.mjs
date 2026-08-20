// PT-04-002 — Budget Reconciliation + Deadline Reminder-Offset hand-verification.
//
// Two independent checks, both against the REAL running system (a local
// `next dev` instance on http://localhost:3100, pointed at the real
// production database), using the dedicated "Benavora E2E Test Org"
// (owner.e2e@benavora-test.dev) — never Faith Foundation's real production
// application — so this audit's writes never pollute a real customer's data.
//
// PART 1 — BUDGET RECONCILIATION
//   Source: src/app/api/applications/[id]/reconcile/route.ts (read directly,
//   not from memory). Documented formula:
//     total_budget = grant_budgets.total_budget if a budget row exists,
//                    else application.awarded_amount ?? requested_amount ?? 0
//     total_spent  = sum(grant_expenses.amount) for the application
//     variance     = total_budget - total_spent
//     compliance_status = "no_budget_set" if no budget row,
//                          else "under_budget" if variance>0,
//                               "over_budget"  if variance<0,
//                               "on_budget"    if variance===0
//   Method: create a REAL budget (POST /api/applications/[id]/budget) and
//   several REAL expenses (POST /api/applications/[id]/expenses) against a
//   real, pre-existing E2E test application via the live authenticated API
//   (not a raw DB insert — this exercises the real write path, including the
//   route's own line-item-sum-as-total_budget default). Then call the real
//   GET /api/applications/[id]/reconcile endpoint to obtain the system's own
//   computed reconciliation report ("actual"). Independently hand-sum the
//   same inputs in this script, using plain arithmetic only (no shared code
//   with the route), to produce "expected". Compare field by field.
//
// PART 2 — DEADLINE REMINDER-OFFSET MATH
//   Source: src/app/api/deadlines/check/route.ts (read directly). Documented
//   formula:
//     daysUntil = differenceInCalendarDays(due_date-as-local-midnight, today)
//     THRESHOLDS = [30, 14, 7, 3, 1] (days)
//     for each threshold: fires (newly, this run) iff daysUntil <= days AND
//       the corresponding reminder_{days}d_sent flag is not already true.
//     Once a flag is set true it is never reset (Contracts §11) — a
//     already-sent threshold must NOT re-fire even if still crossed.
//   Method: seed several REAL `deadlines` rows (direct DB insert — there is
//   no dedicated deadlines-creation API route in this codebase, confirmed by
//   grep) spanning distinct deadline_type enum values and distinct due-date
//   offsets from "today", including one row that already has some reminder
//   flags pre-set true (to exercise the one-way/no-re-fire idempotency rule).
//   Also includes the E2E org's one pre-existing real deadline row (due
//   2026-06-19, all flags false, is_completed false), which the interactive
//   check route will process unconditionally since it scans ALL of the
//   caller's org's incomplete deadlines — its resulting flags are reverted to
//   their original (false) state after the check to leave no lasting effect
//   on a fixture other scripts in this repo depend on.
//   Then call the real, authenticated GET /api/deadlines/check (interactive
//   mode — no CRON_SECRET header — scopes to the caller's own org via
//   session, per the route's own documented two-mode design) to get the
//   system's own actual triggered-reminders result. Independently
//   hand-compute, in this script, which thresholds SHOULD fire for each row
//   using date-fns's differenceInCalendarDays directly (not the route's own
//   code), and compare against what was actually returned.
//
// All seeded rows (budget, expenses, reconciliation report, the 5 new
// deadline rows) are deleted at the end of the run; the pre-existing
// deadline row's reminder flags are reset to false. Confirmed via a final
// re-query that cleanup left no residue.
//
// Usage: node scripts/audit/pt04-002-budget-deadline.mjs

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { differenceInCalendarDays, addDays, startOfDay, format } from "date-fns";
import { WebSocket } from "ws";

// Node 20 has no native WebSocket; @supabase/supabase-js eagerly constructs a
// RealtimeClient that needs one. Same shim used throughout this repo's own
// scripts (e.g. src/lib/supabase/admin.ts, pt03-001).
if (typeof globalThis.WebSocket === "undefined") globalThis.WebSocket = WebSocket;

const BASE_URL = "http://localhost:3100";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const TEST_EMAIL = "owner.e2e@benavora-test.dev";
const TEST_PASSWORD = "Benavora!E2E-Test-1";
const ORG_ID = "bf75d362-473c-4039-9e28-e09ef44ee862"; // Benavora E2E Test Org
const APPLICATION_ID = "49d5f326-5526-49e9-9d4e-fa403d7a96ff"; // real, pre-existing E2E application
const PRE_EXISTING_DEADLINE_ID = "8dc6a387-21e7-444c-b613-a5dc2f75491e"; // "Rural Housing Stability Grant — application due"

const REMINDER_THRESHOLDS = [30, 14, 7, 3, 1];

const { Client: PgClient } = pg;
const pgClient = new PgClient({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function round2(n) {
  return Math.round(n * 100) / 100;
}

function toLocalDateString(d) {
  return format(d, "yyyy-MM-dd");
}

// Mirrors src/app/api/deadlines/check/route.ts's own parsing exactly: a
// 10-char due_date string (the shape PostgREST always returns a `date`
// column as) is parsed as LOCAL midnight, not UTC.
function daysUntilLikeTheRoute(dueDateStr, today) {
  const dueAsLocalMidnight =
    dueDateStr.length === 10 ? new Date(`${dueDateStr}T00:00:00`) : new Date(dueDateStr);
  return differenceInCalendarDays(dueAsLocalMidnight, today);
}

function expectedRemindersForRow(dueDateStr, alreadySentFlags, today) {
  const daysUntil = daysUntilLikeTheRoute(dueDateStr, today);
  const fired = [];
  for (const days of REMINDER_THRESHOLDS) {
    const alreadySent = alreadySentFlags[`reminder_${days}d_sent`] === true;
    if (daysUntil <= days && !alreadySent) fired.push(days);
  }
  return { daysUntil, fired };
}

async function loginAndGetCookieHeader() {
  const anon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await anon.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });
  if (error || !data.session) {
    throw new Error(`signInWithPassword failed: ${error?.message ?? "no session returned"}`);
  }

  const setCookies = [];
  const authForCookies = createServerClient(SUPABASE_URL, ANON_KEY, {
    cookies: { getAll: () => [], setAll: (list) => setCookies.push(...list) },
  });
  await authForCookies.auth.setSession({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });

  const cookieHeader = setCookies.map((c) => `${c.name}=${c.value}`).join("; ");
  return { cookieHeader, userId: data.user.id };
}

async function apiFetch(cookieHeader, method, urlPath, body) {
  const res = await fetch(`${BASE_URL}${urlPath}`, {
    method,
    headers: {
      "content-type": "application/json",
      cookie: cookieHeader,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // leave json null; raw text is captured for diagnostics below
  }
  return { status: res.status, json, raw: text };
}

async function main() {
  await pgClient.connect();

  const generatedAt = new Date().toISOString();
  const evidence = {
    generated_at: generatedAt,
    organization_id: ORG_ID,
    organization_name: "Benavora E2E Test Org",
    method:
      "Real writes via the live, authenticated Next.js API (POST/GET against a local dev server on the real production database), using the dedicated E2E test org — never a real customer's application. All seeded rows deleted / reverted at the end of this script; a final re-query confirms zero residue.",
  };

  // -----------------------------------------------------------------------
  // Pre-flight: confirm the target application has zero budget/expense/
  // reconciliation rows before we start, so "real budget with real expenses"
  // in the final evidence is unambiguously created by THIS run.
  // -----------------------------------------------------------------------
  const preflightBudget = await pgClient.query(
    `SELECT id FROM grant_budgets WHERE application_id = $1`,
    [APPLICATION_ID],
  );
  const preflightExpenses = await pgClient.query(
    `SELECT id FROM grant_expenses WHERE application_id = $1`,
    [APPLICATION_ID],
  );
  const preflightRecon = await pgClient.query(
    `SELECT id FROM grant_reconciliation_reports WHERE application_id = $1`,
    [APPLICATION_ID],
  );
  evidence.preflight = {
    application_id: APPLICATION_ID,
    pre_existing_budget_rows: preflightBudget.rows.length,
    pre_existing_expense_rows: preflightExpenses.rows.length,
    pre_existing_reconciliation_rows: preflightRecon.rows.length,
  };

  // -----------------------------------------------------------------------
  // Real authenticated session for the E2E test org owner.
  // -----------------------------------------------------------------------
  const { cookieHeader, userId } = await loginAndGetCookieHeader();
  evidence.session = { authenticated_user_id: userId, base_url: BASE_URL };

  const createdIds = { budgetId: null, expenseIds: [], deadlineIds: [] };

  try {
    // =====================================================================
    // PART 1 — BUDGET RECONCILIATION
    // =====================================================================
    const lineItems = [
      { category: "Personnel", label: "Program Coordinator (0.5 FTE)", amount: 18000 },
      { category: "Supplies", label: "Client intake materials", amount: 4500 },
      { category: "Travel", label: "Site visits", amount: 2500 },
      { category: "Evaluation", label: "Outcomes assessment", amount: 1500 },
    ];
    const expectedTotalBudget = round2(lineItems.reduce((s, i) => s + i.amount, 0)); // 26500

    const budgetPost = await apiFetch(cookieHeader, "POST", `/api/applications/${APPLICATION_ID}/budget`, {
      line_items: lineItems,
      // total_requested intentionally omitted -- exercises the route's own
      // "defaults to sum of line items" branch, per its documented formula.
    });
    if (budgetPost.status !== 200 && budgetPost.status !== 201) {
      throw new Error(`POST budget failed: HTTP ${budgetPost.status} :: ${budgetPost.raw}`);
    }
    createdIds.budgetId = budgetPost.json?.budget?.id ?? null;

    const expenseSeed = [
      { category: "Personnel", description: "August payroll — coordinator", amount: 5000 },
      { category: "Supplies", description: "Intake folders + printing", amount: 1200.5 },
      { category: "Travel", description: "Mileage reimbursement, 3 site visits", amount: 800.25 },
    ];
    const expectedTotalSpent = round2(expenseSeed.reduce((s, e) => s + e.amount, 0)); // 7000.75

    for (const exp of expenseSeed) {
      const res = await apiFetch(cookieHeader, "POST", `/api/applications/${APPLICATION_ID}/expenses`, exp);
      if (res.status !== 201) {
        throw new Error(`POST expense failed: HTTP ${res.status} :: ${res.raw}`);
      }
      createdIds.expenseIds.push(res.json?.expense?.id);
    }

    const expectedVariance = round2(expectedTotalBudget - expectedTotalSpent); // 19499.25
    const expectedComplianceStatus =
      expectedVariance > 0 ? "under_budget" : expectedVariance < 0 ? "over_budget" : "on_budget";

    const reconcileRes = await apiFetch(cookieHeader, "GET", `/api/applications/${APPLICATION_ID}/reconcile`);
    if (reconcileRes.status !== 200) {
      throw new Error(`GET reconcile failed: HTTP ${reconcileRes.status} :: ${reconcileRes.raw}`);
    }
    const actualReport = reconcileRes.json.report;

    const budgetDelta = {
      total_budget: round2((actualReport.total_budget ?? 0) - expectedTotalBudget),
      total_spent: round2((actualReport.total_spent ?? 0) - expectedTotalSpent),
      variance: round2((actualReport.variance ?? 0) - expectedVariance),
      compliance_status_matches: actualReport.compliance_status === expectedComplianceStatus,
    };
    const budgetMismatch =
      budgetDelta.total_budget !== 0 ||
      budgetDelta.total_spent !== 0 ||
      budgetDelta.variance !== 0 ||
      !budgetDelta.compliance_status_matches;

    evidence.budget_reconciliation = {
      description:
        "Real budget (4 line items) + 3 real expenses created via the live, authenticated POST routes against a real E2E test application, then compared against the live GET /api/applications/[id]/reconcile route's own computed report.",
      documented_formula: {
        source_file: "src/app/api/applications/[id]/reconcile/route.ts",
        total_budget: "grant_budgets.total_budget if a budget row exists, else application.awarded_amount ?? requested_amount ?? 0",
        total_spent: "sum(grant_expenses.amount) for the application",
        variance: "total_budget - total_spent",
        compliance_status: "no_budget_set if no budget row, else under_budget (variance>0) / over_budget (variance<0) / on_budget (variance===0)",
      },
      input: {
        application_id: APPLICATION_ID,
        line_items: lineItems,
        expenses: expenseSeed,
        budget_created_via: "POST /api/applications/[id]/budget (total_requested omitted -> route defaults to sum of line_items)",
      },
      expected: {
        description: "Hand-summed independently in this script, plain arithmetic only, no shared code with the route.",
        total_budget: expectedTotalBudget,
        total_spent: expectedTotalSpent,
        variance: expectedVariance,
        compliance_status: expectedComplianceStatus,
      },
      actual: {
        description: "The real system's own computed reconciliation report, returned by the live GET /api/applications/[id]/reconcile route.",
        id: actualReport.id,
        total_budget: Number(actualReport.total_budget),
        total_spent: Number(actualReport.total_spent),
        variance: Number(actualReport.variance),
        compliance_status: actualReport.compliance_status,
        generated_at: actualReport.generated_at,
      },
      delta: budgetDelta,
      finding: budgetMismatch
        ? `MISMATCH: expected total_budget=${expectedTotalBudget}, total_spent=${expectedTotalSpent}, variance=${expectedVariance}, compliance_status=${expectedComplianceStatus} but the system's actual reconciliation report returned total_budget=${actualReport.total_budget}, total_spent=${actualReport.total_spent}, variance=${actualReport.variance}, compliance_status=${actualReport.compliance_status}.`
        : `No mismatch found: the system's reconciliation report exactly matches the hand-summed expected values (total_budget=${expectedTotalBudget}, total_spent=${expectedTotalSpent}, variance=${expectedVariance}, compliance_status=${expectedComplianceStatus}).`,
    };

    // =====================================================================
    // PART 2 — DEADLINE REMINDER-OFFSET MATH
    // =====================================================================
    const nowForSeeding = new Date();
    const today0 = startOfDay(nowForSeeding);

    // Five synthetic scenarios spanning distinct deadline_type enum values
    // and distinct boundary conditions in the threshold-crossing math.
    const scenarios = [
      {
        key: "none_crossed",
        deadline_type: "reporting_deadline",
        title: "PT-04-002 synthetic — none crossed (45 days out)",
        offsetDays: 45,
        preSetFlags: {},
      },
      {
        key: "single_threshold_exact_boundary",
        deadline_type: "renewal_date",
        title: "PT-04-002 synthetic — exact 30-day boundary",
        offsetDays: 30,
        preSetFlags: {},
      },
      {
        key: "two_thresholds_simultaneous",
        deadline_type: "follow_up_date",
        title: "PT-04-002 synthetic — 10 days out, 30d+14d cross at once",
        offsetDays: 10,
        preSetFlags: {},
      },
      {
        key: "due_today_all_fire",
        deadline_type: "document_expiration",
        title: "PT-04-002 synthetic — due today, all 5 thresholds fire",
        offsetDays: 0,
        preSetFlags: {},
      },
      {
        key: "overdue_partial_already_sent",
        deadline_type: "application_deadline",
        title: "PT-04-002 synthetic — overdue, 30d/14d already sent (must not re-fire)",
        offsetDays: -5,
        preSetFlags: { reminder_30d_sent: true, reminder_14d_sent: true },
      },
    ];

    const deadlineInputs = [];
    for (const s of scenarios) {
      const dueDateStr = toLocalDateString(addDays(today0, s.offsetDays));
      const insertRes = await pgClient.query(
        `INSERT INTO deadlines
           (organization_id, application_id, deadline_type, due_date, title, is_completed,
            reminder_30d_sent, reminder_14d_sent, reminder_7d_sent, reminder_3d_sent, reminder_1d_sent)
         VALUES ($1, $2, $3, $4, $5, false, $6, $7, $8, $9, $10)
         RETURNING id`,
        [
          ORG_ID,
          APPLICATION_ID,
          s.deadline_type,
          dueDateStr,
          s.title,
          s.preSetFlags.reminder_30d_sent === true,
          s.preSetFlags.reminder_14d_sent === true,
          s.preSetFlags.reminder_7d_sent === true,
          s.preSetFlags.reminder_3d_sent === true,
          s.preSetFlags.reminder_1d_sent === true,
        ],
      );
      const deadlineId = insertRes.rows[0].id;
      createdIds.deadlineIds.push(deadlineId);
      deadlineInputs.push({ ...s, id: deadlineId, due_date: dueDateStr });
    }

    // The E2E org's one pre-existing real deadline row -- the interactive
    // check route scans ALL of the caller's org's incomplete deadlines, so
    // this row is unavoidably included. Record its pre-check state and
    // include it in the expected computation rather than ignore it.
    const preExistingBefore = await pgClient.query(
      `SELECT id, title, due_date, deadline_type, is_completed,
              reminder_30d_sent, reminder_14d_sent, reminder_7d_sent, reminder_3d_sent, reminder_1d_sent
       FROM deadlines WHERE id = $1`,
      [PRE_EXISTING_DEADLINE_ID],
    );
    const preExistingRow = preExistingBefore.rows[0];
    if (!preExistingRow) {
      throw new Error(
        `Pre-existing E2E deadline ${PRE_EXISTING_DEADLINE_ID} not found -- fixture assumption broken, aborting.`,
      );
    }
    // due_date from `pg` comes back as a JS Date (node-pg's own `date` type
    // parser); format it back to a clean local YYYY-MM-DD to match exactly
    // what PostgREST (and therefore the real route) would hand back.
    const preExistingDueDateStr = toLocalDateString(new Date(preExistingRow.due_date));

    const today = new Date(); // the moment we're about to call the real check route
    const expectedByKey = {};
    for (const d of deadlineInputs) {
      const { daysUntil, fired } = expectedRemindersForRow(d.due_date, d.preSetFlags, today);
      expectedByKey[d.key] = { id: d.id, due_date: d.due_date, deadline_type: d.deadline_type, daysUntil, expectedFired: fired };
    }
    const preExistingExpected = expectedRemindersForRow(
      preExistingDueDateStr,
      {
        reminder_30d_sent: preExistingRow.reminder_30d_sent,
        reminder_14d_sent: preExistingRow.reminder_14d_sent,
        reminder_7d_sent: preExistingRow.reminder_7d_sent,
        reminder_3d_sent: preExistingRow.reminder_3d_sent,
        reminder_1d_sent: preExistingRow.reminder_1d_sent,
      },
      today,
    );

    // Real, authenticated, INTERACTIVE-mode call (no CRON_SECRET header) ->
    // scoped to this session's own org via the route's own session lookup.
    const checkRes = await apiFetch(cookieHeader, "GET", `/api/deadlines/check`);
    if (checkRes.status !== 200) {
      throw new Error(`GET deadlines/check failed: HTTP ${checkRes.status} :: ${checkRes.raw}`);
    }
    const actualTriggered = checkRes.json.triggered ?? [];
    const actualByDeadlineId = new Map(actualTriggered.map((t) => [t.deadlineId, t]));

    const perDeadlineResults = [];
    let anyMismatch = false;

    for (const d of deadlineInputs) {
      const exp = expectedByKey[d.key];
      const actual = actualByDeadlineId.get(d.id);
      const actualFired = actual ? [...actual.remindersSent].sort((a, b) => b - a) : [];
      const expectedFiredSorted = [...exp.expectedFired].sort((a, b) => b - a);
      const match =
        JSON.stringify(actualFired) === JSON.stringify(expectedFiredSorted) &&
        (actual ? actual.daysUntil === exp.daysUntil : exp.expectedFired.length === 0);
      if (!match) anyMismatch = true;
      perDeadlineResults.push({
        scenario: d.key,
        deadline_id: d.id,
        deadline_type: d.deadline_type,
        due_date: d.due_date,
        expected_days_until: exp.daysUntil,
        expected_reminders_fired: expectedFiredSorted,
        actual_days_until: actual ? actual.daysUntil : null,
        actual_reminders_fired: actualFired,
        actual_row_present_in_response: Boolean(actual),
        match,
      });
    }

    // Pre-existing row check.
    {
      const actual = actualByDeadlineId.get(PRE_EXISTING_DEADLINE_ID);
      const actualFired = actual ? [...actual.remindersSent].sort((a, b) => b - a) : [];
      const expectedFiredSorted = [...preExistingExpected.fired].sort((a, b) => b - a);
      const match =
        JSON.stringify(actualFired) === JSON.stringify(expectedFiredSorted) &&
        (actual ? actual.daysUntil === preExistingExpected.daysUntil : expectedFiredSorted.length === 0);
      if (!match) anyMismatch = true;
      perDeadlineResults.push({
        scenario: "pre_existing_real_deadline",
        deadline_id: PRE_EXISTING_DEADLINE_ID,
        deadline_type: preExistingRow.deadline_type,
        due_date: preExistingDueDateStr,
        expected_days_until: preExistingExpected.daysUntil,
        expected_reminders_fired: expectedFiredSorted,
        actual_days_until: actual ? actual.daysUntil : null,
        actual_reminders_fired: actualFired,
        actual_row_present_in_response: Boolean(actual),
        match,
      });
    }

    evidence.deadline_reminder_offset = {
      description:
        "Five real, freshly-seeded deadlines (distinct deadline_type values, distinct due-date offsets from today, one with reminder flags already partially set to exercise the never-re-fire rule) plus the E2E org's one pre-existing real deadline, all processed by the live, authenticated GET /api/deadlines/check route (interactive mode, org-scoped via session) in a single real run. Expected reminder sets independently hand-computed with date-fns's differenceInCalendarDays directly against the same documented thresholds, not by calling the route's own code.",
      documented_formula: {
        source_file: "src/app/api/deadlines/check/route.ts",
        thresholds_days: REMINDER_THRESHOLDS,
        daysUntil: "differenceInCalendarDays(due_date parsed as local midnight, today)",
        fires_when: "daysUntil <= threshold AND the corresponding reminder_{threshold}d_sent flag is not already true",
        idempotency: "reminder flags are one-way once set true; already-sent thresholds must never re-fire, per Contracts §11 (quoted directly in the route's own header comment)",
      },
      check_call: { mode: "interactive", endpoint: "GET /api/deadlines/check", deadlines_scanned_by_system: checkRes.json.deadlinesScanned, reminders_triggered_by_system: checkRes.json.remindersTriggered },
      per_deadline: perDeadlineResults,
      finding: anyMismatch
        ? "MISMATCH: at least one deadline's hand-computed expected set of newly-fired reminder thresholds does not match what the live /api/deadlines/check route actually returned. See per_deadline[].match=false entries for exact deltas."
        : `No mismatch found across all ${perDeadlineResults.length} deadline scenarios (5 synthetic + 1 pre-existing real row): every hand-computed expected reminder-offset set exactly matches what the live route returned.`,
    };

    evidence.overall_mismatch_found = budgetMismatch || anyMismatch;
  } finally {
    // -------------------------------------------------------------------
    // Cleanup — delete every row this run created, revert the pre-existing
    // deadline's flags to their original (false) state, and independently
    // re-confirm zero residue afterward.
    // -------------------------------------------------------------------
    const cleanup = { errors: [] };
    try {
      if (createdIds.budgetId) {
        await pgClient.query(`DELETE FROM grant_reconciliation_reports WHERE application_id = $1`, [APPLICATION_ID]);
        await pgClient.query(`DELETE FROM grant_expenses WHERE application_id = $1`, [APPLICATION_ID]);
        await pgClient.query(`DELETE FROM grant_budgets WHERE application_id = $1`, [APPLICATION_ID]);
      }
    } catch (err) {
      cleanup.errors.push(`budget/expense/reconciliation cleanup: ${err.message}`);
    }
    try {
      if (createdIds.deadlineIds.length > 0) {
        await pgClient.query(`DELETE FROM deadlines WHERE id = ANY($1::uuid[])`, [createdIds.deadlineIds]);
      }
    } catch (err) {
      cleanup.errors.push(`synthetic deadlines cleanup: ${err.message}`);
    }
    try {
      await pgClient.query(
        `UPDATE deadlines
           SET reminder_30d_sent = false, reminder_14d_sent = false, reminder_7d_sent = false,
               reminder_3d_sent = false, reminder_1d_sent = false
         WHERE id = $1`,
        [PRE_EXISTING_DEADLINE_ID],
      );
    } catch (err) {
      cleanup.errors.push(`pre-existing deadline flag revert: ${err.message}`);
    }

    const residueBudget = await pgClient.query(`SELECT count(*)::int AS c FROM grant_budgets WHERE application_id = $1`, [APPLICATION_ID]);
    const residueExpenses = await pgClient.query(`SELECT count(*)::int AS c FROM grant_expenses WHERE application_id = $1`, [APPLICATION_ID]);
    const residueRecon = await pgClient.query(`SELECT count(*)::int AS c FROM grant_reconciliation_reports WHERE application_id = $1`, [APPLICATION_ID]);
    const residueDeadlines = createdIds.deadlineIds.length
      ? await pgClient.query(`SELECT count(*)::int AS c FROM deadlines WHERE id = ANY($1::uuid[])`, [createdIds.deadlineIds])
      : { rows: [{ c: 0 }] };
    const preExistingAfter = await pgClient.query(
      `SELECT reminder_30d_sent, reminder_14d_sent, reminder_7d_sent, reminder_3d_sent, reminder_1d_sent
       FROM deadlines WHERE id = $1`,
      [PRE_EXISTING_DEADLINE_ID],
    );

    cleanup.residue_check = {
      grant_budgets_remaining: residueBudget.rows[0].c,
      grant_expenses_remaining: residueExpenses.rows[0].c,
      grant_reconciliation_reports_remaining: residueRecon.rows[0].c,
      synthetic_deadlines_remaining: residueDeadlines.rows[0].c,
      pre_existing_deadline_flags_reverted:
        preExistingAfter.rows[0] &&
        Object.values(preExistingAfter.rows[0]).every((v) => v === false),
    };
    evidence.cleanup = cleanup;

    const outDir = path.join(process.cwd(), "test-evidence", "pt-04");
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, "budget-deadline.json");
    fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2), "utf8");
    console.log(`Wrote ${outPath}`);

    if (evidence.budget_reconciliation) {
      console.log(`Budget check: ${evidence.budget_reconciliation.finding}`);
    }
    if (evidence.deadline_reminder_offset) {
      console.log(`Deadline check: ${evidence.deadline_reminder_offset.finding}`);
    }
    console.log("Cleanup:", JSON.stringify(cleanup, null, 2));

    await pgClient.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
