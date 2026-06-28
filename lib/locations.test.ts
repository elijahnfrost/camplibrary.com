import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCATIONS,
  addLocation,
  canonicalLocationLabel,
  normalizeLocationVocab,
  removeLocation,
  renameLocation,
} from "./locations";

describe("location vocabulary normalization", () => {
  it("seeds the standard places, including Pool", () => {
    expect(DEFAULT_LOCATIONS).toContain("Pool");
    expect(DEFAULT_LOCATIONS).toContain("Gym");
  });

  it("trims, drops blanks, and dedupes case-insensitively (first spelling wins)", () => {
    expect(normalizeLocationVocab(["  Gym ", "gym", "", "Pool", "POOL", 7], DEFAULT_LOCATIONS)).toEqual([
      "Gym",
      "Pool",
    ]);
  });

  it("falls back to the seed for a non-array, but keeps an explicit empty list", () => {
    expect(normalizeLocationVocab("nope", DEFAULT_LOCATIONS)).toEqual([...DEFAULT_LOCATIONS]);
    expect(normalizeLocationVocab([], DEFAULT_LOCATIONS)).toEqual([]);
  });

  it("clamps an over-long label", () => {
    const long = "x".repeat(200);
    expect(canonicalLocationLabel(long).length).toBe(80);
  });
});

describe("addLocation", () => {
  it("appends a new place and reports its canonical label", () => {
    expect(addLocation(["Gym"], "  Pool ")).toEqual({ label: "Pool", next: ["Gym", "Pool"] });
  });

  it("no-ops on a blank or duplicate (case-insensitive) label", () => {
    expect(addLocation(["Gym"], "   ")).toBeNull();
    expect(addLocation(["Gym"], "gym")).toBeNull();
  });
});

describe("renameLocation", () => {
  it("renames in place, preserving position", () => {
    expect(renameLocation(["Gym", "Pool", "Fields"], "Pool", "Deep end")).toEqual({
      label: "Deep end",
      next: ["Gym", "Deep end", "Fields"],
    });
  });

  it("merges when the new label collides with another place", () => {
    expect(renameLocation(["Gym", "Pool", "Fields"], "Fields", "Gym")).toEqual({
      label: "Gym",
      next: ["Gym", "Pool"],
    });
  });

  it("no-ops on a blank target, an absent source, or an unchanged label", () => {
    expect(renameLocation(["Gym"], "Gym", "   ")).toBeNull();
    expect(renameLocation(["Gym"], "Pool", "Deck")).toBeNull();
    expect(renameLocation(["Gym"], "Gym", "Gym")).toBeNull();
  });
});

describe("removeLocation", () => {
  it("drops the place, returning null when it wasn't present", () => {
    expect(removeLocation(["Gym", "Pool"], "Pool")).toEqual(["Gym"]);
    expect(removeLocation(["Gym"], "Pool")).toBeNull();
  });
});
