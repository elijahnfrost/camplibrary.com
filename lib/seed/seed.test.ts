import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { SEED_ACTIVITIES } from "./index";

// Guard: the built-in catalog must never ship a "search the game" URL. A generic
// activity should carry a specific, verified link (a real video or how-to page)
// or nothing — never google.com/search or a youtube.com/results search. Specific
// resources are curated in lib/seed/links.json (each fetched + relevance-checked
// at authoring time) and merged by scripts/build-seed.mjs. See docs/ai-authoring-guide.md.
const isSearchUrl = (url: string): boolean => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.replace(/^www\./, "");
  if (host === "google.com" || host.endsWith(".google.com")) {
    return parsed.pathname.startsWith("/search");
  }
  if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    return parsed.pathname.startsWith("/results");
  }
  return false;
};

describe("seed catalog link hygiene", () => {
  it("ships no Google or YouTube search URLs in any media or link", () => {
    const offenders: string[] = [];
    for (const a of SEED_ACTIVITIES) {
      for (const m of a.media || []) {
        if (isSearchUrl(m.url)) offenders.push(`${a.id} media: ${m.url}`);
      }
      for (const l of a.links || []) {
        if (isSearchUrl(l.url)) offenders.push(`${a.id} link: ${l.url}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every shipped media/link is a real http(s) URL", () => {
    for (const a of SEED_ACTIVITIES) {
      for (const l of a.links || []) {
        expect(l.url, `${a.id} link`).toMatch(/^https?:\/\//);
      }
      for (const m of a.media || []) {
        expect(m.url, `${a.id} media`).toMatch(/^https?:\/\//);
      }
    }
  });
});

describe("curated links.json", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const curated: Record<string, { media?: { title?: string; url: string }[]; links?: { label?: string; url: string }[] }> =
    JSON.parse(readFileSync(join(here, "links.json"), "utf8"));
  const ids = new Set(SEED_ACTIVITIES.map((a) => a.id));

  it("keys every entry to a real catalog activity", () => {
    const orphans = Object.keys(curated).filter((id) => !ids.has(id));
    expect(orphans).toEqual([]);
  });

  it("contains only specific, non-search http(s) URLs", () => {
    const offenders: string[] = [];
    for (const [id, entry] of Object.entries(curated)) {
      for (const m of entry.media || []) {
        if (!/^https?:\/\//.test(m.url) || isSearchUrl(m.url)) offenders.push(`${id} media: ${m.url}`);
      }
      for (const l of entry.links || []) {
        if (!/^https?:\/\//.test(l.url) || isSearchUrl(l.url)) offenders.push(`${id} link: ${l.url}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("actually merges into the shipped catalog", () => {
    // Sanity: every curated URL should appear on its activity after the build.
    const missing: string[] = [];
    for (const [id, entry] of Object.entries(curated)) {
      const a = SEED_ACTIVITIES.find((x) => x.id === id);
      const have = new Set([...(a?.media || []).map((m) => m.url), ...(a?.links || []).map((l) => l.url)]);
      for (const m of entry.media || []) if (!have.has(m.url)) missing.push(`${id}: ${m.url}`);
      for (const l of entry.links || []) if (!have.has(l.url)) missing.push(`${id}: ${l.url}`);
    }
    expect(missing).toEqual([]);
  });
});
