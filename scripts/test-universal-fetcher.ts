// Real smoke test for src/lib/scraper-v2/universal-fetcher.ts.
//
// Fetches 3 different, real, varied live sites (not one cherry-picked URL —
// a news site, a small business site, and a .gov site) and reports actual
// retrieved content length for each, plus the last_fetch_error diagnostic on
// any failure so a bad run is never silent.

import { UniversalFetcher } from "../src/lib/scraper-v2/universal-fetcher";

const TARGETS = [
  { label: "news site", url: "https://apnews.com" },
  { label: "small business site", url: "https://www.kingarthurbaking.com" },
  { label: ".gov site", url: "https://www.irs.gov" },
];

async function main() {
  const fetcher = new UniversalFetcher({ headless: true, maxRetries: 3 });
  await fetcher.init();

  const results: { label: string; url: string; success: boolean; status: number | null; contentLength: number; attempts: number; fetchError: string | null }[] = [];

  try {
    for (const target of TARGETS) {
      console.log(`\nFetching ${target.label}: ${target.url}`);
      const result = await fetcher.fetchPage(target.url);
      results.push({
        label: target.label,
        url: target.url,
        success: result.success,
        status: result.status,
        contentLength: result.contentLength,
        attempts: result.attempts,
        fetchError: result.fetchError,
      });
      console.log(
        `  status=${result.status} success=${result.success} attempts=${result.attempts} contentLength=${result.contentLength}` +
          (result.fetchError ? ` fetchError=${result.fetchError}` : ""),
      );
    }
  } finally {
    await fetcher.close();
  }

  console.log("\n=== SUMMARY ===");
  for (const r of results) {
    console.log(`${r.success ? "PASS" : "FAIL"}  ${r.label.padEnd(22)} ${r.url.padEnd(35)} ${r.contentLength} chars (${r.attempts} attempt(s))`);
  }

  const allPassed = results.every((r) => r.success && r.contentLength > 0);
  console.log(`\nSMOKE TEST RESULT: ${allPassed ? "PASS" : "FAIL"}`);
  if (!allPassed) process.exit(1);
}

main().catch((err) => {
  console.error("\nSMOKE TEST RESULT: FAIL");
  console.error(err?.stack || err);
  process.exit(1);
});
