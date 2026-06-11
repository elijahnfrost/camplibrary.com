"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { formatEventDateLabel } from "@/lib/calendar/dates";
import { formatRangeLabel } from "@/lib/calendar/time";
import type { CalendarEvent } from "@/lib/calendar/types";
import { categoryTint } from "@/lib/data";
import type { Activity } from "@/lib/types";
import { CampIcon } from "../icons";
import { useDialogFocus } from "../useDialogFocus";

// Google Calendar's signature interaction: clicking an event shows a small
// anchored card with the essentials and actions, not a full modal. On phones
// it docks to the bottom of the screen (CSS).

const POPOVER_WIDTH = 300;
const MARGIN = 8;

export function EventPopover({
  event,
  activity,
  anchor,
  onOpenActivity,
  onEdit,
  onDelete,
  onClose,
}: {
  event: CalendarEvent;
  activity: Activity | null;
  anchor: DOMRect;
  onOpenActivity: (activity: Activity) => void;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const dialogRef = useDialogFocus<HTMLDivElement>(onClose);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    if (window.innerWidth < 768) {
      setPosition(null); // bottom-docked via CSS
      return;
    }
    const height = cardRef.current?.offsetHeight ?? 200;
    let left = anchor.right + MARGIN;
    if (left + POPOVER_WIDTH > window.innerWidth - MARGIN) left = anchor.left - POPOVER_WIDTH - MARGIN;
    if (left < MARGIN) left = Math.min(Math.max(anchor.left, MARGIN), window.innerWidth - POPOVER_WIDTH - MARGIN);
    let top = anchor.top;
    if (top + height > window.innerHeight - MARGIN) {
      // Flip above the anchor when there's room, so bottom-of-screen events
      // aren't covered by their own popover; otherwise clamp to the viewport.
      const above = anchor.top - height - MARGIN;
      top = above >= MARGIN ? above : Math.max(MARGIN, window.innerHeight - height - MARGIN);
    }
    setPosition({ left, top });
  }, [anchor]);

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
        style={position ? { left: position.left, top: position.top } : undefined}
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
          <button type="button" className="btn btn--ghost btn--sm cal-popover__delete" onClick={onDelete}>
            <CampIcon.Trash />
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
