import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const OUT = "AUDIT_SCREENSHOTS/pricing-rebuild-2026-09-05";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

await page.goto("http://localhost:3000/pricing", { waitUntil: "networkidle" });
await page.screenshot({ path: `${OUT}/pricing-full-annual.png`, fullPage: true });

// Toggle to monthly
await page.getByRole("button", { name: "Monthly" }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/pricing-full-monthly.png`, fullPage: true });

// Open first FAQ
await page.getByRole("button", { name: /How long does setup take/ }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/pricing-faq-open.png`, fullPage: true });

// Mobile viewport
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
await mobile.goto("http://localhost:3000/pricing", { waitUntil: "networkidle" });
await mobile.screenshot({ path: `${OUT}/pricing-mobile-full.png`, fullPage: true });

// Homepage WhatWillItCost section
const home = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await home.goto("http://localhost:3000/#fundraising-toolkit", { waitUntil: "networkidle" });
const costSection = home.locator("text=What will it cost and how fast can I start?").first();
await costSection.scrollIntoViewIfNeeded();
await home.waitForTimeout(300);
await home.screenshot({ path: `${OUT}/homepage-cost-section.png` });

await browser.close();
console.log("Screenshots saved to " + OUT);
