#!/usr/bin/env node
/**
 * PT-14-003: scan the SHIPPED client build output for leaked secrets.
 *
 * "Shipped" is scoped deliberately narrow -- what actually reaches a
 * browser, not everything `next build` writes to disk:
 *   - .next/static (recursive)     JS/CSS chunks served directly to clients
 *   - .next/server/app (*.html)    statically prerendered page HTML, which
 *                                  IS sent over the wire as page source
 *   - .next/server/app (*.rsc, *.meta)  React Server Component payloads,
 *                                  also sent to the client during navigation
 * .next/server (all *.js, everywhere else) -- server-only route handlers,
 * RSC render code that runs on the server and is never transmitted to a
 * browser -- is explicitly OUT of scope for this scan; see the SCOPE
 * section in the output for the exact file count per category. A secret
 * embedded in that server-only code is not a client-bundle leak; it may
 * still be a real problem, but a different one (e.g. it should never have
 * been read into that scope at all), and PT-14-004 (RLS/anon audit) plus
 * PT-02 (auth-bypass sweep) already cover server-side exposure paths.
 *
 * Two independent detection passes:
 *   1. KNOWN-VALUE: for every server-only secret this session has a real
 *      local value for (.env.local, minus NEXT_PUBLIC_* which are
 *      intentionally public), search the shipped files for the literal
 *      value. A hit is a P0 -- an actual live credential is in the bundle.
 *   2. PATTERN: format-based heuristics that don't require knowing the
 *      real value (Stripe secret keys, private-key PEM blocks, AWS access
 *      keys, Resend keys, Postgres connection strings, and -- because the
 *      anon key is also a JWT and is SUPPOSED to be public -- every JWT
 *      found in the bundle has its payload decoded and classified by its
 *      `role` claim: `service_role`/`supabase_admin` is a P0, `anon` is
 *      expected-and-fine).
 *
 * SAFETY: this script never writes a real secret value (or a
 * partially-redacted fragment of one) to any output file, console line,
 * or exit message. Findings report only: which named secret/pattern
 * matched, which file, and a byte offset -- never a substring of the
 * value itself.
 */
import { readFileSync, existsSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const NEXT_DIR = join(ROOT, ".next");
const STATIC_DIR = join(NEXT_DIR, "static");
const SERVER_APP_DIR = join(NEXT_DIR, "server", "app");
const OUT_DIR = join(ROOT, "test-evidence", "pt-14");
const TXT_OUT = join(OUT_DIR, "bundle-scan.txt");

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

if (!existsSync(NEXT_DIR)) {
  fail(`${NEXT_DIR} does not exist. Run \`pnpm run build\` first -- this script scans real build output, it does not build.`);
}
if (!existsSync(STATIC_DIR)) {
  fail(`${STATIC_DIR} does not exist. A completed \`next build\` must produce .next/static.`);
}

// ---- Step 1: enumerate the real shipped-output file set ----
function walk(dir, exts) {
  const out = [];
  if (!existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = join(cur, e.name);
      if (e.isDirectory()) {
        stack.push(full);
      } else if (exts.some((ext) => e.name.endsWith(ext))) {
        out.push(full);
      }
    }
  }
  return out;
}

const clientJsCss = walk(STATIC_DIR, [".js", ".css", ".json"]);
const prerenderedHtml = walk(SERVER_APP_DIR, [".html"]);
const rscPayloads = walk(SERVER_APP_DIR, [".rsc", ".meta"]);
const shippedFiles = [...clientJsCss, ...prerenderedHtml, ...rscPayloads];

if (shippedFiles.length === 0) {
  fail("Zero files found under .next/static or .next/server/app -- the build output looks empty or incomplete.");
}

