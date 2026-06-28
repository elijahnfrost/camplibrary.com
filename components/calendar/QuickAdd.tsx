"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  DURATION_OPTIONS,
  MINUTES_PER_DAY,
  SNAP_MIN,
  formatClock,
  formatDuration,
  type DayWindow,
} from "@/lib/calendar/time";
import { formatEventDateLabel } from "@/lib/calendar/dates";
import { matchesActivitySearch } from "@/lib/activityFilters";
import { categoryTint, durLabel, effectiveActivityColor } from "@/lib/data";
import { type CalendarEvent, type DateKey } from "@/lib/calendar/types";
import type { RecurrenceRule } from "@/lib/calendar/recurrence";
import type { Activity } from "@/lib/types";
import { CampIcon } from "../icons";
import { Modal } from "../Modal";
import { Seg, ToggleSwitch } from "../primitives";
import { Select } from "../floating/Select";
import { DatePopover } from "../floating/DatePopover";
import { ColorField } from "../floating/ColorField";
import { LocationField } from "../floating/LocationField";
import { RepeatField } from "./RepeatField";

export type EditorDraft = {
  id?: string; // present when editing an existing event
  date: DateKey;
  startMin: number;
  durationMin: number;
  allDay: boolean;
  activityId?: string;
  title: string;
  /** The user dragged out a specific span — treat the length as deliberate and
   *  never overwrite it with an activity's recommended duration. */
  explicitDuration?: boolean;
  /** A repeat rule, when the event recurs. CalendarShell turns it into the
   *  materialized series on save (and asks the scope on edits). */
  recurrence?: RecurrenceRule;
  /** Per-placement color override (validated hex); absent = inherit the
   *  activity's / category's color. */
  color?: string;
  /** Where this placement happens (gym, classroom…); empty = unstated. */
  locations?: string[];
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
    explicitDuration: true,
    recurrence: event.recurrence,
    color: event.color,
    locations: event.locations,
  };
}

type QuickTab = "Library" | "Custom";

