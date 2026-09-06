import { chromium } from "playwright";

const PAGES = [
  "/solutions/funding-pipeline-software",
  "/solutions/corporate-giving-database",
  "/solutions/corporate-donation-application-software",
  "/solutions/nonprofit-prospect-research",
  "/solutions/donor-prospecting-intelligence",
];

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

let anyErrors = false;

for (const path of PAGES) {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
  });
  page.on("response", (res) => {
    if (res.url().includes("/marketing/") && res.status() >= 400) {
      errors.push(`bad image response: ${res.status()} ${res.url()}`);
    }
  });

  const resp = await page.goto(`http://localhost:3000${path}`, {
    waitUntil: "load",
    timeout: 60000,
  });
  await page.waitForTimeout(1500);

  const status = resp?.status() ?? -1;
  const fileSlug = path.split("/").pop();
  await page.screenshot({ path: `AUDIT_SCREENSHOTS/qa-${fileSlug}.png`, fullPage: true });

  console.log(`${path} -> HTTP ${status}, ${errors.length} error(s)`);
  for (const e of errors) console.log(`   ${e}`);
  if (status !== 200 || errors.length > 0) anyErrors = true;

  await page.close();
}

await browser.close();
if (anyErrors) {
  console.log("RESULT: FAIL - see errors above");
  process.exit(1);
} else {
  console.log("RESULT: PASS - all 5 pages loaded HTTP 200 with no console/page errors");
}
