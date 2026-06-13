"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Draggable } from "@fullcalendar/interaction";
import { matchesActivityFilters, type CatFilter } from "@/lib/activityFilters";
import { categoryTint, durLabel } from "@/lib/data";
import type { Activity } from "@/lib/types";
import { CampIcon } from "../icons";
import { SidebarSection, TypePicker } from "../primitives";

// The desktop drag source for "library → calendar": a rail in the left
// sidebar. Rows are FullCalendar Draggables; the "+" button places at the
// next open time and the row itself opens the event window pre-filled.
// Phones don't render the rail — the FAB opens the event window directly.

function minutesToDuration(min: number): string {
  const safe = Math.max(5, Math.min(720, Math.round(min)));
  return String(Math.floor(safe / 60)).padStart(2, "0") + ":" + String(safe % 60).padStart(2, "0");
}

export function LibraryPanel({
  activities,
  onPlace,
  onPick,
}: {
  activities: Activity[];
  onPlace: (activity: Activity) => void;
  onPick: (activity: Activity) => void;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<CatFilter>("All");

  // Register rail rows as external FullCalendar drag sources. eventData is
  // read from data attributes at drag time, so one Draggable covers every row.
  // minDistance keeps sloppy clicks from becoming drags; the long-press delay
  // leaves touch scrolling of the list intact (e.g. iPad rail).
  useEffect(() => {
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
        // The category tint rides along so the in-grid drag mirror is colored
        // like the event the drop will create — never the accent fallback.
        tint: el.getAttribute("data-tint") || undefined,
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
    <SidebarSection title="Activities" className="cal-lib cal-lib--rail" bodyClassName="cal-lib__body">
      <label className="cal-lib__search">
        <CampIcon.Search />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search activities"
          aria-label="Search activities"
        />
      </label>
      <div className="cal-lib__cats">
        <TypePicker value={cat} onChange={setCat} ariaLabel="Filter by type" />
      </div>
      <div className="cal-lib__list" ref={listRef} role="group" aria-label="Activity library">
        {filtered.map((activity) => (
          <div
            key={activity.id}
            className="cal-lib__item"
            data-activity-id={activity.id}
            data-title={activity.title}
            data-duration={minutesToDuration(activity.durationMin)}
            data-tint={categoryTint(activity.type)}
            style={{ "--cal-tint": categoryTint(activity.type) } as CSSProperties}
          >
            <span className="cal-lib__grip" aria-hidden="true">
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
    </SidebarSection>
  );
}
