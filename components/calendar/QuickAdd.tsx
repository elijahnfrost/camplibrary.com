"use client";

import { useMemo, useState } from "react";
import { formatClock, MINUTES_PER_DAY } from "@/lib/calendar/time";
import { formatEventDateLabel } from "@/lib/calendar/dates";
import { categoryTint, durLabel } from "@/lib/data";
import type { Activity } from "@/lib/types";
import { CampIcon } from "../icons";
import { Modal } from "../Modal";
import type { EditorDraft } from "./EventEditor";

// The default create surface: one window with full access to BOTH the library
// (pick a pre-made game/activity) AND a custom event (type a name like "Lunch"
// or "Pool time"). The single field filters the library and, when you type a
// name, offers to create it as a custom event. Either path creates immediately
// with Undo; the full editor is reserved for editing or "More options". The
// dragged time/length is preserved.
export function QuickAdd({
  draft,
  activities,
  onPickActivity,
  onCustom,
  onMore,
  onClose,
}: {
  draft: EditorDraft;
  activities: Activity[];
  onPickActivity: (activity: Activity) => void;
  onCustom: (title: string) => void;
  onMore: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");

  const sorted = useMemo(
    () => [...activities].sort((a, b) => a.title.localeCompare(b.title)),
    [activities]
  );
  const trimmed = query.trim();
  const q = trimmed.toLowerCase();
  const filtered = useMemo(
    () =>
      q
        ? sorted.filter((a) => (a.title + " " + a.type + " " + a.blurb).toLowerCase().includes(q))
        : sorted,
    [sorted, q]
  );

  const timeLabel = draft.allDay
    ? "All day"
    : draft.explicitDuration
      ? formatClock(draft.startMin) +
        " – " +
        formatClock(Math.min(MINUTES_PER_DAY, draft.startMin + draft.durationMin))
      : formatClock(draft.startMin);

  return (
    <Modal
      label="Add to calendar"
      onClose={onClose}
      overlayProps={{ className: "overlay--card overlay--quickadd" }}
    >
      <div className="quickadd">
        <div className="quickadd__head">
          <div className="quickadd__when">
            <span className="quickadd__date">{formatEventDateLabel(draft.date)}</span>
            <span className="quickadd__time">{timeLabel}</span>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <CampIcon.Close />
          </button>
        </div>
        {/* One field for both jobs: filter the library, or name a custom event
            (Enter creates it). */}
        <form
          className="quickadd__searchform"
          onSubmit={(e) => {
            e.preventDefault();
            if (trimmed) onCustom(trimmed);
          }}
        >
          <label className="quickadd__search">
            <CampIcon.Search />
            <input
              data-autofocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search activities, or name a custom event"
              aria-label="Search the library, or name a custom event"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} aria-label="Clear">
                <CampIcon.Close />
              </button>
            )}
          </label>
        </form>
        <div className="quickadd__list" role="listbox" aria-label="Library activities and custom event">
          {filtered.map((activity) => (
            <button
              type="button"
              key={activity.id}
              className="quickadd__item"
              onClick={() => onPickActivity(activity)}
            >
              <span
                className="quickadd__dot"
                aria-hidden="true"
                style={{ background: categoryTint(activity.type) }}
              />
              <span className="quickadd__name">{activity.title}</span>
              <span className="quickadd__meta">
                {durLabel(activity)} · {activity.type}
              </span>
            </button>
          ))}
          {/* Custom-event creator — always available the moment you type a name,
              whether or not anything in the library matched. */}
          {trimmed && (
            <>
              {filtered.length > 0 && (
                <span className="quickadd__sep" role="separator" aria-hidden="true" />
              )}
              <button
                type="button"
                className="quickadd__custom-row"
                onClick={() => onCustom(trimmed)}
              >
                <span className="quickadd__custom-icon" aria-hidden="true">
                  <CampIcon.Plus />
                </span>
                <span className="quickadd__name">Add &ldquo;{trimmed}&rdquo;</span>
                <span className="quickadd__meta">custom event</span>
              </button>
            </>
          )}
          {!filtered.length && !trimmed && <div className="quickadd__empty">No activities yet.</div>}
        </div>
        <button type="button" className="quickadd__more" onClick={onMore}>
          More options
        </button>
      </div>
    </Modal>
  );
}
