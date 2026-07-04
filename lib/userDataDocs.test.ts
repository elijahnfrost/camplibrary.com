import { describe, expect, it } from "vitest";
import {
  DOC_LOCAL_KEYS,
  USER_DOC_KEYS,
  docDefault,
  isUserDocKey,
  normalizeDoc,
} from "./userDataDocs";

describe("user data docs", () => {
  it("recognizes only the allowlisted keys", () => {
    USER_DOC_KEYS.forEach((key) => expect(isUserDocKey(key)).toBe(true));
    expect(isUserDocKey("schedule")).toBe(false);
    expect(isUserDocKey("clipboardPin")).toBe(false);
    expect(isUserDocKey(42)).toBe(false);
  });

  it("maps every doc key to a localStorage name", () => {
    USER_DOC_KEYS.forEach((key) => expect(typeof DOC_LOCAL_KEYS[key]).toBe("string"));
    expect(DOC_LOCAL_KEYS.runLists).toBe("runLists.v2");
    expect(DOC_LOCAL_KEYS.playbookOverrides).toBe("playbooks");
  });

  it("returns fresh default instances", () => {
    expect(docDefault("favs")).not.toBe(docDefault("favs"));
    expect(docDefault("ratings")).toEqual({});
    expect(docDefault("view")).toBe("shelf");
  });

  it("normalizes favs: dedupes, drops non-strings, falls back on non-arrays", () => {
    expect(normalizeDoc("favs", ["a", "a", "", 3, "b"])).toEqual(["a", "b"]);
    expect(normalizeDoc("favs", { not: "an array" })).toEqual([]);
  });

  it("normalizes deleted activity ids like other string lists", () => {
    expect(normalizeDoc("deletedActivityIds", ["gaga-ball", "", "gaga-ball", 7, "capture-flag"])).toEqual([
      "gaga-ball",
      "capture-flag",
    ]);
    expect(normalizeDoc("deletedActivityIds", "nope")).toEqual([]);
  });

  it("normalizes ratings: clamps to 0-5 integers and drops junk", () => {
    expect(normalizeDoc("ratings", { ctf: 4.6, gaga: -2, bad: "x", inf: Infinity })).toEqual({
      ctf: 5,
      gaga: 0,
    });
    expect(normalizeDoc("ratings", "nope")).toEqual({});
  });

  it("normalizes view with fallback", () => {
    expect(normalizeDoc("view", "shelf")).toBe("shelf");
    expect(normalizeDoc("view", "bogus")).toBe("shelf");
  });

  it("normalizes run list overrides: keeps valid docs, drops malformed entries", () => {
    const valid = { blocks: [{ id: "b1", type: "step", text: "Go", children: [] }] };
    const out = normalizeDoc("runLists", { good: valid, bad: { blocks: "nope" }, worse: 7 });
    expect(Object.keys(out)).toEqual(["good"]);
    expect(out.good.blocks[0]).toMatchObject({ type: "step", text: "Go" });
  });

  it("drops malformed blocks inside an otherwise valid run doc", () => {
    const doc = { blocks: [{ id: "b1", type: "step", text: "Keep" }, { type: "alien" }, null] };
    const out = normalizeDoc("runLists", { a: doc });
    expect(out.a.blocks).toHaveLength(1);
  });

  it("normalizes playbook overrides: requires frames, fills safe defaults", () => {
    const valid = {
      id: "pb",
      activityId: "ctf",
      title: "CTF",
      summary: "",
      frames: [{ id: "f1", name: "Setup", caption: "", zones: [], flags: [], players: [], arrows: [] }],
    };
    const out = normalizeDoc("playbookOverrides", { ctf: valid, broken: { frames: "x" }, junk: [] });
    expect(Object.keys(out)).toEqual(["ctf"]);
    expect(out.ctf.frames).toHaveLength(1);
  });

  it("normalizes location colors: keeps valid hex, lowercases, drops junk", () => {
    expect(
      normalizeDoc("locationColors", { Gym: "#E0B15A", Pool: "not-a-color", "": "#fff", Fields: 7 })
    ).toEqual({ Gym: "#e0b15a" });
    expect(normalizeDoc("locationColors", "nope")).toEqual({});
    expect(docDefault("locationColors")).toEqual({});
  });

  it("normalizes custom activities through the shared activity validator", () => {
    const activity = {
      id: "custom-1",
      title: "Bucket Brigade",
      type: "Water",
      place: "Outside",
      ageMin: 6,
      ageMax: 12,
      durationMin: 20,
      groupMin: null,
      groupMax: null,
      energy: 2,
      prep: "Low",
      blurb: "Pass the water",
      materials: ["Buckets"],
      steps: ["Line up"],
      notes: "",
      safety: "",
      ages: ["g13"],
      rating: 0,
    };
    const out = normalizeDoc("extra", [activity, { junk: true }, "nope"]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("custom-1");
  });

  it("normalizes the guides doc: valid bands only, empty default", () => {
    expect(docDefault("guides")).toEqual([]);
    const out = normalizeDoc("guides", [
      { id: "g1", label: "Lunch", startMin: 720, endMin: 765, weekdays: [1, 2, 3] },
      { id: "g2", label: "Point", startMin: 600, endMin: 600, weekdays: [1] }, // 0-length -> dropped
      "nope",
    ]);
    expect(out.map((b) => b.id)).toEqual(["g1"]);
    expect(normalizeDoc("guides", "nope")).toEqual([]);
  });

  it("maps the new docs to versioned localStorage names", () => {
    expect(DOC_LOCAL_KEYS.guides).toBe("guides.v1");
  });
});
