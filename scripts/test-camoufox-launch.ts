// camoufox-js declares "engines": { "node": ">=22" } and pulls in better-sqlite3's
// prebuilt native binary (used unconditionally by its WebGL fingerprint sampler on
// every launch, not just when webgl_config is passed). On this project's Node 20.x,
// that binary loads but segfaults on the first `new Database()` call inside
// launchOptions() — confirmed by isolating better-sqlite3 outside camoufox-js
// entirely. See STATE_OF_THE_BUILD.md's 2026-07-28 stealth-stack session entry.
import { Camoufox } from "camoufox-js";

async function main() {
  console.log("[1/5] camoufox-js imported OK");

  console.log("[2/5] launching Camoufox browser...");
  const browser = await Camoufox({ headless: true });
  console.log("[2/5] browser launched OK");

  try {
    console.log("[3/5] opening new page...");
    const page = await browser.newPage();
    console.log("[3/5] page opened OK");

    console.log("[4/5] navigating to https://example.com ...");
    await page.goto("https://example.com", { waitUntil: "domcontentloaded", timeout: 30000 });
    const title = await page.title();
    const bodyText = await page.evaluate(() => document.body?.innerText ?? "");
    console.log("[4/5] navigation complete");
    console.log("    page title:", JSON.stringify(title));
    console.log("    body text (first 200 chars):", JSON.stringify(bodyText.slice(0, 200)));

    if (!bodyText || !bodyText.toLowerCase().includes("example domain")) {
      throw new Error(`Page content did not contain expected text. Got: ${JSON.stringify(bodyText.slice(0, 500))}`);
    }
    console.log("[4/5] page content verified (contains 'Example Domain')");
  } finally {
    console.log("[5/5] closing browser...");
    await browser.close();
    console.log("[5/5] browser closed cleanly");
  }

  console.log("\nSMOKE TEST RESULT: PASS");
}

main().catch((err) => {
  console.error("\nSMOKE TEST RESULT: FAIL");
  console.error(err?.stack || err);
  process.exit(1);
});
