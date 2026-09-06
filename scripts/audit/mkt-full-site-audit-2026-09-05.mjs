import { chromium } from "playwright";
import fs from "fs";

const BASE = "http://localhost:3100";
const OUT_DIR = "AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05";
fs.mkdirSync(OUT_DIR, { recursive: true });

// Ground-truth route list derived directly from src/app/sitemap.ts logic
// (static page.tsx walk + content/marketing MDX catch-all, minus shadowed
// duplicates) on 2026-09-05, plus /login per task instructions.
const ROUTES = [
  "/",
  "/demo",
  "/for-consultants",
  "/how-it-works",
  "/platform/autoapply",
  "/platform/discovery",
  "/platform/draft-generator",
  "/platform/prospect-intelligence",
  "/pricing",
  "/privacy",
  "/scan",
  "/security",
  "/solutions/ai-grant-writing-software",
  "/solutions/autonomous-fundraising-platform",
  "/solutions/corporate-donation-application-software",
  "/solutions/corporate-giving-database",
  "/solutions/donor-prospecting-intelligence",
  "/solutions/funding-operations-software",
  "/solutions/funding-pipeline-software",
  "/solutions/grant-application-automation",
  "/solutions/grant-deadline-tracking",
  "/solutions/grant-discovery-software",
  "/solutions/grant-matching-software",
  "/solutions/human-in-the-loop-ai",
  "/solutions/nonprofit-funding-software",
  "/solutions/nonprofit-outreach-automation",
  "/solutions/nonprofit-prospect-research",
  "/terms",
  "/tour",
  "/agents",
  "/company",
  "/platform",
  "/platform/ai-grant-writer",
  "/platform/analytics",
  "/platform/funding-intelligence",
  "/platform/opportunity-discovery",
  "/platform/pipeline-crm",
  "/resources",
  "/solutions",
  "/solutions/community-development",
  "/solutions/education",
  "/solutions/faith-based",
  "/solutions/housing",
  "/solutions/human-services",
  "/solutions/veterans",
  "/trust",
  "/why-benavora",
  "/login",
];

function slugify(route) {
  return route === "/" ? "home" : route.replace(/^\//, "").replace(/\//g, "_");
}

const results = [];

const browser = await chromium.launch();

for (const route of ROUTES) {
  const slug = slugify(route);
  const entry = { route, slug, desktop: null, mobile: null, status: null, error: null };
  try {
    // Desktop 1440
    const desktopPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const resp = await desktopPage.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 45000 });
    entry.status = resp ? resp.status() : null;
    await desktopPage.waitForTimeout(1200);
    const desktopPath = `${OUT_DIR}/${slug}__desktop-1440.png`;
    await desktopPage.screenshot({ path: desktopPath, fullPage: true });
    entry.desktop = desktopPath;
    await desktopPage.close();

    // Mobile 390
    const mobilePage = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await mobilePage.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 45000 });
    await mobilePage.waitForTimeout(1200);
    const mobilePath = `${OUT_DIR}/${slug}__mobile-390.png`;
    await mobilePage.screenshot({ path: mobilePath, fullPage: true });
    entry.mobile = mobilePath;
    await mobilePage.close();

    console.log(`OK  ${route}  (status ${entry.status})`);
  } catch (err) {
    entry.error = String(err);
    console.log(`FAIL ${route}: ${err}`);
  }
  results.push(entry);
}

await browser.close();

fs.writeFileSync(`${OUT_DIR}/manifest.json`, JSON.stringify(results, null, 2));
console.log("\nDone. Manifest:", `${OUT_DIR}/manifest.json`);
console.log("Total routes:", ROUTES.length, " Failures:", results.filter(r => r.error).length);
