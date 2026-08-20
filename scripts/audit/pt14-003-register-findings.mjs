import { appendFindingRow } from "./evidence-lib.mjs";

appendFindingRow({
  id: "WGR-108",
  layer: "API/SSRF",
  severity: "P0",
  description:
    "POST /api/intelligence/ingest {source:'url', url} (requireRole('writer'), src/app/api/" +
    "intelligence/ingest/route.ts:61-77) does `fetch(url.trim(), {headers, signal})` on a fully " +
    "user-supplied URL with zero validation -- no scheme restriction, no private/loopback/" +
    "link-local IP check, no safeFetch() usage (src/lib/security/safe-fetch.ts, the platform's own " +
    "SSRF-hardened fetch wrapper, is imported by only 2 files repo-wide: custom-api.ts and " +
    "custom-scrape.ts -- this route is not one of them). Worse than blind SSRF: the fetched body is " +
    "extracted via extractSections() and PERSISTED to intelligence_funded_proposals, readable later " +
    "by any viewer-role user through the Intelligence Library UI -- full response-content " +
    "exfiltration of whatever the URL resolves to (e.g. cloud metadata, an internal admin API, " +
    "another internal service), not just a blind fire-and-forget request. Live-reproduced this " +
    "session: the exact fetch() call copied verbatim from the route, run against a real local " +
    "loopback listener standing in for an internal service, successfully retrieved and returned the " +
    "listener's marker payload with zero blocking.",
  evidencePath: "test-evidence/pt-14/injection.json (attempts[] where id===\"ssrf-001-intelligence-ingest-raw-fetch\")",
  reproduction:
    "node scripts/audit/pt14-002-live-tests.mjs (re-runs the full sweep, including this live local " +
    "comparative test); direct read of src/app/api/intelligence/ingest/route.ts:53-77 confirms zero " +
    "URL/host validation before the fetch() call.",
  scopeTag: "CONFIRMED-BROKEN",
});

appendFindingRow({
  id: "WGR-109",
  layer: "Autoapply/SSRF",
  severity: "P0",
  description:
    "WebhookNotifier.notify() (src/lib/autoapply/webhook-notifier.ts:123) does " +
    "`fetch(config.webhook_url, {method:'POST', headers, body, signal})` on a URL read from " +
    "webhook_configs.webhook_url with zero validation beyond `new URL(webhook_url)` (a syntactic " +
    "well-formedness check only -- src/app/api/autoapply/webhooks/route.ts:89, no host/scheme " +
    "restriction) at creation time (requireRole('admin')). Every real AutoApply queue-processor " +
    "event (submission_completed, submission_failed, queue_populated, review_needed, " +
    "agreement_received, captcha_solve_failed) fires this fetch server-side with no safeFetch() " +
    "protection -- confirmed this is not one of the 2 files repo-wide that import " +
    "src/lib/security/safe-fetch.ts. An org admin (or a compromised admin session) can point a " +
    "webhook at http://169.254.169.254/... (cloud metadata), an internal service, or any other " +
    "address the production server can reach, and the platform's own worker will POST a real " +
    "outbound request there on every subsequent AutoApply event. Live-reproduced this session: the " +
    "exact fetch() call copied verbatim, run against a real local loopback listener, successfully " +
    "delivered the POST with zero blocking.",
  evidencePath: "test-evidence/pt-14/injection.json (attempts[] where id===\"ssrf-002-webhook-notifier-raw-fetch\")",
  reproduction:
    "node scripts/audit/pt14-002-live-tests.mjs; direct read of src/lib/autoapply/webhook-notifier.ts:123 " +
    "and src/app/api/autoapply/webhooks/route.ts:81-93 (the only validation on webhook_url is " +
    "`new URL(webhook_url)`).",
  scopeTag: "CONFIRMED-BROKEN",
});

appendFindingRow({
  id: "WGR-110",
  layer: "Autoapply/SSRF",
  severity: "P0",
  description:
    "AutoApply's real submission pipeline (worker/queue-processor.ts:566 reads " +
    "funders.giving_portal_url, a free-text field with no server-side URL/host validation found " +
    "anywhere in the funders write path) navigates a real headless Chromium browser to it " +
    "server-side via src/lib/autoapply/stealth-browser.ts -- confirmed by targeted grep and full " +
    "file read that this file (and the separate general-purpose scraper's src/lib/scraper/" +
    "stealth-engine.ts, which navigates to foundation_directory.website/nonprofits.website the same " +
    "unguarded way) contains zero SSRF-guard pattern (no private-IP check, no safeFetch import, no " +
    "DNS-lookup validation). Highest-severity of the three SSRF findings by mechanism -- full " +
    "browser navigation, not just an HTTP fetch, meaning JS execution, screenshot capture, and " +
    "page-content extraction are all available against whatever the URL resolves to -- but NOT " +
    "live-reproduced this session (a full Playwright browser launch was judged out of reasonable " +
    "scope for this pass). Graded on direct static source evidence only; treat as high-confidence, " +
    "not empirically confirmed the way WGR-108/WGR-109 are.",
  evidencePath: "test-evidence/pt-14/injection.json (attempts[] where id===\"ssrf-003-autoapply-portal-url-navigation-static\")",
  reproduction:
    "Direct read of worker/queue-processor.ts:558-580 (portalUrl = funder.giving_portal_url, no " +
    "validation, gated only by a domain-throttle/pause control-plane check unrelated to SSRF) and " +
    "src/lib/autoapply/stealth-browser.ts (grep for 169.254|127.0.0.1|isPrivate|safeFetch -- zero " +
    "hits). A live reproduction would require launching a real AutoApply submission session against " +
    "a funder record with a loopback/internal giving_portal_url -- not attempted this session.",
  scopeTag: "UNVERIFIED",
});

