import { describe, expect, it } from "vitest";
import {
  catalogNameFor,
  humanizeMaterialId,
  materialFromName,
  mintCatalogEntries,
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

describe("mintCatalogEntries", () => {
  it("appends entries for unknown ids using the ref label as the birth name", () => {
    const out = mintCatalogEntries([], [
      { id: "pool-noodles", label: "Pool noodles" },
      { id: "glitter", label: "Glitter" },
    ]);
    expect(out).toEqual([
      { id: "pool-noodles", name: "Pool noodles" },
      { id: "glitter", name: "Glitter" },
    ]);
  });

  it("mints under the ref's FROZEN id, not the label's re-slug", () => {
    // "Flour, ~2 cups" slugs to "flour-2-cups", but the ref keeps its own id.
    const out = mintCatalogEntries([], [{ id: "flour", label: "Flour, ~2 cups" }]);
    expect(out).toEqual([{ id: "flour", name: "Flour, ~2 cups" }]);
  });

  it("never touches known ids (frozen; even archived ones) and returns the SAME array when nothing is new", () => {
    const catalog: Material[] = [{ id: "flour", name: "Flour", archived: true }];
    const same = mintCatalogEntries(catalog, [{ id: "flour", label: "All-purpose flour" }]);
    // No change → identity preserved so the caller can skip the doc write.
    expect(same).toBe(catalog);
    // A mix appends only the new one, leaving the existing (archived) entry as-is.
    const mixed = mintCatalogEntries(catalog, [
      { id: "flour", label: "Flour renamed?" },
      { id: "salt", label: "Salt" },
    ]);
    expect(mixed).toEqual([
      { id: "flour", name: "Flour", archived: true },
      { id: "salt", name: "Salt" },
    ]);
  });

  it("dedupes within a single batch (first label wins per id)", () => {
    const out = mintCatalogEntries([], [
      { id: "cones", label: "Cones" },
      { id: "cones", label: "Traffic cones" },
    ]);
    expect(out).toEqual([{ id: "cones", name: "Cones" }]);
  });

  it("skips refs whose label slugs to nothing or that carry no id", () => {
    const out = mintCatalogEntries([], [
      { id: "ok", label: "Real thing" },
      { id: "blank", label: "   " }, // label slugs to nothing → skipped
      { id: "", label: "No id" }, // no id → skipped
    ]);
    expect(out).toEqual([{ id: "ok", name: "Real thing" }]);
  });

  it("honors the catalog cap deterministically", () => {
    const full = Array.from({ length: 300 }, (_, i) => ({ id: "m" + i, name: "M" + i }));
    const out = mintCatalogEntries(full, [{ id: "overflow", label: "Overflow" }]);
    expect(out).toBe(full); // at cap → no append
  });
});
