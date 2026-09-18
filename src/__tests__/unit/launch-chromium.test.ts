import { describe, it, expect, afterEach, vi } from "vitest";
import {
  launchChromium,
  resolveChromiumExecutablePath,
  type ChromiumLauncher,
} from "@/lib/browser/launch-chromium";

// `process.execPath` (the node binary running the test) is guaranteed to
// exist on every platform this suite runs on, so it's used as a stand-in
// "real file" wherever a test needs a path that must pass an existsSync
// check without depending on Chromium actually being installed.
const REAL_FILE_A = process.execPath;
const REAL_FILE_B = __filename;

function fakeChromium(launchImpl?: ChromiumLauncher["launch"]): ChromiumLauncher & { launch: ReturnType<typeof vi.fn> } {
  return {
    launch: vi.fn(launchImpl ?? (async () => ({} as never))),
  };
}

describe("launchChromium / resolveChromiumExecutablePath", () => {
  const ORIGINAL_ENV = process.env.CHROMIUM_EXECUTABLE_PATH;

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.CHROMIUM_EXECUTABLE_PATH;
    } else {
      process.env.CHROMIUM_EXECUTABLE_PATH = ORIGINAL_ENV;
    }
  });

  it("passes a non-empty executablePath through to launch()", async () => {
    delete process.env.CHROMIUM_EXECUTABLE_PATH;
    const chromium = fakeChromium();

    await launchChromium(chromium, { executablePath: REAL_FILE_A, headless: true });

    expect(chromium.launch).toHaveBeenCalledTimes(1);
    const passedOptions = chromium.launch.mock.calls[0]![0];
    expect(passedOptions.executablePath).toBeTruthy();
    expect(passedOptions.executablePath).toBe(REAL_FILE_A);
    // The caller's other launch options must survive untouched.
    expect(passedOptions.headless).toBe(true);
  });

  it("lets an explicit option override the env var", () => {
    process.env.CHROMIUM_EXECUTABLE_PATH = REAL_FILE_A;

    const resolved = resolveChromiumExecutablePath(REAL_FILE_B);

    expect(resolved).toBe(REAL_FILE_B);
    expect(resolved).not.toBe(REAL_FILE_A);
  });

  it("throws, naming the attempted paths, when nothing resolves", async () => {
    delete process.env.CHROMIUM_EXECUTABLE_PATH;
    const chromium = fakeChromium();
    // No executablePath() implementation at all: the default-Playwright-path
    // tier has nothing to try, so every real tier is exhausted.

    expect(() => resolveChromiumExecutablePath(undefined, chromium)).toThrow(/Tried:/);
    expect(() => resolveChromiumExecutablePath(undefined, chromium)).toThrow(/\/usr\/bin\/chromium/);
    await expect(launchChromium(chromium, {})).rejects.toThrow(/no Chromium executable found/);
    expect(chromium.launch).not.toHaveBeenCalled();
  });
});
