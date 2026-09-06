import { chromium } from "playwright";
import fs from "fs";

const BASE = "http://localhost:3100";
const OUT_DIR = "AUDIT_SCREENSHOTS/mkt-refresh-2026-09-06";
fs.mkdirSync(OUT_DIR, { recursive: true });

// Only the routes whose underlying source files show uncommitted git diffs
// since the 2026-09-05/06 mkt-full-audit pass: homepage (WhatWillItCost.tsx),
// /pricing (PricingPageClient.tsx, page.tsx), /for-consultants
// (ForConsultantsClient.tsx). Re-capturing these to confirm current rendered
// state rather than reusing now-possibly-stale screenshots.
const ROUTES = ["/", "/pricing", "/for-consultants"];

function slugify(route) {
  return route === "/" ? "home" : route.replace(/^\//, "").replace(/\//g, "_");
}

const results = [];
const browser = await chromium.launch();

for (const route of ROUTES) {
  const slug = slugify(route);
  const entry = { route, slug, desktop: null, mobile: null, status: null, error: null };
  try {
    const desktopPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const resp = await desktopPage.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 45000 });
    entry.status = resp ? resp.status() : null;
    await desktopPage.waitForTimeout(1200);
    const desktopPath = `${OUT_DIR}/${slug}__desktop-1440.png`;
    await desktopPage.screenshot({ path: desktopPath, fullPage: true });
    entry.desktop = desktopPath;
    await desktopPage.close();

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
