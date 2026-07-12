// The editor draft model — the intermediate shape the QuickAdd sheet edits, and
// the two conversions between it and a stored CalendarEvent. This is data/logic,
// not UI, so it lives in lib (QuickAdd renders it; CalendarShell.saveDraft
// commits it). Keeping the draft↔event round-trip here — pure and unit-tested —
// is what stops the "added an editor field, forgot to save it" class of bug: a
// field the editor owns must appear in BOTH draftFromEvent and eventFromDraft.
import { endMinForDraft } from "./shellHelpers";
import type { CalendarEvent, DateKey } from "./types";
import type { RecurrenceRule } from "./recurrence";
import type { Activity } from "@/lib/types";

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

// Event → draft: open an existing event in the editor.
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

// Draft → event: build the row a save commits. This is a PATCH over the existing
// row, not a rebuild — `existing` is spread first so fields the editor doesn't
// own (campId, seriesId, future payload) survive; then the editor-owned optionals
// are set OR DELETED, so clearing a field (color/locations/note/pin) actually
// sticks on an edit. `id` and `now` are passed in (not minted here) so the
// function stays pure and the round-trip is testable.
export function eventFromDraft(
  draft: EditorDraft,
  existing: CalendarEvent | undefined,
  activity: Activity | undefined,
  opts: { id: string; now: number }
): CalendarEvent {
  const startMin = draft.allDay ? 0 : draft.startMin;
  const endMin = endMinForDraft(draft.startMin, draft.durationMin, draft.allDay);
  const event: CalendarEvent = {
    ...existing,
    id: opts.id,
    date: draft.date,
    startMin,
    endMin,
    // Trust the draft's activityId: a just-created library activity links here
    // before byId catches up. A dangling ref self-heals to "custom" at render.
    kind: draft.activityId ? "activity" : "custom",
    title: activity?.title ?? draft.title ?? "Untitled",
    updatedAt: opts.now,
  };
  if (draft.activityId) event.activityId = draft.activityId;
  else delete event.activityId;
  if (draft.allDay) event.allDay = true;
  else delete event.allDay;
  if (draft.color) event.color = draft.color;
  else delete event.color;
  if (draft.locations?.length) event.locations = draft.locations;
  else delete event.locations;
  if (draft.note) event.note = draft.note;
  else delete event.note;
  if (draft.pinned) event.pinned = true;
  else delete event.pinned;
  return event;
}
