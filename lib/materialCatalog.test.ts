import { describe, expect, it } from "vitest";
import {
  catalogNameFor,
  humanizeMaterialId,
  materialFromName,
  normalizeMaterialCatalog,
  type Material,
} from "./materialCatalog";

describe("material catalog validator", () => {
  it("keeps valid entries, trims + clamps names, and carries the flags", () => {
    const out = normalizeMaterialCatalog([
      { id: "flour", name: "  All-purpose flour  " },
      { id: "salt", name: "Salt", consumable: true, plenty: false },
      { id: "cones", name: "Cones", plenty: true, archived: true },
      { id: "long", name: "x".repeat(120) },
    ]);
    expect(out).toEqual([
      { id: "flour", name: "All-purpose flour" },
      { id: "salt", name: "Salt", consumable: true },
      { id: "cones", name: "Cones", plenty: true, archived: true },
      { id: "long", name: "x".repeat(80) },
    ]);
  });

  it("dedupes by id (first wins) and drops entries missing id or name", () => {
    const out = normalizeMaterialCatalog([
      { id: "flour", name: "Flour" },
      { id: "flour", name: "Second flour" }, // dup id → dropped
      { id: "", name: "No id" }, // no id → dropped
      { id: "noname", name: "   " }, // blank name → dropped
      { name: "orphan" }, // missing id → dropped
      "junk", // non-record → dropped
      42,
    ]);
    expect(out).toEqual([{ id: "flour", name: "Flour" }]);
  });

  it("validates substitutes as trimmed, de-duped ids and drops self-references", () => {
    const out = normalizeMaterialCatalog([
      {
        id: "clay",
        name: "Clay",
        substitutes: ["  salt-dough  ", "salt-dough", "clay", "", 7, "air-dry-clay"],
      },
      { id: "bare", name: "Bare", substitutes: [] },
    ]);
    expect(out[0]).toEqual({ id: "clay", name: "Clay", substitutes: ["salt-dough", "air-dry-clay"] });
    // Empty substitutes list → field absent, not [].
    expect(out[1]).toEqual({ id: "bare", name: "Bare" });
  });

  it("caps the catalog at ~300 entries deterministically", () => {
    const many = Array.from({ length: 350 }, (_, i) => ({ id: "m" + i, name: "M" + i }));
    const out = normalizeMaterialCatalog(many);
    expect(out).toHaveLength(300);
    expect(out[0].id).toBe("m0");
    expect(out[299].id).toBe("m299");
  });

  it("falls back to an empty array for non-array input", () => {
    expect(normalizeMaterialCatalog("nope")).toEqual([]);
    expect(normalizeMaterialCatalog(null)).toEqual([]);
    expect(normalizeMaterialCatalog({ id: "x" })).toEqual([]);
  });

  it("is deterministic: same input, same output (round-trips through itself)", () => {
    const input = [
      { id: "flour", name: "Flour", consumable: true },
      { id: "clay", name: "Clay", substitutes: ["salt-dough"] },
    ];
    const once = normalizeMaterialCatalog(input);
    const twice = normalizeMaterialCatalog(once);
    expect(twice).toEqual(once);
  });
});

describe("catalogNameFor + humanizeMaterialId", () => {
  const catalog: Material[] = [{ id: "pool-noodles", name: "Pool noodles" }];

  it("uses the catalog entry name when the id is present", () => {
    expect(catalogNameFor(catalog, "pool-noodles")).toBe("Pool noodles");
  });

  it("humanizes an unknown id (lazy catalog: unknown ids still render)", () => {
    expect(catalogNameFor(catalog, "flags-and-pinnies")).toBe("Flags & pinnies");
    expect(catalogNameFor(undefined, "craft-sticks")).toBe("Craft sticks");
  });

  it("humanizes slugs into readable labels", () => {
    expect(humanizeMaterialId("pool-noodles")).toBe("Pool noodles");
    expect(humanizeMaterialId("flags-and-pinnies")).toBe("Flags & pinnies");
    expect(humanizeMaterialId("8-12-cones")).toBe("8 12 cones");
    expect(humanizeMaterialId("")).toBe("");
  });
});

describe("materialFromName", () => {
  it("mints an entry whose id is the birth-slug of the name", () => {
    expect(materialFromName("  Pool Noodles  ")).toEqual({ id: "pool-noodles", name: "Pool Noodles" });
  });

  it("returns null when the name slugs to nothing", () => {
    expect(materialFromName("   ")).toBeNull();
    expect(materialFromName("!!!")).toBeNull();
  });
});
