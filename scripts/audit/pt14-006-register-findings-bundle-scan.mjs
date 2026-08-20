import { appendFindingRow } from "./evidence-lib.mjs";

appendFindingRow({
  id: "WGR-120",
  layer: "Build/Secrets",
  severity: "P3",
  description:
    "PT-14-003's client-bundle secret scan, recorded as its own row per the register's own " +
    "convention of registering a verified-clean outcome (see WGR-071/073/076/114) rather than " +
    "leaving a 0-finding pass undocumented. Scanned every one of 247 real files a fresh " +
    "`pnpm run build` actually ships to a browser (209 static JS/CSS/JSON chunks, 12 prerendered " +
    "HTML pages, 26 RSC payloads -- explicitly excluding `.next/server/**/*.js`, which never " +
    "reaches a client). Three independent passes: (1) known-value -- every non-NEXT_PUBLIC_* " +
    "secret with a real value in .env.local (SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL, " +
    "ANTHROPIC_API_KEY, SAM_GOV_API_KEY, OPENAI_API_KEY, GOOGLE_PLACES_API_KEY) searched literally " +
    "across all 247 files -- zero matches; (2) format-based pattern pass (Stripe secret/restricted " +
    "keys, PEM private-key blocks, AWS access keys, Resend keys, Postgres connection strings with " +
    "embedded creds, OpenAI/Anthropic key shapes) -- zero matches; (3) every JWT-shaped token in " +
    "the bundle (77 found) had its payload decoded and role claim checked -- all 77 are " +
    "role:\"anon\" (the real, intentionally-public NEXT_PUBLIC_SUPABASE_ANON_KEY, protected by RLS " +
    "not secrecy -- corroborated by WGR-115's independent finding that 0/184 tables leak data to " +
    "this exact key), zero service_role/supabase_admin tokens present anywhere in the shipped " +
    "bundle. 19 server-only secret names referenced in src/worker but absent from .env.local " +
    "(CRON_SECRET, STRIPE_SECRET_KEY, RESEND_API_KEY, CREDENTIAL_ENCRYPTION_KEY, etc.) could not " +
    "be checked by the known-value pass specifically (no local value to search for) -- listed " +
    "explicitly in bundle-scan.txt rather than silently skipped; the pattern pass still covers " +
    "several of them by shape.",
  evidencePath: "test-evidence/pt-14/bundle-scan.txt (raw scan output); test-evidence/pt-14/bundle-and-middleware.json (bundleSecretScan, summary.p0Count=0, summary.verdict=\"PASS\")",
  reproduction:
    "pnpm run build (fresh, .next deleted first) then node scripts/audit/pt14-003-bundle-secret-scan.mjs; " +
    "node scripts/audit/verify-pt14-003.mjs (re-derives the scanned-file count from bundle-scan.txt " +
    "and requires it to match the JSON summary's own claimed count).",
  scopeTag: "CONFIRMED-OK",
});

console.log("Registered WGR-120.");
