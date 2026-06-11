"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Draggable } from "@fullcalendar/interaction";
import { matchesActivityFilters, type CatFilter } from "@/lib/activityFilters";
import { CATEGORIES, categoryTint, durLabel } from "@/lib/data";
import type { Activity } from "@/lib/types";
import { CampIcon } from "../icons";

// The drag source for "library → calendar": a side rail on desktop, a bottom
// sheet behind a FAB on phones. Rail rows are FullCalendar Draggables; the
// sheet overlays the grid, so it sticks to the tap flows — the "+" button
// places at the next open time and the row itself opens the editor pre-filled.

function minutesToDuration(min: number): string {
  const safe = Math.max(5, Math.min(720, Math.round(min)));
  return String(Math.floor(safe / 60)).padStart(2, "0") + ":" + String(safe % 60).padStart(2, "0");
}

export function LibraryPanel({
  variant,
  activities,
  onPlace,
  onPick,
  onClose,
  onDragStart,
  onDragStop,
}: {
  variant: "rail" | "sheet";
  activities: Activity[];
  onPlace: (activity: Activity) => void;
  onPick: (activity: Activity) => void;
  onClose?: () => void;
  /** Rail-only: fired when a row drag begins/ends, so the grid can clear its
   *  empty-state invitation out of the way. */
  onDragStart?: () => void;
  onDragStop?: () => void;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<CatFilter>("All");

  // Register rail rows as external FullCalendar drag sources. eventData is
  // read from data attributes at drag time, so one Draggable covers every row.
  // minDistance keeps sloppy clicks from becoming drags; the long-press delay
  // leaves touch scrolling of the list intact (e.g. iPad rail).
  useEffect(() => {
    if (variant !== "rail") return;
    const container = listRef.current;
    if (!container) return;
    const draggable = new Draggable(container, {
      itemSelector: "[data-activity-id]",
      minDistance: 6,
      longPressDelay: 300,
      eventData: (el) => ({
        title: el.getAttribute("data-title") || "Activity",
        duration: el.getAttribute("data-duration") || "00:30",
        activityId: el.getAttribute("data-activity-id"),
        create: true,
      }),
    });
    return () => draggable.destroy();
  }, [variant]);

  // Signal drag start/end so the calendar can clear its empty-state invitation
  // the moment a row is grabbed (it sits over the grid otherwise).
  useEffect(() => {
    if (variant !== "rail") return;
    const container = listRef.current;
    if (!container) return;
    const onDown = (event: PointerEvent) => {
      if ((event.target as HTMLElement).closest("[data-activity-id]")) onDragStart?.();
    };
    const onUp = () => onDragStop?.();
    container.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      container.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [variant, onDragStart, onDragStop]);

  const filtered = useMemo(
    () =>
      activities
        .filter((a) =>
          matchesActivityFilters(a, { cat, place: "All", age: "All", query, availableMaterialTags: [] })
        )
        .sort((a, b) => a.title.localeCompare(b.title)),
    [activities, cat, query]
  );

  return (
    <aside className={"cal-lib cal-lib--" + variant} aria-label="Activity library">
      <div className="cal-lib__head">
        <span className="cal-lib__title">Library</span>
        {variant === "sheet" && onClose && (
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close library">
            <CampIcon.Close />
          </button>
        )}
      </div>
      <label className="cal-lib__search">
        <CampIcon.Search />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search activities"
          aria-label="Search activities"
        />
      </label>
      <div className="cal-lib__cats" role="group" aria-label="Filter by type">
        <button
          type="button"
          className={"chip" + (cat === "All" ? " is-on" : "")}
          aria-pressed={cat === "All"}
          onClick={() => setCat("All")}
        >
          All
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            className={"chip" + (cat === c.id ? " is-on" : "")}
            aria-pressed={cat === c.id}
            onClick={() => setCat(cat === c.id ? "All" : c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="cal-lib__list" ref={listRef}>
        {filtered.map((activity) => (
          <div
            key={activity.id}
            className="cal-lib__item"
            data-activity-id={activity.id}
            data-title={activity.title}
            data-duration={minutesToDuration(activity.durationMin)}
          >
            {variant === "rail" ? (
              // The grip advertises drag — only honest on the desktop rail,
              // where dragging onto the grid actually works.
              <span className="cal-lib__grip" aria-hidden="true" style={{ color: categoryTint(activity.type) }}>
                <CampIcon.Grip />
              </span>
            ) : (
              <span className="cal-lib__dot" aria-hidden="true" style={{ background: categoryTint(activity.type) }} />
            )}
            <button
              type="button"
              className="cal-lib__open"
              onClick={() => onPick(activity)}
              title="Pick a time for this activity"
            >
              <span className="cal-lib__name">{activity.title}</span>
              <span className="cal-lib__meta">
                {durLabel(activity)} · {activity.type}
              </span>
            </button>
            <button
              type="button"
              className="cal-lib__add"
              onClick={() => onPlace(activity)}
              aria-label={"Add " + activity.title + " at the next open time"}
              title="Add at the next open time"
            >
              <CampIcon.Plus />
            </button>
          </div>
        ))}
        {!filtered.length && <div className="cal-lib__empty">No activities match.</div>}
      </div>
    </aside>
  );
}
