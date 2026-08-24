// One-shot, self-contained evidence capture for WGR-168: starts `next dev`,
// waits for it to be ready, logs in, screenshots /autoapply/recordings after
// the funders-join fix, then tears the server down itself. Runs entirely
// inside one foreground process (spawns and reaps its own child) so nothing
// is left running in the background afterward.
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";

function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      fetch(BASE_URL)
        .then(() => resolve())
        .catch(() => {
          if (Date.now() > deadline) reject(new Error("dev server did not become ready in time"));
          else setTimeout(tryOnce, 1000);
        });
    };
    tryOnce();
  });
}

async function main() {
  const server = spawn("pnpm", ["run", "dev"], {
    cwd: process.cwd(),
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", () => {});
  server.stderr.on("data", () => {});

  try {
    await waitForServer(60000);

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/login`, { waitUntil: "load", timeout: 30000 });
    await page.fill("#email", "info@faithfoundationsf.org");
    await page.fill("#password", "Fasterman1945#@#");
    await page.click('button[type="submit"]');
    await page.waitForTimeout(4000);

    const consoleErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("response", (res) => {
      if (res.url().includes("session_recordings") && res.status() >= 400) {
        consoleErrors.push(`HTTP ${res.status()} on ${res.url()}`);
      }
    });

    await page.goto(`${BASE_URL}/autoapply/recordings`, { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(3000);
    await page.screenshot({
      path: "test-evidence/remediation/wgr-167/recordings-after.png",
      fullPage: true,
    });

    console.log("SCREENSHOT_SAVED");
    console.log("CONSOLE_ERRORS:", JSON.stringify(consoleErrors));
    await browser.close();
  } finally {
    server.kill("SIGTERM");
  }
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  process.exitCode = 1;
});