// ---- Step 2: known-value pass -- real secrets this session can see ----
// NEXT_PUBLIC_* are excluded on purpose: they are meant to ship to the
// client (Supabase URL + anon key), so their presence is expected, not a
// leak. Everything else read from .env.local is a server-only value that
// must never appear in code the browser downloads.
const ENV_LOCAL_PATH = join(ROOT, ".env.local");
const knownSecrets = []; // { name, value }
if (existsSync(ENV_LOCAL_PATH)) {
  const raw = readFileSync(ENV_LOCAL_PATH, "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    const [, name, rawValue] = m;
    if (name.startsWith("NEXT_PUBLIC_")) continue;
    if (name === "NODE_ENV") continue;
    let value = rawValue.trim();
    // strip surrounding quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (value.length < 8) continue; // too short to search meaningfully / not secret-shaped
    knownSecrets.push({ name, value });
  }
}

// Full server-only secret-name surface referenced anywhere in src/ or
// worker/ (informational -- confirms which of these this scan actually had
// a real value to test, vs which were never in .env.local so this pass
// could not check them at all).
const referencedSecretNames = [
  "ANTHROPIC_API_KEY", "BLS_API_KEY", "CDC_APP_TOKEN", "CENSUS_API_KEY",
  "CREDENTIAL_ENCRYPTION_KEY", "CRON_SECRET", "DATABASE_URL", "GEMINI_API_KEY",
  "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_GENERATIVE_AI_API_KEY",
  "GOOGLE_PLACES_API_KEY", "HUD_API_KEY", "INTEGRATION_ENCRYPTION_KEY",
  "INTEGRATION_KEY_SECRET", "OPENAI_API_KEY", "PORTAL_ENCRYPT_SECRET",
  "RESEND_API_KEY", "RESEND_WEBHOOK_SECRET", "SAM_GOV_API_KEY",
  "SIMPLER_GRANTS_API_KEY", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET",
  "SUPABASE_SERVICE_ROLE_KEY", "TWOCAPTCHA_API_KEY", "UNSUBSCRIBE_HMAC_SECRET",
];
const checkedNames = new Set(knownSecrets.map((s) => s.name));
const uncheckedNames = referencedSecretNames.filter((n) => !checkedNames.has(n));

const knownValueFindings = [];
for (const file of shippedFiles) {
  let buf;
  try {
    buf = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const { name, value } of knownSecrets) {
    const idx = buf.indexOf(value);
    if (idx !== -1) {
      knownValueFindings.push({
        kind: "KNOWN_VALUE",
        secretName: name,
        file: relative(ROOT, file),
        byteOffset: idx,
        severity: "P0",
      });
    }
  }
}

// ---- Step 3: pattern pass -- format-based, doesn't need the real value ----
const PATTERNS = [
  { id: "STRIPE_SECRET_KEY_LIVE", re: /\bsk_live_[A-Za-z0-9]{20,}/g, severity: "P0" },
  { id: "STRIPE_SECRET_KEY_TEST", re: /\bsk_test_[A-Za-z0-9]{20,}/g, severity: "P0" },
  { id: "STRIPE_RESTRICTED_KEY", re: /\brk_(live|test)_[A-Za-z0-9]{20,}/g, severity: "P0" },
  { id: "PEM_PRIVATE_KEY", re: /-----BEGIN (RSA |EC |OPENSSH |ENCRYPTED |)PRIVATE KEY-----/g, severity: "P0" },
  { id: "AWS_ACCESS_KEY_ID", re: /\bAKIA[0-9A-Z]{16}\b/g, severity: "P0" },
  { id: "RESEND_API_KEY", re: /\bre_[A-Za-z0-9_]{20,}/g, severity: "P0" },
  { id: "POSTGRES_CONNECTION_STRING_WITH_CREDS", re: /postgres(ql)?:\/\/[^\s"'<>]+:[^\s"'<>]+@[^\s"'<>]+/g, severity: "P0" },
  { id: "OPENAI_API_KEY_SHAPE", re: /\bsk-[A-Za-z0-9]{20,}\b/g, severity: "P0" },
  { id: "ANTHROPIC_API_KEY_SHAPE", re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, severity: "P0" },
];

