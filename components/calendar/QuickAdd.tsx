"use client";

import { useMemo, useRef, useState, type CSSProperties } from "react";
import {
  MINUTES_PER_DAY,
  SNAP_MIN,
  formatClock,
  formatDuration,
  type DayWindow,
} from "@/lib/calendar/time";
import { formatEventDateLabel } from "@/lib/calendar/dates";
import { matchesActivitySearch } from "@/lib/activityFilters";
import { categoryTint, durLabel, effectiveActivityColor, reminderTint } from "@/lib/data";
import { type CalendarEvent, type DateKey } from "@/lib/calendar/types";
import type { RecurrenceRule } from "@/lib/calendar/recurrence";
import type { Activity } from "@/lib/types";
import { CampIcon } from "../icons";
import { PropRow } from "../PropRow";
import { Modal } from "../Modal";
import { ToggleSwitch } from "../primitives";
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
  /** A short free-text note carried by the event (the nudge for a 0-min reminder,
   *  or a detail line on a real block). */
  note?: string;
};

export function draftFromEvent(event: CalendarEvent): EditorDraft {
  return {
    id: event.id,
    date: event.date,
    // A 0-min event keeps its 0 length (a reminder); otherwise the real span.
    durationMin: event.allDay ? 30 : event.endMin - event.startMin,
    startMin: event.startMin,
    allDay: Boolean(event.allDay),
    activityId: event.activityId,
    title: event.title,
    explicitDuration: true,
    recurrence: event.recurrence,
    color: event.color,
    locations: event.locations,
    note: event.note,
  };
}

