import { describe, expect, it } from "vitest";
import { rainPlanForDay } from "./rainPlan";
import type { DayWeather } from "../weather";
import type { CalendarEvent } from "./types";
import type { Activity } from "../types";

const DATE = "2026-07-06";

const day = (over: Partial<DayWeather> = {}): DayWeather => ({
  code: 61,
  condition: "rain",
  tempMax: 70,
  tempMin: 55,
  precipProbMax: 70,
  precipSum: 0.2,
  ...over,
});

const activity = (id: string, over: Partial<Activity> = {}): Activity =>
  ({
    id,
    title: id,
    type: "Game",
    place: "Outside",
    ageMin: 9,
    ageMax: 12,
    durationMin: 30,
    groupMin: null,
    groupMax: null,
    energy: 3,
    prep: "Low",
    blurb: "",
    materials: [],
    steps: [],
    notes: "",
    safety: "",
    ages: ["g46"],
    rating: 0,
    ...over,
  }) as Activity;

const event = (over: Partial<CalendarEvent>): CalendarEvent => ({
  id: "e",
  date: DATE,
  startMin: 600,
  endMin: 630,
  kind: "activity",
  title: "x",
  updatedAt: 1,
  ...over,
});

const byId: Record<string, Activity> = {
  ctf: activity("ctf", { title: "Capture the Flag", alternates: [{ title: "Four Corners", reason: "rain" }] }),
  bingo: activity("bingo", { title: "Bingo", place: "Inside" }),
  outNoBackup: activity("outNoBackup", { title: "Kickball" }),
};

describe("rainPlanForDay — trigger", () => {
  const outdoor = event({ id: "e1", activityId: "ctf", kind: "activity", title: "Capture the Flag" });

  it("returns null with no forecast for the day", () => {
    expect(rainPlanForDay(DATE, undefined, [outdoor], byId, 50)).toBeNull();
  });

  it("fires when precip probability meets the threshold", () => {
    expect(rainPlanForDay(DATE, day({ precipProbMax: 50 }), [outdoor], byId, 50)).not.toBeNull();
    expect(rainPlanForDay(DATE, day({ precipProbMax: 49 }), [outdoor], byId, 50)).toBeNull();
  });

  it("fires on a thunderstorm even below the probability threshold", () => {
    const storm = day({ condition: "thunder", precipProbMax: 20 });
    expect(rainPlanForDay(DATE, storm, [outdoor], byId, 50)).not.toBeNull();
  });

  it("returns null when rain is likely but nothing outdoor is at risk", () => {
    const indoor = event({ id: "e2", activityId: "bingo", title: "Bingo" });
    expect(rainPlanForDay(DATE, day(), [indoor], byId, 50)).toBeNull();
  });
});

describe("rainPlanForDay — at-risk selection", () => {
  it("includes only outdoor, timed, non-reminder, activity-backed blocks on the day", () => {
    const events = [
      event({ id: "out", activityId: "ctf", title: "Capture the Flag" }),
      event({ id: "in", activityId: "bingo", title: "Bingo" }), // indoor
      event({ id: "reminder", activityId: "ctf", startMin: 600, endMin: 600 }), // 0-min
      event({ id: "allday", activityId: "ctf", allDay: true }), // all-day
      event({ id: "custom", kind: "custom", title: "Free play", activityId: undefined }), // no activity
      event({ id: "otherday", activityId: "ctf", date: "2026-07-07" }), // different day
    ];
    const plan = rainPlanForDay(DATE, day(), events, byId, 50);
    expect(plan?.rows.map((r) => r.event.id)).toEqual(["out"]);
  });

  it("orders rows chronologically and carries probMax", () => {
    const events = [
      event({ id: "late", activityId: "ctf", startMin: 800, endMin: 830 }),
      event({ id: "early", activityId: "outNoBackup", startMin: 540, endMin: 600 }),
    ];
    const plan = rainPlanForDay(DATE, day({ precipProbMax: 80 }), events, byId, 50);
    expect(plan?.probMax).toBe(80);
    expect(plan?.rows.map((r) => r.event.id)).toEqual(["early", "late"]);
  });

  it("resolves each row's backups (activity default, or [] when none)", () => {
    const events = [
      event({ id: "withBackup", activityId: "ctf" }),
      event({ id: "noBackup", activityId: "outNoBackup" }),
    ];
    const plan = rainPlanForDay(DATE, day(), events, byId, 50);
    const withBackup = plan?.rows.find((r) => r.event.id === "withBackup");
    const noBackup = plan?.rows.find((r) => r.event.id === "noBackup");
    expect(withBackup?.alternates).toEqual([{ title: "Four Corners", reason: "rain" }]);
    expect(noBackup?.alternates).toEqual([]);
  });

  it("honors an authoritative empty event list (no inherit)", () => {
    const events = [event({ id: "e1", activityId: "ctf", alternates: [] })];
    const plan = rainPlanForDay(DATE, day(), events, byId, 50);
    expect(plan?.rows[0].alternates).toEqual([]);
  });
});
