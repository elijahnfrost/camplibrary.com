import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "./calendar/types";
import type { RunDoc } from "./runList";
import type { Activity } from "./types";
import {
  activitiesWithNotes,
  fieldNotesFromRunLists,
  recentActivity,
  relativeTime,
  totalPlacements,
  usageByActivity,
} from "./staffStats";

function activity(id: string, title: string, type: Activity["type"] = "Game"): Activity {
  return {
    id,
    title,
    type,
    place: "Field",
    ages: { min: 9, max: 12 },
    groupMin: 1,
    groupMax: 25,
    durationMin: 30,
    energy: 2,
    prep: "None",
    rating: 4,
    steps: [],
    notes: "",
    safety: "",
  } as unknown as Activity;
}

function event(id: string, partial: Partial<CalendarEvent>): CalendarEvent {
  return {
    id,
    date: "2026-06-26",
    startMin: 600,
    endMin: 630,
    kind: "activity",
    title: "",
    updatedAt: 0,
    ...partial,
  };
}

const byId: Record<string, Activity> = {
  a1: activity("a1", "Capture the Flag", "Game"),
  a2: activity("a2", "Friendship Bracelets", "Craft"),
};

describe("usageByActivity", () => {
  it("counts placements per activity, most-scheduled first", () => {
    const events: Record<string, CalendarEvent> = {
      e1: event("e1", { activityId: "a1" }),
      e2: event("e2", { activityId: "a1" }),
      e3: event("e3", { activityId: "a2" }),
      e4: event("e4", { kind: "custom", title: "Lunch" }), // no activityId
    };
    const rows = usageByActivity(events, byId);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ activityId: "a1", title: "Capture the Flag", type: "Game", count: 2 });
    expect(rows[1]).toMatchObject({ activityId: "a2", count: 1 });
    expect(totalPlacements(rows)).toBe(3);
  });

  it("breaks count ties alphabetically by title", () => {
    const events: Record<string, CalendarEvent> = {
      e1: event("e1", { activityId: "a2" }),
      e2: event("e2", { activityId: "a1" }),
    };
    const rows = usageByActivity(events, byId);
    expect(rows.map((r) => r.activityId)).toEqual(["a1", "a2"]); // both count 1; "Capture" < "Friendship"
  });

  it("counts an unknown (deleted) activity using its denormalized event title", () => {
    const events: Record<string, CalendarEvent> = {
      e1: event("e1", { activityId: "gone", title: "Old Game" }),
    };
    const rows = usageByActivity(events, byId);
    expect(rows[0]).toMatchObject({ activityId: "gone", title: "Old Game", type: null, count: 1 });
  });

  it("returns nothing when there are no activity placements", () => {
    const rows = usageByActivity({ e1: event("e1", { kind: "custom", title: "Lunch" }) }, byId);
    expect(rows).toEqual([]);
    expect(totalPlacements(rows)).toBe(0);
  });
});

describe("fieldNotesFromRunLists", () => {
  const runLists: Record<string, RunDoc> = {
    a1: {
      blocks: [
        {
          id: "a1-fieldnotes",
          type: "fieldnote",
          text: "Parent block (no date)",
          children: [
            { id: "c1", type: "fieldnote", text: "Kids loved it", at: "2026-06-20" },
            { id: "c2", type: "fieldnote", text: "", at: "2026-06-21" }, // empty -> skipped
            { id: "c3", type: "note", text: "not a field note" }, // wrong type -> skipped
          ],
        },
      ],
    },
    a2: {
      blocks: [{ id: "b1", type: "fieldnote", text: "Ran out of beads", at: "2026-06-25" }],
    },
  };

  it("collects captured field notes newest first and resolves titles", () => {
    const notes = fieldNotesFromRunLists(runLists, byId);
    // 3 captured: a2 (06-25), a1 child (06-20), a1 parent (no date -> last)
    expect(notes).toHaveLength(3);
    expect(notes[0]).toMatchObject({ activityTitle: "Friendship Bracelets", text: "Ran out of beads", at: "2026-06-25" });
    expect(notes[1]).toMatchObject({ activityId: "a1", text: "Kids loved it", at: "2026-06-20" });
    expect(notes[2]).toMatchObject({ text: "Parent block (no date)" });
    expect(notes[2].at).toBeUndefined();
  });

  it("counts distinct activities with notes", () => {
    const notes = fieldNotesFromRunLists(runLists, byId);
    expect(activitiesWithNotes(notes)).toBe(2);
  });

  it("is empty when no overrides carry captured notes", () => {
    expect(fieldNotesFromRunLists({}, byId)).toEqual([]);
    expect(activitiesWithNotes([])).toBe(0);
  });
});

describe("recentActivity", () => {
  it("merges events and notes into one reverse-chronological feed", () => {
    const events: Record<string, CalendarEvent> = {
      e1: event("e1", { title: "CTF", updatedAt: new Date(2026, 5, 26, 9).getTime() }),
      e2: event("e2", { title: "Bracelets", updatedAt: new Date(2026, 5, 24, 9).getTime() }),
      e3: event("e3", { title: "No timestamp", updatedAt: 0 }), // skipped
    };
    const notes = [
      { activityId: "a1", activityTitle: "Capture the Flag", text: "Loved it", at: "2026-06-25" },
      { activityId: "a2", activityTitle: "Bracelets", text: "No date" }, // no at -> skipped
    ];
    const feed = recentActivity(events, notes, 6);
    expect(feed.map((f) => f.title)).toEqual(["CTF", "Capture the Flag", "Bracelets"]);
    expect(feed[0].kind).toBe("event");
    expect(feed[1].kind).toBe("note");
  });

  it("respects the limit", () => {
    const events: Record<string, CalendarEvent> = {};
    for (let i = 0; i < 10; i += 1) {
      events["e" + i] = event("e" + i, { title: "E" + i, updatedAt: 1000 + i });
    }
    expect(recentActivity(events, [], 3)).toHaveLength(3);
  });
});

describe("relativeTime", () => {
  const now = new Date(2026, 5, 26, 12, 0, 0).getTime();
  it("labels recent and older timestamps", () => {
    expect(relativeTime(now - 10_000, now)).toBe("just now");
    expect(relativeTime(now - 5 * 60_000, now)).toBe("5m ago");
    expect(relativeTime(now - 3 * 60 * 60_000, now)).toBe("3h ago");
    expect(relativeTime(now - 24 * 60 * 60_000, now)).toBe("yesterday");
    expect(relativeTime(now - 5 * 24 * 60 * 60_000, now)).toBe("5d ago");
    // > 1 week falls back to an absolute date string (locale-dependent format).
    expect(relativeTime(now - 30 * 24 * 60 * 60_000, now)).toMatch(/\d/);
  });
});
