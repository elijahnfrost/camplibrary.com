"use client";

import { useMemo, useRef, useState } from "react";
import { formatEventDateLabel } from "@/lib/calendar/dates";
import { planDayShift, type DayShiftNote } from "@/lib/calendar/dayShift";
import { SNAP_MIN, formatClock, nowMinutes, snapMinutes } from "@/lib/calendar/time";
import type { CalendarEvent, DateKey } from "@/lib/calendar/types";
import { CampIcon } from "../icons";
import { useDialogFocus } from "../useDialogFocus";
import { useFloatingPosition, type FloatingAnchor } from "../floating/useFloatingPosition";
import { DESKTOP_MIN } from "../useDeviceShape";

// The one surface behind every "recover time" door. A day runs long (a late bus,
// a craft that overshot) or wraps early, and the operator wants to slide the REST
// of the day rather than dragging each block. This card drives lib/calendar/
// dayShift's pure planner: it owns the delta + hold state and previews the plan
// live (planDayShift is pure and cheap, so we re-run it on every change), then
// commits ONE undoable batch. It never mangles geometry itself — the planner
// keeps the operator's intent and reports what it couldn't honor as notes, which
// we surface as a quiet summary + affected list. Positioning + docking reuse the
// shared floating helpers, so it clamps/flips and bottom-docks like every other
// floating card (WeatherPopover / StopPopover).

// A small inline pushpin — the "held in place" affordance. CampIcon.Pin is the
// location map-pin (semantically wrong here), so ShiftBar carries its own.
function PinGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="cal-shift__pinglyph">
      <path d="M9 4h6l-1 5 3 3v2H7v-2l3-3-1-5z" />
      <path d="M12 17v3" />
    </svg>
  );
}

// The delta chips a snap grid offers. "to now" is appended by the caller when the
// day is today and we're extending a running-long block.
function deltaChips(snap: number): number[] {
  // −2·snap −snap +snap +2·snap +4·snap (i.e. −30 −15 +15 +30 +60 at 15-min snap).
  return [-2 * snap, -snap, snap, 2 * snap, 4 * snap];
}

export type ShiftBarTarget = {
  date: DateKey;
  cutoffMin: number;
  /** "Running long" mode: this event's end grows by the delta (its start is
   *  fixed); everything else still shifts. When set, the title names it and the
   *  "to now" chip becomes available on today. */
  extendEventId?: string;
  anchor: FloatingAnchor;
};

