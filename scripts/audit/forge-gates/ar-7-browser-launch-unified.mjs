#!/usr/bin/env node
// FORGE gate - AR-7.1: every Chromium launch must resolve a real executable.
//
// Production evidence 2026-09-17: five agents (ea01, ea02, ea05, ea08, ea09)
// have 215 combined failures, all with the identical error
//   browserType.launch: Executable doesn't exist at
//   /root/.cache/ms-playwright/chromium_headless_shell-1223/...
// worker/Dockerfile installs system chromium and sets
// PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1, so Playwright's own cache is empty.
// stealth-browser.ts already passes executablePath - but it is 1 of 6 launch
// sites. The other five inherit the broken default. This gate requires every
// site to go through one shared helper so the fix cannot be forgotten again.
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const fail = (m) => { console.error("FAIL: " + m); process.exit(1); };

// 1. The shared helper must exist.
const HELPER = "src/lib/browser/launch-chromium.ts";
let helper;
try { helper = readFileSync(HELPER, "utf8"); }
catch { fail(`${HELPER} not found - every launch site must route through one shared helper`); }
if (!/executablePath/.test(helper))
  fail(`${HELPER} never sets executablePath - it cannot fix what it was written to fix`);
if (!/CHROMIUM_EXECUTABLE_PATH|PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH|\/usr\/bin\/chromium/.test(helper))
  fail(`${HELPER} resolves no chromium path from env or a known location`);

// 2. No direct chromium.launch anywhere outside the helper.
let hits = "";
try {
  hits = execSync(
    `grep -rn --include=*.ts --exclude-dir=node_modules --exclude-dir=dist ` +
    `-E "chromium\\.launch\\(" src worker || true`,
    { encoding: "utf8" });
} catch (e) { hits = e.stdout ?? ""; }

const offenders = hits.split("\n").filter(Boolean)
  .filter((l) => !l.startsWith(HELPER))
  .filter((l) => !/__tests__|\.test\.ts|\.spec\.ts/.test(l));

if (offenders.length)
  fail(`${offenders.length} direct chromium.launch() call(s) bypass ${HELPER}:\n       ` +
       offenders.map((o) => o.split(":").slice(0, 2).join(":")).join("\n       "));

// 3. A regression test must exist for the helper.
const TEST = "src/__tests__/unit/launch-chromium.test.ts";
try { readFileSync(TEST, "utf8"); }
catch { fail(`${TEST} not found - the helper needs a guard against silent regression`); }

console.log("OK: all Chromium launches route through src/lib/browser/launch-chromium.ts with a resolved executablePath");
