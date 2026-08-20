// ============================================================================
// PT-07-004 — register the real findings from
// test-evidence/pt-07/comms-billing.json into the WIRING_GAP_REGISTER.
//
// Two findings registered (P2 Resend, P3 Google Calendar OAuth). Stripe is
// NOT registered as a finding here: its webhook signature-verification path
// was functionally exercised (real Stripe SDK constructEvent()/
// generateTestHeaderString() calls, valid signature accepted, tampered
// payload + wrong secret both rejected) and passed, and billing itself being
// unconfigured is an explicit, reasoned PENDING-SCOPE per the task's own
// instruction ("If billing scope is undecided, record PENDING-SCOPE"), not a
// defect — there is no broken code path to register.
//
// Usage: node scripts/audit/pt07-004-register-findings.mjs
// ============================================================================

import { appendFindingRow } from "./evidence-lib.mjs";

const EVIDENCE = "test-evidence/pt-07/comms-billing.json";
const REPRO_CAPTURE =
  "node --import tsx scripts/audit/pt07-004-comms-billing-probes.mjs (re-runs the real live checks); " +
  "node scripts/audit/verify-pt07-004.mjs (validates the captured evidence)";

const findings = [
  {
    id: "WGR-146",
    layer: "Integration",
    severity: "P2",
    description:
      "RESEND_API_KEY is not configured in .env.local or in any Vercel environment (confirmed live via " +
      "`vercel env ls` — only 12 env vars total exist across the whole project, none Resend-related). " +
      "src/lib/email/resend-client.ts's sendEmail() — the shared platform-originated transactional " +
      "email path used by draft-ready/morning-digest/urgent-alert/welcome notifications — was invoked " +
      "for real with the key deliberately absent (matching the real production state) and returned " +
      "{success:false, error:'RESEND_API_KEY not configured'}, its documented no-key branch. The " +
      "platform degrades gracefully (no crash), but zero platform-originated emails can currently be " +
      "sent in production. src/app/api/webhooks/resend/route.ts's Svix signature verification was read " +
      "and confirmed correct (fails closed with 500 if RESEND_WEBHOOK_SECRET is unset, HMAC-SHA256 " +
      "over svix-id.svix-timestamp.body, timingSafeEqual comparison) but is likewise unreachable today " +
      "since no key/secret exists to produce a real webhook in the first place.",
    evidencePath: `${EVIDENCE}#resend`,
    reproduction: REPRO_CAPTURE,
    scopeTag: "PENDING-SCOPE",
  },
  {
    id: "WGR-147",
    layer: "Integration",
    severity: "P3",
    description:
      "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI are not configured in .env.local " +
      "or in any Vercel environment (same live `vercel env ls` check as WGR-146). " +
      "src/lib/integrations/google/auth.ts's getOAuthClient() was called for real with these unset and " +
      "threw 'Missing GOOGLE_CLIENT_ID' immediately, reproducing the exact failure any real OAuth " +
      "connect/refresh/calendar-sync attempt would hit today — Google Calendar sync (Behavioral " +
      "Contracts §20) cannot be authorized in production. A live query of the integrations table " +
      "(provider='google') found 0 rows across all organizations — no org has ever connected Google " +
      "Calendar, so this is not currently stranding any real customer's existing connection, but the " +
      "feature is fully non-functional as shipped. INTEGRATION_ENCRYPTION_KEY (needed to decrypt a " +
      "stored token, were one to exist) IS present in Vercel production — only the three OAuth app " +
      "credentials are missing.",
    evidencePath: `${EVIDENCE}#googleCalendar`,
    reproduction: REPRO_CAPTURE,
    scopeTag: "PENDING-SCOPE",
  },
];

for (const finding of findings) {
  const row = appendFindingRow(finding);
  console.log(`Appended ${finding.id}: ${row.slice(0, 100)}...`);
}

console.log(`\n${findings.length} finding(s) registered in WIRING_GAP_REGISTER.md.`);
