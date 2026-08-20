// ============================================================================
// PT-15-002 — env-var parity reconciliation across local / Vercel production /
// Railway production
//
// PT-00-004 (test-evidence/pt-00/env-audit.json) audited env-var references
// against local .env.local ONLY, and its own text says so explicitly:
// "production (Vercel/Railway) env vars were not checked by this audit."
// That gap produced two open register rows -- WGR-002 (VERCEL_TOKEN /
// VERCEL_PROJECT_ID absence, blocks the automated deploy-drift gate) and
// WGR-003 (13 other production-required vars, local-absence only, production
// state "unconfirmed either way" for most of them) -- plus two partial,
// hearsay-grade updates already logged against WGR-003: CRON_SECRET "per
// Reid, not independently re-verified", and SUPABASE_URL confirmed only
// indirectly (a successful worker boot implies validateEnv() passed, which
// implies the var was truthy, but nobody had actually looked at the variable
// store itself).
//
// This script closes that gap directly: it authenticates against the real
// Vercel and Railway CLIs (both already logged in via a persisted CLI
// session in this environment -- `vercel whoami` / `railway whoami`, no
// token typed anywhere in this script) and reads back the actual variable
// NAME list configured in each platform's Production environment. Names and
// presence only -- no secret value is ever read, printed, or written to any
// file this script produces. Raw CLI output (also name/presence-only; the
// Vercel CLI already redacts values to the literal string "Encrypted") is
// captured alongside this JSON under test-evidence/pt-15/*-raw.txt for
// independent verification.
//
// The presence sets below (VERCEL_PROD_VARS / RAILWAY_PROD_VARS /
// LOCAL_ENV_VARS) were captured live this session via:
//   vercel env ls production                                   (Vercel)
//   railway variables --service benavora-worker --environment production --kv  (Railway)
//   grep -E "^[A-Za-z][A-Za-z0-9 _]*=" .env.local                (local)
// and are reproduced verbatim (names only) from
// test-evidence/pt-15/vercel-env-ls-production-raw.txt and
// test-evidence/pt-15/railway-variables-kv-raw.txt. Re-run those two CLI
// commands directly (both projects are already linked -- see
// .vercel/project.json and `railway status`) to regenerate this file if the
// live state may have changed since.
//
// Usage: node scripts/audit/pt15-002-env-parity.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";

const OUT_DIR = path.join("test-evidence", "pt-15");
const OUT_FILE = path.join(OUT_DIR, "env-parity.json");
const PT00_AUDIT = path.join("test-evidence", "pt-00", "env-audit.json");

// --- Live-captured presence sets (names only), 2026-08-20 -----------------

const VERCEL_PROD_VARS = new Set([
  "ANTHROPIC_API_KEY",
  "GOOGLE_PLACES_API_KEY",
  "CRON_SECRET",
  "UNSUBSCRIBE_HMAC_SECRET",
  "INTEGRATION_ENCRYPTION_KEY",
  "PORTAL_ENCRYPT_SECRET",
  "INTEGRATION_KEY_SECRET",
  "OPENAI_API_KEY",
  "SAM_GOV_API_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
]);

const RAILWAY_PROD_VARS = new Set([
  "ANTHROPIC_API_KEY",
  "CRON_SECRET",
  "GOOGLE_PLACES_API_KEY",
  "INTEGRATION_ENCRYPTION_KEY",
  "INTEGRATION_KEY_SECRET",
  "NODE_ENV",
  "PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH",
  "PORTAL_ENCRYPT_SECRET",
  "RAILWAY_ENVIRONMENT",
  "RAILWAY_ENVIRONMENT_ID",
  "RAILWAY_ENVIRONMENT_NAME",
  "RAILWAY_PRIVATE_DOMAIN",
  "RAILWAY_PROJECT_ID",
  "RAILWAY_PROJECT_NAME",
  "RAILWAY_SERVICE_ID",
  "RAILWAY_SERVICE_NAME",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_URL",
  "UNSUBSCRIBE_HMAC_SECRET",
  "WORKER_ID",
]);

