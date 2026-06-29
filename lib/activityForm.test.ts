import { describe, expect, it } from "vitest";
import { quickActivity, newActivityId } from "./activityForm";

// quickActivity backs the calendar create bar's "Save to library" path: a typed
// name + chosen length becomes a minimal, library-ready Activity in the Routine
// bucket — and, unlike the full form, a 0-minute length stays 0 (a reminder)
// instead of being clamped up to a default.
describe("quickActivity", () => {
  it("builds a Routine-bucket activity at the given length", () => {
    const a = quickActivity("Tie-dye shirts", newActivityId("Tie-dye shirts"), 45);
    expect(a.type).toBe("Routine");
    expect(a.durationMin).toBe(45);
    expect(a.title).toBe("Tie-dye shirts");
    expect(a.id).toMatch(/^tie-dye-shirts-/);
  });

  it("keeps a 0-minute length (a reminder), never clamping it up", () => {
    const a = quickActivity("Sunscreen check", "rm-test", 0);
    expect(a.durationMin).toBe(0);
  });

  it("clamps a negative or non-finite length to 0", () => {
    expect(quickActivity("x", "x1", -10).durationMin).toBe(0);
    expect(quickActivity("x", "x2", Number.NaN).durationMin).toBe(0);
  });

  it("falls back to a title when given only whitespace", () => {
    expect(quickActivity("   ", "blank", 30).title).toBe("Untitled activity");
  });
});
