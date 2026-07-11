import { describe, expect, it } from "vitest";
import {
  mergeActivityCatalog,
  removeActivityRecord,
  seedActivityIds,
  upsertActivityRecord,
} from "./activityCatalog";
import type { Activity } from "../types";

function activity(id: string, title = id): Activity {
  return {
    id,
    title,
    type: "Game",
    place: "Outside",
    ageMin: 6,
    ageMax: 12,
    durationMin: 20,
    groupMin: null,
    groupMax: null,
    energy: 2,
    prep: "Low",
    blurb: "",
    materials: [],
    steps: [],
    notes: "",
    safety: "",
    ages: ["g13"],
    rating: 0,
  };
}

describe("activity catalog merging", () => {
  it("lets a user-owned edit shadow a seed activity with the same id", () => {
    const seed = [activity("gaga-ball", "Gaga Ball")];
    const extra = [activity("gaga-ball", "Ga-ga Ball"), activity("gaga-ball", "Old Gaga")];

    expect(mergeActivityCatalog(seed, extra, [])).toEqual([extra[0]]);
  });

  it("hides deleted seed activities and their promoted records", () => {
    const seed = [activity("capture-flag", "Capture the Flag"), activity("gaga-ball", "Gaga Ball")];
    const extra = [activity("capture-flag", "Edited Capture")];

    expect(mergeActivityCatalog(seed, extra, ["capture-flag"])).toEqual([seed[1]]);
  });

  it("upserts and removes user-owned activity records without duplicates", () => {
    const existing = activity("capture-flag", "Capture the Flag");
    const edited = activity("capture-flag", "Capture Flag");
    const custom = activity("new-game", "New Game");

    expect(upsertActivityRecord([existing], edited)).toEqual([edited]);
    expect(upsertActivityRecord([existing], custom)).toEqual([custom, existing]);
    expect(removeActivityRecord([existing, custom], "capture-flag")).toEqual([custom]);
  });

  it("builds the seed id set used for tombstones", () => {
    expect(seedActivityIds([activity("a"), activity("b")])).toEqual(new Set(["a", "b"]));
  });
});
