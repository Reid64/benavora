import { chromium } from "playwright";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const consoleMsgs = [];
  const failedReqs = [];
  page.on("console", (msg) => consoleMsgs.push(`${msg.type()}: ${msg.text()}`));
  page.on("pageerror", (err) => consoleMsgs.push("pageerror: " + err.message));
  page.on("response", (resp) => { if (resp.status() >= 400) failedReqs.push(resp.status() + " " + resp.url()); });

  const resp = await page.goto("https://benavora.com/", { waitUntil: "load", timeout: 45000 });
  await page.waitForTimeout(2000);
  console.log("status:", resp.status());
  console.log("final url:", page.url());

  // Find every element that looks like a Sign In control.
  const candidates = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll("a, button"));
    return els
      .filter((el) => /sign in/i.test(el.textContent || ""))
      .map((el, i) => {
        const rect = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return {
          i,
          tag: el.tagName,
          text: el.textContent.trim(),
          href: el.getAttribute("href"),
          disabled: el.disabled ?? null,
          rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
          visible: rect.width > 0 && rect.height > 0,
          display: cs.display,
          visibility: cs.visibility,
          opacity: cs.opacity,
          pointerEvents: cs.pointerEvents,
          zIndex: cs.zIndex,
          position: cs.position,
        };
      });
  });
  console.log("CANDIDATES:", JSON.stringify(candidates, null, 2));

  // For each candidate, check what's actually at that point (topmost element).
  const hitTest = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll("a, button")).filter((el) =>
      /sign in/i.test(el.textContent || ""),
    );
    return els.map((el) => {
      const rect = el.getBoundingClientRect();
      const cx = rect.x + rect.width / 2;
      const cy = rect.y + rect.height / 2;
      const topEl = document.elementFromPoint(cx, cy);
      return {
        text: el.textContent.trim(),
        centerPoint: { cx, cy },
        topElementAtPoint: topEl ? topEl.tagName + (topEl.className ? "." + String(topEl.className).replace(/\s+/g, ".") : "") : null,
        isSelfOrChild: topEl ? (el === topEl || el.contains(topEl)) : null,
        topElementOuterHTML: topEl ? topEl.outerHTML.slice(0, 200) : null,
      };
    });
  });
  console.log("HIT TEST:", JSON.stringify(hitTest, null, 2));

  // Attempt a real click on the first Sign In candidate.
  const before = page.url();
  try {
    const target = page.getByText("Sign In", { exact: false }).first();
    await target.scrollIntoViewIfNeeded({ timeout: 5000 });
    await target.click({ timeout: 5000 });
    await page.waitForTimeout(2000);
  } catch (err) {
    console.log("CLICK ERROR:", err.message);
  }
  const after = page.url();
  console.log("URL before click:", before);
  console.log("URL after click:", after);
  console.log("Navigation happened:", before !== after);

  console.log("CONSOLE:", JSON.stringify(consoleMsgs.slice(0, 30), null, 2));
  console.log("FAILED REQS:", JSON.stringify(failedReqs.slice(0, 20), null, 2));

  await page.screenshot({ path: "smoke-test-output/PROD-homepage-signin-2026-08-18.png", fullPage: false });
  await browser.close();
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
