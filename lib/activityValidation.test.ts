import { describe, expect, it } from "vitest";
import { materialOptionsForActivities } from "./materials";
import { normalizeActivities, normalizeActivity } from "./activityValidation";

const legacyActivity = {
  id: "custom-river-relay",
  title: "River Relay",
  type: "Water",
  place: "Outside",
  ageMin: 6,
  ageMax: 12,
  durationMin: 30,
  groupMin: null,
  groupMax: null,
  energy: 3,
  prep: "Low",
  blurb: "Pass water down the line.",
  materials: ["Buckets", "Sponges"],
  steps: ["Line up", "Pass the sponge"],
  notes: "Keep it moving.",
  safety: "Run on grass.",
  rating: 4,
};

describe("activity validation", () => {
  it("migrates persisted activities without age tags from age ranges", () => {
    const normalized = normalizeActivity(legacyActivity);

    expect(normalized?.ages).toEqual(["g13", "g46"]);
  });

  it("re-attaches alternate names, trimmed and de-duped, and omits them when empty", () => {
    const withAltNames = normalizeActivity({
      ...legacyActivity,
      altNames: ["  Octopus  ", "Octopus", "Fishes and Sharks", "", 42],
    });
    // Trimmed, de-duped, non-strings dropped — and the field survives the rebuild.
    expect(withAltNames?.altNames).toEqual(["Octopus", "Fishes and Sharks"]);

    // No altNames (or an all-empty list) leaves the field absent, not an empty array.
    expect(normalizeActivity(legacyActivity)?.altNames).toBeUndefined();
    expect(normalizeActivity({ ...legacyActivity, altNames: ["", "   "] })?.altNames).toBeUndefined();
    expect(normalizeActivity({ ...legacyActivity, altNames: "not an array" })?.altNames).toBeUndefined();
  });

  it("sanitizes persisted arrays and numeric fields before material helpers use them", () => {
    const normalized = normalizeActivities(
      [
        {
          ...legacyActivity,
          ageMin: "5",
          ageMax: "7",
          durationMin: "25",
          groupMin: "4",
          groupMax: "not a number",
          energy: 99,
          rating: "2.6",
          materials: ["  Pencils  ", 42, "", " Paper "],
          materialTags: ["Pencils", false, "Paper"],
          steps: ["Draw", null, "Share"],
          notes: 14,
          safety: undefined,
        },
      ],
      []
    );

    expect(normalized).toHaveLength(1);
    expect(normalized[0]).toMatchObject({
      ageMin: 5,
      ageMax: 7,
      durationMin: 25,
      groupMin: 4,
      groupMax: null,
      energy: 3,
      rating: 3,
      materials: ["Pencils", "Paper"],
      materialTags: ["Pencils", "Paper"],
      steps: ["Draw", "Share"],
      notes: "",
      safety: "",
      ages: ["pre", "g13"],
    });
    expect(materialOptionsForActivities(normalized)).toEqual([
      { id: "paper", label: "Paper", count: 1 },
      { id: "pencils", label: "Pencils", count: 1 },
    ]);
  });

  it("falls back when the persisted activities payload is not an array", () => {
    const fallbackActivity = normalizeActivity(legacyActivity);
    if (!fallbackActivity) throw new Error("test fixture should normalize");
    const fallback = [fallbackActivity];

    expect(normalizeActivities({ bad: "payload" }, fallback)).toBe(fallback);
  });
});
