#!/usr/bin/env node
// FORGE gate - AR-8.1: the CI build must not require a secret CI does not have.
//
// Root cause, confirmed 2026-09-17: .github/workflows/deploy-check.yml supplies
// 2 env vars; .env.local has 17. createAdminClient() throws hard without
// SUPABASE_SERVICE_ROLE_KEY, and 76 of 83 files under src/app/ that call it had
// no `export const dynamic` opt-out, so `next build` evaluated them. Every push
// since 2026-08-07 emailed a failure. The workflow's own history shows the same
// class fixed once for the ANON client and never checked for the ADMIN client.
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const fail = (m) => { console.error("FAIL: " + m); process.exit(1); };
const WF = ".github/workflows/deploy-check.yml";
if (!existsSync(WF)) fail(`${WF} not found`);
const wf = readFileSync(WF, "utf8");

// 1. The real service-role key must NOT be wired into CI. It bypasses every RLS
//    policy in the platform; a build secret is the wrong place for it.
if (/SUPABASE_SERVICE_ROLE_KEY:\s*\$\{\{\s*secrets\.SUPABASE_SERVICE_ROLE_KEY/.test(wf))
  fail("deploy-check.yml injects the REAL SUPABASE_SERVICE_ROLE_KEY secret - that key bypasses all RLS and must not live in CI");

// 2. But the build must still have *a* value so createAdminClient() cannot throw.
if (!/SUPABASE_SERVICE_ROLE_KEY/.test(wf))
  fail("deploy-check.yml provides no SUPABASE_SERVICE_ROLE_KEY at all - createAdminClient() throws and the build exits 1");

// 3. Routes using the admin client must opt out of static evaluation.
//    Walk the tree in pure Node - shelling out to `grep ... || true` is a POSIX
//    idiom and this gate also runs under cmd.exe on Windows, where both `grep`
//    and `|| true` are unrecognized and the gate reported a phantom "no files".
const APP_ROOT = join(process.cwd(), "src", "app");
if (!existsSync(APP_ROOT)) fail(`${APP_ROOT} not found - run this gate from the repo root`);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const rel = (f) => f.replace(process.cwd(), "").replace(/^[\\/]/, "").replace(/\\/g, "/");
const files = walk(APP_ROOT)
  .filter((f) => /createAdminClient/.test(readFileSync(f, "utf8")))
  .map(rel);
if (!files.length) fail("no src/app file calls createAdminClient - unexpected; check the walk");
// Same anchored pattern the standing guard uses, so the two cannot disagree.
const missing = files.filter((f) => !/^export const dynamic\s*=/m.test(readFileSync(f, "utf8")));
if (missing.length)
  fail(`${missing.length} of ${files.length} src/app files call createAdminClient with no 'export const dynamic' - next build will evaluate them:\n       ` +
       missing.slice(0, 6).join("\n       ") + (missing.length > 6 ? `\n       ...and ${missing.length - 6} more` : ""));

// 4. A standing guard so this cannot silently return.
const GUARD = "scripts/audit/assert-admin-routes-dynamic.mjs";
if (!existsSync(GUARD)) fail(`${GUARD} not found - without a repo-side guard the next new route reintroduces this`);

console.log(`OK: ${files.length}/${files.length} admin-client routes are dynamic, CI has a non-secret service-role placeholder, guard script present`);
