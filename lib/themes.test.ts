import { describe, expect, it } from "vitest";
import {
  nextPaletteTint,
  normalizeThemeAssignments,
  normalizeThemes,
  THEME_PALETTE,
  type Theme,
} from "./themes";

describe("theme vocabulary normalization", () => {
  it("keeps well-formed themes and drops malformed ones", () => {
    const result = normalizeThemes(
      [
        { id: "t1", label: "Ocean Week", tint: THEME_PALETTE[0] },
        { id: "", label: "No id" },
        { id: "t2", label: "" },
        { id: "t3", label: "Jungle Week" },
        "not an object",
      ],
      []
    );
    expect(result.map((t) => t.id)).toEqual(["t1", "t3"]);
    expect(result[0].tint).toBe(THEME_PALETTE[0]);
  });

  it("clamps an unknown tint back onto the palette", () => {
    const [theme] = normalizeThemes([{ id: "t1", label: "Ocean", tint: "#ff0000" }], []);
    expect(THEME_PALETTE).toContain(theme.tint);
  });

  it("trims labels and dedupes by id", () => {
    const result = normalizeThemes(
      [
        { id: "t1", label: "  Ocean Week  " },
        { id: "t1", label: "Duplicate" },
      ],
      []
    );
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("Ocean Week");
  });

  it("falls back when the value is not an array", () => {
    const fallback: Theme[] = [{ id: "f", label: "Fallback", tint: THEME_PALETTE[0] }];
    expect(normalizeThemes("nope", fallback)).toBe(fallback);
    expect(normalizeThemes(null, fallback)).toBe(fallback);
  });

  it("assigns palette tints round-robin", () => {
    expect(nextPaletteTint(0)).toBe(THEME_PALETTE[0]);
    expect(nextPaletteTint(THEME_PALETTE.length)).toBe(THEME_PALETTE[0]);
    expect(nextPaletteTint(1)).toBe(THEME_PALETTE[1]);
  });
});

describe("theme assignment normalization", () => {
  it("keeps activityId -> themeId string entries and drops the rest", () => {
    const result = normalizeThemeAssignments(
      {
        "capture-flag": "theme-ocean",
        "gaga-ball": "  theme-jungle  ",
        "bad-number": 5,
        "bad-empty": "",
        "": "theme-orphan",
      },
      {}
    );
    expect(result).toEqual({ "capture-flag": "theme-ocean", "gaga-ball": "theme-jungle" });
  });

  it("falls back for non-object input", () => {
    const fallback = { a: "theme-1" };
    expect(normalizeThemeAssignments([], fallback)).toBe(fallback);
    expect(normalizeThemeAssignments(null, fallback)).toBe(fallback);
  });
});
