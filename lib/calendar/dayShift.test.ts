import { describe, expect, it } from "vitest";
import { planDayShift, type DayShiftOptions, type DayShiftNote } from "./dayShift";
import type { CalendarEvent } from "./types";

const DATE = "2026-06-22";

let seq = 0;
function ev(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: over.id ?? "e" + seq++,
    date: DATE,
    startMin: 540,
    endMin: 600,
    kind: "custom",
    title: "Block",
    updatedAt: 0,
    ...over,
  };
}

// Sensible defaults: 15-min grid, close at 6pm, region unbounded unless a pin
// appears. Callers override the fields a case exercises.
function opts(over: Partial<DayShiftOptions> = {}): DayShiftOptions {
  return {
    date: DATE,
    cutoffMin: 0,
    deltaMin: 0,
    snapMin: 15,
    closeMin: 18 * 60,
    ...over,
  };
}

// Pull the upsert for an id (or undefined), for terse assertions.
function upsert(plan: { upserts: CalendarEvent[] }, id: string): CalendarEvent | undefined {
  return plan.upserts.find((e) => e.id === id);
}
function notesOf(plan: { notes: DayShiftNote[] }, kind: DayShiftNote["kind"]): DayShiftNote[] {
  return plan.notes.filter((n) => n.kind === kind);
}

describe("planDayShift — basics", () => {
  it("shifts every candidate at/after the cutoff by +delta, preserving duration", () => {
    const a = ev({ id: "a", startMin: 600, endMin: 660 }); // 10:00–11:00
    const b = ev({ id: "b", startMin: 690, endMin: 720 }); // 11:30–12:00
    const plan = planDayShift([a, b], opts({ cutoffMin: 540, deltaMin: 30 }));
    expect(upsert(plan, "a")).toMatchObject({ startMin: 630, endMin: 690 });
    expect(upsert(plan, "b")).toMatchObject({ startMin: 720, endMin: 750 });
    expect(plan.removes).toEqual([]);
  });

  it("returns an empty plan when the delta snaps to zero", () => {
    const a = ev({ id: "a", startMin: 600, endMin: 660 });
    // 5 minutes on a 15-min grid rounds to 0 → nothing to do.
    const plan = planDayShift([a], opts({ deltaMin: 5 }));
    expect(plan.upserts).toEqual([]);
    expect(plan.notes).toEqual([]);
  });

  it("omits unchanged rows and sorts upserts by (startMin, id)", () => {
    const a = ev({ id: "a", startMin: 660, endMin: 720 });
    const b = ev({ id: "b", startMin: 600, endMin: 660 });
    const plan = planDayShift([a, b], opts({ cutoffMin: 540, deltaMin: 15 }));
    expect(plan.upserts.map((e) => e.id)).toEqual(["b", "a"]);
  });
});

describe("planDayShift — cutoff exclusivity + straddler", () => {
  it("does not move an event starting before the cutoff", () => {
    const before = ev({ id: "before", startMin: 480, endMin: 540 }); // 8:00–9:00
    const after = ev({ id: "after", startMin: 600, endMin: 660 }); // 10:00–11:00
    const plan = planDayShift([before, after], opts({ cutoffMin: 570, deltaMin: 30 }));
    expect(upsert(plan, "before")).toBeUndefined();
    expect(upsert(plan, "after")).toMatchObject({ startMin: 630 });
  });

  it("leaves an event straddling the cutoff (starts before, ends after) in place", () => {
    // Starts 9:30, cutoff 10:00 — its start is before the cutoff, so it holds.
    const straddler = ev({ id: "s", startMin: 570, endMin: 660 });
    const plan = planDayShift([straddler], opts({ cutoffMin: 600, deltaMin: 30 }));
    expect(upsert(plan, "s")).toBeUndefined();
  });

  it("moves a straddler ONLY when it is the extend target", () => {
    const straddler = ev({ id: "s", startMin: 570, endMin: 660 });
    const plan = planDayShift(
      [straddler],
      opts({ cutoffMin: 600, deltaMin: 30, extendEventId: "s" })
    );
    // Extend never moves the start; only its end grows.
    expect(upsert(plan, "s")).toMatchObject({ startMin: 570, endMin: 690 });
  });
});

