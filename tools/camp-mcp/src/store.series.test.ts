// Coverage for the recurring-series store wrappers (createSeries / editSeries /
// deleteSeries / deleteEvents). Drives the REAL store functions against an
// in-memory fake of the DB layer — the same normalizeCalendarEventInput +
// mapCalendarEventRow round-trip the prod path uses — so it needs no DATABASE_URL
// and never touches live data. The recurrence MATH itself is owned (and tested)
// by lib/calendar/recurrence; this proves the MCP glue wires it up faithfully.
import { describe, expect, test, vi } from "vitest";

vi.mock("./config", () => ({ loadEnv: () => {}, getAdminUserId: () => "user_smoke" }));

vi.mock("@/lib/server/userData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/userData")>();
  const rows = new Map<string, Record<string, unknown>>();
  return {
    ...actual,
    listCalendarEvents: async (_uid: string, range?: { from?: string; to?: string }) => {
      let list = [...rows.values()];
      if (range?.from) list = list.filter((r) => String(r.date) >= range.from!);
      if (range?.to) list = list.filter((r) => String(r.date) <= range.to!);
      return list.sort((a, b) => (String(a.date) < String(b.date) ? -1 : String(a.date) > String(b.date) ? 1 : 0));
    },
    upsertCalendarEvent: async (_uid: string, raw: unknown) => {
      const res = actual.normalizeCalendarEventInput(raw);
      if (!res.ok) return res;
      const e = res.event as unknown as { id: string; date: string; startMin: number | null; endMin: number | null; title: string; activityId: string | null; kind: string; payload: Record<string, unknown> };
      // Mirror mapCalendarEventRow: payload snapshot, canonical columns win, ISO updatedAt.
      const stored = {
        ...e.payload,
        id: e.id,
        date: e.date,
        startMin: e.startMin,
        endMin: e.endMin,
        title: e.title,
        activityId: e.activityId,
        kind: e.kind,
        updatedAt: new Date().toISOString(),
      };
      rows.set(e.id, stored);
      return { ok: true as const, event: stored as never };
    },
    deleteCalendarEvent: async (_uid: string, id: string) => rows.delete(id.toLowerCase()) || rows.delete(id),
  };
});

const store = await import("./store");

