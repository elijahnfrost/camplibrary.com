"use client";

// THE ONE event window (create AND click-to-edit): the search/library pick, the
// custom-title create, the pickTime postures, all-day, location, color,
// repeat/series, save-to-library, backups, delete/delete-series. The sheet is
// TWO-BEAT:
//   Beat one (at rest): the search/title field, the when-line as a compact pill
//   sentence (date pill · start pill · end pill + faint length · All-day
//   switch), and the primary action.
//   Beat two: EVERYTHING else — save-to-library, color, location, repeat, day
//   note, recover time, backups, and the immediate edit actions — behind ONE
//   flat "More options" disclosure (the same chevron-row grammar as the camp
//   editor's collapsed groups). Closed by default while creating; AUTO-OPENS
//   when editing an event that already carries any of those, so existing values
//   are never hidden — and the closed row's summary still echoes what's set.
// Footer: Delete (danger ink, icon+label) bottom-left while editing, the green
// primary bottom-right — the reference popup's anatomy.

import { useMemo, useRef, useState, type CSSProperties } from "react";
import {
  MINUTES_PER_DAY,
  SNAP_MIN,
  formatClock,
  formatDuration,
  snapMinutes,
  type DayWindow,
} from "@/lib/calendar/time";
import { formatEventDateLabel } from "@/lib/calendar/dates";
import { matchesActivitySearch } from "@/lib/activityFilters";
import { categoryTint, durLabel, effectiveActivityColor, reminderTint } from "@/lib/data";
import {
  formatLocations,
  type AlternateRef,
  type CalendarEvent,
  type DateKey,
} from "@/lib/calendar/types";
import { summarizeRecurrence, type RecurrenceRule } from "@/lib/calendar/recurrence";
import type { Activity } from "@/lib/types";
import { coverage } from "@/lib/materials";
import type { Material } from "@/lib/materialCatalog";
import type { StockState } from "@/lib/kitStock";
import { conflictsForEvent, dayKit } from "@/lib/calendar/kitConflicts";
import { CampIcon } from "@/components/icons";
import { PropRow } from "@/components/PropRow";
import { ToggleSwitch } from "@/components/primitives";
import { Select } from "@/components/floating/Select";
import { DatePopover } from "@/components/floating/DatePopover";
import { ColorField } from "@/components/floating/ColorField";
import { LocationField } from "@/components/floating/LocationField";
import { RepeatField } from "@/components/calendar/RepeatField";
import { FocusSheet } from "../FocusSheet";
import { Disclosure } from "../Disclosure";

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
  /** Whether this placement is pinned (held in place on a day-shift). The editor
   *  doesn't SET this (Pin is an immediate footer action), but it rides through
   *  so a save doesn't silently un-pin. */
  pinned?: boolean;
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
    pinned: event.pinned,
  };
}

