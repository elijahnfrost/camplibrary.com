import { describe, expect, it } from "vitest";
import type { Activity } from "./types";
import {
  materialNeedsForActivity,
  materialOptionsForActivities,
  materialTagId,
  materialTagsFromMaterials,
  requiredMaterialTagIds,
  resolveRefs,
  usesAnyMaterialTag,
} from "./materials";
import type { Material } from "./materialCatalog";

function activity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: "a1",
    title: "Base game",
    type: "Game",
    place: "Inside",
    ageMin: 6,
    ageMax: 9,
    durationMin: 30,
    groupMin: null,
    groupMax: null,
    energy: 1,
    prep: "None",
    blurb: "Base blurb",
    materials: [],
    steps: [],
    notes: "",
    safety: "",
    ages: ["g13"],
    rating: 0,
    ...overrides,
  };
}

describe("materials selectors", () => {
  it("normalizes material labels into stable ids", () => {
    expect(materialTagId("  Flags & pinnies  ")).toBe("flags-and-pinnies");
    expect(materialTagId("8-12 cones")).toBe("8-12-cones");
    expect(materialTagId("!!!")).toBe("");
    expect(materialTagId("   ")).toBe("");
  });

  it("dedupes material ids in first-authored order", () => {
    expect(materialTagsFromMaterials(["Cones", " cones ", "Flags & pinnies", "Flags and pinnies"])).toEqual([
      "cones",
      "flags-and-pinnies",
    ]);
  });

  it("prefers explicit material tags when present", () => {
    expect(requiredMaterialTagIds(activity({ materials: ["Cones", " cones ", ""] }))).toEqual(["cones"]);
    expect(requiredMaterialTagIds(activity({ materials: ["Cones"], materialTags: ["Pool noodles", "pool-noodles"] }))).toEqual([
      "pool-noodles",
    ]);
    expect(requiredMaterialTagIds(activity({ materials: ["Cones"], materialTags: [] }))).toEqual(["cones"]);
  });

  it("returns distinct material needs with display labels", () => {
    expect(materialNeedsForActivity(activity({ materials: ["  Cones  ", "cones", "Flags & pinnies"] }))).toEqual([
      { id: "cones", label: "Cones" },
      { id: "flags-and-pinnies", label: "Flags & pinnies" },
    ]);
    expect(materialNeedsForActivity(activity({ materials: ["Human label"], materialTags: ["pool-noodles"] }))).toEqual([
      { id: "pool-noodles", label: "pool-noodles" },
    ]);
  });

  it("counts each material once per activity and sorts options by label", () => {
    const options = materialOptionsForActivities([
      activity({ id: "a", materials: ["Rope", "Cones", "cones", "Flags & pinnies"] }),
      activity({ id: "b", materials: ["Cones", "Flags and pinnies"] }),
      activity({ id: "c", materialTags: ["Rope", "Flags & pinnies"] }),
    ]);

    expect(options).toEqual([
      { id: "cones", label: "Cones", count: 2 },
      { id: "flags-and-pinnies", label: "Flags & pinnies", count: 3 },
      { id: "rope", label: "Rope", count: 2 },
    ]);
  });

  it("matches an activity that uses ANY of the picked kit items", () => {
    const needsCones = activity({ materials: ["Cones", "Rope"] });

    // No kit picked = no filtering, everything matches.
    expect(usesAnyMaterialTag(needsCones, [])).toBe(true);
    // A single overlapping item is enough — the badge promises this activity.
    expect(usesAnyMaterialTag(needsCones, ["cones"])).toBe(true);
    expect(usesAnyMaterialTag(needsCones, ["string"])).toBe(false);
    expect(usesAnyMaterialTag(needsCones, ["string", "rope"])).toBe(true);
    // "No materials" activities need nothing, so they never match a kit filter.
    expect(usesAnyMaterialTag(activity({ materialTags: ["No materials"] }), ["cones"])).toBe(false);
    expect(usesAnyMaterialTag(activity({ materials: [] }), ["cones"])).toBe(false);
  });

  it("resolveRefs: materialRefs win (tier 1), label via catalog, note carried", () => {
    const catalog: Material[] = [{ id: "flour", name: "All-purpose flour" }];
    const a = activity({
      materialRefs: [
        { id: "flour", note: "~2 cups per batch" },
        { id: "salt" },
      ],
      // These lower tiers MUST be ignored when refs are present.
      materialTags: ["Cones"],
      materials: ["Rope, lots of it"],
    });
    expect(resolveRefs(a, catalog)).toEqual([
      { id: "flour", label: "All-purpose flour", note: "~2 cups per batch" },
      // No catalog entry for "salt" → humanized slug fallback (lazy catalog).
      { id: "salt", label: "Salt" },
    ]);
  });

  it("resolveRefs: materialTags are tier 2 (whole string), preferred over free text", () => {
    const a = activity({
      materialTags: ["Flags & pinnies", "Pool noodles"],
      materials: ["ignored"],
    });
    expect(resolveRefs(a)).toEqual([
      { id: "flags-and-pinnies", label: "Flags & pinnies" },
      { id: "pool-noodles", label: "Pool noodles" },
    ]);
  });

  it("resolveRefs: free-text materials are tier 3 with NO comma splitting", () => {
    // One comma-containing string is ONE need, not three — this is the bug the
    // chunk kills. The label is the whole trimmed string.
    const a = activity({ materials: ["Flour, all-purpose, ~2 cups per batch", "Salt"] });
    expect(resolveRefs(a)).toEqual([
      { id: "flour-all-purpose-2-cups-per-batch", label: "Flour, all-purpose, ~2 cups per batch" },
      { id: "salt", label: "Salt" },
    ]);
  });

  it("resolveRefs: dedupes by id and drops 'No materials' sentinels in every tier", () => {
    expect(
      resolveRefs(activity({ materialRefs: [{ id: "cones" }, { id: "Cones" }, { id: "None" }] }))
    ).toEqual([{ id: "cones", label: "Cones" }]);
    expect(resolveRefs(activity({ materialTags: ["Cones", "cones", "No materials"] }))).toEqual([
      { id: "cones", label: "Cones" },
    ]);
    expect(
      resolveRefs(activity({ materials: ["Cones", " cones ", "No materials needed"] }))
    ).toEqual([{ id: "cones", label: "Cones" }]);
  });

  it("drops 'No materials' sentinels from requirements and kit options", () => {
    expect(requiredMaterialTagIds(activity({ materialTags: ["No materials"] }))).toEqual([]);
    expect(requiredMaterialTagIds(activity({ materials: ["No materials needed"] }))).toEqual([]);
    expect(requiredMaterialTagIds(activity({ materialTags: ["Cones", "No materials"] }))).toEqual(["cones"]);

    const options = materialOptionsForActivities([
      activity({ id: "a", materialTags: ["No materials"] }),
      activity({ id: "b", materialTags: ["Cones", "No materials"] }),
    ]);
    expect(options).toEqual([{ id: "cones", label: "Cones", count: 1 }]);
  });
});
