import { describe, expect, it } from "vitest";
import { DEFAULT_PRINT_FORMAT, DOC_SECTIONS, printFormatStorage } from "./options";

describe("printFormatStorage", () => {
  it("falls back wholesale for a non-object value", () => {
    expect(printFormatStorage(null, DEFAULT_PRINT_FORMAT)).toBe(DEFAULT_PRINT_FORMAT);
    expect(printFormatStorage([1, 2], DEFAULT_PRINT_FORMAT)).toBe(DEFAULT_PRINT_FORMAT);
  });

  it("validates the new format fields field-by-field", () => {
    const out = printFormatStorage(
      { fontScale: "large", density: "tight", showCover: false },
      DEFAULT_PRINT_FORMAT
    );
    expect(out.fontScale).toBe("large");
    expect(out.density).toBe("tight");
    expect(out.showCover).toBe(false);
  });

  it("ignores a stale pageNumbers key from an old persisted blob without crashing", () => {
    const out = printFormatStorage(
      { pageNumbers: true, fontScale: "small" },
      DEFAULT_PRINT_FORMAT
    );
    expect(out.fontScale).toBe("small");
    expect((out as unknown as Record<string, unknown>).pageNumbers).toBeUndefined();
  });

  it("falls back per-field for an out-of-range enum", () => {
    const out = printFormatStorage({ fontScale: "huge", density: 7 }, DEFAULT_PRINT_FORMAT);
    expect(out.fontScale).toBe(DEFAULT_PRINT_FORMAT.fontScale);
    expect(out.density).toBe(DEFAULT_PRINT_FORMAT.density);
  });

  it("de-dupes a section order and appends any missing sections", () => {
    // Reversed, with a dup and a bogus entry → keep valid order, append the rest.
    const out = printFormatStorage(
      { sectionOrder: ["appendix", "appendix", "bogus", "schedule"] },
      DEFAULT_PRINT_FORMAT
    );
    expect(out.sectionOrder).toEqual(["appendix", "schedule", "rollup"]);
  });

  it("falls back to the default section order for a non-array", () => {
    const out = printFormatStorage({ sectionOrder: "schedule" }, DEFAULT_PRINT_FORMAT);
    expect(out.sectionOrder).toEqual(DOC_SECTIONS);
  });
});
