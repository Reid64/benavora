import { chromium } from "playwright";
import path from "node:path";

const OUT = path.resolve("AUDIT_SCREENSHOTS/depth-system-2026-09-08");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://localhost:3000/", { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(600);

// "Three doors" mk Section cluster — card elevation + motif + typography
const doors = await page.locator("text=Three doors").first();
await doors.scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(OUT, "home-mk-section-cluster.png") });

// scroll to very bottom (forest CTA -> footer divider)
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(OUT, "home-footer-boundary.png") });

// ManualVsBenavora area
const manual = await page.locator("text=Six things fundraising teams do by hand").first();
await manual.scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(OUT, "home-manual-vs-benavora.png") });

await browser.close();
console.log("done");