export function ShiftBar({
  target,
  dayEvents,
  closeMin,
  isToday,
  colorOf,
  onCommit,
  onClose,
}: {
  target: ShiftBarTarget;
  /** Every event on the target day (already camp-filtered by CalendarShell, so
   *  the planner runs WITHOUT a campId). */
  dayEvents: CalendarEvent[];
  /** Camp close (the day window's end) — a SOFT boundary the planner flags a
   *  spill past, never clamps to. */
  closeMin: number;
  /** True when the target day is today — gates the "to now" chip. */
  isToday: boolean;
  /** The card's title color for the extend target (matches its calendar tint). */
  colorOf: (event: CalendarEvent) => string;
  /** Commit the shift: the caller runs requireStaff, commitEvents(upserts, []),
   *  the undo-snapshot toast, and announce. */
  onCommit: (upserts: CalendarEvent[], summary: string) => void;
  onClose: () => void;
}) {
  const dialogRef = useDialogFocus<HTMLDivElement>(onClose);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const docked = typeof window !== "undefined" && window.innerWidth < DESKTOP_MIN;
  const position = useFloatingPosition(target.anchor, cardRef, docked);

  const extendTarget = target.extendEventId
    ? dayEvents.find((e) => e.id === target.extendEventId)
    : undefined;
  const extendMode = Boolean(extendTarget);

  const [delta, setDelta] = useState(0);
  // Per-run holds feed the planner's excludeIds (held events don't move).
  const [held, setHeld] = useState<ReadonlySet<string>>(() => new Set());

  // The "to now" delta: now − the target's original end, rounded UP to the next
  // snap (running long means at least reaching now). Only on today + extend mode.
  const toNowDelta = useMemo(() => {
    if (!isToday || !extendTarget) return null;
    const raw = nowMinutes() - extendTarget.endMin;
    if (raw <= 0) return null;
    const up = Math.ceil(raw / SNAP_MIN) * SNAP_MIN;
    return up > 0 ? up : null;
  }, [isToday, extendTarget]);

  // Recompute the plan on every delta / hold change. Pure and cheap.
  const plan = useMemo(
    () =>
      planDayShift(dayEvents, {
        date: target.date,
        cutoffMin: target.cutoffMin,
        deltaMin: delta,
        snapMin: SNAP_MIN,
        closeMin,
        extendEventId: target.extendEventId,
        excludeIds: held,
        // No campId in-app: CalendarShell already hands us camp-filtered events.
      }),
    [dayEvents, target.date, target.cutoffMin, target.extendEventId, delta, closeMin, held]
  );

  // The affected rows (before → after) for the compact list, plus the note lens.
  const byId = useMemo(() => {
    const map = new Map<string, CalendarEvent>();
    for (const e of dayEvents) map.set(e.id, e);
    return map;
  }, [dayEvents]);

  // Which ids a note references — a "held" line is suppressed UNLESS that pin is
  // also cited by a shortened/overlap note (the planner reports exhaustively; the
  // UI keeps quiet holds quiet).
  const notedIds = useMemo(() => {
    const cited = new Set<string>();
    for (const n of plan.notes) {
      if (n.kind === "shortened" || n.kind === "overlap") {
        cited.add(n.id);
        cited.add(n.againstId);
      } else if (n.kind === "pastClose") {
        cited.add(n.id);
      }
    }
    return cited;
  }, [plan.notes]);

  const visibleNotes = useMemo(
    () => plan.notes.filter((n) => n.kind !== "held" || notedIds.has(n.id)),
    [plan.notes, notedIds]
  );

  const cutoffLabel = formatClock(target.cutoffMin);
  const title = extendTarget
    ? "Running long — " + (extendTarget.title || "event")
    : "Shift day from " + cutoffLabel;

  // A one-line summary of the plan's shape. Empty until a real delta is chosen.
  const summary = useMemo(() => {
    if (delta === 0 || (!plan.upserts.length && !visibleNotes.length)) return "";
    const moved = plan.upserts.length;
    const sign = delta > 0 ? "+" : "";
    const parts: string[] = [];
    parts.push(moved + (moved === 1 ? " move " : " moves ") + sign + delta);
    // Latest new end among the shifted rows → "ends 4:10" + any spill past close.
    let latestEnd = -1;
    for (const e of plan.upserts) if (e.endMin > latestEnd) latestEnd = e.endMin;
    if (latestEnd >= 0) {
      parts.push("ends " + formatClock(latestEnd));
      if (latestEnd > closeMin) parts.push((latestEnd - closeMin) + " past close");
    }
    return parts.join(" · ");
  }, [delta, plan.upserts, visibleNotes.length, closeMin]);

  const toggleHold = (id: string) => {
    setHeld((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const step = (dir: 1 | -1) => setDelta((d) => snapMinutes(d + dir * SNAP_MIN, SNAP_MIN));

  const noteLabel = (n: DayShiftNote): string => {
    const name = (id: string) => byId.get(id)?.title || "event";
    if (n.kind === "shortened") return name(n.id) + " −" + n.byMin + " min before " + name(n.againstId);
    if (n.kind === "overlap") return name(n.id) + " overlaps " + name(n.againstId);
    if (n.kind === "pastClose") return name(n.id) + " runs " + n.byMin + " min past close";
    return name(n.id) + " held";
  };

  const commit = () => {
    if (delta === 0 || !plan.upserts.length) return;
    onCommit(plan.upserts, summary || title);
  };

  return (
    <div className="cal-popover-root">
      <button type="button" className="cal-popover__scrim" aria-label="Close" onClick={onClose} />
      <div
        ref={(node) => {
          dialogRef.current = node;
          cardRef.current = node;
        }}
        className="cal-popover cal-shift"
        style={
          docked
            ? undefined
            : position
              ? { left: position.left, top: position.top, visibility: "visible" }
              : { left: 0, top: 0, visibility: "hidden" }
        }
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <div className="cal-popover__head">
          <div className="cal-popover__heading">
            <h3 className="cal-popover__title">
              {extendTarget && (
                <span
                  className="cal-shift__dot"
                  style={{ background: colorOf(extendTarget) }}
                  aria-hidden="true"
                />
              )}
              {title}
            </h3>
            <p className="cal-popover__when">
              {formatEventDateLabel(target.date)}
              {!extendMode ? "" : " · from " + cutoffLabel}
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <CampIcon.Close />
          </button>
        </div>

        {/* Delta chips + a ± stepper stepping by the snap. */}
        <div className="cal-shift__deltas" role="group" aria-label="How much to shift">
          {deltaChips(SNAP_MIN).map((d) => (
            <button
              key={d}
              type="button"
              className={"cal-shift__chip" + (delta === d ? " is-on" : "")}
              aria-pressed={delta === d}
              onClick={() => setDelta(d)}
            >
              {(d > 0 ? "+" : "") + d}
            </button>
          ))}
          {toNowDelta != null && (
            <button
              type="button"
              className={"cal-shift__chip" + (delta === toNowDelta ? " is-on" : "")}
              aria-pressed={delta === toNowDelta}
              onClick={() => setDelta(toNowDelta)}
            >
              to now
            </button>
          )}
        </div>
        <div className="cal-shift__stepper" role="group" aria-label="Adjust by 15 minutes">
          <button
            type="button"
            className="cal-shift__step"
            onClick={() => step(-1)}
            aria-label="Fifteen minutes earlier"
          >
            −
          </button>
          <span className="cal-shift__amount" aria-live="polite">
            {delta === 0 ? "no shift" : (delta > 0 ? "+" : "") + delta + " min"}
          </span>
          <button
            type="button"
            className="cal-shift__step"
            onClick={() => step(1)}
            aria-label="Fifteen minutes later"
          >
            +
          </button>
        </div>

        {/* Live plan preview: a one-line summary + a compact affected list, each
            row with a "hold" checkbox feeding excludeIds. */}
        {summary && <p className="cal-shift__summary">{summary}</p>}

        {plan.upserts.length > 0 && (
          <ul className="cal-shift__list">
            {plan.upserts.map((after) => {
              const before = byId.get(after.id);
              const isExtend = after.id === target.extendEventId;
              return (
                <li key={after.id} className="cal-shift__row">
                  <span className="cal-shift__rowtitle">{after.title || "event"}</span>
                  <span className="cal-shift__rowtime">
                    {before ? formatClock(before.startMin) : ""}
                    <span className="cal-shift__arrow" aria-hidden="true">→</span>
                    {formatClock(after.startMin)}
                  </span>
                  {/* The extend target can't be "held" — its own end is the edit. */}
                  {!isExtend && (
                    <label className="cal-shift__hold" title="Keep this one where it is">
                      <input
                        type="checkbox"
                        checked={held.has(after.id)}
                        onChange={() => toggleHold(after.id)}
                        aria-label={"Hold " + (after.title || "event")}
                      />
                      <PinGlyph />
                    </label>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {/* Held rows the operator chose but that don't move any more — offer them
            back so a hold can be released without stepping the delta. */}
        {[...held].some((id) => byId.has(id) && !plan.upserts.some((u) => u.id === id)) && (
          <ul className="cal-shift__held">
            {[...held]
              .filter((id) => byId.has(id) && !plan.upserts.some((u) => u.id === id))
              .map((id) => (
                <li key={id} className="cal-shift__row cal-shift__row--held">
                  <span className="cal-shift__rowtitle">{byId.get(id)?.title || "event"}</span>
                  <label className="cal-shift__hold cal-shift__hold--on" title="Held in place">
                    <input
                      type="checkbox"
                      checked
                      onChange={() => toggleHold(id)}
                      aria-label={"Release " + (byId.get(id)?.title || "event")}
                    />
                    <PinGlyph />
                  </label>
                </li>
              ))}
          </ul>
        )}

        {visibleNotes.length > 0 && (
          <ul className="cal-shift__notes">
            {visibleNotes.map((n, i) => (
              <li key={i} className={"cal-shift__note cal-shift__note--" + n.kind}>
                {noteLabel(n)}
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          className="btn btn--primary cal-shift__commit"
          disabled={delta === 0 || !plan.upserts.length}
          onClick={commit}
        >
          <CampIcon.Check />
          {extendMode ? "Extend & shift" : "Shift day"}
        </button>
      </div>
    </div>
  );
}