appendFindingRow({
  id: "WGR-111",
  layer: "Middleware/Availability",
  severity: "P0",
  description:
    "src/middleware.ts's catch-all matcher requires a valid Supabase session (a real, non-empty " +
    "session cookie that passes supabase.auth.getUser()) for every path not explicitly listed in " +
    "PUBLIC_PATHS/isPublicPath(). Neither /api/webhooks/*, /api/admin/webhooks/*, nor /api/cron/* " +
    "(nor /api/sources/{grantsgov,propublica,samgov}, also cron_secret-gated) are in that allowlist. " +
    "External callers that will never carry a Supabase session cookie -- Stripe (billing webhooks), " +
    "Resend (email delivery/reply webhooks), and Vercel's own vercel.json-configured Cron invoker " +
    "(5 real scheduled jobs: /api/cron/research, /api/cron/grantsgov, /api/cron/reminders, " +
    "/api/cron/autoapply, /api/cron/domain-warmup) are therefore structurally indistinguishable " +
    "from an unauthenticated attacker to this middleware. Live-confirmed this session: all 4 tested " +
    "webhook routes (/api/webhooks/resend, /api/webhooks/stripe, /api/admin/webhooks/email-events, " +
    "/api/admin/webhooks/email-reply) and all 7 tested cron/source routes returned a real 307 " +
    "redirect to /login for a cookie-less POST, BEFORE the route's own signature/CRON_SECRET check " +
    "ever ran -- this is the opposite of a CSRF hole (forged requests genuinely cannot reach the " +
    "handler), but the same redirect applies to every real external caller too, since neither " +
    "Stripe, Resend, nor Vercel Cron send a Supabase session cookie. If this holds for real traffic " +
    "(the middleware has no way to distinguish a forged request from a real one, since both lack a " +
    "session cookie), real Stripe billing events, real Resend delivery/reply events, and all 5 real " +
    "Vercel Cron jobs may be silently redirected and never processed in production. NOT confirmed " +
    "against an actual live Stripe/Resend delivery or a real Vercel Cron firing this session (would " +
    "need dashboard/delivery-log access to those three external services, out of reach here) -- a " +
    "real, repeated, direct production observation, not a certainty about external-service behavior.",
  evidencePath: "test-evidence/pt-14/injection.json (attempts[] where id===\"csrf-middleware-blocks-external-webhooks-and-cron\" and the 11 individual csrf-unsigned-webhook-*/csrf-unauth-cron-* entries)",
  reproduction:
    "curl -i -X POST https://www.benavora.com/api/webhooks/stripe (or any of the 10 other listed " +
    "routes) with no cookie -- observe `307` with `Location: /login`. Cross-check against " +
    "src/middleware.ts:45-72 (PUBLIC_PATHS / isPublicPath()) and vercel.json's crons[] array.",
  scopeTag: "CONFIRMED-BROKEN",
});

appendFindingRow({
  id: "WGR-112",
  layer: "API/SQLi",
  severity: "P2",
  description:
    "GET /api/email/threads?search= (src/app/api/email/threads/route.ts:38) interpolates the raw, " +
    "unescaped `search` query param directly into a PostgREST `.or()` filter template literal " +
    "(`subject.ilike.%${search}%,snippet.ilike.%${search}%`) with no comma/parens stripping -- " +
    "unlike the other two comparable search endpoints in this codebase (corporate-prospects `q`, " +
    "which strips [%,]; intelligence/library/search `query`, which runs sanitizeIlikeTerm() " +
    "stripping [,()%]), both re-confirmed still mitigated this session. Live-reproduced: a payload " +
    "comma-injecting a `gmail_thread_id.neq.<bogus>` clause into `search` caused the route to " +
    "return both of two seeded rows despite neither row's subject/snippet containing the search " +
    "term at all -- proving the injected clause was genuinely honored by PostgREST, not a fluke or " +
    "a parse error (httpStatus 200, resultCount 2, both seeded ids returned). Scope, precisely: " +
    "organization_id is a separate, non-injectable top-level .eq() filter (ANDed with the .or() " +
    "clause as a distinct PostgREST query param) so this specific hole cannot cross the tenant " +
    "boundary -- confirmed by design and corroborated by PT-05's independent 0/120 cross-tenant " +
    "leak result. Real impact is a same-org business-logic filter bypass (the caller's own session " +
    "can retrieve more of their own org's synced_email_threads rows than the search term should " +
    "match, or trigger a 500 with a differently-shaped malformed payload -- also reproduced this " +
    "session with an earlier payload variant), not a cross-tenant leak or a classic SQL-injection " +
    "syntax hole.",
  evidencePath: "test-evidence/pt-14/injection.json (attempts[] where id===\"sqli-002-email-threads-or-filter-injection\", plus sqli-001/003/004 for baseline and the two mitigated comparison targets)",
  reproduction:
    "As a real authenticated (viewer-role) session, GET /api/email/threads?search=" +
    "zzznomatch99%2Cgmail_thread_id.neq.impossible-value-xyz against an org with at least one real " +
    "synced_email_threads row -- observe every row in the org returned, not just rows matching " +
    "'zzznomatch99'. node scripts/audit/pt14-002-live-tests.mjs reproduces this live against a " +
    "throwaway org.",
  scopeTag: "CONFIRMED-BROKEN",
});

