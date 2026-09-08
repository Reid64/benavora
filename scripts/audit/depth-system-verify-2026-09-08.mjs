import { chromium } from "playwright";
import path from "node:path";

const OUT = path.resolve("AUDIT_SCREENSHOTS/depth-system-2026-09-08");
const VIEWPORT = { width: 1440, height: 1200 };

const PAGES = [
  { name: "home", url: "http://localhost:3000/" },
  { name: "platform-autoapply", url: "http://localhost:3000/platform/autoapply" },
  { name: "solutions-grant-discovery", url: "http://localhost:3000/solutions/grant-discovery-software" },
  { name: "pricing", url: "http://localhost:3000/pricing" },
];

const browser = await chromium.launch();
for (const { name, url } of PAGES) {
  const page = await browser.newPage({ viewport: VIEWPORT });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, `${name}-full.png`), fullPage: true });
  // also a viewport-only top-of-page shot for header/hero detail
  await page.screenshot({ path: path.join(OUT, `${name}-top.png`), fullPage: false });
  if (errors.length) {
    console.log(`[${name}] console/page errors:`, errors.slice(0, 5));
  } else {
    console.log(`[${name}] no console errors`);
  }
  await page.close();
}
await browser.close();
console.log("done");
