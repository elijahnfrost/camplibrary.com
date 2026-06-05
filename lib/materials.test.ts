import { describe, expect, it } from "vitest";
import type { Activity } from "./types";
import {
  hasRequiredMaterials,
  materialNeedsForActivity,
  materialOptionsForActivities,
  materialTagId,
  materialTagsFromMaterials,
  requiredMaterialTagIds,
} from "./materials";

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

  it("checks material availability only when a kit filter is active", () => {
    const needsCones = activity({ materials: ["Cones", "Rope"] });

    expect(hasRequiredMaterials(needsCones, [])).toBe(true);
    expect(hasRequiredMaterials(needsCones, ["cones"])).toBe(false);
    expect(hasRequiredMaterials(needsCones, ["cones", "rope"])).toBe(true);
    expect(hasRequiredMaterials(activity({ materials: [] }), ["cones"])).toBe(true);
  });
});
