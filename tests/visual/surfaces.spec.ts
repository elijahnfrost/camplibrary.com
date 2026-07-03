import { test, expect, type Page } from "@playwright/test";

// Visual-regression baselines for every surface, at each project's viewport
// (desktop / tablet / mobile — Playwright suffixes the snapshot name with the
// project). Determinism: a frozen clock pins the calendar's "today", the Next
// dev overlay is hidden, fonts are awaited, and entrance animations are frozen
// by toHaveScreenshot. A fresh browser context seeds the static built-in
// library with no custom camps/events, so the rendered state is stable.

const FROZEN = new Date("2026-06-15T13:00:00"); // Mon Jun 15 2026 → stable week/day

async function hideDevChrome(page: Page) {
  await page.addStyleTag({
    content:
      "nextjs-portal,[data-nextjs-dev-overlay],[data-nextjs-toast]{display:none!important}",
  });
}

async function quiet(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
}

async function gotoApp(page: Page) {
  await page.clock.setFixedTime(FROZEN);
  await page.goto("/");
  await page.waitForLoadState("load");
  await hideDevChrome(page);
  await quiet(page);
}

// Click the visible primary-nav control (sidebar on >=768, bottom tab bar on phones).
async function nav(page: Page, name: string) {
  await page
    .locator(".sidenav__item:visible, .tabbar button:visible")
    .filter({ hasText: name })
    .first()
    .click();
  await quiet(page);
}

async function libraryView(page: Page, label: "Shelf" | "Deck" | "Catalog") {
  await page.getByRole("button", { name: label, exact: true }).click();
  await quiet(page);
}

test.describe("surfaces", () => {
  // The default landing is the calendar now (the Home tab is retired — the
  // calendar is the app's home, and its rail carries the Now/Next "Today" card).
  test("landing (calendar)", async ({ page }) => {
    await gotoApp(page);
    await expect(page).toHaveScreenshot("landing.png");
  });

  test("library — deck", async ({ page }) => {
    await gotoApp(page);
    await nav(page, "Library");
    await libraryView(page, "Deck");
    await expect(page).toHaveScreenshot("library-deck.png");
  });

  test("library — catalog", async ({ page }) => {
    await gotoApp(page);
    await nav(page, "Library");
    await libraryView(page, "Catalog");
    await expect(page).toHaveScreenshot("library-catalog.png");
  });

  test("library — shelf", async ({ page }) => {
    await gotoApp(page);
    await nav(page, "Library");
    await libraryView(page, "Shelf");
    await expect(page).toHaveScreenshot("library-shelf.png");
  });

  test("detail sheet (the book)", async ({ page }) => {
    await gotoApp(page);
    await nav(page, "Library");
    await libraryView(page, "Deck");
    await page.getByRole("button", { name: "Capture the Flag", exact: true }).first().click();
    await quiet(page);
    await expect(page).toHaveScreenshot("detail-sheet.png");
  });

  test("activity editor", async ({ page }) => {
    await gotoApp(page);
    await nav(page, "Library");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await quiet(page);
    await expect(page).toHaveScreenshot("editor.png");
  });

  test("calendar", async ({ page }) => {
    await gotoApp(page);
    await nav(page, "Calendar");
    await expect(page).toHaveScreenshot("calendar.png");
  });

  test("print", async ({ page }) => {
    // Print is reachable on every viewport (sidebar at the desk, the bottom tab
    // bar on touch), so it's covered at all three. The Paged.js preview is the
    // heaviest surface; we wait for the first page-set to settle before diffing.
    await gotoApp(page);
    await nav(page, "Print");
    // The loading veil clears to data-status="paged" (or "fallback") once the
    // first page-set lands — diff the settled document, not the loading veil.
    await page.waitForSelector('.paged-preview:not([data-status="loading"])', { timeout: 30_000 });
    await quiet(page);
    await expect(page).toHaveScreenshot("print.png");
  });
});
