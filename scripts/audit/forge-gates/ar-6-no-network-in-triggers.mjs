#!/usr/bin/env node
// FORGE gate - AR-6.4: a Postgres trigger on this project CANNOT reach Slack.
// Verified 2026-09-17 against the live project: pg_net (0.20.3), http (1.6) and
// pg_cron (1.6.4) are all AVAILABLE BUT NOT INSTALLED. A trigger that attempts
// an outbound HTTP call will error at runtime inside the transaction that
// raised the alert - losing the alert it was trying to deliver. Slack delivery
// therefore belongs in the already-running Railway worker, polling the alerts
// table, not in SQL.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const MIG = "supabase/migrations";
const fail = (m) => { console.error("FAIL: " + m); process.exit(1); };

let files;
try { files = readdirSync(MIG).filter((f) => f.endsWith(".sql")); }
catch { fail(`cannot read ${MIG}`); }
const num = (f) => { const m = /^(\d+)/.exec(f); return m ? Number(m[1]) : -1; };
const newMigs = files.filter((f) => num(f) >= 185);
if (newMigs.length === 0) fail("no migration numbered 185 or higher - AR-6 wrote no schema change");
const newSql = newMigs.map((f) => readFileSync(join(MIG, f), "utf8")).join("\n").toLowerCase();

// 1. Do not install network extensions as a side effect of an alerting build.
const ext = /create\s+extension[^;]*(pg_net|pg_cron|\bhttp\b)/.exec(newSql);
if (ext) fail(`migration installs the ${ext[1]} extension - not approved for this phase; Slack delivery goes through the worker`);

// 2. No outbound HTTP from SQL.
const netCall = /(net\.http_post|net\.http_get|http_post\s*\(|perform\s+net\.)/.exec(newSql);
if (netCall) fail(`migration makes an HTTP call from SQL (${netCall[1].trim()}) - pg_net is not installed on this project`);

// 3. alerts must carry delivery state so the poller is idempotent.
if (!/alter\s+table\s+(public\.)?alerts[\s\S]{0,400}?notified_at/.test(newSql))
  fail("no migration >=185 adds alerts.notified_at - the Slack poller cannot tell delivered from undelivered");

// 4. The delivery path must exist in the worker.
const candidates = ["worker/alert-notifier.ts", "worker/slack-notifier.ts", "worker/alert-dispatch.ts"];
const found = candidates.filter((p) => existsSync(p));
if (found.length === 0)
  fail(`no worker-side Slack delivery module found (looked for: ${candidates.join(", ")})`);
const src = found.map((p) => readFileSync(p, "utf8")).join("\n");
if (!/FORGE_SLACK_WEBHOOK|SLACK_WEBHOOK_URL/.test(src))
  fail(`${found[0]} does not read a Slack webhook env var - reuse FORGE_SLACK_WEBHOOK, do not provision a second`);
if (!/notified_at/.test(src))
  fail(`${found[0]} does not set notified_at - every poll would re-send every critical alert`);
// A webhook URL must never be hard-coded.
if (/https:\/\/hooks\.slack\.com\//.test(src))
  fail(`${found[0]} hard-codes a Slack webhook URL - read it from the environment, never commit it`);

console.log(`OK: no network calls from SQL, no new extensions, delivery in ${found[0]} with notified_at idempotency and env-sourced webhook`);
