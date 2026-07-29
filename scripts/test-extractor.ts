// Real smoke test for src/lib/scraper-v2/extractor.ts.
//
// Reuses the same real pages already proven fetchable by the earlier
// scraper-v2 smoke tests — kingarthurbaking.com (uscraper-004's
// test-universal-fetcher.ts business-site target) and a real business page
// discovered via discoverUrls() for "artisan coffee roasters Nashville"
// (uscraper-003's test-discovery.ts keyword) — fetches them live, and runs
// extractStructured() against each with a simple business-contact schema.
// Prints the actual extracted output AND greps the raw fetched HTML for
// each non-null value, so the result can be checked against the real page
// for hallucination, not just a pass/fail count.

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { UniversalFetcher } from "../src/lib/scraper-v2/universal-fetcher";
import { discoverUrls } from "../src/lib/scraper-v2/discovery";
import { extractStructured } from "../src/lib/scraper-v2/extractor";

const SCHEMA = { business_name: "string", phone: "string", address: "string" } as const;
const KEYWORD = "artisan coffee roasters Nashville";

async function main() {
  const fetcher = new UniversalFetcher({ headless: true, maxRetries: 3 });
  await fetcher.init();

  try {
    const targets: { label: string; url: string }[] = [{ label: "kingarthurbaking.com (uscraper-004 target)", url: "https://www.kingarthurbaking.com" }];

    console.log(`\nDiscovering a real business page for "${KEYWORD}" (uscraper-003 keyword)...`);
    const discovered = await discoverUrls(KEYWORD, undefined, { fetcher, maxResults: 5 });
    if (discovered.length > 0 && discovered[0]) {
      targets.push({ label: `discovered via "${KEYWORD}"`, url: discovered[0].url });
      console.log(`  using: ${discovered[0].url}`);
    } else {
      console.log("  (no URL discovered — proceeding with only the kingarthurbaking.com target)");
    }

    for (const target of targets) {
      console.log(`\n=== ${target.label} ===`);
      console.log(`URL: ${target.url}`);

      const fetchResult = await fetcher.fetchPage(target.url);
      if (!fetchResult.success || !fetchResult.html) {
        console.log(`  FETCH FAILED: ${fetchResult.fetchError}`);
        continue;
      }
      console.log(`  fetched ${fetchResult.contentLength} chars of HTML`);

      const extracted = await extractStructured(fetchResult.html, KEYWORD, SCHEMA, target.url);
      console.log(`  readabilityFallback=${extracted.readabilityFallback} extractedTextLength=${extracted.extractedTextLength} extractedTitle=${JSON.stringify(extracted.extractedTitle)}`);
      console.log(`  tokens: input=${extracted.usage.inputTokens} output=${extracted.usage.outputTokens}`);
      console.log("  EXTRACTED DATA:", JSON.stringify(extracted.data, null, 2));

      console.log("  HALLUCINATION CHECK (does each non-null value literally appear in the raw fetched HTML?):");
      for (const [field, value] of Object.entries(extracted.data)) {
        if (value === null) {
          console.log(`    ${field}: null (skip check)`);
          continue;
        }
        const found = fetchResult.html.includes(String(value));
        console.log(`    ${field}="${value}" -> ${found ? "FOUND VERBATIM IN RAW HTML" : "NOT FOUND VERBATIM (needs manual review)"}`);
      }
    }
  } finally {
    await fetcher.close();
  }
}

main().catch((err) => {
  console.error("\nTEST FAILED");
  console.error(err?.stack || err);
  process.exit(1);
});