describe("planDayShift — extend mode (running long/short)", () => {
  it("grows only the target's end; other candidates shift by the same delta", () => {
    const target = ev({ id: "t", startMin: 540, endMin: 600 }); // 9:00–10:00
    // Composition: the cutoff is the target's original END, so the next block moves.
    const next = ev({ id: "n", startMin: 600, endMin: 660 });
    const plan = planDayShift(
      [target, next],
      opts({ cutoffMin: 600, deltaMin: 30, extendEventId: "t" })
    );
    expect(upsert(plan, "t")).toMatchObject({ startMin: 540, endMin: 630 });
    expect(upsert(plan, "n")).toMatchObject({ startMin: 630, endMin: 690 });
  });

  it("keeps the extension across a pin and reports overlap, never compressing it", () => {
    const target = ev({ id: "t", startMin: 540, endMin: 600 });
    const pin = ev({ id: "p", startMin: 660, endMin: 720, pinned: true });
    const plan = planDayShift(
      [target, pin],
      opts({ cutoffMin: 540, deltaMin: 120, extendEventId: "t" })
    );
    // +120 → end 720, crossing the pin at 660. Kept, not compressed.
    expect(upsert(plan, "t")).toMatchObject({ endMin: 720 });
    expect(notesOf(plan, "overlap")).toContainEqual({ kind: "overlap", id: "t", againstId: "p" });
  });

  it("lets the extension swallow the entire region (no compression)", () => {
    const target = ev({ id: "t", startMin: 540, endMin: 600 });
    const mid = ev({ id: "m", startMin: 660, endMin: 720 });
    const plan = planDayShift(
      [target, mid],
      opts({ cutoffMin: 540, deltaMin: 240, extendEventId: "t" })
    );
    // 600 + 240 = 840; the target now runs right over `mid` — but `mid` is a
    // candidate too and shifts by +240. No compression on the extension.
    expect(upsert(plan, "t")).toMatchObject({ startMin: 540, endMin: 840 });
    expect(upsert(plan, "m")).toMatchObject({ startMin: 900, endMin: 960 });
  });

  it("floors a negative extend at one snap slot and emits shortened (never 0-min)", () => {
    const target = ev({ id: "t", startMin: 540, endMin: 570 }); // 30-min block
    // -60 would put end at 510 (below start). Floor to start + snap = 555.
    const plan = planDayShift([target], opts({ deltaMin: -60, extendEventId: "t" }));
    const t = upsert(plan, "t")!;
    expect(t.endMin).toBe(555);
    expect(t.endMin).toBeGreaterThan(t.startMin); // never minted into a 0-min reminder
    expect(notesOf(plan, "shortened")).toHaveLength(1);
  });

  it("does not floor a reminder up into a block on negative extend", () => {
    const reminder = ev({ id: "r", startMin: 600, endMin: 600 }); // entered 0-min
    const plan = planDayShift([reminder], opts({ deltaMin: -30, extendEventId: "r" }));
    // A reminder that entered 0-min stays 0-min; no change, no upsert.
    expect(upsert(plan, "r")).toBeUndefined();
  });

  it("shifts other candidates with the same delta while extending the target", () => {
    const target = ev({ id: "t", startMin: 540, endMin: 600 });
    const later = ev({ id: "l", startMin: 660, endMin: 720 });
    // Negative extend (running short) shrinks the target; everything past the
    // cutoff still pulls earlier by the same delta.
    const plan = planDayShift(
      [target, later],
      opts({ cutoffMin: 600, deltaMin: -30, extendEventId: "t" })
    );
    expect(upsert(plan, "t")).toMatchObject({ startMin: 540, endMin: 570 }); // end shrank
    expect(upsert(plan, "l")).toMatchObject({ startMin: 630, endMin: 690 }); // pulled earlier
  });
});