export function QuickAdd({
  draft,
  pickTime,
  activities,
  kitStock = {},
  materialCatalog,
  dayEvents = [],
  byId = {},
  window: dayWindow,
  snap = SNAP_MIN,
  locationOptions,
  onManageLocations,
  onPickActivity,
  onCreateActivity,
  onSave,
  onDelete,
  onDeleteSeries,
  onDuplicate,
  onOpenActivity,
  onTogglePin,
  pinned = false,
  onApplyAll,
  onApplyFollowing,
  onResetOccurrence,
  onRestoreSkip,
  onRecoverTime,
  backupAlternates = [],
  onSwapBackup,
  onEditBackups,
  onClearBackups,
  hasOwnBackups = false,
  onClose,
}: {
  draft: EditorDraft;
  /** Show the when-row + commit button (the FAB and edit). */
  pickTime: boolean;
  activities: Activity[];
  kitStock?: Record<string, StockState>;
  materialCatalog?: Material[];
  dayEvents?: CalendarEvent[];
  byId?: Record<string, Activity>;
  window: DayWindow;
  snap?: number;
  locationOptions: readonly string[];
  onManageLocations?: () => void;
  onPickActivity: (activity: Activity) => void;
  onCreateActivity: (title: string, durationMin: number) => Activity | null;
  onSave: (draft: EditorDraft) => void;
  onDelete?: () => void;
  onDeleteSeries?: () => void;
  onDuplicate?: () => void;
  onOpenActivity?: () => void;
  onTogglePin?: () => void;
  pinned?: boolean;
  onApplyAll?: () => void;
  onApplyFollowing?: () => void;
  onResetOccurrence?: () => void;
  onRestoreSkip?: (date: DateKey) => void;
  onRecoverTime?: (extend: boolean) => void;
  backupAlternates?: AlternateRef[];
  onSwapBackup?: (index: number) => void;
  onEditBackups?: () => void;
  onClearBackups?: () => void;
  hasOwnBackups?: boolean;
  onClose: () => void;
}) {
  const isEdit = Boolean(draft.id);
  // One text field does double duty: a search query while creating, and the
  // editable name when editing a one-off custom event.
  const [query, setQuery] = useState(isEdit && !draft.activityId ? draft.title : "");
  const [activityId, setActivityId] = useState(draft.activityId ?? "");
  // "Save to library" — OFF by default (see the production fork source): typed
  // one-offs stay one-offs unless deliberately promoted.
  const [addToLibrary, setAddToLibrary] = useState(false);
  const [date, setDate] = useState(draft.date);
  const [startMin, setStartMin] = useState(draft.startMin);
  const [durationMin, setDurationMin] = useState(draft.durationMin);
  const [allDay, setAllDay] = useState(draft.allDay);
  const [note, setNote] = useState(draft.note ?? "");
  const [recurrence, setRecurrence] = useState<RecurrenceRule | undefined>(draft.recurrence);
  const [color, setColor] = useState<string | undefined>(draft.color);
  const [locations, setLocations] = useState<string[]>(draft.locations ?? []);
  const [changingActivity, setChangingActivity] = useState(false);
  // The TWO-BEAT hinge. Closed for a fresh create; auto-open while editing an
  // event that already carries anything the disclosure hides, so an existing
  // value is never invisible on arrival.
  const [moreOpen, setMoreOpen] = useState(
    () =>
      isEdit &&
      Boolean(
        draft.color ||
          (draft.locations?.length ?? 0) > 0 ||
          draft.recurrence ||
          (draft.note ?? "").trim() ||
          backupAlternates.length > 0 ||
          hasOwnBackups
      )
  );

  const sorted = useMemo(
    () => [...activities].sort((a, b) => a.title.localeCompare(b.title)),
    [activities]
  );
  const trimmed = query.trim();
  const filtered = useMemo(
    () => (trimmed ? sorted.filter((a) => matchesActivitySearch(a, trimmed)) : sorted),
    [sorted, trimmed]
  );
  const selectedActivity = sorted.find((a) => a.id === activityId) ?? null;
  const hasExactMatch = useMemo(
    () => Boolean(trimmed) && sorted.some((a) => a.title.trim().toLowerCase() === trimmed.toLowerCase()),
    [sorted, trimmed]
  );

  const listRef = useRef<HTMLDivElement | null>(null);

  // Option steps ride the active camp's snap grid (see the fork source for the
  // full rationale — anchored first option, current-value injection).
  const startChoices = useMemo(() => {
    const options: { value: number; label: string }[] = [];
    const first = Math.max(dayWindow.startMin, snapMinutes(dayWindow.startMin, snap));
    for (let m = first; m < dayWindow.endMin; m += snap) {
      options.push({ value: m, label: formatClock(m) });
    }
    if (!options.some((option) => option.value === startMin)) {
      options.push({ value: startMin, label: formatClock(startMin) });
      options.sort((a, b) => a.value - b.value);
    }
    return options;
  }, [dayWindow, startMin, snap]);

  // A 0-min length IS a reminder — "No end time" on the End pill, no separate
  // toggle; the when-line then reads as a single time.
  const isReminder = !allDay && durationMin === 0;
  const REMINDER_END = -1;
  const endChoices = useMemo(() => {
    const options: { value: number; label: string }[] = [{ value: REMINDER_END, label: "No end time" }];
    for (let m = startMin + snap; m <= dayWindow.endMin; m += snap) {
      options.push({ value: m, label: formatClock(m) });
    }
    const end = Math.min(MINUTES_PER_DAY, startMin + durationMin);
    if (end > startMin && !options.some((option) => option.value === end)) {
      options.push({ value: end, label: formatClock(end) });
      options.sort((a, b) => (a.value === REMINDER_END ? -1 : b.value === REMINDER_END ? 1 : a.value - b.value));
    }
    return options;
  }, [dayWindow, startMin, durationMin, snap]);
  const moveStart = (next: number) => {
    setStartMin(next);
    if (next + durationMin > MINUTES_PER_DAY) setDurationMin(MINUTES_PER_DAY - next);
  };
  const lastDurationRef = useRef(draft.durationMin || 30);
  const setEnd = (next: number) => {
    if (next === REMINDER_END) {
      if (durationMin > 0) lastDurationRef.current = durationMin;
      setDurationMin(0);
      return;
    }
    setDurationMin(Math.max(snap, next - startMin));
  };
  const draftIsReminder = !draft.allDay && draft.durationMin === 0;
  const clampedEnd = Math.min(MINUTES_PER_DAY, startMin + durationMin);

  // Same-day kit conflict heads-up — informational, never blocking.
  const conflictWarning = useMemo((): string => {
    const activityId = selectedActivity?.id;
    if (!activityId || allDay || isReminder) return "";
    const candidateId = draft.id ?? "__quickadd_candidate__";
    const candidate: CalendarEvent = {
      id: candidateId,
      date,
      startMin,
      endMin: clampedEnd,
      kind: "activity",
      title: selectedActivity.title,
      activityId,
      updatedAt: 0,
    };
    const others = dayEvents.filter((event) => event.date === date && event.id !== candidateId);
    const day = dayKit([...others, candidate], byId, kitStock, materialCatalog);
    const conflicts = conflictsForEvent(day, candidateId);
    if (!conflicts.length) return "";
    const clash = conflicts[0];
    const otherId = clash.eventIds.find((id) => id !== candidateId);
    const other = otherId ? dayEvents.find((event) => event.id === otherId) : undefined;
    const otherTitle = other?.title || "another block";
    const otherAt = other ? " at " + formatClock(other.startMin) : "";
    return clash.label + " is also needed by " + otherTitle + otherAt;
  }, [
    selectedActivity,
    allDay,
    isReminder,
    draft.id,
    date,
    startMin,
    clampedEnd,
    dayEvents,
    byId,
    kitStock,
    materialCatalog,
  ]);
  // Slot posture shows the gesture's when read-only in the header.
  const timeLabel = draftIsReminder
    ? formatClock(draft.startMin)
    : draft.allDay
      ? "All day"
      : draft.explicitDuration
        ? formatClock(draft.startMin) +
          " – " +
          formatClock(Math.min(MINUTES_PER_DAY, draft.startMin + draft.durationMin))
        : formatClock(draft.startMin);

  const valid = selectedActivity ? true : Boolean(trimmed);
  const showList = changingActivity || (!isEdit && Boolean(trimmed));
  const showSuggestions = changingActivity || !isEdit;
  const canCreateNew = !isEdit && Boolean(trimmed) && (!addToLibrary || !hasExactMatch);

  function clampedRule(): RecurrenceRule | undefined {
    return recurrence ? { ...recurrence, until: recurrence.until < date ? date : recurrence.until } : undefined;
  }

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
      pinned: draft.pinned,
    };
  }

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
      pinned: draft.pinned,
    };
  }

  function chooseActivity(activity: Activity) {
    if (!pickTime) {
      if (recurrence) onSave(activityDraft(activity));
      else onPickActivity(activity);
      return;
    }
    if (activity.id === activityId) {
      setActivityId("");
      return;
    }
    setActivityId(activity.id);
    setChangingActivity(false);
    if (!isEdit && !draft.explicitDuration && activity.durationMin) setDurationMin(activity.durationMin);
  }

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

  function save() {
    if (!valid) return;
    if (selectedActivity) onSave(activityDraft(selectedActivity));
    else if (!isEdit) commitNew();
    else onSave(customDraft(trimmed));
  }

  const promoteExactMatch = useMemo(() => {
    const title = (trimmed || draft.title).trim().toLowerCase();
    if (!title) return null;
    return sorted.find((a) => a.title.trim().toLowerCase() === title) ?? null;
  }, [sorted, trimmed, draft.title]);

  function promoteToLibrary() {
    const title = trimmed || draft.title;
    if (!title) return;
    if (promoteExactMatch) {
      onSave(activityDraft(promoteExactMatch));
      return;
    }
    const activity = onCreateActivity(title, isReminder ? 0 : durationMin);
    if (!activity) return; // staff gate blocked it
    onSave(activityDraft(activity));
  }

  const searching = changingActivity || (!isEdit && addToLibrary);
  const searchPlaceholder = changingActivity
    ? "Search activities"
    : isEdit
      ? "Event name"
      : searching
        ? "Search the library or name an event"
        : "Name this event";

  // The closed disclosure's state echo — what's already true about this event,
  // legible without opening anything (the calm twin of the fork source's
  // read-only summary rows).
  const moreSummary = [
    color ? "color" : null,
    locations.length ? formatLocations(locations) : null,
    recurrence ? summarizeRecurrence(recurrence) : null,
    note.trim() ? "note" : null,
    backupAlternates.length
      ? backupAlternates.length + (backupAlternates.length === 1 ? " backup" : " backups")
      : null,
    !isEdit && addToLibrary ? "saves to library" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // The immediate edit-posture actions (Duplicate/Pin/Apply/Reset/promote) live
  // at the disclosure's end under a small-caps ACTIONS label — secondary depth,
  // one honest layer down, never a second popup.
  const hasActions =
    isEdit &&
    Boolean(
      !selectedActivity ||
        onDuplicate ||
        (onTogglePin && !allDay) ||
        onApplyFollowing ||
        onApplyAll ||
        onResetOccurrence
    );

  const searchAndList = (
    <>
      {/* Enter takes the top match — same commit rules as the fork source. */}
      <form
        className="quickadd__searchform"
        onSubmit={(e) => {
          e.preventDefault();
          if (!trimmed) return;
          if (!isEdit && !addToLibrary) {
            commitNew();
            return;
          }
          if (filtered.length > 0) chooseActivity(filtered[0]);
          else if (!isEdit) commitNew();
          else if (pickTime) save();
        }}
      >
        <label
          className={
            "searchfield searchfield--content quickadd__search" + (searching ? "" : " searchfield--name")
          }
        >
          {searching && <CampIcon.Search />}
          <input
            id="quickadd-search"
            className="searchfield__input"
            data-autofocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searching ? "Search the library or name an event" : "Event name"}
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
      </form>
      {showList && (
        <div className="quickadd__list" ref={listRef}>
          {showSuggestions &&
            filtered.map((activity) => {
              const on = pickTime && activity.id === activityId;
              const cov = coverage(activity, kitStock, materialCatalog);
              const showDot = cov.state === "almost" || cov.state === "cant";
              const missingTitle = showDot
                ? "Missing: " + cov.missing.map((m) => m.label).join(", ")
                : undefined;
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
                  {showDot && (
                    <span
                      className={"quickadd__cov quickadd__cov--" + (cov.state === "almost" ? "almost" : "cant")}
                      title={missingTitle}
                      aria-hidden="true"
                    />
                  )}
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
      {!isEdit && !pickTime && !trimmed && (
        <p className="quickadd__prompt">
          Search to place a library activity — or type a name for a one-off.
        </p>
      )}
    </>
  );

  // The persistent create control (does a typed name join the library?) — in C
  // it lives INSIDE the More disclosure, both postures, so the default face
  // stays two-beat. The closed summary echoes it when switched on.
  const modeRow = !isEdit ? (
    <label className="quickadd__mode lc-qa__mode">
      {/* Leading glyph fills the same 20px icon column the PropRows use, so the
          unboxed row reads as one of them (the border went with the box — the
          switch is the pressable object here). */}
      <span className="prop-row__ic lc-qa__modeic" aria-hidden="true">
        <CampIcon.BookOpen />
      </span>
      <span className="quickadd__mode-text">
        <span className="quickadd__mode-label">Save to library</span>
        <span className="quickadd__mode-hint">
          {addToLibrary ? "A new name becomes a reusable activity" : "A new name stays on the calendar only"}
        </span>
      </span>
      <ToggleSwitch on={addToLibrary} onChange={setAddToLibrary} ariaLabel="Save a new entry to the library" />
    </label>
  ) : null;

  return (
    <FocusSheet
      label={isEdit ? "Edit event" : "Add to calendar"}
      onClose={onClose}
      overlayClass="overlay--card overlay--quickadd lc-sheet lc-sheet--qa"
      title={
        pickTime ? (
          <span className="lc-label lc-sheet__eyebrow">{isEdit ? "Edit event" : "Add to calendar"}</span>
        ) : (
          <span className="quickadd__when">
            <span className="quickadd__date">{formatEventDateLabel(draft.date)}</span>
            <span className="quickadd__time">{timeLabel}</span>
          </span>
        )
      }
      footStart={
        pickTime && isEdit && (onDelete || onDeleteSeries) ? (
          <>
            {onDelete && (
              <button type="button" className="lc-del" onClick={onDelete} title="Delete this event">
                <CampIcon.Trash />
                Delete
              </button>
            )}
            {/* The series-wide hatch — opens the this/following/all scope
                dialog, same as the fork source's footer action. */}
            {onDeleteSeries && (
              <button
                type="button"
                className="lc-del"
                onClick={onDeleteSeries}
                title="Delete the entire series…"
              >
                <CampIcon.Trash />
                Delete series…
              </button>
            )}
          </>
        ) : undefined
      }
      footEnd={
        pickTime ? (
          <button type="button" className="btn btn--primary quickadd__save" disabled={!valid} onClick={save}>
            <CampIcon.Check />
            {isEdit ? "Save" : isReminder ? "Add reminder" : "Add to calendar"}
          </button>
        ) : undefined
      }
    >
      <div className="quickadd lc-qa">
        <h2 className="sr-only">{isEdit ? "Edit event" : "Add to calendar"}</h2>
        {isEdit && selectedActivity && !changingActivity ? (
          // The library-backed event's read-only title block — navigates to the
          // run sheet via the app's stretched-card convention (fork source).
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
            {onOpenActivity && (
              <button
                type="button"
                className="quickadd__act-open stretch"
                aria-label={"Open run list for " + selectedActivity.title}
                onClick={onOpenActivity}
              />
            )}
            <div className="quickadd__act-links">
              {onOpenActivity && (
                <span className="quickadd__act-link quickadd__act-link--static" aria-hidden="true">
                  <CampIcon.BookOpen />
                  Open Run List
                </span>
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
          searchAndList
        )}

        {conflictWarning && (
          <p className="quickadd__conflict" role="status">
            <span aria-hidden="true">⚠</span> {conflictWarning}
          </p>
        )}

        {pickTime && (
          <div className="lc-qa__schedule">
            {/* THE WHEN-LINE — one compact pill sentence. The End pill still
                carries "No end time" (a 0-min reminder), so the sentence
                collapses to a single time exactly like the fork source. */}
            <div className="lc-when">
              <DatePopover id="quickadd-date" value={date} onChange={(next) => setDate(next)} ariaLabel="Event date" />
              {!allDay && (
                <>
                  <Select
                    id="quickadd-start"
                    value={startMin}
                    options={startChoices}
                    onChange={moveStart}
                    ariaLabel={isReminder ? "Reminder time" : "Event start time"}
                  />
                  <span className="quickadd__timedash" aria-hidden="true">–</span>
                  <Select
                    id="quickadd-end"
                    value={isReminder ? REMINDER_END : clampedEnd}
                    options={endChoices}
                    onChange={setEnd}
                    ariaLabel="Event end time"
                  />
                  {!isReminder && <span className="quickadd__timelen">{formatDuration(durationMin)}</span>}
                </>
              )}
              {!isReminder && (
                <span className="lc-when__allday">
                  <span className="lc-when__alldaylbl">All day</span>
                  <ToggleSwitch on={allDay} onChange={setAllDay} ariaLabel="All day" />
                </span>
              )}
            </div>

            {/* MORE OPTIONS — the one honest disclosure. Controlled: the open
                state auto-derives from the draft's contents (see moreOpen). */}
            <Disclosure
              className="lc-qa__more lc-rule"
              title="More options"
              summary={moreSummary}
              open={moreOpen}
              onToggle={() => setMoreOpen((o) => !o)}
            >
                  <div className="proplist quickadd__settings lc-qa__props">
                    {modeRow}
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
                    {!isReminder && (
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
                    <RepeatField
                      value={recurrence}
                      startDate={date}
                      onChange={setRecurrence}
                      onRestoreSkip={onRestoreSkip}
                    />
                    {!isReminder && !allDay && onRecoverTime && (
                      <PropRow icon={CampIcon.Clock} label="Recover time">
                        <span className="quickadd__recover">
                          <button type="button" className="quickadd__recover-btn" onClick={() => onRecoverTime(true)}>
                            Running long
                          </button>
                          <button type="button" className="quickadd__recover-btn" onClick={() => onRecoverTime(false)}>
                            Shift day
                          </button>
                        </span>
                      </PropRow>
                    )}
                    <PropRow icon={CampIcon.Note} label="Day note" className="prop-row--top quickadd__noterow">
                      <textarea
                        id="quickadd-note"
                        className="input quickadd__note"
                        rows={2}
                        maxLength={280}
                        placeholder={
                          isReminder
                            ? "What's the nudge? e.g. switch the laundry"
                            : "Shows on the run sheet — e.g. use the back field"
                        }
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                      />
                    </PropRow>
                    {!isReminder && onSwapBackup && (
                      <PropRow icon={BackupGlyph} label="Backup plans" className="prop-row--top quickadd__backuprow">
                        <div className="quickadd__backups">
                          {backupAlternates.length ? (
                            <ul className="quickadd__backuplist">
                              {backupAlternates.map((alt, index) => (
                                <li key={index} className="quickadd__backup">
                                  <span className="quickadd__backup-title">{alt.title}</span>
                                  {alt.reason === "rain" && <span className="quickadd__backup-tag">rain</span>}
                                  <button
                                    type="button"
                                    className="btn btn--quiet btn--sm quickadd__backup-swap"
                                    onClick={() => onSwapBackup(index)}
                                  >
                                    Swap
                                  </button>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="quickadd__backup-empty">No backup plans for this block.</p>
                          )}
                          <div className="quickadd__backup-acts">
                            {onEditBackups && (
                              <button type="button" className="quickadd__backup-btn" onClick={onEditBackups}>
                                {hasOwnBackups ? "Editing backups for this day" : "Edit backups…"}
                              </button>
                            )}
                            {onClearBackups && backupAlternates.length > 0 && (
                              <button type="button" className="quickadd__backup-btn" onClick={onClearBackups}>
                                No backups for this day
                              </button>
                            )}
                          </div>
                        </div>
                      </PropRow>
                    )}
                  </div>
                  {hasActions && (
                    <div className="lc-qa__actions lc-rule">
                      <span className="lc-label lc-qa__actionslbl">Actions</span>
                      {isEdit && !selectedActivity && promoteExactMatch && (
                        <p className="quickadd__tolib-warn" role="status">
                          “{promoteExactMatch.title}” is already in the library — Add to library will link
                          this event to it instead of creating a duplicate.
                        </p>
                      )}
                      <div className="lc-qa__actionrow">
                        {isEdit && !selectedActivity && (
                          <button type="button" className="btn btn--ghost quickadd__tolib-btn" onClick={promoteToLibrary}>
                            <CampIcon.Bookmark />
                            Add to library
                          </button>
                        )}
                        {onDuplicate && (
                          <button type="button" className="btn btn--ghost quickadd__dup" onClick={onDuplicate}>
                            <CampIcon.Copy />
                            Duplicate
                          </button>
                        )}
                        {onTogglePin && !allDay && (
                          <button type="button" className="btn btn--ghost quickadd__pin" onClick={onTogglePin}>
                            <PinGlyph />
                            {pinned ? "Unpin" : "Pin in place"}
                          </button>
                        )}
                        {onApplyFollowing && (
                          <button type="button" className="btn btn--ghost quickadd__applyfrom" onClick={onApplyFollowing}>
                            <CampIcon.Repeat />
                            Apply from here on
                          </button>
                        )}
                        {onApplyAll && (
                          <button type="button" className="btn btn--ghost quickadd__applyall" onClick={onApplyAll}>
                            <CampIcon.Repeat />
                            Apply to all
                          </button>
                        )}
                        {onResetOccurrence && (
                          <button type="button" className="btn btn--ghost quickadd__resetocc" onClick={onResetOccurrence}>
                            <CampIcon.Reset />
                            Reset to series
                          </button>
                        )}
                      </div>
                    </div>
                  )}
            </Disclosure>
          </div>
        )}

        {/* Slot posture: the gesture already chose the when and the list is the
            commit, but the save-to-library choice must stay reachable — same
            disclosure grammar, holding only that one row. */}
        {!pickTime && !isEdit && (
          <div className="lc-qa__slotmore lc-rule">
            <Disclosure
              title="More options"
              summary={addToLibrary ? "saves to library" : "calendar only"}
            >
              {modeRow}
            </Disclosure>
          </div>
        )}
      </div>
    </FocusSheet>
  );
}

// A small inline umbrella for the "Backup plans" axis row (icons.tsx owns the
// shared set and has no umbrella; drawn on the set's 24×24 grid).
function BackupGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path d="M12 3v2M4 12a8 8 0 0 1 16 0z" />
      <path d="M12 12v6a2.2 2.2 0 0 1-4.4 0" />
    </svg>
  );
}

// A small inline pushpin for "Pin in place" / "Unpin" (CampIcon.Pin is the
// location MAP-pin — semantically wrong here).
function PinGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 4h6l-1 5 3 3v2H7v-2l3-3-1-5z" />
      <path d="M12 17v3" />
    </svg>
  );
}
