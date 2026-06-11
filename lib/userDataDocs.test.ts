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
    expect(docDefault("view")).toBe("deck");
  });

  it("normalizes favs: dedupes, drops non-strings, falls back on non-arrays", () => {
    expect(normalizeDoc("favs", ["a", "a", "", 3, "b"])).toEqual(["a", "b"]);
    expect(normalizeDoc("favs", { not: "an array" })).toEqual([]);
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
    expect(normalizeDoc("view", "bogus")).toBe("deck");
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
});
