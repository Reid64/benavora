import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const OUT_DIR = "test-evidence/lifecycle-flow-animation";
mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });
const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => consoleErrors.push(String(err)));

await page.goto("http://localhost:3000", { waitUntil: "networkidle" });

const brainNode = page.getByRole("button", { name: /Prospect Discovery/ });
await brainNode.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${OUT_DIR}/00-brain-before-click.png` });

const flowSection = page.locator(".bm-hiw-flow");
await flowSection.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${OUT_DIR}/01-flow-before-click.png` });

// Playwright's .click() auto-scrolls the target into view first, which would
// yank the viewport away from the flow diagram below — so scroll back to the
// flow diagram immediately after the click fires, before screenshotting.
await brainNode.click();
await flowSection.scrollIntoViewIfNeeded();

// Capture a burst of frames across the ~4.2s sweep to prove motion. Element
// screenshots (not full-page) so the particle trail is legible at full size.
const delays = [150, 700, 1400, 2100, 2800, 3500, 4300, 5500];
for (let i = 0; i < delays.length; i++) {
  await page.waitForTimeout(i === 0 ? delays[0] : delays[i] - delays[i - 1]);
  await flowSection.screenshot({ path: `${OUT_DIR}/${String(i + 2).padStart(2, "0")}-sweep-t${delays[i]}ms.png` });
}
await page.screenshot({ path: `${OUT_DIR}/09b-full-page-after-sweep.png` });

// Independently test the standalone Replay button.
const replayBtn = page.getByRole("button", { name: /Replay the lifecycle sequence/ });
await replayBtn.scrollIntoViewIfNeeded();
await replayBtn.click();
const replayDelays = [200, 900, 1800, 2700];
for (let i = 0; i < replayDelays.length; i++) {
  await page.waitForTimeout(i === 0 ? replayDelays[0] : replayDelays[i] - replayDelays[i - 1]);
  await flowSection.screenshot({ path: `${OUT_DIR}/${String(i + 10).padStart(2, "0")}-replay-t${replayDelays[i]}ms.png` });
}

console.log("CONSOLE_ERRORS:", JSON.stringify(consoleErrors));
await browser.close();
