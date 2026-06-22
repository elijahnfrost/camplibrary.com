import { describe, expect, it } from "vitest";
import { SEED_ACTIVITIES } from "./index";

// Guard: the built-in catalog must never ship a "search the game" URL. A generic
// game like Sharks & Minnows should carry a specific verified link or nothing —
// never google.com/search or a youtube.com/results search. This locks in the
// fix from build-seed.mjs so the pattern can't creep back in via a regeneration
// or a hand-authored staple. See docs/ai-authoring-guide.md.
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

  it("ships no fabricated/unverifiable YouTube watch ids as media", () => {
    const offenders: string[] = [];
    for (const a of SEED_ACTIVITIES) {
      for (const m of a.media || []) {
        if (/youtube\.com\/(watch|shorts|embed)|youtu\.be\//.test(m.url)) {
          offenders.push(`${a.id} media: ${m.url}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every shipped link is a real http(s) URL", () => {
    for (const a of SEED_ACTIVITIES) {
      for (const l of a.links || []) {
        expect(l.url).toMatch(/^https?:\/\//);
      }
      for (const m of a.media || []) {
        expect(m.url).toMatch(/^https?:\/\//);
      }
    }
  });
});
