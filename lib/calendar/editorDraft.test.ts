import { describe, it, expect } from "vitest";
import { draftFromEvent, eventFromDraft, type EditorDraft } from "./editorDraft";
import type { CalendarEvent } from "./types";

const event = (over: Partial<CalendarEvent> = {}): CalendarEvent =>
  ({ id: "e1", date: "2026-07-15", startMin: 540, endMin: 585, kind: "custom", title: "Craft", ...over }) as CalendarEvent;

const draft = (over: Partial<EditorDraft> = {}): EditorDraft =>
  ({ date: "2026-07-15", startMin: 540, durationMin: 45, allDay: false, title: "Craft", ...over }) as EditorDraft;

describe("draftFromEvent", () => {
  it("maps a timed event's span to durationMin and copies the editor fields", () => {
    const d = draftFromEvent(event({ startMin: 540, endMin: 585, color: "#abc", note: "glue", pinned: true }));
    expect(d).toMatchObject({ id: "e1", date: "2026-07-15", startMin: 540, durationMin: 45, allDay: false, color: "#abc", note: "glue", pinned: true });
    expect(d.explicitDuration).toBe(true);
  });

  it("gives an all-day event a nominal 30-min length", () => {
    expect(draftFromEvent(event({ allDay: true })).durationMin).toBe(30);
    expect(draftFromEvent(event({ allDay: true })).allDay).toBe(true);
  });
});

describe("eventFromDraft", () => {
  it("mints id + updatedAt from opts and derives kind/title", () => {
    const e = eventFromDraft(draft({ activityId: "a1", title: "typed" }), undefined, undefined, { id: "new", now: 1234 });
    expect(e.id).toBe("new");
    expect(e.updatedAt).toBe(1234);
    expect(e.kind).toBe("activity");
    // an activity's title wins over the draft's; otherwise the draft's is used
    // verbatim (`??` only falls through on null/undefined, so "" is kept as-is).
    expect(eventFromDraft(draft({ activityId: "a1", title: "typed" }), undefined, { title: "Real" } as never, { id: "x", now: 0 }).title).toBe("Real");
    expect(eventFromDraft(draft({ title: "Lunch" }), undefined, undefined, { id: "x", now: 0 }).title).toBe("Lunch");
  });

  it("snaps the timed span from startMin + durationMin; a 0-length draft is a reminder", () => {
    expect(eventFromDraft(draft({ startMin: 600, durationMin: 45 }), undefined, undefined, { id: "x", now: 0 })).toMatchObject({ startMin: 600, endMin: 645 });
    const reminder = eventFromDraft(draft({ durationMin: 0 }), undefined, undefined, { id: "x", now: 0 });
    expect(reminder.endMin).toBe(reminder.startMin);
  });

  it("PATCHES over the existing row: fields the editor doesn't own survive", () => {
    const existing = event({ campId: "c2", seriesId: "s9" });
    const e = eventFromDraft(draft(), existing, undefined, { id: "e1", now: 5 });
    expect(e.campId).toBe("c2");
    expect(e.seriesId).toBe("s9");
  });

  it("DELETES an editor-owned optional the draft cleared (clearing sticks on an edit)", () => {
    const existing = event({ color: "#fff", note: "old", locations: ["Gym"], pinned: true });
    // draft carries none of those → they must be removed, not left at their old value
    const e = eventFromDraft(draft(), existing, undefined, { id: "e1", now: 5 });
    expect("color" in e).toBe(false);
    expect("note" in e).toBe(false);
    expect("locations" in e).toBe(false);
    expect("pinned" in e).toBe(false);
  });

  it("keeps an editor-owned optional the draft set", () => {
    const e = eventFromDraft(draft({ color: "#123", locations: ["Field"], note: "hi", pinned: true }), event(), undefined, { id: "e1", now: 5 });
    expect(e).toMatchObject({ color: "#123", locations: ["Field"], note: "hi", pinned: true });
  });
});

describe("draft ↔ event round-trip", () => {
  it("preserves the editor-owned fields through event → draft → event", () => {
    const d = draft({ startMin: 540, durationMin: 45, activityId: undefined, title: "Lunch", color: "#abc", locations: ["Cafe"], note: "pizza", pinned: true });
    const e = eventFromDraft(d, undefined, undefined, { id: "e1", now: 7 });
    const d2 = draftFromEvent(e);
    expect(d2).toMatchObject({ date: d.date, startMin: 540, durationMin: 45, allDay: false, title: "Lunch", color: "#abc", locations: ["Cafe"], note: "pizza", pinned: true });
  });
});