describe("recurring-series store wrappers", () => {
  test("create → list → edit-all → skip-one → delete-following → delete-rest", async () => {
    // Weekly Mon/Wed/Fri, 2026-07-06 (Mon) through 2026-07-17 (Fri) inclusive.
    const created = await store.createSeries({
      date: "2026-07-06",
      startMin: 540,
      endMin: 585,
      title: "Flag raising",
      recurrence: { freq: "weekly", weekdays: [1, 3, 5], until: "2026-07-17" },
    });
    // Mon 6, Wed 8, Fri 10, Mon 13, Wed 15, Fri 17 = 6 dates.
    expect(created.count).toBe(6);
    expect(created.dates).toEqual(["2026-07-06", "2026-07-08", "2026-07-10", "2026-07-13", "2026-07-15", "2026-07-17"]);
    expect(created.rule).toContain("weekly");

    let evs = await store.listEvents();
    expect(evs.length).toBe(6);
    const seriesIds = new Set(evs.map((e) => (e as Record<string, unknown>).seriesId));
    expect(seriesIds.size).toBe(1); // all share one seriesId
    expect(evs.every((e) => (e as Record<string, unknown>).recurrence)).toBe(true);
    expect(evs.every((e) => e.startMin === 540)).toBe(true);

    // Edit ALL: shift to 10:00–11:00 by passing one occurrence's id.
    const anyId = String(evs[2].id);
    const edited = await store.editSeries({ id: anyId, scope: "all", startMin: 600, endMin: 660 });
    expect(edited.count).toBe(6);
    evs = await store.listEvents();
    expect(evs.every((e) => e.startMin === 600 && e.endMin === 660)).toBe(true);
    expect(evs.every((e) => e.title === "Flag raising")).toBe(true);
    expect(new Set(evs.map((e) => (e as Record<string, unknown>).seriesId)).size).toBe(1); // seriesId preserved

    // Skip a single day (scope "this"): removes it and records an exdate.
    const byDate = [...evs].sort((a, b) => (a.date < b.date ? -1 : 1));
    const skipTarget = byDate[1]; // 2026-07-08
    const skipped = await store.deleteSeries({ id: String(skipTarget.id), scope: "this" });
    expect(skipped.skipped).toBe("2026-07-08");
    evs = await store.listEvents();
    expect(evs.length).toBe(5);
    expect(evs.some((e) => e.date === "2026-07-08")).toBe(false);
    // Survivors carry the exdate so a later regeneration won't resurrect it.
    expect(
      evs.every((e) => ((e as Record<string, unknown>).recurrence as { exdates?: string[] })?.exdates?.includes("2026-07-08")),
    ).toBe(true);

    // Delete THIS-AND-FOLLOWING from 2026-07-13 onward (removes 13, 15, 17).
    const remaining = [...evs].sort((a, b) => (a.date < b.date ? -1 : 1));
    const fromTarget = remaining.find((e) => e.date === "2026-07-13")!;
    const delFollowing = await store.deleteSeries({ id: String(fromTarget.id), scope: "following" });
    expect(delFollowing.removed).toBe(3);
    evs = await store.listEvents();
    expect(evs.map((e) => e.date).sort()).toEqual(["2026-07-06", "2026-07-10"]);

    // Delete the remaining series with the scoped series verb.
    const delRest = await store.deleteSeries({ id: String(evs[0].id), scope: "all" });
    expect(delRest.removed).toBe(2);
    expect((await store.listEvents()).length).toBe(0);
  });

  test("one-off edit/delete verbs refuse series occurrences", async () => {
    const created = await store.createSeries({
      date: "2026-07-06",
      startMin: 720,
      endMin: 750,
      title: "Lunch",
      recurrence: { freq: "daily", until: "2026-07-10" },
    });
    expect(created.count).toBe(5);
    const evs = await store.listEvents();
    const target = evs[0];

    await expect(store.upsertEvent({ id: String(target.id), title: "Late lunch" })).rejects.toThrow(
      /edit_series/i,
    );
    await expect(store.deleteEvent(String(target.id))).rejects.toThrow(/delete_series/i);
    await expect(store.deleteEvents([String(target.id)])).rejects.toThrow(/delete_series/i);

    await store.deleteSeries({ id: String(target.id), scope: "all" });
    expect((await store.listEvents()).length).toBe(0);
  });

  test("all-day series + per-event color round-trip", async () => {
    const created = await store.createSeries({
      date: "2026-08-03",
      allDay: true,
      title: "Theme day",
      color: "#2F6F4E",
      recurrence: { freq: "daily", interval: 1, until: "2026-08-05" },
    });
    expect(created.count).toBe(3);
    const evs = await store.listEvents();
    expect(evs.length).toBe(3);
    expect(evs.every((e) => (e as Record<string, unknown>).allDay === true)).toBe(true);
    expect(evs.every((e) => e.startMin === null)).toBe(true); // all-day → no canonical start
    expect(evs.every((e) => (e as Record<string, unknown>).color === "#2f6f4e")).toBe(true); // normalized lowercase
    await store.deleteSeries({ id: String(evs[0].id), scope: "all" });
  });

  test("stopRepeating collapses a scope to a single event", async () => {
    const created = await store.createSeries({
      date: "2026-09-07",
      startMin: 480,
      endMin: 510,
      title: "Standup",
      recurrence: { freq: "daily", until: "2026-09-11" },
    });
    expect(created.count).toBe(5);
    let evs = await store.listEvents();
    const collapsed = await store.editSeries({ id: String(evs[0].id), scope: "all", stopRepeating: true });
    expect(collapsed.rule).toBe("no longer repeats");
    evs = await store.listEvents();
    expect(evs.length).toBe(1);
    expect((evs[0] as Record<string, unknown>).recurrence).toBeUndefined();
    await store.deleteEvents(evs.map((e) => String(e.id)));
  });
});
