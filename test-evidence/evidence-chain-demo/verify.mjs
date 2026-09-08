import { chromium } from "@playwright/test";
import path from "node:path";

const EVIDENCE_DIR = "C:\\Users\\manag\\Documents\\benavora\\test-evidence\\evidence-chain-demo";

const consoleMessages = [];
const pageErrors = [];

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

page.on("console", (msg) => {
  consoleMessages.push({ type: msg.type(), text: msg.text() });
});
page.on("pageerror", (err) => {
  pageErrors.push(err.message);
});

let report = {};

try {
  await page.goto("http://localhost:3000/trust", { waitUntil: "networkidle", timeout: 60000 });

  const toggle = page.getByRole("button", { name: /Every draft cites its source/i });
  const found = (await toggle.count()) > 0;
  report.buttonFound = found;

  if (found) {
    await toggle.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "before-click.png") });

    // Confirm collapsed state (no expanded content)
    const kbTitleBefore = await page.getByText("Program Description: Weekend Youth Tutoring").count();
    report.expandedContentVisibleBeforeClick = kbTitleBefore > 0;

    await toggle.click();
    await page.waitForTimeout(500); // css reveal transition

    const kbTitleAfter = page.getByText("Program Description: Weekend Youth Tutoring", { exact: false }).first();
    await kbTitleAfter.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);

    // Verify the 3 stages content
    const stage1Title = await page.getByText("Program Description: Weekend Youth Tutoring").count();
    const stage2Code = await page.getByText(/### Program Description: Weekend Youth Tutoring \(Program Description\)/).count();
    const stage3Citation = await page.getByText(/"kind": "knowledge_base"/).count();
    report.stage1Found = stage1Title > 0;
    report.stage2Found = stage2Code > 0;
    report.stage3JsonFound = stage3Citation > 0;

    await page.screenshot({ path: path.join(EVIDENCE_DIR, "after-click.png") });
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "after-click-fullpage.png"), fullPage: true });

    // Collapse again
    await toggle.scrollIntoViewIfNeeded();
    await toggle.click();
    await page.waitForTimeout(500);
    const stillExpandedCount = await page.getByText("Program Description: Weekend Youth Tutoring").count();
    report.collapsedAgainSuccessfully = stillExpandedCount === 0;
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "after-collapse.png") });
  }
} catch (e) {
  report.error = String(e && e.stack ? e.stack : e);
} finally {
  report.consoleMessages = consoleMessages;
  report.pageErrors = pageErrors;
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}
