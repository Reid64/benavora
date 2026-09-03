// Verify the ChatbotAssistant gives page-specific guidance: on Opportunities,
// asking "How do I use this page?" should answer about the Opportunities catalog,
// not a generic or wrong-page answer.
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { WebSocket } from "ws";
if (typeof globalThis.WebSocket === "undefined") globalThis.WebSocket = WebSocket;

function loadEnv() {
  const raw = readFileSync(".env.local", "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return env;
}
const env = loadEnv();
const BASE_URL = process.argv[2] || "http://localhost:3000";

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function loginAs(context, email) {
  const { data: linkData, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw error;
  const verifyResp = await fetch(linkData.properties.action_link, { redirect: "manual" });
  const location = verifyResp.headers.get("location") || "";
  const hash = location.split("#")[1];
  const params = new URLSearchParams(hash);
  const access_token = params.get("access_token");
  const refresh_token = params.get("refresh_token");
  const { createServerClient } = await import("@supabase/ssr");
  const setCookies = [];
  const authForCookies = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: { getAll: () => [], setAll: (list) => setCookies.push(...list) },
  });
  await authForCookies.auth.setSession({ access_token, refresh_token });
  const domain = new URL(BASE_URL).hostname;
  await context.addCookies(setCookies.map((c) => ({ name: c.name, value: c.value, domain, path: "/" })));
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await loginAs(context, "info@faithfoundationsf.org");
  const page = await context.newPage();

  await page.goto(`${BASE_URL}/opportunities`, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(1500);

  const toggleBtn = page.locator("button[aria-label='Open assistant']");
  await toggleBtn.click();
  await page.waitForTimeout(300);

  const textarea = page.locator("textarea[placeholder='Type a question...']");
  await textarea.fill("How do I use this page?");
  await textarea.press("Enter");
  await page.waitForTimeout(500);

  const dialog = page.locator("div[role='dialog']");
  const assistantBubbles = dialog.locator("div.whitespace-pre-wrap");
  const count = await assistantBubbles.count();
  const lastAnswer = count > 0 ? await assistantBubbles.nth(count - 1).textContent() : "";

  await page.screenshot({ path: "test-evidence/chatbot-assistant/opportunities-qa.png" });

  console.log("ANSWER:", lastAnswer);
  const isOpportunitySpecific =
    /opportunit/i.test(lastAnswer || "") &&
    /probability|catalog|eligibility|funder/i.test(lastAnswer || "");
  console.log(isOpportunitySpecific ? "OPPORTUNITY_SPECIFIC_PASS" : "OPPORTUNITY_SPECIFIC_FAIL");

  await browser.close();
  if (!isOpportunitySpecific) process.exit(1);
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