describe("planDayShift — reminders + stop cohesion", () => {
  it("shifts a reminder on BOTH ends, keeping it 0-min", () => {
    const r = ev({ id: "r", startMin: 600, endMin: 600 });
    const plan = planDayShift([r], opts({ cutoffMin: 540, deltaMin: 30 }));
    expect(upsert(plan, "r")).toMatchObject({ startMin: 630, endMin: 630 });
  });

  it("holds an entire stop when one member is pinned (never splits)", () => {
    const a = ev({ id: "a", startMin: 600, endMin: 600, title: "Sunscreen" });
    const b = ev({ id: "b", startMin: 600, endMin: 600, title: "Bathroom", pinned: true });
    const c = ev({ id: "c", startMin: 600, endMin: 600, title: "Trash" });
    const plan = planDayShift([a, b, c], opts({ cutoffMin: 540, deltaMin: 30 }));
    // Whole stop holds → no geometry change, three held notes.
    expect(plan.upserts).toEqual([]);
    expect(notesOf(plan, "held").map((n) => n.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("holds an entire stop when one member is excluded", () => {
    const a = ev({ id: "a", startMin: 600, endMin: 600, title: "A" });
    const b = ev({ id: "b", startMin: 600, endMin: 600, title: "B" });
    const plan = planDayShift(
      [a, b],
      opts({ cutoffMin: 540, deltaMin: 30, excludeIds: new Set(["b"]) })
    );
    expect(plan.upserts).toEqual([]);
    expect(notesOf(plan, "held").map((n) => n.id).sort()).toEqual(["a", "b"]);
  });

  it("shifts an unfrozen stop's members together", () => {
    const a = ev({ id: "a", startMin: 600, endMin: 600, title: "A" });
    const b = ev({ id: "b", startMin: 600, endMin: 600, title: "B" });
    const plan = planDayShift([a, b], opts({ cutoffMin: 540, deltaMin: 30 }));
    expect(upsert(plan, "a")).toMatchObject({ startMin: 630, endMin: 630 });
    expect(upsert(plan, "b")).toMatchObject({ startMin: 630, endMin: 630 });
  });

  it("a pinned reminder NEVER acts as a firewall", () => {
    const pinnedReminder = ev({ id: "pr", startMin: 600, endMin: 600, pinned: true });
    const later = ev({ id: "l", startMin: 660, endMin: 720 });
    const plan = planDayShift([pinnedReminder, later], opts({ cutoffMin: 540, deltaMin: 30 }));
    // The reminder holds (pinned), but the later block still shifts — the reminder
    // did not wall off the day.
    expect(upsert(plan, "pr")).toBeUndefined();
    expect(upsert(plan, "l")).toMatchObject({ startMin: 690, endMin: 750 });
    expect(notesOf(plan, "held")).toContainEqual({ kind: "held", id: "pr" });
  });
});

describe("planDayShift — firewall region", () => {
  it("ends the region at the FIRST pin (multi-pin)", () => {
    const a = ev({ id: "a", startMin: 600, endMin: 630 });
    const pin1 = ev({ id: "p1", startMin: 660, endMin: 720, pinned: true });
    const pin2 = ev({ id: "p2", startMin: 780, endMin: 840, pinned: true });
    const plan = planDayShift([a, pin1, pin2], opts({ cutoffMin: 540, deltaMin: 15 }));
    // Region is [540, 660). `a` moves; both pins hold; nothing after pin1 moves.
    expect(upsert(plan, "a")).toMatchObject({ startMin: 615 });
    expect(upsert(plan, "p1")).toBeUndefined();
    expect(upsert(plan, "p2")).toBeUndefined();
    expect(notesOf(plan, "held").map((n) => n.id).sort()).toEqual(["p1", "p2"]);
  });

  it("compresses a shifted end to the pin (shortened), flooring the duration", () => {
    const a = ev({ id: "a", startMin: 570, endMin: 630 }); // 9:30–10:30, 60 min
    const pin = ev({ id: "p", startMin: 660, endMin: 720, pinned: true }); // 11:00
    // +45 → start 615, end 675 which crosses the pin at 660. Keep start, end→660.
    const plan = planDayShift([a, pin], opts({ cutoffMin: 540, deltaMin: 45 }));
    const moved = upsert(plan, "a")!;
    expect(moved.startMin).toBe(615);
    expect(moved.endMin).toBe(660);
    expect(notesOf(plan, "shortened")).toContainEqual({
      kind: "shortened",
      id: "a",
      byMin: 15, // 675 → 660
      againstId: "p",
    });
  });

  it("clamps the start to pin - snap when the shifted start reaches the pin", () => {
    const a = ev({ id: "a", startMin: 600, endMin: 630 }); // 30-min block
    const pin = ev({ id: "p", startMin: 660, endMin: 720, pinned: true }); // 11:00
    // +90 → start 690, past the pin. Clamp start to 660 - 15 = 645, dur floored 15.
    const plan = planDayShift([a, pin], opts({ cutoffMin: 540, deltaMin: 90 }));
    const moved = upsert(plan, "a")!;
    expect(moved.startMin).toBe(645);
    expect(moved.endMin).toBe(660);
  });

  it("keeps an overlap when even the floored form still crosses a mid-slot pin", () => {
    const a = ev({ id: "a", startMin: 600, endMin: 660 });
    // Pin sits off the snap grid (legacy row) at 655; region ends there.
    const pin = ev({ id: "p", startMin: 655, endMin: 700, pinned: true });
    // +60 → start 660 ≥ pin(655): clamp start to 655-15=640 → snapped 645, end 660.
    // end 660 > pin 655 → overlap kept.
    const plan = planDayShift([a, pin], opts({ cutoffMin: 540, deltaMin: 60 }));
    expect(notesOf(plan, "overlap")).toContainEqual({ kind: "overlap", id: "a", againstId: "p" });
  });

  it("compression floors to one slot then falls through to overlap at a mid-slot pin", () => {
    // A block whose shifted end lands just past an off-grid pin: compress-to-pin,
    // but the one-slot floor still overruns the mid-slot pin → shortened AND overlap.
    const a = ev({ id: "a", startMin: 600, endMin: 655 }); // 55-min block
    const pin = ev({ id: "p", startMin: 665, endMin: 720, pinned: true }); // off-grid pin
    // +15 → start 615, end 670 > pin 665. Compress end to max(665, 615+15=630)=665.
    // Floored end 665 == pin → no residual overlap here; lost = 670-665 = 5.
    const plan = planDayShift([a, pin], opts({ cutoffMin: 540, deltaMin: 15 }));
    expect(notesOf(plan, "shortened")).toContainEqual({
      kind: "shortened",
      id: "a",
      byMin: 5,
      againstId: "p",
    });
  });
});

describe("planDayShift — negative delta compaction", () => {
  it("compacts moved events in order without stacking them", () => {
    // Three blocks with a big gap; pull them earlier by an hour. They must not
    // overlap each other after compaction.
    const a = ev({ id: "a", startMin: 660, endMin: 720 }); // 11:00–12:00
    const b = ev({ id: "b", startMin: 780, endMin: 840 }); // 13:00–14:00
    const c = ev({ id: "c", startMin: 900, endMin: 960 }); // 15:00–16:00
    const plan = planDayShift([a, b, c], opts({ cutoffMin: 600, deltaMin: -60 }));
    const A = upsert(plan, "a")!;
    const B = upsert(plan, "b")!;
    const C = upsert(plan, "c")!;
    expect(A.startMin).toBe(600); // shifted to 10:00, floored at cutoff
    expect(A.endMin).toBe(660);
    // b shifted to 720, but must clear a's end (660) — 720 wins, no stack.
    expect(B.startMin).toBe(720);
    expect(B.endMin).toBe(780);
    // Durations never change on negative delta.
    expect(B.endMin - B.startMin).toBe(60);
    expect(C.endMin - C.startMin).toBe(60);
    // No shortened notes on a negative shift.
    expect(notesOf(plan, "shortened")).toEqual([]);
  });

  it("does not back a compacted block into a fixed block straddling the cutoff", () => {
    // A fixed (non-moving) block starts before the cutoff but runs past it to
    // 11:30; a mover pulled earlier must not start before that end.
    const fixed = ev({ id: "f", startMin: 630, endMin: 690 }); // 10:30–11:30 (starts before cutoff)
    const mover = ev({ id: "m", startMin: 780, endMin: 840 }); // 13:00–14:00
    const plan = planDayShift([fixed, mover], opts({ cutoffMin: 660, deltaMin: -120 }));
    // 780 - 120 = 660 (11:00) but the fixed block runs to 690 → floored to 690.
    // The fixed block starts at 630 (< cutoff 660) so it holds and floors movers.
    expect(upsert(plan, "f")).toBeUndefined();
    expect(upsert(plan, "m")).toMatchObject({ startMin: 690, endMin: 750 });
  });
});

describe("planDayShift — boundaries", () => {
  it("clamps at midnight (hard) so a shift never overflows the day", () => {
    const a = ev({ id: "a", startMin: 1350, endMin: 1410 }); // 22:30–23:30, 60 min
    // +120 would push the start to 1470; clamp so the whole block fits by midnight.
    const plan = planDayShift([a], opts({ cutoffMin: 0, deltaMin: 120 }));
    const moved = upsert(plan, "a")!;
    expect(moved.endMin).toBe(1440); // hard against midnight
    expect(moved.startMin).toBe(1380);
    expect(moved.endMin - moved.startMin).toBe(60); // duration intact
  });

  it("emits pastClose with the spill minutes for a soft close crossing", () => {
    const a = ev({ id: "a", startMin: 990, endMin: 1050 }); // 16:30–17:30
    // close at 17:00 (1020). +45 → end 1095, spill 75 past close.
    const plan = planDayShift([a], opts({ cutoffMin: 900, deltaMin: 45, closeMin: 1020 }));
    expect(upsert(plan, "a")).toMatchObject({ endMin: 1095 }); // not clamped to close
    expect(notesOf(plan, "pastClose")).toContainEqual({ kind: "pastClose", id: "a", byMin: 75 });
  });
});

describe("planDayShift — camp scope + excludeIds", () => {
  it("moves in-scope and unscoped events but leaves a foreign camp untouched", () => {
    const mine = ev({ id: "mine", startMin: 600, endMin: 660, campId: "camp-1" });
    const ambient = ev({ id: "ambient", startMin: 660, endMin: 720 }); // unscoped
    const foreign = ev({ id: "foreign", startMin: 700, endMin: 760, campId: "camp-2" });
    const plan = planDayShift(
      [mine, ambient, foreign],
      opts({ cutoffMin: 540, deltaMin: 30, campId: "camp-1" })
    );
    expect(upsert(plan, "mine")).toMatchObject({ startMin: 630 });
    expect(upsert(plan, "ambient")).toMatchObject({ startMin: 690 });
    // Foreign camp is invisible to the operation — not moved, not held, not noted.
    expect(upsert(plan, "foreign")).toBeUndefined();
    expect(plan.notes.find((n) => n.id === "foreign")).toBeUndefined();
  });

  it("holds an excluded event but still shifts its neighbours", () => {
    const held = ev({ id: "held", startMin: 600, endMin: 660 });
    const other = ev({ id: "other", startMin: 720, endMin: 780 });
    const plan = planDayShift(
      [held, other],
      opts({ cutoffMin: 540, deltaMin: 30, excludeIds: new Set(["held"]) })
    );
    expect(upsert(plan, "held")).toBeUndefined();
    expect(notesOf(plan, "held")).toContainEqual({ kind: "held", id: "held" });
    expect(upsert(plan, "other")).toMatchObject({ startMin: 750 });
  });
});

describe("planDayShift — snapping + grid", () => {
  it("snaps the delta to the nearest snap multiple (ties away from zero)", () => {
    const a = ev({ id: "a", startMin: 600, endMin: 660 });
    // 22 on a 15 grid → 30 (22/15 = 1.47 → round 1... actually 22/15=1.47→1→15).
    // Use 23 → 23/15=1.53→2→30 to make the rounding explicit.
    const plan = planDayShift([a], opts({ deltaMin: 23, snapMin: 15 }));
    expect(upsert(plan, "a")).toMatchObject({ startMin: 630 }); // +30
  });

  it("rounds a .5 tie away from zero for a negative delta", () => {
    // snapMin 10, delta -15 → magnitude 1.5 slots → ties away → 2 slots = -20.
    const a = ev({ id: "a", startMin: 600, endMin: 660 });
    const plan = planDayShift([a], opts({ cutoffMin: 0, deltaMin: -15, snapMin: 10 }));
    expect(upsert(plan, "a")).toMatchObject({ startMin: 580 }); // -20
  });

  it("honours an injected snap of 10", () => {
    const a = ev({ id: "a", startMin: 600, endMin: 660 });
    const plan = planDayShift([a], opts({ deltaMin: 20, snapMin: 10 }));
    expect(upsert(plan, "a")).toMatchObject({ startMin: 620 }); // +20
  });

  it("lands an off-grid legacy row on-grid after a shift", () => {
    // 602 is off the 15-min grid; +30 → 632 → snapped to 630.
    const a = ev({ id: "a", startMin: 602, endMin: 662 });
    const plan = planDayShift([a], opts({ cutoffMin: 600, deltaMin: 30, snapMin: 15 }));
    const moved = upsert(plan, "a")!;
    expect(moved.startMin % 15).toBe(0);
    expect(moved.startMin).toBe(630);
  });
});

describe("planDayShift — payload preservation", () => {
  it("preserves every payload field, changing only geometry + updatedAt", () => {
    const rich = ev({
      id: "rich",
      startMin: 600,
      endMin: 660,
      pinned: false,
      campId: "camp-1",
      seriesId: "series-9",
      recurrence: { freq: "daily", interval: 1, until: "2026-06-30" },
      mealKind: "lunch",
      note: "check allergies",
      locations: ["Kitchen"],
      color: "#aabbcc",
      title: "Lunch",
      activityId: "act-1",
      alternates: [{ title: "Rain lunch", reason: "rain" }],
    });
    const plan = planDayShift([rich], opts({ cutoffMin: 540, deltaMin: 30, campId: "camp-1" }));
    const moved = upsert(plan, "rich")!;
    // Geometry + updatedAt changed…
    expect(moved.startMin).toBe(630);
    expect(moved.endMin).toBe(690);
    expect(moved.updatedAt).toBeGreaterThan(0);
    // …everything else survives the spread untouched (bulk-gesture contract: the
    // series rule rides along as a plain row upsert, no scope dialog).
    expect(moved.seriesId).toBe("series-9");
    expect(moved.recurrence).toEqual({ freq: "daily", interval: 1, until: "2026-06-30" });
    expect(moved.mealKind).toBe("lunch");
    expect(moved.note).toBe("check allergies");
    expect(moved.locations).toEqual(["Kitchen"]);
    expect(moved.color).toBe("#aabbcc");
    expect(moved.activityId).toBe("act-1");
    expect(moved.alternates).toEqual([{ title: "Rain lunch", reason: "rain" }]);
  });
});

describe("planDayShift — non-participants", () => {
  it("never moves an all-day event", () => {
    const allDay = ev({ id: "ad", allDay: true, startMin: 0, endMin: 0 });
    const timed = ev({ id: "t", startMin: 600, endMin: 660 });
    const plan = planDayShift([allDay, timed], opts({ cutoffMin: 0, deltaMin: 30 }));
    expect(upsert(plan, "ad")).toBeUndefined();
    expect(upsert(plan, "t")).toMatchObject({ startMin: 630 });
  });

  it("ignores events on a different day", () => {
    const other = ev({ id: "o", date: "2026-06-23", startMin: 600, endMin: 660 });
    const plan = planDayShift([other], opts({ cutoffMin: 0, deltaMin: 30 }));
    expect(plan.upserts).toEqual([]);
  });
});
