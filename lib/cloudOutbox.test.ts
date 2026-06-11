import { describe, expect, it } from "vitest";
import { coalesce, nextRetryDelayMs, parseOutbox, serializeOutbox, type OutboxOp } from "./cloudOutbox";

describe("coalesce", () => {
  it("dedupes doc dirty flags by key, preserving first-seen order", () => {
    const ops: OutboxOp[] = [
      { kind: "doc", key: "favs" },
      { kind: "doc", key: "ratings" },
      { kind: "doc", key: "favs" },
      { kind: "doc", key: "favs" },
    ];
    expect(coalesce(ops)).toEqual([
      { kind: "doc", key: "favs" },
      { kind: "doc", key: "ratings" },
    ]);
  });

  it("keeps only the latest op per event id", () => {
    const ops: OutboxOp[] = [
      { kind: "eventUpsert", id: "e1" },
      { kind: "eventUpsert", id: "e2" },
      { kind: "eventDelete", id: "e1" },
    ];
    expect(coalesce(ops)).toEqual([
      { kind: "eventDelete", id: "e1" },
      { kind: "eventUpsert", id: "e2" },
    ]);
  });

  it("delete followed by re-create becomes a single upsert", () => {
    const ops: OutboxOp[] = [
      { kind: "eventDelete", id: "e1" },
      { kind: "eventUpsert", id: "e1" },
    ];
    expect(coalesce(ops)).toEqual([{ kind: "eventUpsert", id: "e1" }]);
  });

  it("interleaves docs and events without losing order", () => {
    const ops: OutboxOp[] = [
      { kind: "doc", key: "favs" },
      { kind: "eventUpsert", id: "e1" },
      { kind: "doc", key: "favs" },
    ];
    expect(coalesce(ops)).toEqual([
      { kind: "doc", key: "favs" },
      { kind: "eventUpsert", id: "e1" },
    ]);
  });
});

describe("nextRetryDelayMs", () => {
  it("backs off and caps", () => {
    expect(nextRetryDelayMs(0)).toBe(2000);
    expect(nextRetryDelayMs(1)).toBe(5000);
    expect(nextRetryDelayMs(2)).toBe(15000);
    expect(nextRetryDelayMs(3)).toBe(30000);
    expect(nextRetryDelayMs(99)).toBe(30000);
    expect(nextRetryDelayMs(-5)).toBe(2000);
  });
});

describe("serialize / parse round-trip", () => {
  it("round-trips a mixed queue", () => {
    const ops: OutboxOp[] = [
      { kind: "doc", key: "runLists" },
      { kind: "eventUpsert", id: "abc" },
      { kind: "eventDelete", id: "def" },
    ];
    expect(parseOutbox(serializeOutbox(ops))).toEqual(ops);
  });

  it("drops malformed entries and survives corrupt JSON", () => {
    expect(parseOutbox(null)).toEqual([]);
    expect(parseOutbox("{not json")).toEqual([]);
    expect(parseOutbox('{"a":1}')).toEqual([]);
    expect(
      parseOutbox(
        JSON.stringify([
          { kind: "doc", key: "favs" },
          { kind: "doc", key: "notAKey" },
          { kind: "eventUpsert", id: "" },
          { kind: "eventDelete", id: "ok" },
          "junk",
        ])
      )
    ).toEqual([
      { kind: "doc", key: "favs" },
      { kind: "eventDelete", id: "ok" },
    ]);
  });
});
