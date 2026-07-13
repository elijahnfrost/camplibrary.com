import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "../calendar/types";
import { mergeServerDocs, mergeServerEvents, type Docs } from "./serverSync";
import { USER_DOC_KEYS, docDefault, type UserDocKey } from "./userDataDocs";

function defaultDocs(overrides: Partial<Docs> = {}): Docs {
  const out = {} as Docs;
  for (const key of USER_DOC_KEYS) (out as Record<string, unknown>)[key] = docDefault(key);
  return { ...out, ...overrides };
}

function event(id: string, over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id,
    date: "2026-07-12",
    startMin: 540,
    endMin: 600,
    kind: "custom",
    title: id,
    updatedAt: 1,
    ...over,
  };
}

describe("mergeServerDocs", () => {
  it("adopts the server value for a key not being locally edited", () => {
    const current = defaultDocs({ favs: ["a"] });
    const next = mergeServerDocs(current, { favs: ["a", "b", "c"] }, new Set());
    expect(next.favs).toEqual(["a", "b", "c"]);
  });

  it("keeps the local value for a key with a pending edit (in skipKeys)", () => {
    const current = defaultDocs({ favs: ["local-edit"] });
    const skip = new Set<UserDocKey>(["favs"]);
    const next = mergeServerDocs(current, { favs: ["stale-server"] }, skip);
    expect(next.favs).toEqual(["local-edit"]);
  });

  it("keeps the current value for a key the server snapshot omits", () => {
    const current = defaultDocs({ ratings: { x: 5 } });
    const next = mergeServerDocs(current, { favs: ["a"] }, new Set());
    expect(next.ratings).toEqual({ x: 5 });
    expect(next.favs).toEqual(["a"]);
  });

  it("normalizes the server value through the per-key validator", () => {
    const current = defaultDocs();
    // ratings must be a Record<string, number>; a garbage value normalizes away.
    const next = mergeServerDocs(current, { ratings: "not-an-object" }, new Set());
    expect(next.ratings).toEqual({});
  });

  it("returns a fresh object, leaving the input untouched", () => {
    const current = defaultDocs({ favs: ["a"] });
    const next = mergeServerDocs(current, { favs: ["b"] }, new Set());
    expect(next).not.toBe(current);
    expect(current.favs).toEqual(["a"]);
  });
});

describe("mergeServerEvents", () => {
  it("adopts server events wholesale when nothing is pending", () => {
    const current = { e1: event("e1") };
    const next = mergeServerEvents(current, [event("e1", { title: "server" }), event("e2")], new Set());
    expect(Object.keys(next).sort()).toEqual(["e1", "e2"]);
    expect(next.e1.title).toBe("server");
  });

  it("drops a local event the server no longer has (deleted remotely)", () => {
    const current = { e1: event("e1"), gone: event("gone") };
    const next = mergeServerEvents(current, [event("e1")], new Set());
    expect(Object.keys(next)).toEqual(["e1"]);
    expect(next.gone).toBeUndefined();
  });

  it("keeps the local value for a pending id, ignoring a stale server row", () => {
    const current = { e1: event("e1", { title: "local-edit", updatedAt: 99 }) };
    const pending = new Set(["e1"]);
    const next = mergeServerEvents(current, [event("e1", { title: "stale-server", updatedAt: 1 })], pending);
    expect(next.e1.title).toBe("local-edit");
    expect(next.e1.updatedAt).toBe(99);
  });

  it("keeps a pending id that the server doesn't have yet (in-flight create)", () => {
    const current = { fresh: event("fresh") };
    const pending = new Set(["fresh"]);
    const next = mergeServerEvents(current, [], pending);
    expect(next.fresh).toBeDefined();
  });

  it("skips malformed server rows", () => {
    const current = {};
    const next = mergeServerEvents(current, [event("ok"), { id: "bad", date: "nonsense" }], new Set());
    expect(Object.keys(next)).toEqual(["ok"]);
  });

  it("treats a non-array server payload as an empty snapshot", () => {
    const current = { e1: event("e1") };
    const next = mergeServerEvents(current, undefined, new Set());
    expect(next).toEqual({});
  });
});
