// Fetches the live homepage from the local dev server, extracts the two
// JSON-LD <script> blocks, and validates them against schema.org's
// documented required/recommended properties for Organization and
// SoftwareApplication (per Google's Rich Results requirements) rather than
// just asserting they parse. Also checks <title>, canonical link, and OG tags
// are actually present in the rendered HTML.

const BASE_URL = process.argv[2] || "http://localhost:3000";

const REQUIRED = {
  Organization: ["@context", "@type", "name", "url"],
  SoftwareApplication: ["@context", "@type", "name", "applicationCategory", "operatingSystem"],
};

function extractJsonLd(html) {
  const blocks = [];
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    blocks.push(m[1]);
  }
  return blocks;
}

async function main() {
  const res = await fetch(BASE_URL + "/");
  if (!res.ok) {
    console.error(`FAIL: homepage fetch returned ${res.status}`);
    process.exit(1);
  }
  const html = await res.text();

  const results = { passed: [], failed: [] };

  // --- metadata tags ---
  const checks = [
    ["<title>", /<title>[^<]+<\/title>/],
    ["canonical link", /<link rel="canonical" href="https:\/\/benavora\.com\/?"/],
    ["og:title", /<meta property="og:title" content="[^"]+"/],
    ["og:description", /<meta property="og:description" content="[^"]+"/],
    ["og:url", /<meta property="og:url" content="[^"]+"/],
    ["twitter:card", /<meta name="twitter:card" content="summary_large_image"/],
  ];
  for (const [label, re] of checks) {
    if (re.test(html)) results.passed.push(`metadata: ${label} present`);
    else results.failed.push(`metadata: ${label} MISSING`);
  }

  // --- JSON-LD blocks ---
  const blocks = extractJsonLd(html);
  if (blocks.length === 0) {
    results.failed.push("json-ld: no <script type=application/ld+json> blocks found");
  }

  const seenTypes = new Set();
  for (const raw of blocks) {
    let obj;
    try {
      obj = JSON.parse(raw);
    } catch (e) {
      results.failed.push(`json-ld: block failed to parse: ${e.message}`);
      continue;
    }
    const type = obj["@type"];
    seenTypes.add(type);
    const required = REQUIRED[type];
    if (!required) {
      results.failed.push(`json-ld: unexpected @type "${type}"`);
      continue;
    }
    const missing = required.filter((k) => !(k in obj) || obj[k] === "" || obj[k] == null);
    if (missing.length) {
      results.failed.push(`json-ld: ${type} missing required field(s): ${missing.join(", ")}`);
    } else {
      results.passed.push(`json-ld: ${type} has all required fields (${required.join(", ")})`);
    }
    // schema.org url fields must be absolute URLs
    if (obj.url && !/^https?:\/\//.test(obj.url)) {
      results.failed.push(`json-ld: ${type}.url is not an absolute URL: ${obj.url}`);
    }
  }
  for (const wanted of ["Organization", "SoftwareApplication"]) {
    if (!seenTypes.has(wanted)) results.failed.push(`json-ld: expected @type "${wanted}" not found`);
  }

  console.log("PASSED:");
  results.passed.forEach((p) => console.log("  ✓ " + p));
  console.log("FAILED:");
  results.failed.forEach((f) => console.log("  ✗ " + f));
  console.log(`\n${results.passed.length} passed, ${results.failed.length} failed`);

  if (results.failed.length > 0) process.exit(1);
}

main().catch((e) => {
  console.error("SCRIPT ERROR:", e);
  process.exit(1);
});
