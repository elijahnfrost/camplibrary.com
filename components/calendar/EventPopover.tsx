"use client";

import { useEffect, useRef } from "react";
import { formatEventDateLabel } from "@/lib/calendar/dates";
import { formatRangeLabel } from "@/lib/calendar/time";
import { summarizeRecurrence } from "@/lib/calendar/recurrence";
import type { CalendarEvent } from "@/lib/calendar/types";
import { categoryTint } from "@/lib/data";
import type { Theme } from "@/lib/themes";
import type { Activity } from "@/lib/types";
import { CampIcon } from "../icons";
import { ThemeBadge } from "../primitives";
import { useDialogFocus } from "../useDialogFocus";
import { useFloatingPosition } from "../floating/useFloatingPosition";

// Google Calendar's signature interaction: clicking an event shows a small
// anchored card with the essentials and actions, not a full modal. On phones
// it docks to the bottom of the screen (CSS). Positioning is delegated to the
// shared useFloatingPosition helper (the same engine that backs the dropdowns
// and context menus), so all floating layers clamp/flip identically.

export function EventPopover({
  event,
  activity,
  theme = null,
  anchor,
  onOpenActivity,
  onEdit,
  onDuplicate,
  onDelete,
  onClose,
}: {
  event: CalendarEvent;
  activity: Activity | null;
  /** The event's theme (inherited from its activity); display-only. */
  theme?: Theme | null;
  anchor: DOMRect;
  onOpenActivity: (activity: Activity) => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const dialogRef = useDialogFocus<HTMLDivElement>(onClose);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const docked = typeof window !== "undefined" && window.innerWidth < 768;
  const position = useFloatingPosition({ kind: "rect", rect: anchor }, cardRef, docked);

  // Desktop-anchored mode: the position is computed once from the anchor rect,
  // so any grid scroll detaches the card from its event — close instead of
  // chasing the anchor through FullCalendar re-renders (Google Calendar does
  // the same). The bottom-docked phone variant scrolls nothing behind it.
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

  const timeLabel = event.allDay ? "All day" : formatRangeLabel(event.startMin, event.endMin);
  const title = activity?.title || event.title || "Untitled";

  return (
    <div className="cal-popover-root">
      <button type="button" className="cal-popover__scrim" aria-label="Close" onClick={onClose} />
      <div
        ref={(node) => {
          dialogRef.current = node;
          cardRef.current = node;
        }}
        className="cal-popover"
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
          <span className="cal-popover__dot" style={{ background: categoryTint(activity?.type) }} aria-hidden="true" />
          <div className="cal-popover__heading">
            <h3 className="cal-popover__title">{title}</h3>
            <p className="cal-popover__when">
              {formatEventDateLabel(event.date)} · {timeLabel}
            </p>
            {activity && <p className="cal-popover__meta">{activity.type}</p>}
            {event.recurrence && (
              <p className="cal-popover__repeat">
                <CampIcon.Repeat />
                {summarizeRecurrence(event.recurrence)}
              </p>
            )}
            {theme && <ThemeBadge theme={theme} className="cal-popover__theme" />}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <CampIcon.Close />
          </button>
        </div>
        <div className="cal-popover__actions">
          {activity && (
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={() => onOpenActivity(activity)}
            >
              <CampIcon.BookOpen />
              Open Run List
            </button>
          )}
          <button type="button" className="btn btn--quiet btn--sm" onClick={onEdit}>
            <CampIcon.Pencil />
            Edit
          </button>
          <button type="button" className="btn btn--quiet btn--sm" onClick={onDuplicate}>
            <CampIcon.Copy />
            Duplicate
          </button>
          <button type="button" className="btn btn--ghost btn--sm cal-popover__delete" onClick={onDelete}>
            <CampIcon.Trash />
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
