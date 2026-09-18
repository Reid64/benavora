// launchChromium — the single Chromium launch path for every browser-automation
// call site in this repo (AutoApply stealth browser, EA-0x enrichment agents,
// the universal scraper, AutoApply's BrowserEngine, and the manual scrape-*
// scripts).
//
// AR-7.1 root cause (production evidence 2026-09-17, five agents / 215 failed
// runs): worker/Dockerfile installs Debian's `chromium` apt package and sets
// PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 so Playwright never downloads its own
// bundled browser into the image. Exactly one of six `chromium.launch()` call
// sites (src/lib/autoapply/stealth-browser.ts) read the env var pointing at
// that system binary and passed it through as `executablePath`. The other
// five called `chromium.launch()` with no executablePath, so Playwright fell
// back to its own (empty, because downloads were skipped) bundled-browser
// cache and threw "Executable doesn't exist at
// /root/.cache/ms-playwright/...". Patching each site individually just
// recreates this bug the next time someone adds a seventh launch call — the
// fix has to be the class, not the instance.
//
// This module resolves the executable ONCE per call, in a fixed order, and
// fails loudly (naming every path it tried) when none of them exist, rather
// than handing Playwright an unset/wrong path and letting the failure surface
// three stack frames later inside Playwright's own error — which is exactly
// how these five agents ended up silently returning empty enrichment instead
// of a visible error.
//
// Resolution order:
//   1. an explicit `options.executablePath` passed by the caller
//   2. the CHROMIUM_EXECUTABLE_PATH env var (set by worker/Dockerfile in
//      production; NOT a real Playwright env var — see below)
//   3. known system install locations for the Debian/Ubuntu `chromium` and
//      `google-chrome` apt packages
//   4. the Chromium binary Playwright itself would use by default (its own
//      downloaded browser cache) — this is what makes local development work
//      without setting any env var, since PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD is
//      only set inside the worker container, not on a dev machine
//
// NOTE on the env var name: this was previously called
// PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, which looks like a real Playwright
// environment variable but is not one — Playwright does not read it. Renamed
// to CHROMIUM_EXECUTABLE_PATH so it no longer impersonates framework
// behavior it doesn't have.

import { existsSync } from "node:fs";
import type { Browser, LaunchOptions } from "playwright";

/** Debian/Ubuntu apt package install locations, in the order worker/Dockerfile would produce them. */
export const KNOWN_SYSTEM_CHROMIUM_PATHS: readonly string[] = [
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
];

/**
 * The subset of a Playwright `BrowserType` (or a playwright-extra wrapped
 * equivalent) that launchChromium needs. Accepting this instead of importing
 * `chromium` directly lets every call site keep using its own import —
 * plain `playwright` in some files, the stealth-plugin-wrapped
 * `playwright-extra` singleton in others.
 */
export interface ChromiumLauncher {
  launch(options?: LaunchOptions): Promise<Browser>;
  executablePath?(): string;
}

/**
 * Resolves a Chromium executable path, or throws naming every path tried.
 * Exported separately from launchChromium so resolution logic can be unit
 * tested without a real browser launch.
 */
export function resolveChromiumExecutablePath(
  explicitPath?: string,
  chromiumLike?: ChromiumLauncher,
): string {
  const tried: string[] = [];

  if (explicitPath) {
    tried.push(explicitPath);
    if (existsSync(explicitPath)) return explicitPath;
  }

  const envPath = process.env.CHROMIUM_EXECUTABLE_PATH;
  if (envPath) {
    tried.push(envPath);
    if (existsSync(envPath)) return envPath;
  }

  for (const candidate of KNOWN_SYSTEM_CHROMIUM_PATHS) {
    tried.push(candidate);
    if (existsSync(candidate)) return candidate;
  }

  if (chromiumLike?.executablePath) {
    try {
      const defaultPath = chromiumLike.executablePath();
      tried.push(defaultPath);
      if (existsSync(defaultPath)) return defaultPath;
    } catch {
      // Some chromium-like objects (playwright-extra's proxy, test stubs)
      // may not implement executablePath() at all — that's fine, it's the
      // last tier of resolution, not a required one.
    }
  }

  throw new Error(
    `launchChromium: no Chromium executable found. Tried: ${
      tried.length ? tried.join(", ") : "(no candidates - set CHROMIUM_EXECUTABLE_PATH or pass options.executablePath)"
    }`,
  );
}

/**
 * Launches Chromium through `chromiumLike` (the caller's own `chromium`
 * import — plain playwright or a playwright-extra stealth wrapper) with a
 * resolved `executablePath` applied. Every other launch option the caller
 * passes (headless, args, proxy, etc.) is preserved as-is.
 */
export async function launchChromium(
  chromiumLike: ChromiumLauncher,
  options: LaunchOptions = {},
): Promise<Browser> {
  const executablePath = resolveChromiumExecutablePath(options.executablePath, chromiumLike);
  return chromiumLike.launch({ ...options, executablePath });
}