// Local .env.local: real var names present, deduped. Note the two malformed
// "STRIPE PUBLISHABLE KEY=" / "STRIPE SECRET KEY=" lines (space, not
// underscore) are NOT valid identifiers -- dotenv will not parse them as
// STRIPE_SECRET_KEY / STRIPE_PUBLISHABLE_KEY, so they do not count as that
// var being present. Recorded separately as a distinct finding below.
const LOCAL_ENV_VARS = new Set([
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "DATABASE_URL",
  "ANTHROPIC_API_KEY",
  "SAM_GOV_API_KEY",
  "OPENAI_API_KEY",
  "GOOGLE_PLACES_API_KEY",
  "FAITH_FOUNDATION_ORG_ID",
]);

const LOCAL_MALFORMED_LINES = ["STRIPE PUBLISHABLE KEY", "STRIPE SECRET KEY"];

// --- Per-var platform relevance, hand-verified this session via grep ------
// against worker/*.ts (source), worker/dist/**/*.js (actual compiled worker
// bundle -- the most direct evidence of what code genuinely executes inside
// the Railway container, since railway.json builds worker/Dockerfile from a
// watchPatterns-scoped slice of src/ + worker/), and src/+scripts/ (the
// Next.js app / dev-tooling side). "worker" here always means: a real
// import chain exists from a worker/*.ts processor entry point (queue-
// processor.ts, dd-request-processor.ts, knowledge-indexer-processor.ts,
// autonomous-orchestrator.ts, etc.) down to the file that reads
// process.env.<VAR> -- not merely "the file happens to be present in
// worker/dist" (several files are bundled but never actually called, e.g.
// src/lib/supabase/client.ts / server.ts, which are cookie-based and
// couldn't function in a worker context regardless of env vars).
const RELEVANCE = {
  ANTHROPIC_API_KEY: { app: true, worker: true, tooling: false },
  CREDENTIAL_ENCRYPTION_KEY: { app: true, worker: true, tooling: false },
  CRON_SECRET: { app: true, worker: false, tooling: false },
  DATABASE_URL: { app: false, worker: false, tooling: true },
  GOOGLE_PLACES_API_KEY: { app: true, worker: true, tooling: false },
  INTEGRATION_ENCRYPTION_KEY: { app: true, worker: false, tooling: false },
  INTEGRATION_KEY_SECRET: { app: true, worker: true, tooling: false },
  NEXT_PUBLIC_SUPABASE_ANON_KEY: { app: true, worker: false, tooling: false },
  NEXT_PUBLIC_SUPABASE_URL: { app: true, worker: true, tooling: false },
  OPENAI_API_KEY: { app: true, worker: true, tooling: false },
  PORTAL_ENCRYPT_SECRET: { app: true, worker: false, tooling: false },
  RESEND_API_KEY: { app: true, worker: true, tooling: false },
  RESEND_WEBHOOK_SECRET: { app: true, worker: false, tooling: false },
  SAM_GOV_API_KEY: { app: true, worker: true, tooling: false },
  SCRAPER_API_KEY: { app: false, worker: true, tooling: false },
  STRIPE_SECRET_KEY: { app: true, worker: false, tooling: false },
  STRIPE_WEBHOOK_SECRET: { app: true, worker: false, tooling: false },
  SUPABASE_SERVICE_ROLE_KEY: { app: true, worker: true, tooling: false },
  SUPABASE_URL: { app: false, worker: true, tooling: false },
  UNSUBSCRIBE_HMAC_SECRET: { app: true, worker: false, tooling: false },
  VERCEL_PROJECT_ID: { app: false, worker: false, tooling: true },
  VERCEL_TOKEN: { app: false, worker: false, tooling: true },
  WORKER_ID: { app: false, worker: true, tooling: false },
};

