import { describe, it, expect } from "vitest";
import { setWeekdayHours, setDateHours, setSnap, addGuide, updateGuide, removeGuide } from "./campEdits";
import { clampOverrideWindow, type Camp } from "./camps";
import type { GuideBand } from "@/lib/calendar/guides";

const camp = (over: Partial<Camp> = {}): Camp => ({ id: "c1", ...over }) as Camp;
const band = (id: string, over: Partial<GuideBand> = {}): GuideBand =>
  ({ id, label: id, startMin: 540, endMin: 600, weekdays: [1, 2, 3, 4, 5], ...over });

describe("campEdits — day-structure hours", () => {
  it("stores a weekday window routed through clampOverrideWindow, on the target camp only", () => {
    const before = [camp({ id: "c1" }), camp({ id: "c2" })];
    const after = setWeekdayHours(before, "c1", 3, { openMin: 540, closeMin: 720 });
    expect(after[0].weekdayHours).toEqual({ 3: clampOverrideWindow(540, 720) });
    expect(after[1]).toBe(before[1]); // untouched camp keeps its reference
    expect(before[0].weekdayHours).toBeUndefined(); // input not mutated
  });

  it("'closed' stores an explicit null; 'default' removes the override", () => {
    const closed = setWeekdayHours([camp()], "c1", 3, "closed");
    expect(closed[0].weekdayHours).toEqual({ 3: null });
    const cleared = setWeekdayHours(closed, "c1", 3, "default");
    // removing the only override drops the whole map (no empty {} left behind)
    expect(cleared[0].weekdayHours).toBeUndefined();
  });

  it("keeps other weekday overrides when clearing one", () => {
    const seeded = camp({ weekdayHours: { 1: null, 3: null } });
    const after = setWeekdayHours([seeded], "c1", 1, "default");
    expect(after[0].weekdayHours).toEqual({ 3: null });
  });

  it("setDateHours: window clamps, 'closed' → null, null removes and drops the empty map", () => {
    const win = setDateHours([camp()], "c1", "2026-07-15", { openMin: 480, closeMin: 1080 });
    expect(win[0].dateHours).toEqual({ "2026-07-15": clampOverrideWindow(480, 1080) });
    const closed = setDateHours(win, "c1", "2026-07-16", "closed");
    expect(closed[0].dateHours).toMatchObject({ "2026-07-16": null });
    const removed = setDateHours(closed, "c1", "2026-07-15", null);
    expect(removed[0].dateHours).toEqual({ "2026-07-16": null });
    const emptied = setDateHours(removed, "c1", "2026-07-16", null);
    expect(emptied[0].dateHours).toBeUndefined();
  });

  it("setSnap sets snapMin on the target camp only", () => {
    const after = setSnap([camp({ id: "c1" }), camp({ id: "c2" })], "c2", 10);
    expect(after[0].snapMin).toBeUndefined();
    expect(after[1].snapMin).toBe(10);
  });
});

describe("campEdits — guidance bands (fork-the-shared-baseline rule)", () => {
  const shared = [band("s1"), band("s2")];

  it("addGuide forks the shared baseline into a camp that has none, then appends", () => {
    const fresh = band("new");
    const after = addGuide([camp()], "c1", fresh, shared);
    expect(after[0].guides!.map((b) => b.id)).toEqual(["s1", "s2", "new"]);
  });

  it("addGuide appends to a camp's OWN bands, ignoring the shared baseline", () => {
    const owned = camp({ guides: [band("own1")] });
    const after = addGuide([owned], "c1", band("new"), shared);
    expect(after[0].guides!.map((b) => b.id)).toEqual(["own1", "new"]);
  });

  it("updateGuide patches a band by id (forking from shared if needed)", () => {
    const after = updateGuide([camp()], "c1", "s2", { label: "renamed" }, shared);
    const patched = after[0].guides!.find((b) => b.id === "s2");
    expect(patched?.label).toBe("renamed");
    expect(after[0].guides!.find((b) => b.id === "s1")?.label).toBe("s1");
  });

  it("removeGuide drops a band by id", () => {
    const owned = camp({ guides: [band("a"), band("b"), band("c")] });
    const after = removeGuide([owned], "c1", "b", shared);
    expect(after[0].guides!.map((b) => b.id)).toEqual(["a", "c"]);
  });

  it("guide edits touch only the target camp", () => {
    const before = [camp({ id: "c1" }), camp({ id: "c2" })];
    const after = addGuide(before, "c1", band("new"), shared);
    expect(after[1]).toBe(before[1]);
  });
});
