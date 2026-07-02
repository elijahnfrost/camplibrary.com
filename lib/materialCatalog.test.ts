import { describe, expect, it } from "vitest";
import {
  buildCatalogFromActivities,
  indexCatalog,
  materialCoverage,
  materialRowsForActivity,
  normalizeMaterialCatalog,
  runnableState,
  type MaterialCatalog,
  type MaterialCuration,
  type MaterialRef,
} from "./materialCatalog";
import type { Activity } from "./types";

const catalog: MaterialCatalog = {
  categories: [{ id: "balls", label: "Balls" }],
  materials: [
    { id: "kickball", name: "Kickball", category: "balls" },
    { id: "playground-ball", name: "Playground ball", category: "balls" },
    { id: "egg", name: "Egg", substitutes: ["ping-pong-ball"] },
    { id: "ping-pong-ball", name: "Ping-pong ball" },
    { id: "glue", name: "Glue" },
  ],
};
const index = indexCatalog(catalog);

const item = (id: string, optional?: boolean): MaterialRef => ({ kind: "item", id, ...(optional ? { optional } : {}) });
const category = (id: string): MaterialRef => ({ kind: "category", id });
const other = (label: string): MaterialRef => ({ kind: "other", label });

function activity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: "a1",
    title: "Base",
    type: "Game",
    place: "Inside",
    ageMin: 6,
    ageMax: 9,
    durationMin: 30,
    groupMin: null,
    groupMax: null,
    energy: 1,
    prep: "None",
    blurb: "",
    materials: [],
    steps: [],
    notes: "",
    safety: "",
    ages: ["g13"],
    rating: 0,
    ...overrides,
  };
}

describe("materialCoverage", () => {
  it("covers an exact item on hand (no substitution flagged)", () => {
    const c = materialCoverage([item("glue")], new Set(["glue"]), index);
    expect(c.runnable).toBe(true);
    expect(c.satisfiedBySubstitute).toHaveLength(0);
    expect(c.total).toBe(1);
  });

  it("covers a specific item via ANY same-category member (the headline 'a particular ball' case)", () => {
    const c = materialCoverage([item("kickball")], new Set(["playground-ball"]), index);
    expect(c.runnable).toBe(true);
    expect(c.satisfiedBySubstitute).toHaveLength(1);
    expect(c.satisfiedBySubstitute[0].via).toBe("playground-ball");
    expect(c.satisfiedBySubstitute[0].viaLabel).toBe("Playground ball");
  });

  it("covers via a declared cross-item substitute", () => {
    const c = materialCoverage([item("egg")], new Set(["ping-pong-ball"]), index);
    expect(c.runnable).toBe(true);
    expect(c.satisfiedBySubstitute[0].via).toBe("ping-pong-ball");
  });

  it("covers a category ('any of these') ref by a member — NOT counted as a substitution", () => {
    const c = materialCoverage([category("balls")], new Set(["kickball"]), index);
    expect(c.runnable).toBe(true);
    expect(c.satisfiedBySubstitute).toHaveLength(0);
  });

  it("reports the missing items when nothing covers them", () => {
    const c = materialCoverage([item("glue"), item("kickball")], new Set(["glue"]), index);
    expect(c.runnable).toBe(false);
    expect(c.missing).toHaveLength(1);
    expect(c.missingLabels).toEqual(["Kickball"]);
  });

  it("never blocks runnability on an optional ref, and excludes it from the total", () => {
    const c = materialCoverage([item("kickball", true)], new Set(), index);
    expect(c.runnable).toBe(true);
    expect(c.total).toBe(0);
  });

  it("an unmapped 'other' ref is never auto-runnable (an honest Need)", () => {
    const c = materialCoverage([other("Unicorn horn")], new Set(["glue"]), index);
    expect(c.runnable).toBe(false);
    expect(c.missingLabels).toEqual(["Unicorn horn"]);
  });
});

describe("runnableState", () => {
  it("buckets ready / almost / blocked by the missing count", () => {
    const ready = materialCoverage([item("glue")], new Set(["glue"]), index);
    const almost = materialCoverage([item("glue"), item("kickball")], new Set(["glue"]), index);
    const blocked = materialCoverage([item("a"), item("b"), item("c")], new Set(), index);
    expect(runnableState(ready)).toBe("ready");
    expect(runnableState(almost)).toBe("almost");
    expect(runnableState(blocked)).toBe("blocked");
  });
});

describe("materialRowsForActivity", () => {
  it("labels each requirement have / substitute / missing", () => {
    const a = activity({ materialRefs: [item("glue"), item("kickball"), item("egg")] });
    const rows = materialRowsForActivity(a, new Set(["glue", "playground-ball"]), index);
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r]));
    expect(byLabel["Glue"].status).toBe("have");
    expect(byLabel["Kickball"].status).toBe("substitute");
    expect(byLabel["Kickball"].substituteLabel).toBe("Playground ball");
    expect(byLabel["Egg"].status).toBe("missing");
  });
});

describe("buildCatalogFromActivities", () => {
  it("derives a catalog from tags and remaps a curated bundle tag to a category ref", () => {
    const acts = [
      activity({ id: "tag", materialTags: ["Flags or pinnies", "Cones"] }),
    ];
    const curation: MaterialCuration = {
      splitBundles: {
        "flags-or-pinnies": {
          category: "flags-pinnies",
          categoryLabel: "Flags & pinnies",
          members: [
            { id: "flags", name: "Flags" },
            { id: "pinnies", name: "Pinnies" },
          ],
        },
      },
    };
    const { catalog: built, refsFor } = buildCatalogFromActivities(acts, curation);
    // The bundle tag is gone as a material; its members + category exist.
    expect(built.materials.some((m) => m.id === "flags-or-pinnies")).toBe(false);
    expect(built.materials.some((m) => m.id === "flags")).toBe(true);
    expect(built.categories.some((c) => c.id === "flags-pinnies")).toBe(true);
    // The activity's ref to the bundle becomes a category ref; "cones" stays an item.
    const refs = refsFor(acts[0]);
    expect(refs).toContainEqual({ kind: "category", id: "flags-pinnies" });
    expect(refs).toContainEqual({ kind: "item", id: "cones" });
  });
});

describe("normalizeMaterialCatalog", () => {
  const fallback: MaterialCatalog = { materials: [], categories: [] };

  it("drops malformed entries and references to ids that don't exist", () => {
    const dirty = {
      categories: [{ id: "Balls", label: "Balls" }, { id: "", label: "x" }],
      materials: [
        { id: "Kickball", name: "Kickball", category: "Balls", substitutes: ["ghost"] },
        { id: "", name: "nameless" },
        { nope: true },
      ],
    };
    const clean = normalizeMaterialCatalog(dirty, fallback);
    expect(clean.categories).toEqual([{ id: "balls", label: "Balls" }]);
    expect(clean.materials).toHaveLength(1);
    expect(clean.materials[0].id).toBe("kickball");
    expect(clean.materials[0].category).toBe("balls");
    // The dangling substitute "ghost" is purged.
    expect(clean.materials[0].substitutes).toBeUndefined();
  });

  it("falls back when the shape is wrong", () => {
    expect(normalizeMaterialCatalog(null, fallback)).toBe(fallback);
    expect(normalizeMaterialCatalog({ materials: "x" }, fallback)).toBe(fallback);
  });
});
