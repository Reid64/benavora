// Real smoke test for src/lib/scraper-v2/discovery.ts.
//
// Proves discoverUrls() is genuinely keyword-general, not nonprofit-specific,
// by running it against two real keywords with no nonprofit/foundation
// relevance at all and reporting the actual URLs discovered for each.

import { discoverUrls } from "../src/lib/scraper-v2/discovery";
import { UniversalFetcher } from "../src/lib/scraper-v2/universal-fetcher";

const KEYWORDS = ["artisan coffee roasters Nashville", "independent bookstores Seattle"];

async function main() {
  const fetcher = new UniversalFetcher({ headless: true, maxRetries: 2 });
  await fetcher.init();

  const summary: { keyword: string; count: number }[] = [];

  try {
    for (const keyword of KEYWORDS) {
      console.log(`\n=== "${keyword}" ===`);
      const found = await discoverUrls(keyword, undefined, { fetcher, maxResults: 15 });
      summary.push({ keyword, count: found.length });

      if (found.length === 0) {
        console.log("  (no URLs discovered)");
      } else {
        for (const item of found) {
          console.log(`  [${item.source}] ${item.url}`);
        }
      }
    }
  } finally {
    await fetcher.close();
  }

  console.log("\n=== SUMMARY ===");
  for (const s of summary) {
    console.log(`${s.count > 0 ? "PASS" : "FAIL"}  "${s.keyword}" -> ${s.count} URL(s)`);
  }

  const allPassed = summary.every((s) => s.count > 0);
  console.log(`\nSMOKE TEST RESULT: ${allPassed ? "PASS" : "FAIL"}`);
  if (!allPassed) process.exit(1);
}

main().catch((err) => {
  console.error("\nSMOKE TEST RESULT: FAIL");
  console.error(err?.stack || err);
  process.exit(1);
});
