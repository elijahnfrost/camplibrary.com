"use client";

import { useMemo, useState } from "react";
import { formatClock, formatDuration, DURATION_OPTIONS, SNAP_MIN, type DayWindow } from "@/lib/calendar/time";
import type { CalendarEvent, DateKey } from "@/lib/calendar/types";
import type { Activity } from "@/lib/types";
import { durLabel } from "@/lib/data";
import { CampIcon } from "../icons";
import { Modal } from "../Modal";
import { Seg } from "../primitives";

export type EditorDraft = {
  id?: string; // present when editing an existing event
  date: DateKey;
  startMin: number;
  durationMin: number;
  allDay: boolean;
  activityId?: string;
  title: string;
};

export function draftFromEvent(event: CalendarEvent): EditorDraft {
  return {
    id: event.id,
    date: event.date,
    startMin: event.startMin,
    durationMin: event.allDay ? 30 : Math.max(SNAP_MIN, event.endMin - event.startMin),
    allDay: Boolean(event.allDay),
    activityId: event.activityId,
    title: event.title,
  };
}

type SourceTab = "Library" | "Custom";

export function EventEditor({
  initial,
  activities,
  window,
  onSave,
  onDelete,
  onClose,
}: {
  initial: EditorDraft;
  activities: Activity[];
  window: DayWindow;
  onSave: (draft: EditorDraft) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const isEdit = Boolean(initial.id);
  const [tab, setTab] = useState<SourceTab>(initial.activityId || !isEdit ? "Library" : "Custom");
  const [activityId, setActivityId] = useState(initial.activityId ?? "");
  const [title, setTitle] = useState(initial.activityId ? "" : initial.title);
  const [date, setDate] = useState(initial.date);
  const [startMin, setStartMin] = useState(initial.startMin);
  const [durationMin, setDurationMin] = useState(initial.durationMin);
  const [allDay, setAllDay] = useState(initial.allDay);

  const sortedActivities = useMemo(
    () => [...activities].sort((a, b) => a.title.localeCompare(b.title)),
    [activities]
  );
  const selectedActivity = sortedActivities.find((a) => a.id === activityId) ?? null;

  const startChoices = useMemo(() => {
    const options: { value: number; label: string }[] = [];
    for (let m = window.startMin; m < window.endMin; m += SNAP_MIN) {
      options.push({ value: m, label: formatClock(m) });
    }
    if (!options.some((option) => option.value === startMin)) {
      options.push({ value: startMin, label: formatClock(startMin) });
      options.sort((a, b) => a.value - b.value);
    }
    return options;
  }, [window, startMin]);

  const durationChoices = useMemo(() => {
    const values = DURATION_OPTIONS.includes(durationMin)
      ? DURATION_OPTIONS
      : [...DURATION_OPTIONS, durationMin].sort((a, b) => a - b);
    return values;
  }, [durationMin]);

  const valid = tab === "Library" ? Boolean(selectedActivity) : Boolean(title.trim());

  function save() {
    if (!valid) return;
    onSave({
      id: initial.id,
      date,
      startMin,
      durationMin,
      allDay,
      activityId: tab === "Library" ? selectedActivity?.id : undefined,
      title: tab === "Library" ? selectedActivity?.title ?? "" : title.trim(),
    });
  }

  return (
    <Modal
      label={isEdit ? "Edit event" : "New event"}
      onClose={onClose}
      overlayProps={{ className: "overlay--card" }}
    >
      <form
        className="overlay__body cal-editor"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="cal-editor__head">
          <h2 className="cal-editor__title">{isEdit ? "Edit event" : "New event"}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <CampIcon.Close />
          </button>
        </div>

        <div className="field">
          <span className="field__label">What</span>
          <Seg options={["Library", "Custom"] as const} value={tab} onChange={setTab} ariaLabel="Event source" />
        </div>

        {tab === "Library" ? (
          <div className="field">
            <label className="field__label" htmlFor="cal-editor-activity">Activity</label>
            <select
              id="cal-editor-activity"
              className="select"
              data-autofocus
              value={activityId}
              onChange={(e) => {
                setActivityId(e.target.value);
                const activity = sortedActivities.find((a) => a.id === e.target.value);
                if (activity && !isEdit) setDurationMin(activity.durationMin);
              }}
            >
              <option value="">Pick an activity…</option>
              {sortedActivities.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title} · {durLabel(a)}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="field">
            <label className="field__label" htmlFor="cal-editor-title">Title</label>
            <input
              id="cal-editor-title"
              className="input"
              data-autofocus
              enterKeyHint="done"
              placeholder="e.g. Lunch, Assembly, Free play"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
        )}

        <div className="cal-editor__when">
          <div className="field">
            <label className="field__label" htmlFor="cal-editor-date">Date</label>
            <input
              id="cal-editor-date"
              type="date"
              className="input"
              value={date}
              onChange={(e) => {
                if (e.target.value) setDate(e.target.value);
              }}
            />
          </div>
          {!allDay && (
            <>
              <div className="field">
                <label className="field__label" htmlFor="cal-editor-start">Starts</label>
                <select
                  id="cal-editor-start"
                  className="select"
                  value={startMin}
                  onChange={(e) => setStartMin(Number(e.target.value))}
                >
                  {startChoices.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="field__label" htmlFor="cal-editor-duration">Length</label>
                <select
                  id="cal-editor-duration"
                  className="select"
                  value={durationMin}
                  onChange={(e) => setDurationMin(Number(e.target.value))}
                >
                  {durationChoices.map((value) => (
                    <option key={value} value={value}>
                      {formatDuration(value)}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
        </div>

        <label className="cal-editor__allday">
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
          All day
        </label>

        <div className="cal-editor__actions">
          {isEdit && onDelete && (
            <button type="button" className="btn btn--ghost cal-editor__delete" onClick={onDelete}>
              <CampIcon.Trash />
              Delete
            </button>
          )}
          <span className="cal-editor__sp" />
          <button type="submit" className="btn btn--primary" disabled={!valid}>
            <CampIcon.Check />
            {isEdit ? "Save" : "Add to calendar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
