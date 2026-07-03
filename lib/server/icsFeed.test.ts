import { describe, expect, it } from "vitest";
import { buildCalendarFeed } from "./icsFeed";
import type { StoredCalendarEvent } from "./userData";

function event(overrides: Partial<StoredCalendarEvent>): StoredCalendarEvent {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    date: "2026-06-18",
    startMin: 600, // 10:00
    endMin: 690, // 11:30
    title: "Capture the Flag",
    activityId: "game-ctf",
    kind: "activity",
    updatedAt: "2026-06-01T12:00:00.000Z",
    ...overrides,
  };
}

const base = {
  calendarName: "Summer Day Camp",
  feedUrl: "https://camplibrary.com/api/ics/tok.ics",
  appBaseUrl: "https://camplibrary.com",
  feedToken: "tok",
  campName: "Summer Day Camp" as string | null,
};

function vevents(ics: string): string[] {
  return ics.split("BEGIN:VEVENT").slice(1).map((part) => part.split("END:VEVENT")[0]);
}

// RFC 5545 folds any line over 75 octets onto a continuation line starting
// with a single space ("\r\n "). A long DESCRIPTION (run-sheet link + the
// severe-dietary line) legitimately folds mid-string, which would otherwise
// break a naive .toContain on the raw feed. Unfold before asserting on
// substrings that might straddle a fold boundary.
function unfold(ics: string): string {
  return ics.replace(/\r\n /g, "");
}

