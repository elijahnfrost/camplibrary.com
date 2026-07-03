// The pure day-shift planner: "everything from here shifts by N minutes". A day
// runs late (a late bus, a long craft) or early (a game wrapped fast, an early
// lunch), and the operator wants to slide the REST of the day without dragging
// each block one at a time. This file owns that math and NOTHING else — no
// store, no React, no DOM — so it unit-tests in isolation exactly like
// selection.ts and recurrence.ts. CalendarShell / the ShiftBar UI owns state and
// the imperative paint; this file returns a {upserts, removes, notes} plan the
// same shape the recurrence planners return, so it commits through the identical
// commitEvents path (which re-stamps updatedAt at apply time).
//
// It is DEFENSIVE, not clever. The operator's intent is ground truth; the planner
// never reorders the day, never auto-resolves an overlap beyond one compression
// step, and never changes an event's data SHAPE (a 0-min reminder stays 0-min; a
// timed block never silently becomes a reminder). Where it can't honor the shift
// cleanly it KEEPS the operator's geometry and emits a note so the UI can warn —
// reporting, never silent mangling.

import { MINUTES_PER_DAY, snapMinutes } from "./time";
import type { CalendarEvent, DateKey } from "./types";

export interface DayShiftOptions {
  /** The single day being shifted. Only events on this date participate. */
  date: DateKey;
  /** Candidacy floor: an event must start at/after this minute to be shifted.
   *  This is where the operator says "from here on". */
  cutoffMin: number;
  /** Signed shift in minutes. Positive = running late (push later); negative =
   *  running early (pull earlier). Defensively snapped to a snapMin multiple. */
  deltaMin: number;
  /** The snap grid, INJECTED so callers stay the single source of truth — never
   *  hard-code 15 here. Everything (the delta, every shifted start) lands on it. */
  snapMin: number;
  /** Camp close. A SOFT boundary: nothing is clamped to it, but any moved/extended
   *  event spilling past it emits a `pastClose` note so the UI can flag it. */
  closeMin: number;
  /** "Running long / short" mode: THIS event's endMin grows/shrinks by deltaMin;
   *  its start never moves. Everything else still shifts by delta per rules 4/5. */
  extendEventId?: string;
  /** Per-run "hold these" ids — treated like `pinned` for candidacy (they don't
   *  move), but NOT firewalls (they never bound the shift region). */
  excludeIds?: ReadonlySet<string>;
  /** Camp scope. When set, only events whose campId === campId OR whose campId is
   *  unset participate (mirrors useCamps.filterEvents); foreign-camp events are
   *  untouched — not held, not noted, just absent from the plan. */
  campId?: string;
}

// One advisory produced alongside the geometry. Note EMISSION is kept honest here
// (the planner records every hold/clamp/spill it actually did); which notes the
// ShiftBar surfaces is a UI concern, so we never suppress at this layer.
export type DayShiftNote =
  // A candidate that would otherwise move was held: it's pinned, or excluded, or a
  // member of a stop whose cohesion forced the whole stop to hold.
  | { kind: "held"; id: string }
  // A positive shift pushed this event's end into the firewall pin; its end was
  // compressed to the pin (duration floored at one snap slot). byMin = minutes lost.
  | { kind: "shortened"; id: string; byMin: number; againstId: string }
  // Even after compression (or an extend), this event still overlaps `againstId`.
  // The planner KEEPS the overlap rather than reorder the day.
  | { kind: "overlap"; id: string; againstId: string }
  // A moved/extended event's new end spills past the soft close. byMin = spill.
  | { kind: "pastClose"; id: string; byMin: number };

export interface DayShiftPlan {
  /** Changed rows only (unchanged events are omitted). Sorted by (startMin, id)
   *  for deterministic tests. */
  upserts: CalendarEvent[];
  /** Always [] in v1 — day-shift never deletes. Kept so the plan is
   *  shape-compatible with the recurrence planners and commitEvents. */
  removes: string[];
  notes: DayShiftNote[];
}

const isZero = (e: CalendarEvent): boolean => e.endMin === e.startMin;

// Snap a signed value to the nearest multiple of `step`, ties AWAY from zero.
// Math.round breaks .5 ties toward +∞, which would bias a -7.5-slot delta the
// wrong way; we round the magnitude and re-apply the sign so +delta and -delta
// snap symmetrically. Used only to sanitize the incoming deltaMin — an operator
// might pass an off-grid nudge and we want a predictable grid multiple.
function snapDeltaAwayFromZero(delta: number, step: number): number {
  if (!Number.isFinite(delta) || step <= 0) return 0;
  const sign = delta < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(delta) / step) * step;
}

