"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Draggable } from "@fullcalendar/interaction";
import { matchesActivityFilters, type CatFilter } from "@/lib/activityFilters";
import { CATEGORIES, categoryTint, durLabel } from "@/lib/data";
import type { Activity } from "@/lib/types";
import { CampIcon } from "../icons";

// The drag source for "library → calendar": a side rail on desktop, a bottom
// sheet behind a FAB on phones. Rows are FullCalendar Draggables (mouse drag
// and long-press touch drag); the "+" button is the dependable tap-to-place
// flow and the row itself opens the editor pre-filled.

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
}: {
  variant: "rail" | "sheet";
  activities: Activity[];
  onPlace: (activity: Activity) => void;
  onPick: (activity: Activity) => void;
  onClose?: () => void;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<CatFilter>("All");

  // Register rows as external FullCalendar drag sources. eventData is read
  // from data attributes at drag time, so one Draggable covers every row.
  useEffect(() => {
    const container = listRef.current;
    if (!container) return;
    const draggable = new Draggable(container, {
      itemSelector: "[data-activity-id]",
      eventData: (el) => ({
        title: el.getAttribute("data-title") || "Activity",
        duration: el.getAttribute("data-duration") || "00:30",
        activityId: el.getAttribute("data-activity-id"),
        create: true,
      }),
    });
    return () => draggable.destroy();
  }, []);

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
            <span className="cal-lib__grip" aria-hidden="true" style={{ color: categoryTint(activity.type) }}>
              <CampIcon.Grip />
            </span>
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
