// Marketing route smoke test: starts a production `next start` on port 3101,
// requests every route in src/lib/marketing/nav.ts's ALL_MARKETING_ROUTES,
// asserts HTTP 200 + a non-empty <title>, and screenshots each route to
// test-evidence/marketing/mkt-002/. Run `pnpm run build` before this script.
import { spawnSync, spawn } from "child_process";
import fs from "fs";
import path from "path";
import { chromium } from "playwright";

const PORT = 3101;
const BASE_URL = `http://localhost:${PORT}`;
const ROOT = process.cwd();
const EVIDENCE_DIR = path.join(ROOT, "test-evidence", "marketing", "mkt-002");
const NAV_FILE = path.join(ROOT, "src", "lib", "marketing", "nav.ts");

function readRoutes() {
  // ALL_MARKETING_ROUTES is built with array spreads (...PLATFORM.items.map(...)),
  // so a source-text regex cannot recover it; evaluate the real module with tsx.
  // A temp file (not --eval with an inline multi-line string) avoids Windows
  // shell-quoting corruption of the backslash-heavy absolute NAV_FILE path.
  const tmpScript = path.join(ROOT, "scripts", "marketing", ".routes-probe.mjs");
  let navImportPath = path.relative(path.dirname(tmpScript), NAV_FILE).replace(/\\/g, "/");
  if (!navImportPath.startsWith(".")) navImportPath = `./${navImportPath}`;
  fs.writeFileSync(
    tmpScript,
    `import { ALL_MARKETING_ROUTES } from ${JSON.stringify(navImportPath)};\n` +
      `process.stdout.write(JSON.stringify(ALL_MARKETING_ROUTES));\n`
  );
  try {
    const result = spawnSync("npx", ["tsx", tmpScript], {
      cwd: ROOT,
      encoding: "utf-8",
      shell: true,
    });
    if (result.status !== 0) {
      throw new Error(`Failed to evaluate ALL_MARKETING_ROUTES via tsx: ${result.stderr}`);
    }
    const routes = JSON.parse(result.stdout.trim());
    return Array.from(new Set(routes));
  } finally {
    fs.rmSync(tmpScript, { force: true });
  }
}

function slugForFile(route) {
  if (route === "/") return "home";
  return route.replace(/^\//, "").replace(/\//g, "-");
}

async function waitForServer(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(BASE_URL);
      if (res.status) return true;
    } catch {
      // server not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`next start did not become ready on port ${PORT} within ${timeoutMs}ms`);
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const routes = readRoutes();
  console.log(`Loaded ${routes.length} routes from nav.ts`);

  const server = spawn("npx", ["next", "start", "-p", String(PORT)], {
    cwd: ROOT,
    stdio: "inherit",
    shell: true,
  });

  let exitCode = 0;
  const results = [];

  try {
    await waitForServer(60000);

    const browser = await chromium.launch();
    const page = await browser.newPage();

    for (const route of routes) {
      const url = `${BASE_URL}${route}`;
      let status = 0;
      let title = "";
      let error = null;
      try {
        const response = await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
        status = response ? response.status() : 0;
        title = await page.title();
        const screenshotPath = path.join(EVIDENCE_DIR, `${slugForFile(route)}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }

      const pass = status === 200 && title.trim().length > 0 && !error;
      if (!pass) exitCode = 1;

      results.push({ route, status, title, pass, error });
      console.log(`${pass ? "PASS" : "FAIL"} ${route} -> status ${status}, title "${title}"${error ? `, error: ${error}` : ""}`);
    }

    await browser.close();
  } finally {
    // server was spawned with shell:true, so server.kill() only kills the
    // shell wrapper on Windows and leaves the next-server child holding the
    // port. taskkill /T kills the whole process tree.
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { shell: true });
    } else {
      server.kill();
    }
  }

  const routesJsonPath = path.join(EVIDENCE_DIR, "routes.json");
  fs.writeFileSync(
    routesJsonPath,
    JSON.stringify(
      {
        total: results.length,
        passed: results.filter((r) => r.pass).length,
        failed: results.filter((r) => !r.pass).length,
        results,
      },
      null,
      2
    )
  );

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} routes passed`);

  process.exit(exitCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
