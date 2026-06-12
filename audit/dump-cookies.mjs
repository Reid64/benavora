// Log in via the real UI and dump cookies to a Netscape cookie jar curl can use.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const BASE = "http://localhost:3000";
const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.fill("#email", "reid@benavora.com");
await page.fill("#password", "test1234");
await page.click('button[type="submit"]');
await page.waitForURL("**/dashboard", { timeout: 30000 });
console.log("Logged in, url:", page.url());

const cookies = await ctx.cookies();
// Netscape cookie file format
let jar = "# Netscape HTTP Cookie File\n";
for (const c of cookies) {
  const domain = c.domain.startsWith(".") ? c.domain : c.domain;
  const flag = domain.startsWith(".") ? "TRUE" : "FALSE";
  const secure = c.secure ? "TRUE" : "FALSE";
  const expires = c.expires && c.expires > 0 ? Math.floor(c.expires) : 0;
  jar += [domain, flag, c.path, secure, expires, c.name, c.value].join("\t") + "\n";
}
writeFileSync("audit/cookies.txt", jar);
console.log("Wrote", cookies.length, "cookies:", cookies.map((c) => c.name).join(", "));
await browser.close();