const patternFindings = [];
for (const file of shippedFiles) {
  let buf;
  try {
    buf = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const { id, re, severity } of PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(buf)) !== null) {
      patternFindings.push({
        kind: "PATTERN",
        patternId: id,
        file: relative(ROOT, file),
        byteOffset: m.index,
        severity,
      });
      if (patternFindings.length > 5000) break; // sanity cap
    }
  }
}

// ---- Step 4: JWT pass -- decode every JWT-shaped token, classify by role ----
// A JWT is expected in the client bundle (the Supabase anon key). What
// must never be there is a JWT whose payload `role` claim is
// service_role/supabase_admin -- that would be the server-only key.
const JWT_RE = /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const jwtFindings = []; // { file, byteOffset, role, severity }
const jwtRoleCounts = {};
for (const file of shippedFiles) {
  let buf;
  try {
    buf = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  JWT_RE.lastIndex = 0;
  let m;
  while ((m = JWT_RE.exec(buf)) !== null) {
    const token = m[0];
    const parts = token.split(".");
    let role = "unknown";
    try {
      const payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const padded = payloadB64 + "=".repeat((4 - (payloadB64.length % 4)) % 4);
      const payload = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
      role = payload.role || payload.aud || "unknown";
    } catch {
      role = "undecodable";
    }
    jwtRoleCounts[role] = (jwtRoleCounts[role] || 0) + 1;
    const isPrivileged = role === "service_role" || role === "supabase_admin";
    jwtFindings.push({
      file: relative(ROOT, file),
      byteOffset: m.index,
      role,
      severity: isPrivileged ? "P0" : "informational",
    });
    if (jwtFindings.length > 2000) break;
  }
}
const privilegedJwtFindings = jwtFindings.filter((j) => j.severity === "P0");
const anonJwtSampleFiles = [...new Set(jwtFindings.filter((j) => j.role === "anon").map((j) => j.file))].slice(0, 3);

// ---- Assemble output ----
const allFindings = [...knownValueFindings, ...patternFindings, ...privilegedJwtFindings];
const p0Count = allFindings.filter((f) => f.severity === "P0").length;

const lines = [];
lines.push("PT-14-003 client bundle secret scan");
lines.push(`Generated: ${new Date().toISOString()}`);
lines.push("");
lines.push("=== SCOPE ===");
lines.push(`.next/static (JS/CSS/JSON chunks):        ${clientJsCss.length} files`);
lines.push(`.next/server/app (*.html, prerendered):   ${prerenderedHtml.length} files`);
lines.push(`.next/server/app (*.rsc/*.meta, RSC data): ${rscPayloads.length} files`);
lines.push(`TOTAL shipped files scanned:               ${shippedFiles.length}`);
lines.push("Explicitly OUT of scope (server-only, never sent to a browser): .next/server/**/*.js route handlers/RSC render code.");
lines.push("");
lines.push("=== KNOWN-VALUE PASS ===");
lines.push(`Server-only secret names checked (real value present in .env.local): ${[...new Set(knownSecrets.map((s) => s.name))].join(", ") || "(none -- .env.local had no non-NEXT_PUBLIC values)"}`);
lines.push(`Server-only secret names referenced in code but NOT checked (no local value to test against): ${uncheckedNames.join(", ")}`);
lines.push(`Findings: ${knownValueFindings.length}`);
for (const f of knownValueFindings) {
  lines.push(`  [P0] ${f.secretName} literal value found in ${f.file} at byte offset ${f.byteOffset} -- VALUE NOT PRINTED, see file to confirm.`);
}
lines.push("");
lines.push("=== PATTERN PASS ===");
lines.push(`Findings: ${patternFindings.length}`);
for (const f of patternFindings) {
  lines.push(`  [${f.severity}] ${f.patternId} matched in ${f.file} at byte offset ${f.byteOffset} -- VALUE NOT PRINTED, see file to confirm.`);
}
lines.push("");
lines.push("=== JWT ROLE-CLAIM PASS ===");
lines.push(`Total JWT-shaped tokens found: ${jwtFindings.length}`);
lines.push(`By role claim: ${JSON.stringify(jwtRoleCounts)}`);
lines.push(`Privileged (service_role/supabase_admin) JWTs found in shipped output: ${privilegedJwtFindings.length}`);
for (const f of privilegedJwtFindings) {
  lines.push(`  [P0] JWT with role="${f.role}" found in ${f.file} at byte offset ${f.byteOffset} -- VALUE NOT PRINTED, see file to confirm.`);
}
if (jwtRoleCounts.anon > 0) {
  lines.push(`  Expected/by-design: ${jwtRoleCounts.anon} anon-role JWT occurrence(s) -- this is NEXT_PUBLIC_SUPABASE_ANON_KEY, meant to ship to the client (protected by RLS, not secrecy). Sample file(s): ${anonJwtSampleFiles.join(", ")}`);
}
lines.push("");
lines.push("=== SUMMARY ===");
lines.push(`Total findings: ${allFindings.length}`);
lines.push(`P0 (real secret confirmed in shipped output): ${p0Count}`);
lines.push(p0Count === 0
  ? "VERDICT: PASS -- no server-only secret value, no secret-shaped pattern, and no privileged-role JWT was found in the shipped client bundle."
  : "VERDICT: FAIL -- one or more real secrets appear to be present in the shipped client bundle. Treat as P0 and rotate the affected credential(s) immediately.");
lines.push("");

writeFileSync(TXT_OUT, lines.join("\n") + "\n", "utf8");

const jsonSummary = {
  generatedAt: new Date().toISOString(),
  scope: {
    clientJsCssFiles: clientJsCss.length,
    prerenderedHtmlFiles: prerenderedHtml.length,
    rscPayloadFiles: rscPayloads.length,
    totalShippedFilesScanned: shippedFiles.length,
    outOfScope: ".next/server/**/*.js (server-only route handlers/RSC render code, never sent to a browser)",
  },
  knownValuePass: {
    secretsChecked: knownSecrets.map((s) => s.name),
    secretsReferencedButNotChecked: uncheckedNames,
    findings: knownValueFindings,
  },
  patternPass: {
    patternsChecked: PATTERNS.map((p) => p.id),
    findings: patternFindings,
  },
  jwtPass: {
    totalJwtTokensFound: jwtFindings.length,
    roleCounts: jwtRoleCounts,
    privilegedFindings: privilegedJwtFindings,
  },
  summary: {
    totalFindings: allFindings.length,
    p0Count,
    verdict: p0Count === 0 ? "PASS" : "FAIL",
  },
};

console.log(`Scanned ${shippedFiles.length} shipped files (${clientJsCss.length} static JS/CSS/JSON, ${prerenderedHtml.length} prerendered HTML, ${rscPayloads.length} RSC payloads).`);
console.log(`Known-value pass: ${knownSecrets.length} real secret(s) checked, ${knownValueFindings.length} found in bundle.`);
console.log(`Pattern pass: ${patternFindings.length} format-based match(es).`);
console.log(`JWT pass: ${jwtFindings.length} JWT(s) found, role distribution ${JSON.stringify(jwtRoleCounts)}, ${privilegedJwtFindings.length} privileged.`);
console.log(`P0 total: ${p0Count}`);
console.log(`Written: ${TXT_OUT}`);

// Export the JSON summary via a global so the caller script (which also
// writes bundle-and-middleware.json) can reuse it without re-scanning.
writeFileSync(join(OUT_DIR, "_bundle-scan-summary.json"), JSON.stringify(jsonSummary, null, 2), "utf8");

process.exit(p0Count === 0 ? 0 : 1);
