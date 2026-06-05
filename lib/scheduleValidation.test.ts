import { describe, expect, it } from "vitest";
import type { Schedule } from "./types";
import { hasPlannedActivity, normalizeScheduleActivityRefs } from "./scheduleValidation";

describe("schedule validation", () => {
  it("converts stale activity ids into open slots so they do not count as planned", () => {
    const schedule: Schedule = {
      0: [
        {
          id: "missing",
          start: "09:00",
          end: "10:00",
          kind: "activity",
          label: "Old custom activity",
          activityId: "deleted-custom",
        },
        {
          id: "known",
          start: "10:00",
          end: "11:00",
          kind: "activity",
          label: "Known activity",
          activityId: "capture-flag",
        },
      ],
    };

    const normalized = normalizeScheduleActivityRefs(schedule, new Set(["capture-flag"]));

    expect(normalized[0][0]).toEqual({
      id: "missing",
      start: "09:00",
      end: "10:00",
      kind: "activity",
      label: "Old custom activity",
      fill: "open",
    });
    expect(normalized[0][1]).toEqual(schedule[0][1]);
    expect(normalized[0].filter((block) => block.kind === "activity" && block.activityId)).toHaveLength(1);
  });

  it("does not treat labels and open slots as planned activities", () => {
    expect(
      hasPlannedActivity([
        { id: "dropoff", start: "08:00", end: "09:00", kind: "label", label: "Drop-off" },
        { id: "open", start: "09:00", end: "10:00", kind: "activity", label: "Activity", fill: "open" },
      ]),
    ).toBe(false);
  });

  it("ignores stale activity ids when valid ids are provided", () => {
    expect(
      hasPlannedActivity(
        [{ id: "old", start: "09:00", end: "10:00", kind: "activity", label: "Old", activityId: "deleted" }],
        new Set(["capture-flag"]),
      ),
    ).toBe(false);
    expect(
      hasPlannedActivity(
        [{ id: "known", start: "09:00", end: "10:00", kind: "activity", label: "Known", activityId: "capture-flag" }],
        new Set(["capture-flag"]),
      ),
    ).toBe(true);
  });
});
