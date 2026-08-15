// Live adversarial SSRF re-test against src/lib/security/safe-fetch.ts (rows #59/#60).
// Run via: npx tsx scripts/security-test-ssrf.mjs
import { safeFetch, SsrfBlockedError } from "../src/lib/security/safe-fetch.ts";

const payloads = [
  { name: "cloud metadata IP literal", url: "http://169.254.169.254/latest/meta-data/" },
  { name: "loopback IP literal", url: "http://127.0.0.1:22/" },
  { name: "loopback hostname", url: "http://localhost:5432/" },
  { name: "RFC1918 10.x", url: "http://10.0.0.1/" },
  { name: "RFC1918 192.168.x", url: "http://192.168.1.1/" },
  { name: "RFC1918 172.16-31.x", url: "http://172.16.0.1/" },
  { name: "IPv6 loopback", url: "http://[::1]/" },
  { name: "IPv4-mapped IPv6 smuggling loopback", url: "http://[::ffff:127.0.0.1]/" },
  { name: "non-http scheme (file)", url: "file:///etc/passwd" },
  { name: "non-http scheme (gopher)", url: "gopher://127.0.0.1:6379/_INFO" },
  { name: "CGNAT 100.64.x", url: "http://100.64.0.1/" },
  { name: "redirect to internal (httpbin -> 169.254.169.254)", url: "https://httpbin.org/redirect-to?url=http://169.254.169.254/latest/meta-data/", expectMaybeNetworkFail: true },
  { name: "legitimate public target (control, should succeed)", url: "https://example.com/", expectBlocked: false },
];

let blocked = 0, allowed = 0, errors = 0;
const results = [];

for (const p of payloads) {
  try {
    const res = await safeFetch(p.url, { timeoutMs: 8000 });
    const line = `ALLOWED  (status ${res.status}) — ${p.name} — ${p.url}`;
    console.log(line);
    results.push({ ...p, outcome: "allowed", status: res.status });
    if (p.expectBlocked === false) allowed++; else allowed++;
  } catch (err) {
    if (err instanceof SsrfBlockedError) {
      console.log(`BLOCKED  — ${p.name} — ${p.url} — ${err.message}`);
      results.push({ ...p, outcome: "blocked", message: err.message });
      blocked++;
    } else {
      console.log(`ERROR(network, not SSRF-block) — ${p.name} — ${p.url} — ${err.message}`);
      results.push({ ...p, outcome: "network_error", message: err.message });
      errors++;
    }
  }
}

console.log(`\nSummary: ${blocked} blocked, ${allowed} allowed, ${errors} network errors, out of ${payloads.length} payloads.`);
console.log(JSON.stringify(results, null, 2));
