import { describe, expect, it } from "vitest";
import { ALTERNATES_MAX, MATERIAL_SUBS_MAX, normalizeCalendarEvent } from "./types";

// The normalizer rebuilds a CLEAN object, so every payload-riding field must be
// explicitly re-attached or it is silently stripped on every read and every
// optimistic write. These tests lock the allowlist: a field that stops
// round-tripping here would vanish from real data the moment a client hydrates.

const base = {
  id: "e1",
  date: "2026-07-06",
  startMin: 720,
  endMin: 750,
  kind: "custom",
  title: "Lunch",
  updatedAt: 1,
};

const weeklyRule = { freq: "weekly", interval: 1, weekdays: [1, 3], until: "2026-08-28" };

describe("normalizeCalendarEvent — payload field allowlist", () => {
  it("round-trips the newer payload-riding fields", () => {
    const event = normalizeCalendarEvent({
      ...base,
      pinned: true,
      linkId: " run-2 ",
      alternates: [
        { title: " Four Corners ", activityId: "a1", reason: "overflow", locations: ["Gym"] },
        { title: "Quiet bingo" },
      ],
      materialSubs: { parachute: " Bedsheet ", cones: "" },
      headcount: { planned: 25, actual: 23 },
    });
    expect(event?.pinned).toBe(true);
    expect(event?.linkId).toBe("run-2");
    expect(event?.alternates).toEqual([
      { title: "Four Corners", activityId: "a1", reason: "overflow", locations: ["Gym"] },
      { title: "Quiet bingo", reason: "rain" },
    ]);
    expect(event?.materialSubs).toEqual({ parachute: "Bedsheet", cones: "" });
    expect(event?.headcount).toEqual({ planned: 25, actual: 23 });
  });

  it("keeps an EMPTY alternates list (authoritative 'no backups here') but not an absent one", () => {
    expect(normalizeCalendarEvent({ ...base, alternates: [] })?.alternates).toEqual([]);
    expect("alternates" in (normalizeCalendarEvent(base) ?? {})).toBe(false);
  });

  it("drops malformed values without dropping the event", () => {
    const event = normalizeCalendarEvent({
      ...base,
      pinned: "yes",
      linkId: 7,
      alternates: [{ reason: "rain" }, "nope"],
      materialSubs: { "": "x", cones: 3 },
      headcount: { planned: -1, actual: 3.5 },
    });
    expect(event).not.toBeNull();
    expect(event?.pinned).toBeUndefined();
    expect(event?.linkId).toBeUndefined();
    expect(event?.alternates).toEqual([]);
    expect(event?.materialSubs).toBeUndefined();
    expect(event?.headcount).toBeUndefined();
  });

  it("caps alternates and materialSubs", () => {
    const event = normalizeCalendarEvent({
      ...base,
      alternates: Array.from({ length: 6 }, (_, i) => ({ title: "Alt " + i })),
      materialSubs: Object.fromEntries(Array.from({ length: 30 }, (_, i) => ["m" + i, "x"])),
    });
    expect(event?.alternates).toHaveLength(ALTERNATES_MAX);
    expect(Object.keys(event?.materialSubs ?? {})).toHaveLength(MATERIAL_SUBS_MAX);
  });

  it("gates custom/origDate on a surviving series and whitelist-filters custom", () => {
    const member = normalizeCalendarEvent({
      ...base,
      seriesId: "s1",
      recurrence: weeklyRule,
      custom: ["startMin", "startMin", "endMin", "not-a-field"],
      origDate: "2026-07-01",
    });
    expect(member?.custom).toEqual(["startMin", "endMin"]);
    expect(member?.origDate).toBe("2026-07-01");

    // Without a parseable rule the row degrades to a plain event and the
    // series-only fields go with it.
    const orphan = normalizeCalendarEvent({
      ...base,
      custom: ["startMin"],
      origDate: "2026-07-01",
    });
    expect(orphan?.custom).toBeUndefined();
    expect(orphan?.origDate).toBeUndefined();
  });

  it("stays strip-by-default for unknown fields", () => {
    const event = normalizeCalendarEvent({ ...base, futureField: "kept?" });
    expect(event && "futureField" in event).toBe(false);
  });
});