// Hand-authored notes per var: what the presence/absence pattern actually
// means, given the relevance map above. Written from the live evidence
// gathered this session, not restated from PT-00/WGR text.
const NOTES = {
  ANTHROPIC_API_KEY:
    "Present in all three environments where it's needed (app + worker). No gap.",
  CREDENTIAL_ENCRYPTION_KEY:
    "CONFIRMED ABSENT from local, Vercel production, AND Railway production. This is a real, live production gap, not just a local one -- src/lib/autoapply/credential-manager.ts (imported by worker/queue-processor.ts, the live AutoApply submission pipeline) and src/lib/email/encryption.ts both `throw()` immediately if this is unset. Any AutoApply flow that needs to decrypt a stored portal credential will throw in production right now. Upgrades WGR-003's 'unconfirmed either way' status for this var to CONFIRMED-BROKEN in production, not just locally.",
  CRON_SECRET:
    "Independently confirmed PRESENT in Vercel production via a live, authenticated `vercel env ls production` call this session (not 'per Reid' hearsay, which is how WGR-003's prior update was sourced). Settles WGR-003's CRON_SECRET question with first-hand evidence. Local absence is real but does not affect production, since the var's only consumer (16 /api/cron/* route handlers, deployed on Vercel) has it. This finding is about the ENV VAR's presence only -- it does NOT resolve or contradict WGR-111's separate, still-open finding that src/middleware.ts's PUBLIC_PATHS allowlist redirects cron/webhook callers to /login (307) before the route handler's own CRON_SECRET check ever runs. Whether cron/webhook requests actually reach the code that reads this var in production is WGR-111's question, not this one; not attempted here.",
  DATABASE_URL:
    "Not an app or worker runtime var -- only referenced by scripts/check-migration-idempotency.ts, a local dev-tooling script. Present locally (where it's actually needed); 'presence in Vercel/Railway production' is not a meaningful question for this var (it is never deployed as an app env var, by design). No gap for this var's real purpose.",
  GOOGLE_PLACES_API_KEY:
    "Present in all three environments where it's needed (app + worker). No gap.",
  INTEGRATION_ENCRYPTION_KEY:
    "Present in both Vercel and Railway production, confirmed live this session. Absent locally only -- a local-dev-only gap (matches the encryption-fallback-removal precedent: local dev simply can't exercise Google-integration-token encryption without it, production is unaffected).",
  INTEGRATION_KEY_SECRET:
    "Present in both Vercel and Railway production, confirmed live this session. Absent locally only -- same local-dev-only pattern as INTEGRATION_ENCRYPTION_KEY.",
  NEXT_PUBLIC_SUPABASE_ANON_KEY:
    "Present locally and in Vercel production (where the Next.js app actually needs it, inlined into the client bundle at build time). Absent from Railway, but confirmed NOT a functional gap: the only worker-bundled files that reference this var (src/lib/supabase/client.ts, server.ts) are cookie/session-based Next.js request-scoped clients with no real worker-reachable call site (grepped every worker-relevant source directory -- src/lib/autoapply, src/lib/donor-discovery, src/lib/supabase, src/lib/enrichment/web-extractor.ts, src/lib/env.ts, worker/*.ts -- zero imports of client.ts or server.ts). They're bundled only because railway.json's watchPatterns includes the whole src/lib/supabase/** directory, not because they execute. Contrast with NEXT_PUBLIC_SUPABASE_URL below, which IS genuinely called from worker-reachable code.",
  NEXT_PUBLIC_SUPABASE_URL:
    "CONFIRMED ABSENT from Railway production -- and this is a real, live gap, not a benign bundling artifact. src/lib/supabase/admin.ts's createAdminClient() requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (throws 'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' if either is unset), and is called directly by src/lib/donor-discovery/adapters/{geocoding,google-places,google-places-adapter,propublica}.ts + agents/enrichment-agent.ts + connectors/usage-log.ts (all confirmed worker-reachable via worker/dd-request-processor.ts) AND by src/lib/scraper/foundation-scraper.ts (confirmed worker-reachable via worker/autonomous-orchestrator.ts's 'foundation-990-enrichment' queue case, i.e. the AG-42 chain target). This is the exact error string ('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY') already documented in STATE_OF_THE_BUILD.md as a live-reproduced AG-42 downstream failure, previously attributed only to enrichSingleFoundation() calling createAdminClient() 'independently instead of reusing the caller's supabase client, reading the wrong env var names.' This env-parity check confirms the concrete production root cause: it's not just a code-style issue, the var this code path needs genuinely is not set in Railway. SUPABASE_SERVICE_ROLE_KEY (the other half of the same check) IS present in Railway, so this specific var is the actual missing piece.",
  OPENAI_API_KEY:
    "CONFIRMED ABSENT from Railway production. Real, confirmed worker-execution-path gap: src/lib/intelligence/embeddings.ts's generateEmbeddingsBatch() is imported directly by src/lib/agents/knowledge-indexer-agent.ts, which worker/knowledge-indexer-processor.ts instantiates and runs continuously (wired into worker/index.ts's boot sequence per STATE_OF_THE_BUILD.md's AG-29 sessions, confirmed genuinely running in production via real 'autonomous'-triggered agent_runs). This plausibly explains the 'AG-29 cold-start anomaly' documented in STATE_OF_THE_BUILD.md (5 real autonomous embedding runs failed before a 6th 'manual' run succeeded) -- if that manual run was executed locally (where OPENAI_API_KEY IS present) rather than through the actual Railway worker, a missing key in Railway would produce exactly that pattern (every autonomous/Railway-originated attempt fails, any locally-run attempt succeeds), which is a materially different and more mundane explanation than the network-race hypothesis that session's own investigation landed on for lack of persisted error text. Flagged as a plausible, well-corroborated candidate root cause, not proven outright -- the original investigation could not capture the real OpenAI error text (by design, per that session's own finding), so this cannot be confirmed beyond 'the key really is absent from the environment where those failures occurred.'",
  PORTAL_ENCRYPT_SECRET:
    "Present in both Vercel and Railway production, confirmed live this session. Absent locally only -- same local-dev-only pattern as INTEGRATION_ENCRYPTION_KEY/INTEGRATION_KEY_SECRET.",
  RESEND_API_KEY:
    "CONFIRMED ABSENT from local, Vercel production, AND Railway production. Real, confirmed gap across all 13 files that send email (transactional, digest, sequence, AutoApply confirmation) in both the app and the worker (src/lib/autoapply/digest-email.ts, email-submitter.ts are worker-bundled and confirmed reference this var). Every Resend send call will fail in production today.",
  RESEND_WEBHOOK_SECRET:
    "CONFIRMED ABSENT from Vercel production (the only platform that needs it -- the 3 webhook receiver routes are Next.js API routes, not worker code; confirmed zero worker-dist references). This directly contradicts a prior memory/session claim ('Resend webhook now verifies signatures -- fails closed... set in Vercel prod') -- that claim does not hold as of this session's live check. Per that same prior work's own documented fail-closed design, the webhook receivers should be 500ing on every real Resend delivery/reply event right now, not silently accepting unverified payloads -- a real availability gap, not a security hole (fails closed, not open), but still a genuine production defect.",
  SAM_GOV_API_KEY:
    "CONFIRMED ABSENT from Railway production. Real, confirmed worker-execution-path gap: src/lib/donor-discovery/adapters/samgov-adapter.ts, src/lib/sources/{land-bank-client,samgov-client}.ts are all worker-bundled and worker-reachable (via worker/dd-request-processor.ts's donor-discovery import chain). SAM.gov-sourced donor-discovery/land-bank lookups triggered from the worker will fail in production; present in Vercel, so the same code paths work fine when invoked from the Next.js app side (API routes).",
  SCRAPER_API_KEY:
    "CONFIRMED ABSENT from local, Vercel production, AND Railway production. Real, confirmed gap, but a degraded-not-broken one by the code's own design: src/lib/scraper/stealth-engine.ts (confirmed worker-bundled, used by the weekly foundation/nonprofit enrichment scraper jobs) falls back to direct-IP scraping with no proxy when this is unset, rather than throwing -- so Directive 1's scraper jobs still run, just without IP rotation. Matches WGR-003's prior framing exactly, now confirmed true in production as well as locally.",
  STRIPE_SECRET_KEY:
    "CONFIRMED ABSENT from Vercel production (the only platform that needs it -- src/lib/payments/stripe.ts, zero worker-dist references). Locally, the closest thing on file is a malformed line, 'STRIPE SECRET KEY=' (space instead of underscore) in .env.local -- not a valid identifier, dotenv will not parse it as STRIPE_SECRET_KEY, so this does not count as 'present locally' either. Billing/payments has no working Stripe secret key anywhere in this project as of this session.",
  STRIPE_WEBHOOK_SECRET:
    "CONFIRMED ABSENT from Vercel production and, like STRIPE_SECRET_KEY, has no valid local equivalent (same malformed-line finding, 'STRIPE PUBLISHABLE KEY=' / 'STRIPE SECRET KEY=' are the only Stripe-shaped lines in .env.local and neither is this var). Stripe webhook signature verification cannot function in production.",
  SUPABASE_SERVICE_ROLE_KEY:
    "Present in all three environments where it's needed (app + worker). No gap.",
  SUPABASE_URL:
    "CONFIRMED PRESENT in Railway production via a direct, first-hand read of the variable name in `railway variables --kv` output this session -- a stronger, more direct confirmation than PT-08's prior evidence, which only inferred presence indirectly from a successful worker boot log (validateEnv() passing implies truthiness, but doesn't show the variable itself). Corroborates and upgrades that PT-08 finding. Settles WGR-003's SUPABASE_URL question for good: the worker (the only consumer, via worker/index.ts's validateEnv()) genuinely has it. Local absence remains real but doesn't matter for production; most local scripts that need it already fall back to NEXT_PUBLIC_SUPABASE_URL (process.env['SUPABASE_URL'] ?? process.env['NEXT_PUBLIC_SUPABASE_URL']), which IS present locally.",
  UNSUBSCRIBE_HMAC_SECRET:
    "Present in both Vercel and Railway production, confirmed live this session (Railway's presence is extraneous -- confirmed zero worker-dist references to this var -- but harmless). Absent locally only.",
  VERCEL_PROJECT_ID:
    "Still absent everywhere this script could check, including the one place it actually needs to exist (wherever scripts/verify-deployment.ts is run -- locally today). Genuinely partial progress on WGR-002 though: the VALUE this var needs is already sitting in .vercel/project.json (`projectId: 'prj_7pn7UmQQsiEjTIHH58cfUU84p6xc'`, confirmed present in this repo's working tree) -- setting VERCEL_PROJECT_ID in .env.local is a one-line copy, not a lookup task, once VERCEL_TOKEN (a real personal access token, not recoverable from anything already on disk) is obtained.",
  VERCEL_TOKEN:
    "Still absent everywhere this script could check -- local, and (correctly, by design) not something that would ever be a Vercel/Railway deployed env var, since it's a credential used to call Vercel's own API about deployment state, not something the deployed app needs at runtime. WGR-002 remains open for scripts/verify-deployment.ts's intended (Vercel-REST-API-based) verification path. Distinct, working alternative path confirmed available this session though: the `vercel` CLI itself is authenticated via a persisted session (`vercel whoami` -> 'reid-9664', no token needed) and can read deployment/env state directly (as this very script's data was gathered) -- the script's own header comment already explains why it deliberately avoids the CLI (a documented hang-after-finish quirk, interactive-login requirement) in favor of the REST API + token approach, so this is noted as an available manual fallback, not a fix to the automated gate.",
  WORKER_ID:
    "CONFIRMED PRESENT in Railway production via a direct read of the variable name this session -- corroborates PT-08's prior indirect (boot-log) confirmation with first-hand evidence. Not applicable to Vercel (worker-only var, Next.js app never reads it).",
};

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const pt00 = JSON.parse(fs.readFileSync(PT00_AUDIT, "utf8"));
  const requiredVars = pt00.vars.filter((v) => v.production_required === true);

  const vars = requiredVars.map((v) => {
    const name = v.var;
    const rel = RELEVANCE[name] ?? { app: true, worker: false, tooling: false };
    const localPresent = LOCAL_ENV_VARS.has(name);
    const vercelPresent = rel.tooling ? null : VERCEL_PROD_VARS.has(name);
    const railwayPresent = rel.tooling ? null : RAILWAY_PROD_VARS.has(name);

    // A var only counts as a genuine "gap" in an environment where it's
    // actually relevant. tooling-only vars are judged solely on local
    // presence (the only place they're meant to exist).
    let gapEnvironments = [];
    if (!localPresent) gapEnvironments.push("local");
    if (rel.app && vercelPresent === false) gapEnvironments.push("vercel_production");
    if (rel.worker && railwayPresent === false) gapEnvironments.push("railway_production");

    const fullyResolved = gapEnvironments.length === 0;

    return {
      var: name,
      relevant_to: {
        app_vercel: rel.app,
        worker_railway: rel.worker,
        tooling_only: rel.tooling,
      },
      local_present: localPresent,
      vercel_production_present: vercelPresent,
      railway_production_present: railwayPresent,
      status: fullyResolved ? "ok_all_relevant_environments" : "gap_confirmed",
      gap_environments: gapEnvironments,
      note: NOTES[name] ?? "",
    };
  });

  const confirmedGaps = vars.filter((v) => v.status === "gap_confirmed");
  const WGR003_ORIGINAL_13 = new Set([
    "CREDENTIAL_ENCRYPTION_KEY",
    "CRON_SECRET",
    "INTEGRATION_ENCRYPTION_KEY",
    "INTEGRATION_KEY_SECRET",
    "PORTAL_ENCRYPT_SECRET",
    "RESEND_API_KEY",
    "RESEND_WEBHOOK_SECRET",
    "SCRAPER_API_KEY",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "SUPABASE_URL",
    "UNSUBSCRIBE_HMAC_SECRET",
    "WORKER_ID",
  ]);
  // "New" here means: this var was NOT one of WGR-003's original 13 (PT-00
  // marked it "ok" since it's present locally), but this session's app-vs-
  // worker relevance mapping found it has a real production gap anyway --
  // a genuinely new finding, not a re-confirmation of an already-known one.
  const newVarsBeyondWgr003Scope = confirmedGaps.filter(
    (v) =>
      !WGR003_ORIGINAL_13.has(v.var) &&
      ((v.relevant_to.app_vercel && v.vercel_production_present === false) ||
        (v.relevant_to.worker_railway && v.railway_production_present === false)),
  );

  const output = {
    audit: "PT-15-002 env-var parity reconciliation across local / Vercel production / Railway production",
    generated_context:
      "Closes the local-only-verification gap PT-00-004's own text flags, and independently re-verifies (rather than trusting hearsay for) the two WGR-003 updates already on file for CRON_SECRET ('per Reid, not independently re-verified') and SUPABASE_URL (inferred only from a worker boot log, never a direct variable-store read).",
    method:
      "Live, authenticated CLI reads against both deployment platforms this session: `vercel env ls production` (Vercel CLI, session-authenticated as 'reid-9664', project already linked via .vercel/project.json) and `railway variables --service benavora-worker --environment production --kv` (Railway CLI, session-authenticated as 'reid@repvg.com', project linked via `railway status`). Names/presence only -- no secret value was ever read, printed, or written to this file or any evidence file it references. Cross-referenced against test-evidence/pt-00/env-audit.json's 23 production_required vars, and against a fresh source-code grep (worker/*.ts source + worker/dist/**/*.js compiled bundle, matched against real import chains from worker/index.ts's processor entry points) to determine which platform(s) each var is actually relevant to -- several vars PT-00 marked production_required without distinguishing app-vs-worker relevance turned out to need that distinction to interpret correctly (e.g. NEXT_PUBLIC_SUPABASE_URL, OPENAI_API_KEY, SAM_GOV_API_KEY are all genuinely worker-relevant despite being introduced to the codebase as Next.js/app-side vars).",
    raw_evidence_files: [
      "test-evidence/pt-15/vercel-whoami-raw.txt",
      "test-evidence/pt-15/vercel-env-ls-production-raw.txt",
      "test-evidence/pt-15/railway-whoami-raw.txt",
      "test-evidence/pt-15/railway-status-raw.txt",
      "test-evidence/pt-15/railway-variables-kv-raw.txt",
      "test-evidence/pt-15/local-env-names-raw.txt",
    ],
    environments_checked: {
      local: {
        method: "grep -E \"^[A-Za-z][A-Za-z0-9 _]*=\" .env.local (names only, values never read into this script)",
        var_count: LOCAL_ENV_VARS.size,
        additional_finding:
          "Two malformed lines exist in .env.local -- 'STRIPE PUBLISHABLE KEY=' and 'STRIPE SECRET KEY=' (space instead of underscore). These are not valid env-var identifiers; dotenv will not parse them as STRIPE_PUBLISHABLE_KEY / STRIPE_SECRET_KEY. Recorded here so a future session doesn't assume Stripe is configured locally just because *a* Stripe-shaped line exists.",
        malformed_lines: LOCAL_MALFORMED_LINES,
      },
      vercel_production: {
        method: "vercel env ls production",
        authenticated_as: "reid-9664 (confirmed via `vercel whoami`)",
        project: "benavora (prj_7pn7UmQQsiEjTIHH58cfUU84p6xc, team_LakHkpsa9gL4kTe1WZIHBJaR)",
        var_count: VERCEL_PROD_VARS.size,
      },
      railway_production: {
        method: "railway variables --service benavora-worker --environment production --kv",
        authenticated_as: "reid@repvg.com (confirmed via `railway whoami`)",
        project: "benavora-worker (1d79d4e6-f529-4903-9577-7085b3ab126b), environment production, service status confirmed Online at check time",
        var_count: RAILWAY_PROD_VARS.size,
      },
    },
    wgr_resolution: {
      "WGR-002": {
        original_claim:
          "VERCEL_TOKEN and VERCEL_PROJECT_ID confirmed absent from local .env.local; production Vercel/Railway presence not checked.",
        resolution:
          "Both vars are 'tooling_only' (used exclusively by scripts/verify-deployment.ts, run locally/in CI -- never a Vercel/Railway deployed app env var by design, so 'Vercel/Railway production presence' isn't a meaningful question for them). Confirmed this session: still absent locally, still nowhere the deploy-verify script could read them from. Genuinely still CONFIRMED-BROKEN for VERCEL_TOKEN -- no token exists anywhere this audit could find. Partial forward progress on VERCEL_PROJECT_ID: its value is already available in .vercel/project.json in this working tree, so populating it is a one-line copy once a token is obtained, not a separate lookup task. See vars[] rows for VERCEL_TOKEN / VERCEL_PROJECT_ID for full detail.",
        settled: false,
        remaining_action: "Reid needs to generate a Vercel personal access token and add VERCEL_TOKEN (+ VERCEL_PROJECT_ID, value already known) to .env.local (or wherever scripts/verify-deployment.ts is meant to run) before the automated deploy-drift gate can produce a real PASS/FAIL instead of INDETERMINATE.",
      },
      "WGR-003": {
        original_claim:
          "13 production-required vars confirmed absent from local .env.local; production state unconfirmed for 11 of them, plus two hearsay/indirect-only updates already on file (CRON_SECRET 'per Reid', SUPABASE_URL inferred from a worker boot log).",
        resolution:
          "All 13 vars now independently, directly checked against both Vercel production and Railway production this session (whichever platform(s) each is actually relevant to). Full results in vars[] below. Summary: CRON_SECRET and SUPABASE_URL are now independently confirmed present (first-hand evidence replacing the prior hearsay/indirect sourcing) -- both settled, no gap. INTEGRATION_ENCRYPTION_KEY, INTEGRATION_KEY_SECRET, PORTAL_ENCRYPT_SECRET, UNSUBSCRIBE_HMAC_SECRET, WORKER_ID are all confirmed present in every environment where they're relevant -- local-only gaps, not production risks. CREDENTIAL_ENCRYPTION_KEY, RESEND_API_KEY, RESEND_WEBHOOK_SECRET, SCRAPER_API_KEY, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET are all confirmed GENUINELY ABSENT from every relevant production environment, not just locally -- real, live production gaps.",
        settled: true,
        vars_settled_no_gap: [
          "CRON_SECRET",
          "SUPABASE_URL",
          "INTEGRATION_ENCRYPTION_KEY",
          "INTEGRATION_KEY_SECRET",
          "PORTAL_ENCRYPT_SECRET",
          "UNSUBSCRIBE_HMAC_SECRET",
          "WORKER_ID",
        ],
        vars_confirmed_production_gap: [
          "CREDENTIAL_ENCRYPTION_KEY",
          "RESEND_API_KEY",
          "RESEND_WEBHOOK_SECRET",
          "SCRAPER_API_KEY",
          "STRIPE_SECRET_KEY",
          "STRIPE_WEBHOOK_SECRET",
        ],
      },
    },
    beyond_original_scope: {
      description:
        "Two production_required vars (NEXT_PUBLIC_SUPABASE_URL, OPENAI_API_KEY, SAM_GOV_API_KEY) were marked 'ok' by PT-00 because they're present locally and referenced by app code -- PT-00's method never distinguished worker-relevance. This session's app-vs-worker relevance mapping (see method above) found genuine, previously-undocumented worker-production gaps for all three. NEXT_PUBLIC_SUPABASE_URL's gap directly corroborates and explains the concrete production root cause behind the already-documented AG-42 chain-target bug in STATE_OF_THE_BUILD.md. OPENAI_API_KEY's gap is a plausible (not proven) explanation for the previously-'not fully determined' AG-29 cold-start anomaly also documented there. Full detail in each var's own note below.",
      vars: ["NEXT_PUBLIC_SUPABASE_URL", "OPENAI_API_KEY", "SAM_GOV_API_KEY"],
    },
    not_attempted: {
      description:
        "This phase is env-var presence reconciliation only. It does not attempt to resolve WGR-111 (the middleware-level finding that /api/cron/* and /api/webhooks/* routes 307-redirect to /login before any CRON_SECRET/signature check runs, for any caller lacking a session cookie -- including Stripe, Resend, and Vercel Cron itself) or independently verify a real Vercel Cron firing / Stripe or Resend webhook delivery in production. CRON_SECRET's confirmed presence in Vercel settles the narrow 'is the var configured' question only; it says nothing about whether cron/webhook requests can currently reach the code that reads it.",
    },
    summary: {
      total_vars_checked: vars.length,
      fully_resolved_no_gap: vars.filter((v) => v.status === "ok_all_relevant_environments").length,
      confirmed_gaps: confirmedGaps.length,
      confirmed_gaps_vars: confirmedGaps.map((v) => v.var),
      new_vars_beyond_wgr003_scope_with_production_gap: newVarsBeyondWgr003Scope.map((v) => v.var),
    },
    vars,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2) + "\n", "utf8");
  console.log(`Wrote ${OUT_FILE}`);
  console.log(
    `  ${output.summary.total_vars_checked} vars checked, ${output.summary.fully_resolved_no_gap} fully resolved, ${output.summary.confirmed_gaps} confirmed gap(s).`,
  );
}

main();
