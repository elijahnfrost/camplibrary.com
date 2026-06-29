import { describe, expect, it } from "vitest";
import {
  isValidDateKey,
  mapCalendarEventRow,
  normalizeCalendarEventInput,
} from "./userData";

const EVENT_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

function validEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: EVENT_ID,
    date: "2026-06-11",
    startMin: 540,
    endMin: 600,
    kind: "activity",
    title: "Capture the Flag",
    activityId: "capture-flag",
    updatedAt: 1770000000000,
    ...overrides,
  };
}

describe("isValidDateKey", () => {
  it("accepts real calendar dates only", () => {
    expect(isValidDateKey("2026-06-11")).toBe(true);
    expect(isValidDateKey("2026-02-30")).toBe(false);
    expect(isValidDateKey("2026-13-01")).toBe(false);
    expect(isValidDateKey("06/11/2026")).toBe(false);
    expect(isValidDateKey(20260611)).toBe(false);
  });
});

describe("normalizeCalendarEventInput", () => {
  it("accepts a valid timed event and keeps the full payload", () => {
    const result = normalizeCalendarEventInput(validEvent({ futureField: "round-trips" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event).toMatchObject({
      id: EVENT_ID,
      date: "2026-06-11",
      startMin: 540,
      endMin: 600,
      kind: "activity",
      activityId: "capture-flag",
    });
    expect(result.event.payload.futureField).toBe("round-trips");
  });

  it("requires a UUID id and a valid date", () => {
    expect(normalizeCalendarEventInput(validEvent({ id: "not-a-uuid" })).ok).toBe(false);
    expect(normalizeCalendarEventInput(validEvent({ id: undefined })).ok).toBe(false);
    expect(normalizeCalendarEventInput(validEvent({ date: "2026-02-30" })).ok).toBe(false);
    expect(normalizeCalendarEventInput(null).ok).toBe(false);
    expect(normalizeCalendarEventInput([validEvent()]).ok).toBe(false);
  });

  it("enforces minute bounds and ordering", () => {
    expect(normalizeCalendarEventInput(validEvent({ startMin: -10 })).ok).toBe(false);
    expect(normalizeCalendarEventInput(validEvent({ endMin: 1441 })).ok).toBe(false);
    // A negative span (start AFTER end) is still rejected.
    expect(normalizeCalendarEventInput(validEvent({ startMin: 600, endMin: 540 })).ok).toBe(false);
    expect(normalizeCalendarEventInput(validEvent({ startMin: 9.5 })).ok).toBe(false);
  });

  it("accepts a 0-minute event (a reminder: start === end)", () => {
    const result = normalizeCalendarEventInput(validEvent({ startMin: 600, endMin: 600 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.startMin).toBe(600);
    expect(result.event.endMin).toBe(600);
  });

  it("trims, bounds, and round-trips the note in the payload", () => {
    const ok = normalizeCalendarEventInput(validEvent({ note: "  check allergies  " }));
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.event.payload.note).toBe("check allergies");
    const long = normalizeCalendarEventInput(validEvent({ note: "x".repeat(500) }));
    expect(long.ok).toBe(true);
    if (!long.ok) return;
    expect(String(long.event.payload.note).length).toBe(280);
    const blank = normalizeCalendarEventInput(validEvent({ note: "   " }));
    expect(blank.ok).toBe(true);
    if (!blank.ok) return;
    expect(blank.event.payload.note).toBeUndefined();
  });

  it("allows all-day events with null minutes", () => {
    const result = normalizeCalendarEventInput(
      validEvent({ allDay: true, startMin: undefined, endMin: undefined })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.startMin).toBeNull();
    expect(result.event.endMin).toBeNull();
  });

  it("downgrades kind to custom when no activityId is present", () => {
    const result = normalizeCalendarEventInput(validEvent({ activityId: undefined }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.kind).toBe("custom");
    expect(result.event.activityId).toBeNull();
  });

  it("trims and caps the title", () => {
    const result = normalizeCalendarEventInput(validEvent({ title: "  " + "x".repeat(500) }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.title.length).toBeLessThanOrEqual(200);
  });
});

describe("mapCalendarEventRow", () => {
  it("spreads the payload but lets canonical columns win", () => {
    const row = {
      id: EVENT_ID,
      event_date: new Date("2026-06-11T00:00:00Z"),
      start_min: 540,
      end_min: 600,
      title: "Canonical title",
      activity_id: "capture-flag",
      kind: "activity",
      updated_at: "2026-06-11T12:00:00Z",
      payload: { title: "Stale payload title", customNote: "kept" },
    };
    const event = mapCalendarEventRow(row);
    expect(event.title).toBe("Canonical title");
    expect(event.customNote).toBe("kept");
    expect(event.date).toBe("2026-06-11");
    expect(event.startMin).toBe(540);
  });

  it("handles all-day rows and string dates", () => {
    const event = mapCalendarEventRow({
      id: EVENT_ID,
      event_date: "2026-06-12",
      start_min: null,
      end_min: null,
      title: "",
      activity_id: null,
      kind: "custom",
      updated_at: "2026-06-12T08:00:00Z",
      payload: {},
    });
    expect(event.date).toBe("2026-06-12");
    expect(event.startMin).toBeNull();
    expect(event.activityId).toBeNull();
  });
});