// THE calendar event window — every create and edit goes through this one
// surface, so the calendar has a single look and a single set of habits. There
// is ONE create path now: a search bar. Type a name; matching library activities
// appear and a tap places one; if it isn't there, the same text becomes a new
// event — and a "Save to library" switch (OFF by default, so quickly typed
// one-offs don't silently become permanent library rows) decides whether that
// new event is also saved as a reusable library activity (in the Routine
// bucket). Length drives behavior: a timed block, or "None" = a 0-minute
// reminder. Two postures:
//  - slot posture (tap/drag a slot): the gesture already chose the when, so
//    picking an activity or naming a new event creates instantly, with Undo.
//  - pick-a-time posture (the + FAB, editing an event): the same window grows a
//    compact when-row (date · starts · length · all day) and commits via a button.
export function QuickAdd({
  draft,
  pickTime,
  activities,
  window: dayWindow,
  locationOptions,
  onManageLocations,
  onPickActivity,
  onCreateActivity,
  onSave,
  onDelete,
  onDuplicate,
  onOpenActivity,
  onClose,
}: {
  draft: EditorDraft;
  /** Show the when-row + commit button (the FAB and edit). */
  pickTime: boolean;
  activities: Activity[];
  window: DayWindow;
  /** The user-editable place vocabulary for the Location picker. */
  locationOptions: readonly string[];
  /** Opens the place-list editor from the Location picker's footer. */
  onManageLocations?: () => void;
  /** Place an existing library activity instantly (slot posture). */
  onPickActivity: (activity: Activity) => void;
  /** Create a brand-new library activity from a typed name + length (the
   *  "Save to library" path) and return it so it can be placed. Lands in the
   *  Routine bucket. Returns null if the staff gate blocks it. */
  onCreateActivity: (title: string, durationMin: number) => Activity | null;
  onSave: (draft: EditorDraft) => void;
  onDelete?: () => void;
  /** Copy this event (edit posture only) — the single-event action that used to
   *  live on the now-retired click popover, so touch (no right-click) keeps it. */
  onDuplicate?: () => void;
  /** Jump to this activity event's run list (activity-backed edits only) — the
   *  other action the click popover carried; now reachable from the editor. */
  onOpenActivity?: () => void;
  onClose: () => void;
}) {
  const isEdit = Boolean(draft.id);
  // One text field does double duty: a search query while creating, and the
  // editable name when editing a one-off custom event.
  const [query, setQuery] = useState(isEdit && !draft.activityId ? draft.title : "");
  const [activityId, setActivityId] = useState(draft.activityId ?? "");
  // "Save to library" — OFF by default: quickly typed one-off entries stay
  // one-offs instead of silently becoming permanent library rows that degrade
  // search all season. A just-placed one-off can still be promoted afterwards
  // (the create toast's "Save to library" action, or promoteToLibrary in edit).
  const [addToLibrary, setAddToLibrary] = useState(false);
  // The when-state only drives the pick-a-time posture; the slot posture's
  // when came from the gesture and is displayed read-only in the header.
  const [date, setDate] = useState(draft.date);
  const [startMin, setStartMin] = useState(draft.startMin);
  const [durationMin, setDurationMin] = useState(draft.durationMin);
  const [allDay, setAllDay] = useState(draft.allDay);
  const [note, setNote] = useState(draft.note ?? "");
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
  // Is the typed name already a library title? Then "create new" doesn't apply —
  // the matching row is the path. (Case-/space-insensitive.)
  const hasExactMatch = useMemo(
    () => Boolean(trimmed) && sorted.some((a) => a.title.trim().toLowerCase() === trimmed.toLowerCase()),
    [sorted, trimmed]
  );

  // A preselected activity (editing) may sort below the fold — bring its row into
  // view so the selection is never invisible.
  const listRef = useRef<HTMLDivElement | null>(null);

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

  // A 0-min length IS a reminder — it shows just a start time, no range.
  const isReminder = !allDay && durationMin === 0;
  // End-time choices mirror the start grid, from one snap past the start to the
  // end of the day. The END is the live control now; LENGTH is derived from it
  // (end − start) and shown only as a faint hint — "important to have, not to
  // see." Changing the end sets the duration; changing the start shifts the end.
  const endChoices = useMemo(() => {
    const options: { value: number; label: string }[] = [];
    for (let m = startMin + SNAP_MIN; m <= dayWindow.endMin; m += SNAP_MIN) {
      options.push({ value: m, label: formatClock(m) });
    }
    const end = Math.min(MINUTES_PER_DAY, startMin + durationMin);
    if (end > startMin && !options.some((option) => option.value === end)) {
      options.push({ value: end, label: formatClock(end) });
      options.sort((a, b) => a.value - b.value);
    }
    return options;
  }, [dayWindow, startMin, durationMin]);
  // Move the start but keep the block's length (the end rides along), clamped so
  // it can't spill past midnight.
  const moveStart = (next: number) => {
    setStartMin(next);
    if (next + durationMin > MINUTES_PER_DAY) setDurationMin(MINUTES_PER_DAY - next);
  };
  // Set the end → that defines the length (never negative).
  const setEnd = (next: number) => setDurationMin(Math.max(SNAP_MIN, next - startMin));
  // Toggling "Reminder" zeroes the length (a point in time) and remembers the
  // last real length so switching back restores a sensible block — round-trippable.
  const lastDurationRef = useRef(draft.durationMin || 30);
  const toggleReminder = (on: boolean) => {
    if (on) {
      if (durationMin > 0) lastDurationRef.current = durationMin;
      setAllDay(false);
      setDurationMin(0);
    } else {
      setDurationMin(lastDurationRef.current || 30);
    }
  };
  const draftIsReminder = !draft.allDay && draft.durationMin === 0;
  const clampedEnd = Math.min(MINUTES_PER_DAY, startMin + durationMin);
  const timeLabel = pickTime
    ? isReminder
      ? formatClock(startMin)
      : allDay
        ? "All day"
        : formatClock(startMin) + " – " + formatClock(clampedEnd)
    : draftIsReminder
      ? formatClock(draft.startMin)
      : draft.allDay
        ? "All day"
        : draft.explicitDuration
          ? formatClock(draft.startMin) +
            " – " +
            formatClock(Math.min(MINUTES_PER_DAY, draft.startMin + draft.durationMin))
          : formatClock(draft.startMin);

  // Valid to commit when an activity is selected, or a name is typed.
  const valid = selectedActivity ? true : Boolean(trimmed);
  // Showing the list area. It's a TYPE-TO-SEARCH dropdown now, not an always-open
  // catalog: while creating it appears only once you've typed (so an empty Add
  // reads as a calm property sheet, and dropdowns have room to open), but while
  // swapping an edited activity it stays open so you can browse the library.
  const showList = changingActivity || (!isEdit && Boolean(trimmed));
  // Whether to RECOMMEND library events. Always on while creating — matches are
  // PLACEMENT options (the primary create path), independent of the
  // save-to-library switch, which only governs what happens to a brand-new typed
  // name. Also on while swapping an edited activity (that IS a library pick).
  const showSuggestions = changingActivity || !isEdit;
  // The inline "create new" affordance shows while creating, once a name is typed.
  // With "Save to library" off it always shows (calendar-only text, even if the
  // name happens to match a library title); on, it defers to an exact match.
  const canCreateNew = !isEdit && Boolean(trimmed) && (!addToLibrary || !hasExactMatch);

  // The repeat rule clamped so its end never falls behind the event's own date.
  function clampedRule(): RecurrenceRule | undefined {
    return recurrence ? { ...recurrence, until: recurrence.until < date ? date : recurrence.until } : undefined;
  }

  // Build the draft an existing-activity commit saves.
  function activityDraft(activity: Activity): EditorDraft {
    return {
      id: draft.id,
      date,
      startMin,
      durationMin,
      allDay: isReminder ? false : allDay,
      activityId: activity.id,
      title: activity.title,
      explicitDuration: draft.explicitDuration,
      recurrence: clampedRule(),
      color,
      locations,
      note: note.trim() || undefined,
    };
  }

  // Build the draft a one-off custom commit saves (no library backing).
  function customDraft(title: string): EditorDraft {
    return {
      id: draft.id,
      date,
      startMin,
      durationMin,
      allDay: isReminder ? false : allDay,
      title,
      explicitDuration: draft.explicitDuration,
      recurrence: clampedRule(),
      color,
      locations,
      note: note.trim() || undefined,
    };
  }

  // Place an existing activity. Slot posture creates instantly (unless a repeat
  // is set — then it routes through onSave so CalendarShell builds the series).
  function chooseActivity(activity: Activity) {
    if (!pickTime) {
      if (recurrence) onSave(activityDraft(activity));
      else onPickActivity(activity);
      return;
    }
    // Pick-a-time: toggle the selection; seed the recommended length only when
    // nothing deliberate was chosen.
    if (activity.id === activityId) {
      setActivityId("");
      return;
    }
    setActivityId(activity.id);
    setChangingActivity(false);
    if (!isEdit && !draft.explicitDuration && activity.durationMin) setDurationMin(activity.durationMin);
  }

  // Commit a brand-new entry: create a reusable library activity first when
  // "Save to library" is on, else place a one-off custom event. Either way the
  // chosen Length (0 = reminder) carries through.
  function commitNew() {
    const title = trimmed;
    if (!title) return;
    if (addToLibrary) {
      const activity = onCreateActivity(title, isReminder ? 0 : durationMin);
      if (!activity) return; // staff gate blocked it
      onSave(activityDraft(activity));
    } else {
      onSave(customDraft(title));
    }
  }

  // The pick-a-time commit button: an existing activity, a new entry, or a saved
  // edit of a one-off custom event.
  function save() {
    if (!valid) return;
    if (selectedActivity) onSave(activityDraft(selectedActivity));
    else if (!isEdit) commitNew();
    else onSave(customDraft(trimmed));
  }

  // Editing a calendar-only event: add it to the library after the fact (when
  // "Save to library" was off at creation). Creates the reusable activity and
  // links this placement to it, so the event becomes activity-backed.
  function promoteToLibrary() {
    const title = trimmed || draft.title;
    if (!title) return;
    const activity = onCreateActivity(title, isReminder ? 0 : durationMin);
    if (!activity) return; // staff gate blocked it
    onSave(activityDraft(activity));
  }

  // Is the field actually SEARCHING the library, or just NAMING an event? It
  // searches while swapping an activity, or while creating with "Save to library"
  // on. Otherwise (calendar-only create, or editing a one-off) it's a plain name
  // field — so it sheds the search icon and reads "Name this event", not a search.
  const searching = changingActivity || (!isEdit && addToLibrary);
  const searchPlaceholder = changingActivity
    ? "Search activities"
    : isEdit
      ? "Event name"
      : searching
        ? "Search the library or name an event"
        : "Name this event";

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
        {isEdit && selectedActivity && !changingActivity ? (
          // The library-backed event reads as a clean title block (category
          // eyebrow + name), not a boxed summary card — the run-sheet header
          // vocabulary, so editing an event and opening its sheet feel like one
          // surface. Its actions are quiet inline links, not heavy buttons.
          <div className="quickadd__act">
            <span className="quickadd__act-eyebrow">
              <span
                className="quickadd__act-dot"
                style={{ background: effectiveActivityColor(selectedActivity) }}
                aria-hidden="true"
              />
              {selectedActivity.type} · {durLabel(selectedActivity)}
            </span>
            <h3 className="quickadd__act-title">{selectedActivity.title}</h3>
            <div className="quickadd__act-links">
              {onOpenActivity && (
                <button type="button" className="quickadd__act-link" onClick={onOpenActivity}>
                  <CampIcon.BookOpen />
                  Open Run List
                </button>
              )}
              <button
                type="button"
                className="quickadd__act-link quickadd__act-link--quiet"
                onClick={() => setChangingActivity(true)}
              >
                Change activity
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Enter takes the top match — type, hit return, done. With no match
                the typed name becomes a new event (slot posture commits it). An
                empty field stays a no-op so a stray Enter never places anything. */}
            <form
              className="quickadd__searchform"
              onSubmit={(e) => {
                e.preventDefault();
                if (!trimmed) return;
                // Calendar-only mode: Enter commits the typed text, never a
                // library match (we're not recommending any).
                if (!isEdit && !addToLibrary) {
                  commitNew();
                  return;
                }
                if (filtered.length > 0) chooseActivity(filtered[0]);
                else if (!isEdit) commitNew();
                else if (pickTime) save();
              }}
            >
              <label className={"quickadd__search" + (searching ? "" : " quickadd__search--name")}>
                {searching && <CampIcon.Search />}
                <input
                  id="quickadd-search"
                  data-autofocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={searchPlaceholder}
                  aria-label={searching ? "Search the library or name an event" : "Event name"}
                  // Stop the mobile keyboard from auto-capitalizing/autocorrecting
                  // the query (see LibraryTab's search for the full rationale).
                  autoCapitalize="none"
                  autoCorrect="off"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
            </form>
            {/* The ONE create control besides the search: does a name you type
                match the library (become a reusable activity) or just land as
                calendar-only text? Persistent so the choice is made up front, not
                buried on the no-match row. Pick an existing row and this doesn't
                apply — it's already in the library. */}
            {!isEdit && (
              <label className="quickadd__mode">
                <span className="quickadd__mode-text">
                  <span className="quickadd__mode-label">Save to library</span>
                  <span className="quickadd__mode-hint">
                    {addToLibrary
                      ? "A new name becomes a reusable activity"
                      : "A new name stays on the calendar only"}
                  </span>
                </span>
                <ToggleSwitch
                  on={addToLibrary}
                  onChange={setAddToLibrary}
                  ariaLabel="Save a new entry to the library"
                />
              </label>
            )}
            {showList && (
              <div className="quickadd__list" ref={listRef}>
                {/* Library recommendations — only when "Save to library" is on (or
                    when swapping an edited activity). Off → a calendar-only text
                    entry, so we stop recommending events entirely. */}
                {showSuggestions &&
                  filtered.map((activity) => {
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
                        <span className="quickadd__itemdot" aria-hidden="true" />
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
                {/* No match is never a dead end — the typed name lands as a new
                    event. Whether it's also saved to the library is the persistent
                    checkbox above; this row just echoes the outcome. */}
                {canCreateNew && (
                  <div className="quickadd__create">
                    <button type="button" className="quickadd__custom-row" onClick={commitNew}>
                      <span className="quickadd__custom-icon" aria-hidden="true">
                        <CampIcon.Plus />
                      </span>
                      <span className="quickadd__name">Add &ldquo;{trimmed}&rdquo;</span>
                      <span className="quickadd__meta">
                        {addToLibrary ? "new · saved to library" : "calendar only"}
                      </span>
                    </button>
                  </div>
                )}
                {/* Calendar-only mode with nothing typed yet — a prompt, not the
                    library's empty states (we're deliberately not recommending). */}
                {!showSuggestions && !canCreateNew && (
                  <div className="quickadd__empty">Type a name to drop it on the calendar.</div>
                )}
                {showSuggestions && !filtered.length && !canCreateNew && trimmed && (
                  <div className="quickadd__empty">No activities match.</div>
                )}
                {showSuggestions && !filtered.length && !trimmed && (
                  <div className="quickadd__empty">No activities yet.</div>
                )}
              </div>
            )}
            {/* Slot posture, nothing typed yet: a calm one-line prompt instead of
                an always-open catalog (the list is type-to-search now). */}
            {!isEdit && !pickTime && !trimmed && (
              <p className="quickadd__prompt">
                Search to place a library activity — or type a name for a one-off.
              </p>
            )}
          </>
        )}

        {pickTime && (
          <div className="quickadd__schedule">
            {/* The schedule is a PROPERTY LIST — the shared "Notion lines" rows
                (icon · muted label · inline control) used across the app, so the
                editor reads in the same vocabulary as the run sheet and filters.
                The live time field is the start–end RANGE; length is derived and
                shown only as a faint hint. */}
            <div className="proplist quickadd__settings">
              <PropRow icon={CampIcon.Calendar} label="Date">
                <DatePopover
                  id="quickadd-date"
                  value={date}
                  onChange={(next) => setDate(next)}
                  ariaLabel="Event date"
                />
              </PropRow>
              {/* Reminder: a point in time, no length (a bathroom-break nudge
                  between blocks). The toggle round-trips back to a timed block. */}
              <PropRow icon={CampIcon.Bell} label="Reminder">
                <ToggleSwitch
                  on={isReminder}
                  onChange={toggleReminder}
                  ariaLabel="Make this a point-in-time reminder"
                />
              </PropRow>
              {/* All day is meaningless for a reminder — hide it then. */}
              {!isReminder && (
                <PropRow icon={CampIcon.Calendar} label="All day">
                  <ToggleSwitch on={allDay} onChange={setAllDay} ariaLabel="All day" />
                </PropRow>
              )}
              {!allDay && (
                <PropRow icon={CampIcon.Clock} label={isReminder ? "At" : "Time"}>
                  <Select
                    id="quickadd-start"
                    value={startMin}
                    options={startChoices}
                    onChange={moveStart}
                    ariaLabel={isReminder ? "Reminder time" : "Event start time"}
                  />
                  {!isReminder && (
                    <>
                      <span className="quickadd__timedash" aria-hidden="true">–</span>
                      <Select
                        id="quickadd-end"
                        value={clampedEnd}
                        options={endChoices}
                        onChange={setEnd}
                        ariaLabel="Event end time"
                      />
                      <span className="quickadd__timelen">{formatDuration(durationMin)}</span>
                    </>
                  )}
                </PropRow>
              )}
              {/* Create keeps the list to the WHEN (date · all-day · time). The
                  richer details below — color, location, repeat, day note — are
                  EDIT-only, so a fresh add stays calm; click the placed event to
                  set them. */}
              {isEdit && (
                <PropRow icon={CampIcon.Palette} label="Color">
                  <ColorField
                    id="quickadd-color"
                    value={color}
                    fallback={
                      isReminder
                        ? reminderTint(undefined)
                        : selectedActivity
                          ? effectiveActivityColor(selectedActivity)
                          : categoryTint(undefined)
                    }
                    onChange={setColor}
                    ariaLabel="Event color"
                  />
                </PropRow>
              )}
              {isEdit && !isReminder && (
                <PropRow icon={CampIcon.Pin} label="Location">
                  <LocationField
                    id="quickadd-location"
                    value={locations}
                    options={locationOptions}
                    onChange={setLocations}
                    onManage={onManageLocations}
                    ariaLabel="Event location"
                  />
                </PropRow>
              )}
              {/* Repeat rides last (edit-only): its lead row carries the axis
                  icon, its detail rows indent beneath it. */}
              {isEdit && (
                <RepeatField value={recurrence} startDate={date} onChange={setRecurrence} />
              )}
              {/* Day note — a named property that bridges to the run sheet. A
                  top-aligned row whose value is the prose field. Edit-only. */}
              {isEdit && (
                <PropRow icon={CampIcon.Note} label="Day note" className="prop-row--top quickadd__noterow">
                  <textarea
                    id="quickadd-note"
                    className="input quickadd__note"
                    rows={2}
                    maxLength={280}
                    placeholder={
                      isReminder ? "What's the nudge? e.g. switch the laundry" : "Shows on the run sheet — e.g. use the back field"
                    }
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </PropRow>
              )}
            </div>
            <div className="quickadd__foot">
              {isEdit && !selectedActivity && (
                <button type="button" className="btn btn--ghost quickadd__tolib-btn" onClick={promoteToLibrary}>
                  <CampIcon.Bookmark />
                  Add to library
                </button>
              )}
              {isEdit && onDuplicate && (
                <button type="button" className="btn btn--ghost quickadd__dup" onClick={onDuplicate}>
                  <CampIcon.Copy />
                  Duplicate
                </button>
              )}
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
                    (selectedActivity ? selectedActivity.title : trimmed) +
                    "”" +
                    (!isEdit && !selectedActivity && addToLibrary ? " · saved to library" : "")
                  : "Search or name an event."}
              </p>
              <button type="button" className="btn btn--primary" disabled={!valid} onClick={save}>
                <CampIcon.Check />
                {isEdit ? "Save" : isReminder ? "Add reminder" : "Add to calendar"}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