describe("buildCalendarFeed", () => {
  it("emits a valid VCALENDAR shell with a refresh interval and calendar name", () => {
    const ics = buildCalendarFeed({ ...base, events: [event({})] });
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("END:VCALENDAR");
    expect(ics).toContain("METHOD:PUBLISH");
    expect(ics).toContain("REFRESH-INTERVAL;VALUE=DURATION:PT1H");
    expect(ics).toContain("X-WR-CALNAME:Summer Day Camp");
  });

  it("renders a timed event at its wall-clock time (floating, no timezone)", () => {
    const ics = buildCalendarFeed({ ...base, events: [event({})] });
    // Floating: same digits as the stored wall clock, no trailing Z, no TZID.
    expect(ics).toContain("DTSTART:20260618T100000");
    expect(ics).toContain("DTEND:20260618T113000");
    expect(ics).not.toContain("DTSTART;TZID");
    expect(ics).not.toMatch(/DTSTART:20260618T\d{6}Z/);
  });

  it("includes a stable UID and a sequence derived from updatedAt", () => {
    const ics = buildCalendarFeed({ ...base, events: [event({})] });
    expect(ics).toContain("UID:11111111-1111-1111-1111-111111111111@camplibrary");
    const expectedSeq = Math.floor(Date.parse("2026-06-01T12:00:00.000Z") / 1000);
    expect(ics).toContain("SEQUENCE:" + expectedSeq);
  });

  it("links each activity event to its token-gated run sheet", () => {
    const ics = buildCalendarFeed({ ...base, events: [event({ activityId: "game-ctf" })] });
    expect(ics).toContain("https://camplibrary.com/run/tok/game-ctf");
    expect(ics).toMatch(/URL[^\n]*:https:\/\/camplibrary\.com\/run\/tok\/game-ctf/);
    expect(ics).toContain("DESCRIPTION:Run sheet: https://camplibrary.com/run/tok/game-ctf");
  });

  it("omits the run-sheet link for events with no activity", () => {
    const ics = buildCalendarFeed({
      ...base,
      events: [event({ activityId: null, kind: "custom", title: "Lunch" })],
    });
    const body = vevents(ics)[0];
    expect(body).toContain("SUMMARY:Lunch");
    expect(body).not.toContain("/run/");
    expect(body).not.toContain("URL");
  });

  it("renders an all-day event as a date-only value", () => {
    const ics = buildCalendarFeed({
      ...base,
      events: [event({ startMin: null, endMin: null, title: "Field Trip" })],
    });
    expect(ics).toContain("DTSTART;VALUE=DATE:20260618");
  });

  it("falls back to 'Untitled' for blank titles", () => {
    const ics = buildCalendarFeed({ ...base, events: [event({ title: "  " })] });
    expect(ics).toContain("SUMMARY:Untitled");
  });

  it("keeps a DST spring-forward day on its wall clock (floating dodges the offset)", () => {
    // 2026-03-08 02:30 is inside the US spring-forward gap; a UTC-anchored or
    // local-Date conversion could shift the day. Floating must keep it verbatim.
    const ics = buildCalendarFeed({
      ...base,
      events: [event({ date: "2026-03-08", startMin: 150, endMin: 210 })],
    });
    expect(ics).toContain("DTSTART:20260308T023000");
    expect(ics).toContain("DTEND:20260308T033000");
  });

  it("applies the camp name as the event location when provided", () => {
    const ics = buildCalendarFeed({ ...base, events: [event({})] });
    expect(ics).toContain("LOCATION:Summer Day Camp");
  });

  it("joins a multi-value locations array, overriding the camp fallback", () => {
    const ics = buildCalendarFeed({
      ...base,
      events: [event({ locations: ["Gym", "Kitchen"] } as Partial<StoredCalendarEvent>)],
    });
    expect(ics).toContain("LOCATION:Gym\\, Kitchen");
  });

  it("honors a legacy single location string", () => {
    const ics = buildCalendarFeed({
      ...base,
      events: [event({ location: "Playground" } as Partial<StoredCalendarEvent>)],
    });
    expect(ics).toContain("LOCATION:Playground");
  });

  // meals-2: meal glyph + severe-dietary warning reach the ICS feed (previously
  // the live calendar was the ONLY surface where meals had any visible effect).
  it("prefixes a meal-tagged event's summary with a fork+spoon glyph and its kind", () => {
    const ics = buildCalendarFeed({
      ...base,
      events: [event({ title: "Lunch", mealKind: "lunch" } as Partial<StoredCalendarEvent>)],
    });
    expect(ics).toContain("SUMMARY:🍴 Lunch (Lunch)");
  });

  it("leaves a non-meal event's summary untouched", () => {
    const ics = buildCalendarFeed({ ...base, events: [event({ title: "Capture the Flag" })] });
    const body = vevents(ics)[0];
    expect(body).toContain("SUMMARY:Capture the Flag");
    expect(body).not.toContain("🍴");
  });

  it("adds a severe-dietary description line to a meal event when the roster has one", () => {
    const ics = buildCalendarFeed({
      ...base,
      events: [event({ title: "Lunch", mealKind: "lunch" } as Partial<StoredCalendarEvent>)],
      dietary: [
        { id: "d1", label: "nuts", severity: "severe", detail: "Ella" },
        { id: "d2", label: "gluten", severity: "note" },
      ],
    });
    expect(unfold(ics)).toContain("Severe allergies on roster: nuts (Ella).");
  });

  it("omits the dietary line on a non-meal event even when severe entries are on file", () => {
    const ics = buildCalendarFeed({
      ...base,
      events: [event({ title: "Capture the Flag" })],
      dietary: [{ id: "d1", label: "nuts", severity: "severe" }],
    });
    const body = vevents(ics)[0];
    expect(body).not.toContain("Severe allergies");
  });

  it("omits the dietary line on a meal event when the roster has no severe entries", () => {
    const ics = buildCalendarFeed({
      ...base,
      events: [event({ title: "Lunch", mealKind: "lunch" } as Partial<StoredCalendarEvent>)],
      dietary: [{ id: "d1", label: "gluten", severity: "avoid" }],
    });
    const body = vevents(ics)[0];
    expect(body).not.toContain("Severe allergies");
  });

  it("joins the run-sheet link and the dietary line as two description lines", () => {
    const ics = buildCalendarFeed({
      ...base,
      events: [
        event({
          title: "Lunch",
          mealKind: "lunch",
          activityId: "meal-lunch",
        } as Partial<StoredCalendarEvent>),
      ],
      dietary: [{ id: "d1", label: "nuts", severity: "severe" }],
    });
    const unfolded = unfold(ics);
    expect(unfolded).toContain("Run sheet: https://camplibrary.com/run/tok/meal-lunch");
    expect(unfolded).toContain("Severe allergies on roster: nuts.");
  });
});