// Whether an event is in this planner's camp scope. Mirrors useCamps.filterEvents:
// an event participates when it belongs to the target camp OR is unscoped. With no
// campId option set, scope is off and everything participates.
function inCampScope(event: CalendarEvent, campId: string | undefined): boolean {
  if (!campId) return true;
  return !event.campId || event.campId === campId;
}

// Snap+clamp a proposed start for `duration`, keeping the block inside the day
// exactly as applyMoveDelta does (midnight is HARD). A 0-min reminder keeps ZERO
// duration so it stays a reminder — its identity must never change. Snapping onto
// the grid means an off-grid legacy row lands on-grid after any shift. Returns the
// on-grid, in-bounds startMin; the max-start guard always holds (start ≤ 1440).
function clampStart(start: number, duration: number, snapMin: number): number {
  const maxStart = MINUTES_PER_DAY - duration;
  const bounded = Math.min(Math.max(0, start), Math.max(0, maxStart));
  return snapMinutes(bounded, snapMin);
}

const EMPTY_SET: ReadonlySet<string> = new Set();

// A candidate event tagged with why it does or doesn't move. We compute this once
// so both the positive and negative passes share one candidacy verdict.
interface Tagged {
  event: CalendarEvent;
  moves: boolean; // a real candidate the shift applies to
  held: boolean; // in-scope, past cutoff, but pinned/excluded (emit `held`)
}

