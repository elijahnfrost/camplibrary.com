"use client";

import { useEffect, useRef } from "react";
import { formatEventDateLabel } from "@/lib/calendar/dates";
import { formatClock, formatDuration } from "@/lib/calendar/time";
import { summarizeRecurrence } from "@/lib/calendar/recurrence";
import type { CalendarEvent } from "@/lib/calendar/types";
import { CampIcon } from "../icons";
import { useDialogFocus } from "../useDialogFocus";
import { useFloatingPosition } from "../floating/useFloatingPosition";
import { DESKTOP_MIN } from "../useDeviceShape";

// The anchored card a STOP marker opens — the events sharing one exact start
// time, each with its note, editable / deletable, plus "Add to this time" to
// stack another. A single 0-min reminder shows one row; several lined-up backups
// list together. Positioning + scroll-close reuse the shared floating helpers,
// so it clamps/flips like every other floating layer.

export function StopPopover({
  events,
  colorOf,
  anchor,
  onEdit,
  onDelete,
  onAddAtTime,
  onClose,
}: {
  events: CalendarEvent[];
  /** The marker color for one event (reminder tint for 0-min, else event color). */
  colorOf: (event: CalendarEvent) => string;
  anchor: DOMRect;
  onEdit: (event: CalendarEvent) => void;
  onDelete: (event: CalendarEvent) => void;
  onAddAtTime: () => void;
  onClose: () => void;
}) {
  const dialogRef = useDialogFocus<HTMLDivElement>(onClose);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const docked = typeof window !== "undefined" && window.innerWidth < DESKTOP_MIN;
  const position = useFloatingPosition({ kind: "rect", rect: anchor }, cardRef, docked);

  // Anchored to a grid marker — a scroll detaches it, so close rather than chase
  // the anchor through FullCalendar re-renders (same as EventPopover).
  useEffect(() => {
    if (docked) return;
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && cardRef.current?.contains(e.target)) return;
      onClose();
    };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onClose);
    };
  }, [docked, onClose]);

  if (!events.length) return null;
  const allZero = events.every((e) => e.endMin === e.startMin);
  const heading =
    events.length > 1 ? events.length + (allZero ? " reminders" : " here") : allZero ? "Reminder" : "Event";
  const when = formatEventDateLabel(events[0].date) + " · " + formatClock(events[0].startMin);

  return (
    <div className="cal-popover-root">
      <button type="button" className="cal-popover__scrim" aria-label="Close" onClick={onClose} />
      <div
        ref={(node) => {
          dialogRef.current = node;
          cardRef.current = node;
        }}
        className="cal-popover cal-popover--stop"
        style={
          docked
            ? undefined
            : position
              ? { left: position.left, top: position.top, visibility: "visible" }
              : { left: 0, top: 0, visibility: "hidden" }
        }
        role="dialog"
        aria-modal="true"
        aria-label={heading}
        tabIndex={-1}
      >
        <div className="cal-popover__head">
          <div className="cal-popover__heading">
            <h3 className="cal-popover__title">{heading}</h3>
            <p className="cal-popover__when">{when}</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <CampIcon.Close />
          </button>
        </div>
        <ul className="cal-stoplist">
          {events.map((event) => {
            const dur = event.endMin - event.startMin;
            return (
              <li key={event.id} className="cal-stoplist__row">
                <span
                  className="cal-stoplist__dot"
                  style={{ background: colorOf(event) }}
                  aria-hidden="true"
                />
                <span className="cal-stoplist__text">
                  <span className="cal-stoplist__title">
                    {event.title || "Reminder"}
                    <span className="cal-stoplist__meta">{dur > 0 ? formatDuration(dur) : "reminder"}</span>
                  </span>
                  {event.note && <span className="cal-stoplist__note">{event.note}</span>}
                  {event.recurrence && (
                    <span className="cal-stoplist__repeat">
                      <CampIcon.Repeat />
                      {summarizeRecurrence(event.recurrence)}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  className="icon-btn cal-stoplist__btn"
                  aria-label={"Edit " + (event.title || "reminder")}
                  onClick={() => onEdit(event)}
                >
                  <CampIcon.Pencil />
                </button>
                <button
                  type="button"
                  className="icon-btn cal-stoplist__btn cal-stoplist__btn--danger"
                  aria-label={"Delete " + (event.title || "reminder")}
                  onClick={() => onDelete(event)}
                >
                  <CampIcon.Trash />
                </button>
              </li>
            );
          })}
        </ul>
        <button type="button" className="btn btn--quiet btn--sm cal-stop__add" onClick={onAddAtTime}>
          <CampIcon.Plus />
          Add to this time
        </button>
      </div>
    </div>
  );
}
