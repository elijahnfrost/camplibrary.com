import { describe, expect, it } from "vitest";
import type { Activity } from "../types";
import {
  coverage,
  materialNeedsForActivity,
  materialOptionsForActivities,
  materialTagsFromMaterials,
  requiredMaterialTagIds,
  resolveRefs,
  usesAnyMaterialTag,
} from "./materials";
import { materialTagId } from "./materialTag";
import type { Material } from "./materialCatalog";
import type { StockState } from "./kitStock";

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

describe("coverage — the availability lens", () => {
  const stock = (map: Record<string, StockState>) => map;

  it("zero-needs activities are always ready (stock irrelevant)", () => {
    const none = activity({ materials: [] });
    expect(coverage(none, {}).state).toBe("ready");
    expect(coverage(none, { anything: "out" }).state).toBe("ready");
    expect(coverage(activity({ materialTags: ["No materials"] }), { x: "out" }).state).toBe("ready");
  });

  it("an empty stock map with real needs is UNSET (the lens is inert)", () => {
    const a = activity({ materials: ["Cones"] });
    const cov = coverage(a, {});
    expect(cov.state).toBe("unset");
    expect(cov.missing).toEqual([]);
    expect(cov.lowCount).toBe(0);
  });

  it("ready when every need is have/low; almost = exactly 1 uncovered; cant = >= 2", () => {
    const a = activity({ materials: ["Cones", "Rope", "Flags"] });
    // All covered → ready.
    expect(coverage(a, stock({ cones: "have", rope: "have", flags: "have" })).state).toBe("ready");
    // One out, rest have → almost (a single missing item).
    const almost = coverage(a, stock({ cones: "have", rope: "have", flags: "out" }));
    expect(almost.state).toBe("almost");
    expect(almost.missing).toEqual([{ id: "flags", label: "Flags" }]);
    // Two uncovered (one out, one absent) → cant.
    const cant = coverage(a, stock({ cones: "have", rope: "out" }));
    expect(cant.state).toBe("cant");
    expect(cant.missing.map((m) => m.id)).toEqual(["rope", "flags"]);
  });

  it("'low' covers a need (never demotes) and decorates via lowCount", () => {
    const a = activity({ materials: ["Cones", "Rope"] });
    const cov = coverage(a, stock({ cones: "low", rope: "have" }));
    expect(cov.state).toBe("ready");
    expect(cov.lowCount).toBe(1);
    expect(cov.missing).toEqual([]);
  });

  it("a substitute on hand covers a need and is recorded in substituted", () => {
    const catalog: Material[] = [
      { id: "pool-noodles", name: "Pool noodles", substitutes: ["foam-tubes"] },
      { id: "foam-tubes", name: "Foam tubes" },
    ];
    const a = activity({ materials: ["Pool noodles"] });
    // Own item out, but the substitute is on hand → covered via the substitute.
    const cov = coverage(a, stock({ "pool-noodles": "out", "foam-tubes": "have" }), catalog);
    expect(cov.state).toBe("ready");
    expect(cov.missing).toEqual([]);
    expect(cov.substituted).toEqual([{ id: "pool-noodles", viaId: "foam-tubes" }]);
  });

  it("a low substitute still covers and counts toward lowCount", () => {
    const catalog: Material[] = [
      { id: "pool-noodles", name: "Pool noodles", substitutes: ["foam-tubes"] },
      { id: "foam-tubes", name: "Foam tubes" },
    ];
    const a = activity({ materials: ["Pool noodles"] });
    const cov = coverage(a, stock({ "pool-noodles": "out", "foam-tubes": "low" }), catalog);
    expect(cov.state).toBe("ready");
    expect(cov.lowCount).toBe(1);
    expect(cov.substituted).toEqual([{ id: "pool-noodles", viaId: "foam-tubes" }]);
  });

  it("an out substitute does NOT cover (the need stays missing)", () => {
    const catalog: Material[] = [
      { id: "pool-noodles", name: "Pool noodles", substitutes: ["foam-tubes"] },
      { id: "foam-tubes", name: "Foam tubes" },
    ];
    const a = activity({ materials: ["Pool noodles"] });
    // A non-empty stock so the lens isn't unset, but neither the item nor its
    // substitute is on hand.
    const cov = coverage(a, stock({ "pool-noodles": "out", "foam-tubes": "out" }), catalog);
    expect(cov.state).toBe("almost");
    expect(cov.missing).toEqual([{ id: "pool-noodles", label: "Pool noodles" }]);
    expect(cov.substituted).toEqual([]);
  });
});
