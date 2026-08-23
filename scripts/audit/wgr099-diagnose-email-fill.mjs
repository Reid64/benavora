// WGR-099 diagnostic: inspect what WebKit's fill() actually does to the
// email input on /login, step by step, against the local dev server.
import { webkit } from "playwright";

const BASE_URL = process.argv[2] || "http://localhost:3000";

async function main() {
  const browser = await webkit.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("console", (msg) => console.log("[console]", msg.type(), msg.text()));
  page.on("pageerror", (err) => console.log("[pageerror]", String(err)));
  page.on("requestfailed", (req) =>
    console.log("[requestfailed]", req.method(), req.url(), req.failure()?.errorText),
  );
  page.on("response", (res) => {
    if (res.url().includes("supabase") || res.url().includes("/auth/")) {
      console.log("[response]", res.status(), res.url());
    }
  });

  await page.goto(BASE_URL + "/login", { waitUntil: "load" });

  const emailInput = page.getByLabel("Email");
  await emailInput.fill("beta1@benavora-test.com");

  const domValue = await emailInput.inputValue();
  console.log("DOM value immediately after fill():", JSON.stringify(domValue));

  await page.waitForTimeout(300);
  const domValueAfterWait = await emailInput.inputValue();
  console.log("DOM value after 300ms wait:", JSON.stringify(domValueAfterWait));

  const passwordInput = page.getByLabel("Password");
  await passwordInput.fill("BetaTest2026");

  const emailValueAfterPasswordFill = await emailInput.inputValue();
  console.log("Email DOM value after filling password:", JSON.stringify(emailValueAfterPasswordFill));

  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForTimeout(2000);
  console.log("URL 2s after click:", page.url());
  const alertText = await page.locator("[role=alert]").allTextContents();
  console.log("Alert texts 2s after click:", JSON.stringify(alertText));
  const emailValueAfterClick = await emailInput.inputValue().catch((e) => `ERR: ${e}`);
  console.log("Email DOM value 2s after click:", JSON.stringify(emailValueAfterClick));

  await page.waitForTimeout(5000);
  console.log("URL 7s after click:", page.url());

  const cookies = await context.cookies();
  console.log(
    "Cookies:",
    cookies.map((c) => c.name),
  );

  await page.waitForTimeout(20000);
  console.log("URL 27s after click:", page.url());

  await browser.close();
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
