import { defineConfig } from "@playwright/test";

// Visual-regression suite (separate from the vitest unit tests, which match
// **/*.test.ts — these specs are *.spec.ts and live under tests/visual). It
// renders every surface at three viewports and diffs against committed
// baselines, so a future change that breaks a layout fails CI instead of
// shipping silently. Update baselines deliberately with `npm run test:visual:update`.
const PORT = Number(process.env.VISUAL_PORT ?? 5599);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./tests/visual",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  timeout: 60_000,
  expect: {
    toHaveScreenshot: {
      // A small tolerance absorbs sub-pixel font/antialiasing jitter across
      // machines without letting a real layout shift through.
      maxDiffPixelRatio: 0.015,
      animations: "disabled",
      scale: "css",
    },
  },
  use: {
    baseURL: BASE_URL,
    deviceScaleFactor: 1,
    locale: "en-US",
    timezoneId: "America/New_York",
    reducedMotion: "reduce",
    colorScheme: "light",
  },
  projects: [
    {
      name: "desktop",
      use: { viewport: { width: 1280, height: 900 }, hasTouch: false, isMobile: false },
    },
    {
      // iPad-portrait touch tablet: exercises the >=768 sidebar "desk" + the
      // hover:none touch-tier rules.
      name: "tablet",
      use: { viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true },
    },
    {
      name: "mobile",
      use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: BASE_URL,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    stdout: "ignore",
    stderr: "pipe",
  },
});