// THE calendar event window — every create and edit goes through this one
// surface, so the calendar has a single look and a single set of habits.
// Two postures:
//  - slot posture (tap/drag a slot): the gesture already chose the when, so
//    picking an activity or naming a custom event creates instantly, with Undo.
//  - pick-a-time posture (library row, the + FAB, or editing an event): the
//    same window grows a compact when-row (date · starts · length · all day)
//    and commits through one button instead of instantly.
export function QuickAdd({
  draft,
  pickTime,
  activities,
  window: dayWindow,
  locationOptions,
  onManageLocations,
  onPickActivity,
  onCustom,
  onSave,
  onDelete,
  onClose,
}: {
  draft: EditorDraft;
  /** Show the when-row + commit button (library pick, FAB, and edit). */
  pickTime: boolean;
  activities: Activity[];
  window: DayWindow;
  /** The user-editable place vocabulary for the Location picker. */
  locationOptions: readonly string[];
  /** Opens the place-list editor from the Location picker's footer. */
  onManageLocations?: () => void;
  onPickActivity: (activity: Activity) => void;
  onCustom: (title: string) => void;
  onSave: (draft: EditorDraft) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const isEdit = Boolean(draft.id);
  const [tab, setTab] = useState<QuickTab>(!draft.activityId && isEdit ? "Custom" : "Library");
  const [query, setQuery] = useState("");
  const [customTitle, setCustomTitle] = useState(draft.activityId ? "" : draft.title);
  // The when-state only drives the pick-a-time posture; the slot posture's
  // when came from the gesture and is displayed read-only in the header.
  const [activityId, setActivityId] = useState(draft.activityId ?? "");
  const [date, setDate] = useState(draft.date);
  const [startMin, setStartMin] = useState(draft.startMin);
  const [durationMin, setDurationMin] = useState(draft.durationMin);
  const [allDay, setAllDay] = useState(draft.allDay);
  const [recurrence, setRecurrence] = useState<RecurrenceRule | undefined>(draft.recurrence);
  const [color, setColor] = useState<string | undefined>(draft.color);
  const [locations, setLocations] = useState<string[]>(draft.locations ?? []);
  // Editing an activity event opens with a compact "Editing: <activity>" summary
  // instead of the full searchable list; "Change activity" expands it on demand.
  const [changingActivity, setChangingActivity] = useState(false);

  const sorted = useMemo(
    () => [...activities].sort((a, b) => a.title.localeCompare(b.title)),
    [activities]
  );
  const trimmed = query.trim();
  // The SAME matcher the Library uses (lib/activityFilters) — multi-word,
  // accent-/case-insensitive, over the shared activity haystack — so a query
  // behaves identically whether you search the Library or this picker.
  const filtered = useMemo(
    () => (trimmed ? sorted.filter((a) => matchesActivitySearch(a, trimmed)) : sorted),
    [sorted, trimmed]
  );
  const selectedActivity = sorted.find((a) => a.id === activityId) ?? null;

  // Switching tabs moves focus into that tab's field — data-autofocus only
  // runs once, when the dialog first opens.
  const tabTouched = useRef(false);
  useEffect(() => {
    if (!tabTouched.current) {
      tabTouched.current = true;
      return;
    }
    document.getElementById(tab === "Library" ? "quickadd-search" : "quickadd-title")?.focus();
  }, [tab]);

  // A preselected activity (rail click, editing) may sort below the fold —
  // bring its row into view so the selection is never invisible.
  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    listRef.current?.querySelector(".quickadd__item.is-on")?.scrollIntoView({ block: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startChoices = useMemo(() => {
    const options: { value: number; label: string }[] = [];
    for (let m = dayWindow.startMin; m < dayWindow.endMin; m += SNAP_MIN) {
      options.push({ value: m, label: formatClock(m) });
    }
    if (!options.some((option) => option.value === startMin)) {
      options.push({ value: startMin, label: formatClock(startMin) });
      options.sort((a, b) => a.value - b.value);
    }
    return options;
  }, [dayWindow, startMin]);

  const durationChoices = useMemo(
    () =>
      DURATION_OPTIONS.includes(durationMin)
        ? DURATION_OPTIONS
        : [...DURATION_OPTIONS, durationMin].sort((a, b) => a - b),
    [durationMin]
  );

  const clampedEnd = Math.min(MINUTES_PER_DAY, startMin + durationMin);
  const timeLabel = pickTime
    ? allDay
      ? "All day"
      : formatClock(startMin) + " – " + formatClock(clampedEnd)
    : draft.allDay
      ? "All day"
      : draft.explicitDuration
        ? formatClock(draft.startMin) +
          " – " +
          formatClock(Math.min(MINUTES_PER_DAY, draft.startMin + draft.durationMin))
        : formatClock(draft.startMin);

  const customTrimmed = customTitle.trim();
  const valid = tab === "Library" ? Boolean(selectedActivity) : Boolean(customTrimmed);

  // The repeat rule clamped so its end never falls behind the event's own date.
  function clampedRule(): RecurrenceRule | undefined {
    return recurrence ? { ...recurrence, until: recurrence.until < date ? date : recurrence.until } : undefined;
  }

  // Slot posture commits: a one-off creates instantly (the gesture chose the
  // when), but once a repeat is set it routes through onSave so CalendarShell
  // builds the whole series — the fix for "repeat is unreachable from tap/drag".
  function slotCommitActivity(activity: Activity) {
    if (!recurrence) {
      onPickActivity(activity);
      return;
    }
    const dur = draft.explicitDuration ? durationMin : activity.durationMin || durationMin;
    onSave({
      date,
      startMin,
      durationMin: dur,
      allDay,
      activityId: activity.id,
      title: activity.title,
      explicitDuration: draft.explicitDuration,
      recurrence: clampedRule(),
    });
  }

  function slotCommitCustom(title: string) {
    if (!recurrence) {
      onCustom(title);
      return;
    }
    onSave({ date, startMin, durationMin, allDay, title, recurrence: clampedRule() });
  }

  function chooseActivity(activity: Activity) {
    if (!pickTime) {
      slotCommitActivity(activity);
      return;
    }
    setActivityId(activity.id);
    setChangingActivity(false);
    // Seed the recommended length only when nothing deliberate was chosen —
    // a dragged span or an edited event's length always wins.
    if (!isEdit && !draft.explicitDuration && activity.durationMin) setDurationMin(activity.durationMin);
  }

  function save() {
    if (!valid) return;
    onSave({
      id: draft.id,
      date,
      startMin,
      durationMin,
      allDay,
      activityId: tab === "Library" ? selectedActivity?.id : undefined,
      title: tab === "Library" ? selectedActivity?.title ?? "" : customTrimmed,
      // The end date can fall behind once the event's own date is pushed later;
      // clamp it so the saved rule always covers the start.
      recurrence: clampedRule(),
      color,
      locations,
    });
  }

  return (
    <Modal
      label={isEdit ? "Edit event" : "Add to calendar"}
      onClose={onClose}
      overlayProps={{ className: "overlay--card overlay--quickadd" }}
    >
      <div className="quickadd">
        <h2 className="sr-only">{isEdit ? "Edit event" : "Add to calendar"}</h2>
        <div className="quickadd__head">
          <div className="quickadd__when">
            <span className="quickadd__date">{formatEventDateLabel(pickTime ? date : draft.date)}</span>
            <span className="quickadd__time">{timeLabel}</span>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <CampIcon.Close />
          </button>
        </div>
        <div className="quickadd__tabs">
          <Seg options={["Library", "Custom"] as const} value={tab} onChange={setTab} ariaLabel="What to add" />
        </div>
        {/* Slot posture: the when came from the gesture, but a repeat is still
            reachable here — set it, then the next pick builds the whole series.
            (Pick-a-time posture has its own RepeatField in the schedule block.) */}
        {!pickTime && (
          <div className="quickadd__slotrepeat">
            <div className="ledger">
              <RepeatField value={recurrence} startDate={date} onChange={setRecurrence} />
            </div>
          </div>
        )}
        {tab === "Library" ? (
          isEdit && selectedActivity && !changingActivity ? (
            <div className="quickadd__editing">
              <span
                className="quickadd__editing-spine"
                style={{ "--cal-tint": effectiveActivityColor(selectedActivity) } as CSSProperties}
                aria-hidden="true"
              />
              <span className="quickadd__editing-info">
                <span className="quickadd__editing-title">{selectedActivity.title}</span>
                <span className="quickadd__editing-meta">
                  {selectedActivity.type} · {durLabel(selectedActivity)}
                </span>
              </span>
              <button
                type="button"
                className="btn btn--ghost quickadd__editing-change"
                onClick={() => setChangingActivity(true)}
              >
                Change activity
              </button>
            </div>
          ) : (
          <>
            {/* Enter takes the top match — type, hit return, done. An empty
                field stays a no-op so a stray Enter never places an event. */}
            <form
              className="quickadd__searchform"
              onSubmit={(e) => {
                e.preventDefault();
                if (!trimmed) return;
                if (filtered.length > 0) {
                  chooseActivity(filtered[0]);
                } else if (pickTime) {
                  // Mirror the rescue row: the typed name becomes a custom event.
                  setCustomTitle(trimmed);
                  setTab("Custom");
                } else {
                  slotCommitCustom(trimmed);
                }
              }}
            >
              <label className="quickadd__search">
                <CampIcon.Search />
                <input
                  id="quickadd-search"
                  data-autofocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search activities"
                  aria-label="Search the library"
                  // Stop the mobile keyboard from auto-capitalizing/autocorrecting
                  // the query (see LibraryTab's search for the full rationale).
                  autoCapitalize="none"
                  autoCorrect="off"
                  autoComplete="off"
                  spellCheck={false}
                />
                {query && (
                  <button type="button" onClick={() => setQuery("")} aria-label="Clear">
                    <CampIcon.Close />
                  </button>
                )}
              </label>
            </form>
            <div className="quickadd__list" ref={listRef}>
              {filtered.map((activity) => {
                const on = pickTime && activity.id === activityId;
                return (
                  <button
                    type="button"
                    key={activity.id}
                    className={"quickadd__item" + (on ? " is-on" : "")}
                    aria-pressed={pickTime ? on : undefined}
                    onClick={() => chooseActivity(activity)}
                    style={{ "--cal-tint": effectiveActivityColor(activity) } as CSSProperties}
                  >
                    <span className="quickadd__name">{activity.title}</span>
                    <span className="quickadd__meta">
                      {durLabel(activity)} · {activity.type}
                    </span>
                    {on && (
                      <span className="quickadd__picked" aria-hidden="true">
                        <CampIcon.Check />
                      </span>
                    )}
                  </button>
                );
              })}
              {/* No match is never a dead end — the typed name can land as a
                  custom event right here. */}
              {!filtered.length && trimmed && (
                <button
                  type="button"
                  className="quickadd__custom-row"
                  onClick={() => {
                    if (pickTime) {
                      setCustomTitle(trimmed);
                      setTab("Custom");
                    } else {
                      slotCommitCustom(trimmed);
                    }
                  }}
                >
                  <span className="quickadd__custom-icon" aria-hidden="true">
                    <CampIcon.Plus />
                  </span>
                  <span className="quickadd__name">Add &ldquo;{trimmed}&rdquo;</span>
                  <span className="quickadd__meta">custom event</span>
                </button>
              )}
              {!filtered.length && !trimmed && (
                <div className="quickadd__empty">No activities yet.</div>
              )}
            </div>
          </>
          )
        ) : (
          <form
            className={"quickadd__custom" + (pickTime ? " quickadd__custom--inline" : "")}
            onSubmit={(e) => {
              e.preventDefault();
              if (!customTrimmed) return;
              if (pickTime) save();
              else slotCommitCustom(customTrimmed);
            }}
          >
            <div className="field">
              <label className="field__label" htmlFor="quickadd-title">
                Event name
              </label>
              <input
                id="quickadd-title"
                className="input"
                data-autofocus
                enterKeyHint="done"
                placeholder="e.g. Lunch, Assembly, Free play"
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
              />
            </div>
            {!pickTime && (
              <button
                type="submit"
                className="btn btn--primary quickadd__custom-add"
                disabled={!customTrimmed}
              >
                <CampIcon.Check />
                Add to calendar
              </button>
            )}
          </form>
        )}

        {pickTime && (
          <div className="quickadd__schedule">
            {/* The schedule is a switch ledger — the same label-left/control-right
                rows as the calendar sidebar's View settings, so the editor and the
                sidebar read as one compact vocabulary instead of a tall stack of
                boxed fields. */}
            <div className="ledger quickadd__settings">
              <div className="ledger__row">
                <span className="ledger__label">Date</span>
                <DatePopover
                  id="quickadd-date"
                  value={date}
                  onChange={(next) => setDate(next)}
                  ariaLabel="Event date"
                />
              </div>
              <div className="ledger__row">
                <span className="ledger__label">All day</span>
                <ToggleSwitch on={allDay} onChange={setAllDay} ariaLabel="All day" />
              </div>
              {!allDay && (
                <>
                  <div className="ledger__row">
                    <span className="ledger__label">Starts</span>
                    <Select
                      id="quickadd-start"
                      value={startMin}
                      options={startChoices}
                      onChange={setStartMin}
                      ariaLabel="Event start time"
                    />
                  </div>
                  <div className="ledger__row">
                    <span className="ledger__label">Length</span>
                    <Select
                      id="quickadd-length"
                      value={durationMin}
                      options={durationChoices.map((value) => ({ value, label: formatDuration(value) }))}
                      onChange={setDurationMin}
                      ariaLabel="Event length"
                    />
                  </div>
                </>
              )}
              <div className="ledger__row">
                <span className="ledger__label">Color</span>
                <ColorField
                  id="quickadd-color"
                  value={color}
                  fallback={
                    tab === "Library" && selectedActivity
                      ? effectiveActivityColor(selectedActivity)
                      : categoryTint(undefined)
                  }
                  onChange={setColor}
                  ariaLabel="Event color"
                />
              </div>
              <div className="ledger__row">
                <span className="ledger__label">Location</span>
                <LocationField
                  id="quickadd-location"
                  value={locations}
                  options={locationOptions}
                  onChange={setLocations}
                  onManage={onManageLocations}
                  ariaLabel="Event location"
                />
              </div>
              {/* Repeat rides last: its detail rows (weekday toggles, end date)
                  and the plain-language summary expand below without pushing the
                  core when-controls down. */}
              <RepeatField value={recurrence} startDate={date} onChange={setRecurrence} />
            </div>
            <div className="quickadd__foot">
              {isEdit && onDelete && (
                <button type="button" className="btn btn--ghost quickadd__delete" onClick={onDelete}>
                  <CampIcon.Trash />
                  Delete
                </button>
              )}
              {/* The footer always says what the commit will do — the chosen
                  row may be scrolled out of view in a long library. */}
              <p className="quickadd__hint" role="status">
                {valid
                  ? (isEdit ? "Saving" : "Adding") +
                    " “" +
                    (tab === "Library" ? selectedActivity?.title : customTrimmed) +
                    "”"
                  : tab === "Library"
                    ? "Pick an activity to add it."
                    : "Give the event a name."}
              </p>
              <button type="button" className="btn btn--primary" disabled={!valid} onClick={save}>
                <CampIcon.Check />
                {isEdit ? "Save" : "Add to calendar"}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