export function planDayShift(
  dayEvents: readonly CalendarEvent[],
  opts: DayShiftOptions
): DayShiftPlan {
  const empty: DayShiftPlan = { upserts: [], removes: [], notes: [] };
  const snapMin = opts.snapMin > 0 ? opts.snapMin : 1;

  // Defensively snap the incoming delta. A snap-to-zero delta means "no real
  // shift" → empty plan (an operator nudge under half a slot rounds away).
  const delta = snapDeltaAwayFromZero(opts.deltaMin, snapMin);
  const extendId = opts.extendEventId;
  if (delta === 0) return empty;

  const excludeIds = opts.excludeIds ?? EMPTY_SET;

  // Restrict to THIS day + camp scope up front. Foreign-camp and other-day rows
  // never appear in the plan (not held, not noted) — they're simply invisible to
  // this operation, per filterEvents semantics.
  const onDay = dayEvents.filter(
    (e) => e.date === opts.date && inCampScope(e, opts.campId)
  );

  // ---- Stop cohesion pre-pass -------------------------------------------------
  // 0-min events sharing an exact (date, startMin) form a stop. If ANY member is
  // pinned or excluded, the WHOLE stop holds — a stop must never split. We compute
  // which 0-min startMins are "frozen" so candidacy below can hold every member.
  const frozenStopStarts = new Set<number>();
  const stopMembers = new Map<number, CalendarEvent[]>();
  for (const e of onDay) {
    if (e.allDay || !isZero(e)) continue;
    const arr = stopMembers.get(e.startMin);
    if (arr) arr.push(e);
    else stopMembers.set(e.startMin, [e]);
  }
  for (const [start, members] of stopMembers) {
    // A member is "sticky" if it's pinned OR excluded. Note: the extend target is
    // never a reminder (extend never applies to 0-min events), so it can't freeze
    // a stop here. Pinned 0-min events NEVER act as firewalls (that's rule 3 —
    // only non-0-min pins do) and are never compression targets; freezing only
    // holds them in place.
    if (members.some((m) => m.pinned || excludeIds.has(m.id))) {
      frozenStopStarts.add(start);
    }
  }

  // ---- Firewall ---------------------------------------------------------------
  // The shift region is [cutoffMin, firewall). The firewall is the FIRST pinned,
  // NON-0-min event starting at/after the cutoff; the pin and everything at/after
  // it never move. No pin → the region is unbounded (only midnight clamps it).
  // Pinned 0-min reminders are explicitly NOT firewalls (they'd wall off the day
  // at a mere nudge), which is why isZero events are excluded here.
  let firewall: CalendarEvent | null = null;
  for (const e of onDay) {
    if (e.allDay || isZero(e)) continue;
    if (!e.pinned) continue;
    if (e.startMin < opts.cutoffMin) continue;
    if (!firewall || e.startMin < firewall.startMin) firewall = e;
  }
  const firewallStart = firewall ? firewall.startMin : Number.POSITIVE_INFINITY;

  // ---- Candidacy --------------------------------------------------------------
  // A candidate moves iff: on this day, not all-day, not pinned, not excluded, not
  // frozen-by-stop, camp-scope match (already filtered), and startMin >= cutoff,
  // and strictly BEFORE the firewall. A pinned/excluded/frozen event that is in
  // range but held emits `held`. The firewall pin itself (and anything at/after
  // it) is out of range → neither moves nor is held here (rule 3: pins in scan
  // range emit held; the firewall pin sits AT firewallStart so it's excluded from
  // the moving region but we DO emit a held note for it below, and for any pin in
  // [cutoff, firewall) as well).
  const tagged: Tagged[] = [];
  for (const e of onDay) {
    // The extend target is special-cased entirely below — never a plain candidate.
    if (e.id === extendId) continue;
    if (e.allDay) {
      tagged.push({ event: e, moves: false, held: false });
      continue;
    }
    const inRange = e.startMin >= opts.cutoffMin && e.startMin < firewallStart;
    if (!inRange) {
      tagged.push({ event: e, moves: false, held: false });
      continue;
    }
    const stuck =
      e.pinned || excludeIds.has(e.id) || (isZero(e) && frozenStopStarts.has(e.startMin));
    tagged.push({ event: e, moves: !stuck, held: stuck });
  }

  const notes: DayShiftNote[] = [];
  const upsertsById = new Map<string, CalendarEvent>();

  // `held` notes for everything in-range but stuck (pinned / excluded / frozen
  // stop). We emit one per member so a held stop reads as N holds, not one.
  for (const t of tagged) {
    if (t.held) notes.push({ kind: "held", id: t.event.id });
  }
  // The firewall pin is at/after the region; it holds by definition. Emit a held
  // note for it too (a pin in scan range is honestly a hold), plus any OTHER pins
  // sitting at/after the firewall within the day — the operator asked to shift
  // "from cutoff"; every pin they didn't move is worth reporting.
  for (const e of onDay) {
    if (e.allDay || isZero(e) || !e.pinned) continue;
    if (e.startMin < opts.cutoffMin) continue; // a pin before the cutoff isn't in scope
    if (e.startMin < firewallStart) continue; // already emitted above (in-range held)
    notes.push({ kind: "held", id: e.id });
  }

  // ---- Extend mode ------------------------------------------------------------
  // Only the target's endMin changes, by delta; its start NEVER moves. The
  // extension is operator ground truth: it is NEVER compressed against a pin or a
  // following block. Positive extend that crosses the firewall → keep it, emit
  // `overlap` vs the pin. Negative extend floors endMin at startMin + snapMin and
  // emits `shortened` — an event may only BE 0-min if it ENTERED 0-min (guarding
  // against silently converting an activity into a reminder).
  const extendTarget = extendId
    ? onDay.find((e) => e.id === extendId && !e.allDay)
    : undefined;
  if (extendTarget) {
    const enteredZero = isZero(extendTarget);
    let newEnd = extendTarget.endMin + delta;
    if (delta < 0) {
      // Running short. Floor the duration at one snap slot UNLESS it was already a
      // 0-min reminder (then it stays 0-min — we never floor a reminder up into a
      // block, and never shorten it below its own start).
      const floorEnd = enteredZero
        ? extendTarget.startMin
        : extendTarget.startMin + snapMin;
      if (newEnd < floorEnd) {
        const clampedBy = floorEnd - newEnd; // minutes we refused to remove
        newEnd = floorEnd;
        notes.push({ kind: "shortened", id: extendTarget.id, byMin: clampedBy, againstId: extendTarget.id });
      }
    }
    // Midnight is HARD even for the operator's extension.
    newEnd = Math.min(MINUTES_PER_DAY, Math.max(extendTarget.startMin, newEnd));
    // Crossing the firewall pin → keep the length, report the overlap.
    if (firewall && newEnd > firewall.startMin) {
      notes.push({ kind: "overlap", id: extendTarget.id, againstId: firewall.id });
    }
    // Soft close spill.
    if (newEnd > opts.closeMin) {
      notes.push({ kind: "pastClose", id: extendTarget.id, byMin: newEnd - opts.closeMin });
    }
    if (newEnd !== extendTarget.endMin) {
      upsertsById.set(extendTarget.id, { ...extendTarget, endMin: newEnd, updatedAt: Date.now() });
    }
  }

  // The moving candidates, in start order (id as a stable tiebreak) — the spine
  // both passes walk.
  const movers = tagged
    .filter((t) => t.moves)
    .map((t) => t.event)
    .sort((a, b) => a.startMin - b.startMin || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  if (delta > 0) {
    // ---- Positive shift (running late) ----------------------------------------
    // Each candidate shifts by +delta. It may never RELOCATE past the firewall:
    //  - if its shifted END crosses the pin, keep the shifted start and compress
    //    the end to the pin, flooring duration at one snap slot (emit `shortened`);
    //  - if its shifted START reaches/passes the pin, clamp start to pin - snap,
    //    duration floored at one slot;
    //  - if even the floored form still overlaps the pin, KEEP the overlap and emit
    //    `overlap`. We never reorder the day or auto-resolve beyond compression.
    for (const e of movers) {
      const isReminder = isZero(e);
      const duration = e.endMin - e.startMin;
      let startMin = clampStart(e.startMin + delta, duration, snapMin);
      let endMin = isReminder ? startMin : Math.min(MINUTES_PER_DAY, startMin + duration);

      if (firewall && !isReminder) {
        const pin = firewall.startMin;
        if (startMin >= pin) {
          // Shifted start would reach/pass the pin: clamp start to pin - snap,
          // duration floored at one slot. (A reminder never trips this — its
          // "duration" is zero and it can sit AT the pin minute harmlessly; we
          // guard with !isReminder above.)
          startMin = clampStart(pin - snapMin, snapMin, snapMin);
          endMin = Math.min(MINUTES_PER_DAY, startMin + snapMin);
          if (endMin > pin) {
            // Even the floored slot still crosses the pin (pin sits mid-slot):
            // keep it, report the overlap.
            notes.push({ kind: "overlap", id: e.id, againstId: firewall.id });
          }
        } else if (endMin > pin) {
          // Shifted end crosses the pin: keep the start, compress the end to the
          // pin, flooring the duration at one slot.
          const flooredEnd = Math.max(pin, startMin + snapMin);
          const lost = endMin - flooredEnd; // minutes shaved off the tail
          endMin = flooredEnd;
          if (lost > 0) {
            notes.push({ kind: "shortened", id: e.id, byMin: lost, againstId: firewall.id });
          }
          if (endMin > pin) {
            // The one-slot floor still overran the pin (block sits within a slot of
            // it): keep the overlap.
            notes.push({ kind: "overlap", id: e.id, againstId: firewall.id });
          }
        }
      }

      if (endMin > opts.closeMin) {
        notes.push({ kind: "pastClose", id: e.id, byMin: endMin - opts.closeMin });
      }
      if (startMin !== e.startMin || endMin !== e.endMin) {
        upsertsById.set(e.id, { ...e, startMin, endMin, updatedAt: Date.now() });
      }
    }
  } else {
    // ---- Negative shift (running early) ---------------------------------------
    // Sequential compaction in start order. Durations NEVER change (no `shortened`
    // notes). Each moved event's new start is the MAX of:
    //   - its own shifted start (its original start + delta, snapped/clamped),
    //   - the previous processed mover's new end (no stacking),
    //   - the end of the last NON-MOVING timed block at/before the cutoff (we don't
    //     pull an event earlier than where the fixed part of the day left off),
    //   - cutoffMin as a floor when there's no such block.
    // This collapses the gap the operator opened without ever overlapping the
    // events onto each other or backing into the fixed morning.

    // The floor from the fixed (non-moving) timed part of the day up to the cutoff:
    // the latest end among non-mover, non-allDay, non-reminder blocks that start
    // before the cutoff. Reminders (0-min) don't consume space, so they don't floor.
    let fixedFloor = opts.cutoffMin;
    const moverIds = new Set(movers.map((m) => m.id));
    for (const e of onDay) {
      if (e.allDay || isZero(e)) continue;
      if (moverIds.has(e.id)) continue;
      if (e.id === extendId) continue; // the extend target's tail is handled in extend mode
      if (e.startMin >= opts.cutoffMin) continue; // only the fixed morning floors us
      if (e.endMin > fixedFloor) fixedFloor = e.endMin;
    }

    let prevEnd = fixedFloor;
    for (const e of movers) {
      const isReminder = isZero(e);
      const duration = e.endMin - e.startMin;
      const shifted = clampStart(e.startMin + delta, duration, snapMin);
      // A reminder occupies no space, so it doesn't advance prevEnd and only floors
      // against the fixed morning / cutoff (compaction against a preceding block's
      // end would be meaningless for a point-in-time nudge). Real blocks compact.
      const flooredStart = isReminder
        ? Math.max(shifted, fixedFloor)
        : Math.max(shifted, prevEnd);
      const startMin = clampStart(flooredStart, duration, snapMin);
      const endMin = isReminder ? startMin : Math.min(MINUTES_PER_DAY, startMin + duration);
      if (!isReminder) prevEnd = endMin;

      if (endMin > opts.closeMin) {
        notes.push({ kind: "pastClose", id: e.id, byMin: endMin - opts.closeMin });
      }
      if (startMin !== e.startMin || endMin !== e.endMin) {
        upsertsById.set(e.id, { ...e, startMin, endMin, updatedAt: Date.now() });
      }
    }
  }

  const upserts = [...upsertsById.values()].sort(
    (a, b) => a.startMin - b.startMin || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
  return { upserts, removes: [], notes };
}
