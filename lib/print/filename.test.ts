import { describe, expect, it } from "vitest";
import { DEFAULT_PRINT_FORMAT, type PrintOptions } from "./options";
import { exportFilename, slugify } from "./filename";

function opts(partial: Partial<PrintOptions>): PrintOptions {
  return {
    ...DEFAULT_PRINT_FORMAT,
    start: "2026-06-16",
    end: "2026-06-18",
    campId: null,
    title: "",
    ...partial,
  };
}

describe("slugify", () => {
  it("collapses spaces/underscores to single dashes", () => {
    expect(slugify("Week of  Jan 16")).toBe("Week-of-Jan-16");
    expect(slugify("Ocean__Week")).toBe("Ocean-Week");
  });

  it("drops punctuation and trims stray dashes", () => {
    expect(slugify("  —Pizza! Friday—  ")).toBe("Pizza-Friday");
    expect(slugify("A/B & C")).toBe("A-B-C");
  });

  it("strips diacritics down to ASCII", () => {
    expect(slugify("Forêt Été")).toBe("Foret-Ete");
  });

  it("returns empty string for punctuation-only input", () => {
    expect(slugify("—  !!! ")).toBe("");
  });
});

describe("exportFilename", () => {
  it("uses the custom title when present, over the camp name", () => {
    expect(exportFilename(opts({ title: "Ocean Week" }), "Sunrise Camp")).toBe(
      "Camp-Library_Ocean-Week_2026-06-16_2026-06-18"
    );
  });

  it("falls back to the camp name when there is no title", () => {
    expect(exportFilename(opts({}), "Sunrise Camp")).toBe(
      "Camp-Library_Sunrise-Camp_2026-06-16_2026-06-18"
    );
  });

  it("omits the label segment when neither title nor camp is set", () => {
    expect(exportFilename(opts({}), null)).toBe("Camp-Library_2026-06-16_2026-06-18");
  });

  it("collapses a single-day range to one date", () => {
    expect(exportFilename(opts({ start: "2026-06-16", end: "2026-06-16" }), null)).toBe(
      "Camp-Library_2026-06-16"
    );
  });
});
