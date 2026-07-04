import { describe, expect, it } from "vitest";
import { effectiveKitStock, foldStockWrite, isStocked, normalizeKitStock } from "./kitStock";

describe("normalizeKitStock validator", () => {
  it("keeps well-formed slug → state pairs", () => {
    expect(normalizeKitStock({ cones: "have", rope: "low", flags: "out" })).toEqual({
      cones: "have",
      rope: "low",
      flags: "out",
    });
  });

  it("returns {} for non-objects, arrays, and null (the UNSET state)", () => {
    expect(normalizeKitStock(undefined)).toEqual({});
    expect(normalizeKitStock(null)).toEqual({});
    expect(normalizeKitStock("nope")).toEqual({});
    expect(normalizeKitStock(["cones"])).toEqual({});
    expect(normalizeKitStock(42)).toEqual({});
  });

  it("drops values outside the have/low/out whitelist", () => {
    expect(normalizeKitStock({ cones: "have", rope: "plenty", flags: "true", beads: 1 })).toEqual({
      cones: "have",
    });
  });

  it("trims keys and drops empty ones", () => {
    expect(normalizeKitStock({ "  cones  ": "have", "": "low", "   ": "out" })).toEqual({ cones: "have" });
  });

  it("clamps keys to 80 chars and drops long+empty", () => {
    const longKey = "x".repeat(90);
    const out = normalizeKitStock({ [longKey]: "have" });
    expect(Object.keys(out)[0]).toHaveLength(80);
  });

  it("caps the map size", () => {
    const big: Record<string, string> = {};
    for (let i = 0; i < 500; i += 1) big["k" + i] = "have";
    expect(Object.keys(normalizeKitStock(big)).length).toBe(400);
  });

  it("is deterministic (client and server agree)", () => {
    const input = { cones: "have", rope: "bad", "": "low", flags: "out" };
    expect(normalizeKitStock(input)).toEqual(normalizeKitStock(input));
  });
});

describe("effectiveKitStock — legacy fold precedence", () => {
  it("both empty → {} (unset)", () => {
    expect(effectiveKitStock({}, [])).toEqual({});
  });

  it("kitStock empty, legacy set present → legacy ids as 'have' (un-migrated)", () => {
    expect(effectiveKitStock({}, ["cones", "rope"])).toEqual({ cones: "have", rope: "have" });
  });

  it("kitStock present → it wins per key over the legacy fold", () => {
    // Legacy says cones is on hand, but kitStock records it as "out" — the real
    // state must win (a stale legacy 'have' can't mask a fresh 'out').
    expect(effectiveKitStock({ cones: "out" }, ["cones", "rope"])).toEqual({
      cones: "out",
      rope: "have",
    });
  });

  it("folds legacy ids NOT in kitStock as 'have' alongside real entries", () => {
    expect(effectiveKitStock({ flags: "low" }, ["cones"])).toEqual({ flags: "low", cones: "have" });
  });

  it("ignores empty legacy ids", () => {
    expect(effectiveKitStock({}, ["", "cones"])).toEqual({ cones: "have" });
  });
});

describe("foldStockWrite — add-only migration, never downgrades", () => {
  it("sets one id while folding the legacy set as 'have'", () => {
    expect(foldStockWrite({}, ["cones", "rope"], "flags", "low")).toEqual({
      cones: "have",
      rope: "have",
      flags: "low",
    });
  });

  it("never downgrades an existing kitStock 'out' when folding the legacy set", () => {
    // The legacy set still lists cones as on hand, but the user has since marked
    // it "out". A write to a DIFFERENT id must not resurrect cones as "have".
    const next = foldStockWrite({ cones: "out" }, ["cones"], "rope", "have");
    expect(next.cones).toBe("out");
    expect(next.rope).toBe("have");
  });

  it("the explicit edit wins over both the fold and an existing state", () => {
    expect(foldStockWrite({ cones: "have" }, ["cones"], "cones", "out")).toEqual({ cones: "out" });
  });

  it("ignores an empty id (no phantom key)", () => {
    expect(foldStockWrite({ cones: "have" }, [], "", "low")).toEqual({ cones: "have" });
  });
});

describe("stock helpers", () => {
  it("isStocked: have/low are stocked, out/absent are not", () => {
    expect(isStocked("have")).toBe(true);
    expect(isStocked("low")).toBe(true);
    expect(isStocked("out")).toBe(false);
    expect(isStocked(undefined)).toBe(false);
  });
});
