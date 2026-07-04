"use client";

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
  /** The effective 3-state kit stock map (material id → have/low/out). Drives
   *  an INFORMATIONAL coverage dot on the search rows; empty ({}) = UNSET = no
   *  dot. Never filters or blocks the create path. Safe default so other hosts
   *  compile unchanged. */
  kitStock?: Record<string, StockState>;
  /** The materials catalog — substitution groups + names for the coverage dot. */
  materialCatalog?: Material[];
  /** The day's existing events (all days is fine — we filter to the draft date),
   *  used to warn when the current draft would create a same-day kit conflict.
   *  Safe default [] so other hosts compile unchanged; empty = no warning. */
  dayEvents?: CalendarEvent[];
  /** activityId → Activity, so the conflict probe can resolve each event's kit. */
  byId?: Record<string, Activity>;
  window: DayWindow;
  /** The active camp's snap grid (5/10/15/30). Drives the start/end/length option
   *  steps so the editor offers the same grid placement/editing snaps to. Default
   *  keeps the classic 15-min grid for hosts that don't configure a per-camp snap. */
  snap?: number;
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
  /** quickadd-2: open the this/following/all scope dialog directly from the
   *  sheet's footer, for a series member — the same "Delete entire series…"
   *  safety hatch the context menu offers, reachable without closing the sheet
   *  and right-clicking. Absent = not a series member (the plain Delete button
   *  above already covers a one-off event completely). */
  onDeleteSeries?: () => void;
  /** Copy this event (edit posture only) — the single-event action that used to
   *  live on the now-retired click popover, so touch (no right-click) keeps it. */
  onDuplicate?: () => void;
  /** Jump to this activity event's run list (activity-backed edits only) — the
   *  other action the click popover carried; now reachable from the editor. */
  onOpenActivity?: () => void;
  /** Pin / unpin this event in place (edit posture only). An IMMEDIATE action —
   *  it commits instantly through CalendarShell's series-wide path and does NOT
   *  close the sheet, so it never routes through the draft/save/scope machinery.
   *  The touch surface for pinning (right-click doesn't fire on a tap). */
  onTogglePin?: () => void;
  /** Whether this event is currently pinned (drives the footer label). */
  pinned?: boolean;
  /** Durable recurrence escalation (edit posture, a THIS-customized series member
   *  only): apply this occurrence's overrides to the whole series / from here on,
   *  or reset it back to a plain series member. All IMMEDIATE — they commit
   *  through CalendarShell and close the sheet, so they sit among the footer
   *  actions, not the draft controls. Absent on plain events / non-customized
   *  members (the touch twin of the right-click escalation items). */
  onApplyAll?: () => void;
  onApplyFollowing?: () => void;
  onResetOccurrence?: () => void;
  /** Restore a skipped occurrence from the RepeatField's "Skipped dates" ledger
   *  (edit posture, a series member). Wired to CalendarShell's restore path;
   *  IMMEDIATE + closes the sheet. Absent = no skips / not a series member. */
  onRestoreSkip?: (date: DateKey) => void;
  /** Open the day-shift card for this event (edit posture, timed non-reminder).
   *  `extend` true = "Running long" (grow this end + slide the rest); false =
   *  "Shift day from here". Closes the sheet first, then opens the bar. */
  onRecoverTime?: (extend: boolean) => void;
  /** The placement's RESOLVED backup plans (event override ?? activity default) —
   *  shown as compact rows in edit posture with a per-row [Swap]. Absent/empty =
   *  no backups on file. Display-only; the actions below mutate through
   *  CalendarShell (IMMEDIATE, like Pin). */
  backupAlternates?: AlternateRef[];
  /** Swap this placement to backup #index — the self-inverse promote (IMMEDIATE,
   *  closes the sheet). Absent = no swap wired (read-only surface). */
  onSwapBackup?: (index: number) => void;
  /** Copy the resolved list onto THIS placement (copy-on-write) so it can be
   *  edited per-day — the "Edit backups…" affordance. IMMEDIATE. */
  onEditBackups?: () => void;
  /** Write an authoritative empty list on THIS placement — "No backups for this
   *  day". IMMEDIATE. */
  onClearBackups?: () => void;
  /** Whether this placement already carries its OWN backup override (so the footer
   *  reads "Editing backups for this day" rather than "Edit backups…"). */
  hasOwnBackups?: boolean;
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
  // "More options" — the ONE inline expansion holding everything besides Date/
  // Time (All day, Color, Location, Repeat, Recover time, Day note, Backup
  // plans): see the audit brief's default-face rule. Starts CLOSED — anything
  // already set still shows as a compact read-only summary row on the default
  // face (below), so nothing important goes invisible; opening the section is
  // only needed to CHANGE something, not to see it.
  const [moreOpen, setMoreOpen] = useState(false);

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

  // The option steps ride the active camp's snap grid, so the editor offers the
  // same times placement/editing snaps to. The grid is anchored to a snapped
  // start so a half-hour camp window still lists clock-aligned options, and the
  // current value is INJECTED when a stored off-grid time isn't in the list (the
  // standard current-value injection rule) so a legacy event stays representable.
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

  // A 0-min length IS a reminder — it shows just a start time, no range. There
  // is no separate "Reminder" toggle (removed — see the End-choices sentinel
  // below): a reminder is simply what you get by picking "No end time" for the
  // End control, and the time row itself then reads as a single time instead of
  // a range, which IS the reminder-ness made visible, per the audit brief.
  const isReminder = !allDay && durationMin === 0;
  // A sentinel End-choice value meaning "no end time" (durationMin 0, a
  // reminder). Distinct from every real end-time value, which is always
  // startMin + snap or later (>= 1) — so -1 can never collide with a real
  // clock minute.
  const REMINDER_END = -1;
  // End-time choices mirror the start grid, from one snap past the start to the
  // end of the day, PLUS the reminder sentinel as the first option (so "make
  // this a point in time" is just the top of the same list, not a separate
  // control). The END is the live control now; LENGTH is derived from it
  // (end − start) and shown only as a faint hint — "important to have, not to
  // see." Changing the end sets the duration; changing the start shifts the end.
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
  // Move the start but keep the block's length (the end rides along), clamped so
  // it can't spill past midnight.
  const moveStart = (next: number) => {
    setStartMin(next);
    if (next + durationMin > MINUTES_PER_DAY) setDurationMin(MINUTES_PER_DAY - next);
  };
  // Remembers the last real (non-zero) length, so picking "No end time" then
  // picking a real end again restores a sensible block instead of a 1-snap
  // sliver — the same round-trippability the old Reminder toggle gave, now
  // folded into the End control itself (no separate toggle row).
  const lastDurationRef = useRef(draft.durationMin || 30);
  // Set the end → that defines the length. The sentinel means "no end time"
  // (durationMin 0, a reminder); any real value clamps to at least one snap.
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

  // Same-day kit conflict for the CURRENT draft: a quiet, informational heads-up
  // (never blocking) shown when placing this activity at this date + time would
  // fight another block for the same material. Computed by running dayKit over the
  // day's existing events PLUS a synthetic candidate for the draft. Only timed,
  // activity-backed, non-reminder drafts can conflict; everything else is empty.
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

  // Build the draft an existing-activity commit saves. `pinned` rides the draft
  // (an immediate footer action, not an editor control).
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
      pinned: draft.pinned,
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

  // quickadd-14: the exact library match (if any) for the title promoteToLibrary
  // would act on — drives the inline warning below the footer's "Add to library"
  // button so the link-instead-of-duplicate outcome is visible BEFORE the click,
  // not just baked silently into promoteToLibrary's behavior.
  const promoteExactMatch = useMemo(() => {
    const title = (trimmed || draft.title).trim().toLowerCase();
    if (!title) return null;
    return sorted.find((a) => a.title.trim().toLowerCase() === title) ?? null;
  }, [sorted, trimmed, draft.title]);

  // Editing a calendar-only event: add it to the library after the fact (when
  // "Save to library" was off at creation). Creates the reusable activity and
  // links this placement to it, so the event becomes activity-backed.
  //
  // quickadd-14: this used to call onCreateActivity unconditionally, with no
  // exact-match guard — unlike the create path's canCreateNew (which suppresses
  // "Add as new" when the typed name already matches a library title). A custom
  // event coincidentally titled the same as an existing activity (e.g. "Capture
  // the Flag") would silently mint a SECOND, duplicate library entry instead of
  // linking to the existing one. Mirrors the create flow's existing guard: when
  // the title exactly matches a library activity, promoting LINKS to that
  // activity instead of minting a duplicate.
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
          // surface. Activity-owned properties (type/ages/energy/prep/materials/
          // steps) are NEVER edited here — this card is read-only and NAVIGATES
          // to the run sheet (the same "Open Run List" path), so it must LOOK
          // interactive rather than like static text. It reuses the app's own
          // stretched-card convention (the deck/catalog book cards: a full-card
          // .stretch overlay button + a sibling secondary control layered above),
          // not a new hover language. "Change activity" stays a quiet secondary
          // link, sitting above the stretch overlay via z-index so it's still
          // its own click target.
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
              <label
                className={
                  "searchfield searchfield--content quickadd__search" +
                  (searching ? "" : " searchfield--name")
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
                    // An INFORMATIONAL coverage dot: amber when the camp is one
                    // item short, red when it can't run this yet. Nothing for
                    // ready/unset. Never filters — the row is always pickable.
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
                            className={
                              "quickadd__cov quickadd__cov--" + (cov.state === "almost" ? "almost" : "cant")
                            }
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

        {/* A quiet, informational same-day kit conflict heads-up — never blocks
            the create; it just names the block this draft would fight for a
            material. Sits under the list / name section for both postures. */}
        {conflictWarning && (
          <p className="quickadd__conflict" role="status">
            <span aria-hidden="true">⚠</span> {conflictWarning}
          </p>
        )}

        {pickTime && (
          <div className="quickadd__schedule">
            {/* The schedule is a PROPERTY LIST — the shared "Notion lines" rows
                (icon · muted label · inline control) used across the app, so the
                editor reads in the same vocabulary as the run sheet and filters.
                The live time field is the start–end RANGE; length is derived and
                shown only as a faint hint.
                DEFAULT FACE: title/activity card (above) + Date + Time, plus a
                compact READ-ONLY summary row for anything already set (Color/
                Location/Repeat/Day note) — so "what's already true about
                this event" is visible without opening anything. Everything ELSE
                (All day, Color, Location, Repeat when UNSET, Recover time,
                an EMPTY Day note, Backup plans) lives behind ONE "More options"
                disclosure below, so a plain event's default face stays to two
                rows. There is no separate "Reminder" toggle any more — picking
                "No end time" on the Time row's End control IS how you make this
                a reminder (a 0-min event), and the row then shows just the one
                time instead of a range, which already reads as "this is a
                reminder" per the audit brief. */}
            <div className="proplist quickadd__settings">
              <PropRow icon={CampIcon.Calendar} label="Date">
                <DatePopover
                  id="quickadd-date"
                  value={date}
                  onChange={(next) => setDate(next)}
                  ariaLabel="Event date"
                />
              </PropRow>
              {!allDay && (
                <PropRow icon={CampIcon.Clock} label={isReminder ? "At" : "Time"}>
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
                </PropRow>
              )}
              {/* All-day-events-only compact echo when More options is closed —
                  All day itself lives in More, but a reader should still be able
                  to tell an all-day event apart from a timed one at a glance
                  (and reach the toggle in one tap). */}
              {allDay && !moreOpen && (
                <PropRow icon={CampIcon.Calendar} label="Time">
                  <button type="button" className="quickadd__summarybtn" onClick={() => setMoreOpen(true)}>
                    <span className="quickadd__summaryval">All day</span>
                  </button>
                </PropRow>
              )}
              {/* Compact, read-only summary rows for anything ALREADY SET — shown
                  on the default face even with More options closed, so a glance
                  at the sheet tells you what's already true about this event.
                  Editing still happens inside More options (opening it moves the
                  focus straight to the real control, not a second copy of it). */}
              {isEdit && !moreOpen && color && (
                <PropRow icon={CampIcon.Palette} label="Color">
                  <button type="button" className="quickadd__summarybtn" onClick={() => setMoreOpen(true)}>
                    <span className="quickadd__summarydot" style={{ background: color }} aria-hidden="true" />
                    <span className="quickadd__summaryval">Custom</span>
                  </button>
                </PropRow>
              )}
              {isEdit && !moreOpen && locations.length > 0 && (
                <PropRow icon={CampIcon.Pin} label="Location">
                  <button type="button" className="quickadd__summarybtn" onClick={() => setMoreOpen(true)}>
                    <span className="quickadd__summaryval">{formatLocations(locations)}</span>
                  </button>
                </PropRow>
              )}
              {isEdit && !moreOpen && recurrence && (
                <PropRow icon={CampIcon.Repeat} label="Repeat">
                  <button type="button" className="quickadd__summarybtn" onClick={() => setMoreOpen(true)}>
                    <span className="quickadd__summaryval">{summarizeRecurrence(recurrence)}</span>
                  </button>
                </PropRow>
              )}
              {isEdit && !moreOpen && note.trim() && (
                <PropRow icon={CampIcon.Note} label="Day note" className="prop-row--top">
                  <button type="button" className="quickadd__summarybtn quickadd__summarybtn--note" onClick={() => setMoreOpen(true)}>
                    <span className="quickadd__summaryval">{note}</span>
                  </button>
                </PropRow>
              )}
              {/* ONE "More options" inline expansion — the app's existing
                  disclosure idiom (the Collapsible chevron-header shell used by
                  ListManagerModal's Guidance bands section, same open/close
                  treatment), reused here rather than inventing a
                  new one. Create keeps everything but Date/Time behind it too
                  (a fresh add stays calm); edit shows it once any hidden field
                  is actually set (handled above by the summary rows) but the
                  disclosure itself always offers a way in. */}
              {isEdit && (
                <div className={"quickadd__more" + (moreOpen ? " is-open" : "")}>
                  <button
                    type="button"
                    className="quickadd__more-head"
                    aria-expanded={moreOpen}
                    onClick={() => setMoreOpen((o) => !o)}
                  >
                    <CampIcon.ChevronRight className="quickadd__more-chev" />
                    <span className="quickadd__more-label">More options</span>
                  </button>
                  {moreOpen && (
                    <div className="quickadd__more-body">
                      {!isReminder && (
                        <PropRow icon={CampIcon.Calendar} label="All day">
                          <ToggleSwitch on={allDay} onChange={setAllDay} ariaLabel="All day" />
                        </PropRow>
                      )}
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
                      {/* Repeat: its lead row carries the axis icon, its detail
                          rows indent beneath it. */}
                      <RepeatField
                        value={recurrence}
                        startDate={date}
                        onChange={setRecurrence}
                        onRestoreSkip={onRestoreSkip}
                      />
                      {/* Recover time — the TOUCH door into the day-shift card
                          (right-click isn't available on a tap). Two quiet inline
                          actions: "Running long" (grow this end + slide the rest)
                          and "Shift day" (slide everything from this start). Both
                          close the sheet, then open the bar. Timed non-reminder
                          events only. */}
                      {!isReminder && !allDay && onRecoverTime && (
                        <PropRow icon={CampIcon.Clock} label="Recover time">
                          <span className="quickadd__recover">
                            <button
                              type="button"
                              className="quickadd__recover-btn"
                              onClick={() => onRecoverTime(true)}
                            >
                              Running long
                            </button>
                            <button
                              type="button"
                              className="quickadd__recover-btn"
                              onClick={() => onRecoverTime(false)}
                            >
                              Shift day
                            </button>
                          </span>
                        </PropRow>
                      )}
                      {/* Day note — a named property that bridges to the run
                          sheet. A top-aligned row whose value is the prose field. */}
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
                      {/* Backup plans — the placement's RESOLVED rain/overflow
                          fallbacks (event override ?? activity default), shown as
                          compact rows with a per-row [Swap] (the self-inverse
                          promote). "Edit backups…" copies the resolved list onto
                          THIS day (copy-on-write) so it can diverge; "No backups
                          for this day" writes an authoritative empty list.
                          Non-reminder only. */}
                      {!isReminder && onSwapBackup && (
                        <PropRow icon={BackupGlyph} label="Backup plans" className="prop-row--top quickadd__backuprow">
                          <div className="quickadd__backups">
                            {backupAlternates.length ? (
                              <ul className="quickadd__backuplist">
                                {backupAlternates.map((alt, index) => (
                                  <li key={index} className="quickadd__backup">
                                    <span className="quickadd__backup-title">{alt.title}</span>
                                    {alt.reason === "rain" && (
                                      <span className="quickadd__backup-tag">rain</span>
                                    )}
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
                  )}
                </div>
              )}
            </div>
            {/* "Add to library" ONLY while the draft is an unlinked custom title
                (selectedActivity absent) — hidden once a library match is
                selected, since there's nothing left to promote. quickadd-14: a
                typed title that already matches an existing activity would
                previously mint a silent duplicate; promoteToLibrary now links to
                the exact match instead, and this inline note warns before that
                happens rather than surprising the user after the fact. */}
            {isEdit && !selectedActivity && promoteExactMatch && (
              <p className="quickadd__tolib-warn" role="status">
                “{promoteExactMatch.title}” is already in the library — Add to library will link this
                event to it instead of creating a duplicate.
              </p>
            )}
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
              {/* Pin / unpin — an IMMEDIATE action (it commits instantly through
                  CalendarShell's series-wide path, closing nothing), so it sits in
                  the footer next to Duplicate/Delete, NOT among the draft controls.
                  event-detail-3: shown ONLY for TIMED (non-all-day) events — pin
                  only guards day-shift, which never touches all-day events
                  (lib/calendar/dayShift.ts), so offering it there was a functional
                  no-op with no observable effect. */}
              {isEdit && onTogglePin && !allDay && (
                <button type="button" className="btn btn--ghost quickadd__pin" onClick={onTogglePin}>
                  <PinGlyph />
                  {pinned ? "Unpin" : "Pin in place"}
                </button>
              )}
              {/* Durable recurrence escalation (a THIS-customized series member on
                  touch, where there's no right-click) — immediate, closing the
                  sheet. Only rendered when this occurrence carries overrides. */}
              {isEdit && onApplyFollowing && (
                <button type="button" className="btn btn--ghost quickadd__applyfrom" onClick={onApplyFollowing}>
                  <CampIcon.Repeat />
                  Apply from here on
                </button>
              )}
              {isEdit && onApplyAll && (
                <button type="button" className="btn btn--ghost quickadd__applyall" onClick={onApplyAll}>
                  <CampIcon.Repeat />
                  Apply to all
                </button>
              )}
              {isEdit && onResetOccurrence && (
                <button type="button" className="btn btn--ghost quickadd__resetocc" onClick={onResetOccurrence}>
                  <CampIcon.Reset />
                  Reset to series
                </button>
              )}
              {isEdit && onDelete && (
                <button type="button" className="btn btn--ghost quickadd__delete" onClick={onDelete}>
                  <CampIcon.Trash />
                  Delete
                </button>
              )}
              {/* quickadd-2: Delete on a series member only skips THIS day
                  (instant, with a toast escalation to "Delete following"/"Delete
                  all") — a staffer who opened the sheet specifically to delete the
                  WHOLE series had no way to do that without closing the sheet and
                  right-clicking "Delete entire series…". This quiet secondary
                  action opens that exact same scope-choice dialog directly from
                  here. Only rendered for an existing series member. */}
              {isEdit && onDeleteSeries && (
                <button type="button" className="btn btn--ghost quickadd__deleteseries" onClick={onDeleteSeries}>
                  <CampIcon.Trash />
                  Delete series…
                </button>
              )}
              {/* J5: explicit Save everywhere — no simultaneous "Saving “X”…"
                  status line next to the button (removed; it read as an ambient
                  auto-save in progress when nothing has actually been written
                  yet). Nothing here writes until Save is pressed, EXCEPT the
                  already-documented immediate actions above (Pin, Apply to all/
                  following, Reset to series, Delete, Delete series) and the
                  backups editor's immediate actions (Swap/Edit backups/No backups
                  for this day, in More options) — those are called out at their
                  own definitions as intentionally immediate. */}
              <button type="button" className="btn btn--primary quickadd__save" disabled={!valid} onClick={save}>
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

// A small inline umbrella for the "Backup plans" axis row. icons.tsx is owned
// elsewhere (no umbrella glyph), so it's inlined on the icon set's 24×24 grid.
function BackupGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path d="M12 3v2M4 12a8 8 0 0 1 16 0z" />
      <path d="M12 12v6a2.2 2.2 0 0 1-4.4 0" />
    </svg>
  );
}

// A small inline pushpin for the footer "Pin in place" / "Unpin" action.
// CampIcon.Pin is the location MAP-pin (semantically wrong here), and icons.tsx
// is owned elsewhere, so the pushpin is inlined on the icon set's 24×24 grid.
function PinGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 4h6l-1 5 3 3v2H7v-2l3-3-1-5z" />
      <path d="M12 17v3" />
    </svg>
  );
}
