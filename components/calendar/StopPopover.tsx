"use client";

import { formatEventDateLabel } from "@/lib/calendar/dates";
import { formatClock, formatDuration } from "@/lib/calendar/time";
import { summarizeRecurrence } from "@/lib/calendar/recurrence";
import type { CalendarEvent } from "@/lib/calendar/types";
import { CampIcon } from "../ui/icons";
import { FloatingLayer } from "../floating/FloatingLayer";

// The anchored card a STOP marker opens — the events sharing one exact start
// time, each with its note, editable / deletable, plus "Add to this time" to
// stack another. A single 0-min reminder shows one row; several lined-up backups
// list together. Hosted in the shared FloatingLayer engine, so it clamps/flips/
// dismisses like every other floating layer.

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
  if (!events.length) return null;
  const allZero = events.every((e) => e.endMin === e.startMin);
  const heading =
    events.length > 1 ? events.length + (allZero ? " reminders" : " here") : allZero ? "Reminder" : "Event";
  const when = formatEventDateLabel(events[0].date) + " · " + formatClock(events[0].startMin);

  return (
    <FloatingLayer
      anchor={{ kind: "rect", rect: anchor }}
      onClose={onClose}
      className="cal-popover cal-popover--stop"
      role="dialog"
      ariaLabel={heading}
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
    </FloatingLayer>
  );
}
