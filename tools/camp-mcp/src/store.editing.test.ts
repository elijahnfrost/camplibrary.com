// Coverage for the editing/search store wrappers added for full calendar parity:
// searchActivities, setActivityColor, recolorEvents, duplicateEvent, and the
// camp/theme management verbs. Drives the REAL store functions against an
// in-memory fake of BOTH the calendar-event layer and the user-docs layer — the
// docs fake runs the prod normalizeDoc, so it proves a per-item color actually
// survives the validate→persist→reload round-trip. No DATABASE_URL, no live data.
import { describe, expect, test, vi } from "vitest";
import { normalizeDoc } from "@/lib/userDataDocs";

vi.mock("./config", () => ({ loadEnv: () => {}, getAdminUserId: () => "user_edit" }));

vi.mock("@/lib/server/userData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/userData")>();
  const rows = new Map<string, Record<string, unknown>>();
  const docs = new Map<string, unknown>();
  return {
    ...actual,
    getUserDocs: async (_uid: string) => {
      const out: Record<string, unknown> = {};
      for (const [key, value] of docs) out[key] = value;
      return out;
    },
    putUserDoc: async (_uid: string, key: string, raw: unknown) => {
      // Mirror prod: normalize on write so the test exercises the real validators.
      docs.set(key, normalizeDoc(key as never, raw));
      return { updatedAt: new Date().toISOString() };
    },
    listCalendarEvents: async (_uid: string, range?: { from?: string; to?: string }) => {
      let list = [...rows.values()];
      if (range?.from) list = list.filter((r) => String(r.date) >= range.from!);
      if (range?.to) list = list.filter((r) => String(r.date) <= range.to!);
      return list.sort((a, b) => (String(a.date) < String(b.date) ? -1 : String(a.date) > String(b.date) ? 1 : 0));
    },
    upsertCalendarEvent: async (_uid: string, raw: unknown) => {
      const res = actual.normalizeCalendarEventInput(raw);
      if (!res.ok) return res;
      const e = res.event as unknown as {
        id: string; date: string; startMin: number | null; endMin: number | null;
        title: string; activityId: string | null; kind: string; payload: Record<string, unknown>;
      };
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

describe("library search", () => {
  test("ranks a title match top and respects facet filters", async () => {
    const byTitle = await store.searchActivities({ query: "gaga" });
    expect(byTitle[0]?.id).toBe("gaga-ball");
    expect(byTitle[0]?.source).toBe("library");
    expect(byTitle[0]?.color).toMatch(/^#[0-9a-f]{3,6}$/); // effective tint resolved

    // Alternate names are in the haystack: "Octoball" → Gaga Ball.
    const byAlt = await store.searchActivities({ query: "octoball" });
    expect(byAlt.some((h) => h.id === "gaga-ball")).toBe(true);

    // Facet filter narrows to one category.
    const crafts = await store.searchActivities({ type: "Craft", limit: 5 });
    expect(crafts.length).toBeGreaterThan(0);
    expect(crafts.every((h) => h.type === "Craft")).toBe(true);

    // A nonsense query matches nothing.
    expect(await store.searchActivities({ query: "zzzznotanactivity" })).toEqual([]);
  });
});

describe("activity color (built-in override)", () => {
  test("set on a built-in promotes it to custom, then clearing reverts", async () => {
    const saved = await store.setActivityColor("gaga-ball", "#3F6B45");
    expect(saved.color).toBe("#3f6b45"); // normalized lowercase, survived normalizeActivities

    // It now shadows the seed as a custom record and is findable by the facet.
    const overridden = await store.searchActivities({ hasColorOverride: true });
    expect(overridden.some((h) => h.id === "gaga-ball" && h.source === "custom")).toBe(true);

    const cleared = await store.setActivityColor("gaga-ball", null);
    expect(cleared.color).toBeUndefined();
    expect((await store.searchActivities({ hasColorOverride: true })).some((h) => h.id === "gaga-ball")).toBe(false);
  });

  test("rejects an unknown activity id", async () => {
    await expect(store.setActivityColor("nope-not-real", "#abc")).rejects.toThrow(/Unknown activityId/);
  });
});

describe("event recolor + duplicate", () => {
  test("recolor by activityId sets then clears the override on every placement", async () => {
    await store.upsertEvent({ date: "2026-07-06", startMin: 540, endMin: 585, activityId: "gaga-ball" });
    await store.upsertEvent({ date: "2026-07-07", startMin: 540, endMin: 585, activityId: "gaga-ball" });

    const set = await store.recolorEvents({ activityId: "gaga-ball", color: "#aabbcc" });
    expect(set.recolored).toBe(2);
    let evs = await store.listEvents();
    expect(evs.every((e) => (e as Record<string, unknown>).color === "#aabbcc")).toBe(true);

    const clear = await store.recolorEvents({ activityId: "gaga-ball", color: null });
    expect(clear.recolored).toBe(2);
    evs = await store.listEvents();
    expect(evs.every((e) => (e as Record<string, unknown>).color === undefined)).toBe(true);

    await store.deleteEvents(evs.map((e) => String(e.id)));
  });

  test("duplicate clones a standalone copy detached from its series", async () => {
    const series = await store.createSeries({
      date: "2026-07-06",
      startMin: 540,
      endMin: 585,
      title: "Flag",
      recurrence: { freq: "daily", until: "2026-07-08" },
    });
    expect(series.count).toBe(3);
    const occ = (await store.listEvents())[0];

    const copy = await store.duplicateEvent({ id: String(occ.id), date: "2026-07-20" });
    expect(copy.id).not.toBe(occ.id);
    expect(copy.date).toBe("2026-07-20");
    expect(copy.title).toBe("Flag");
    expect((copy as Record<string, unknown>).seriesId).toBeUndefined();
    expect((copy as Record<string, unknown>).recurrence).toBeUndefined();

    await store.deleteEvents((await store.listEvents()).map((e) => String(e.id)));
  });
});

describe("camp + theme management", () => {
  test("camps: add → edit (rename + hours, clamped) → delete (idempotent)", async () => {
    const camp = await store.addCamp("Summer 2026");
    const edited = await store.editCamp({ id: camp.id, name: "Summer Camp 2026", openMin: 5 * 60, closeMin: 23 * 60 });
    expect(edited.name).toBe("Summer Camp 2026");
    expect(edited.openMin).toBe(6 * 60); // clamped up to EARLIEST_OPEN_MIN
    expect(edited.closeMin).toBe(20 * 60); // clamped down to LATEST_CLOSE_MIN

    expect((await store.deleteCamp(camp.id)).existed).toBe(true);
    expect((await store.deleteCamp(camp.id)).existed).toBe(false);
  });

  test("themes: add → rename → assign → delete purges assignments; unassign", async () => {
    const theme = await store.addTheme("Ocean");
    const renamed = await store.editTheme(theme.id, "Ocean Week");
    expect(renamed.label).toBe("Ocean Week");

    await store.assignTheme("gaga-ball", theme.id);
    await store.assignTheme("capture-flag", theme.id);

    // Unassign one directly.
    await store.unassignTheme("capture-flag");

    // Deleting the theme purges the remaining assignment.
    const del = await store.deleteTheme(theme.id);
    expect(del.existed).toBe(true);
    expect(del.unassigned).toBe(1); // only gaga-ball was still assigned
  });
});