appendFindingRow({
  id: "WGR-113",
  layer: "Email/XSS",
  severity: "P2",
  description:
    "Transactional HTML email templates (src/lib/email/templates/{base-layout,draft-ready," +
    "morning-digest,urgent-alert,welcome}.ts) interpolate user-controlled fields (organization " +
    "display name, digest item titles/details) directly into raw HTML template-literal strings with " +
    "zero output-escaping anywhere in the directory (grep for escapeHtml|sanitize across all 5 " +
    "files: zero hits). First documented in SECURITY_TEST_2026-08-15.md section 2b as a real, " +
    "unfixed gap; not previously carried into WIRING_GAP_REGISTER.md. Re-confirmed still unfixed " +
    "this session via a fresh static scan (same result: all 5 files, zero escaping function " +
    "referenced). Real impact scoped honestly, unchanged from the original finding: not directly " +
    "exploitable as executing JavaScript in mainstream mail clients (Gmail/Outlook/Apple Mail strip " +
    "<script> and block inline JS by default), but is genuine uncontrolled HTML injection into a " +
    "real transactional send -- an attacker who controls an org name or a digest item title reaching " +
    "one of these templates could inject arbitrary markup (fake buttons/links styled to look " +
    "legitimate, broken layout, a tracking pixel via <img>).",
  evidencePath: "test-evidence/pt-14/injection.json (attempts[] where id===\"xss-004-email-templates-html-injection\"), SECURITY_TEST_2026-08-15.md section 2b (original finding)",
  reproduction:
    "grep -rn 'escapeHtml\\|sanitize' src/lib/email/templates/ -- zero hits across all 5 files. " +
    "node scripts/audit/pt14-002-live-tests.mjs re-runs this check as part of the XSS sweep.",
  scopeTag: "CONFIRMED-BROKEN",
});

appendFindingRow({
  id: "WGR-114",
  layer: "Cross-cutting",
  severity: "P3",
  description:
    "PT-14's clean results, recorded together rather than as separate rows per the register's own " +
    "convention of registering a verified-clean outcome (see WGR-071/073/076): (1) CSRF -- 0 of 21 " +
    "live attempts against production were NOT_BLOCKED (8 no-cookie requireRole-gated routes all " +
    "307/401/403; the header-spoof-onboarding attempt confirmed middleware.ts's Headers.set() " +
    "genuinely overwrites a client-supplied x-organization-id/x-user-id before the route sees it, " +
    "not merely appends). (2) SQLi -- the two comparison endpoints (corporate-prospects `q`, " +
    "intelligence/library/search `query`) both correctly neutralize the identical comma-injection " +
    "payload class that breaks /api/email/threads (WGR-112). (3) XSS -- zero dangerouslySetInnerHTML " +
    "sink with user-controlled content found repo-wide (the one real hit, HowItWorksClient.tsx, " +
    "injects only a hardcoded developer-authored CSS string interpolating a fixed brand-token hex " +
    "constant, confirmed by direct read); a live <script>/onerror payload round-tripped raw and " +
    "unescaped through both knowledge_base.content and contacts.name (correct -- escaping belongs at " +
    "render time, not write time) with no render sink found; the one real raw-HTML-building sink in " +
    "the codebase (src/app/api/unsubscribe/route.ts's escapeHtml()) was executed directly against a " +
    "live <script>/quote/ampersand payload and correctly neutralized every HTML-meaningful character. " +
    "(4) SSRF -- the platform's own safeFetch() (src/lib/security/safe-fetch.ts) correctly blocked " +
    "the same real local loopback listener the two vulnerable sinks (WGR-108/109) successfully " +
    "reached, confirming the contrast is real (the loopback address itself is reachable in this " +
    "environment; only the guarded path refuses it).",
  evidencePath: "test-evidence/pt-14/injection.json (full attempts[] array -- csrf-nocookie-*, csrf-header-spoof-onboarding, sqli-001/003/004, xss-001/002/003/005, ssrf-000)",
  reproduction: "node scripts/audit/pt14-002-live-tests.mjs; node scripts/audit/verify-pt14-001.mjs",
  scopeTag: "CONFIRMED-OK",
});

console.log("Registered WGR-108 through WGR-114.");
