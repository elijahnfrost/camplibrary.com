// Pure reducers behind the Staff dashboard's usage stats. Lifted out of the
// component so the derivation RULES are testable and never drift. Everything
// here is read-only over data the app already syncs — there is no new data
// model and no mutation:
//   · usage frequency = how many calendar PLACEMENTS reference each activity
//     (events grouped by activityId). We deliberately label this "times
//     scheduled", NOT "times run" — actual run completion isn't tracked.
//   · notes made      = the dated field-note blocks/children captured across
//     every saved Run List override (the only place captured notes persist).
//   · recent activity = the most recently touched events (event.updatedAt, epoch
//     ms) merged with dated field notes (fieldnote.at, day-granular ISO date)
//     into one reverse-chronological feed.

import type { CalendarEvent } from "./calendar/types";
import type { RunDoc } from "./runList";
import type { Activity } from "./types";

// ---- usage frequency --------------------------------------------------------

export interface UsageRow {
  activityId: string;
  /** Resolved title (falls back to a denormalized event title, then "Untitled"). */
  title: string;
  /** Category for the tint/monogram, when the activity is known. */
  type: Activity["type"] | null;
  /** Times this activity is placed on the calendar in scope. */
  count: number;
}

/**
 * Count how many calendar events reference each activity, ranked most-scheduled
 * first (ties broken alphabetically by title for a stable order). Custom events
 * with no activityId are ignored — they aren't library activities. `byId`
 * supplies the canonical title/type; an event whose activity was deleted still
 * counts, using its denormalized event title.
 */
export function usageByActivity(
  events: Record<string, CalendarEvent>,
  byId: Record<string, Activity>
): UsageRow[] {
  const counts = new Map<string, number>();
  const fallbackTitle = new Map<string, string>();
  for (const event of Object.values(events)) {
    const id = event.activityId;
    if (!id) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
    if (!fallbackTitle.has(id) && event.title) fallbackTitle.set(id, event.title);
  }

  const rows: UsageRow[] = [];
  for (const [activityId, count] of counts) {
    const activity = byId[activityId];
    rows.push({
      activityId,
      title: activity?.title || fallbackTitle.get(activityId) || "Untitled",
      type: activity?.type ?? null,
      count,
    });
  }
  rows.sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));
  return rows;
}

/** Total calendar placements across all activities (excludes custom blocks). */
export function totalPlacements(rows: UsageRow[]): number {
  return rows.reduce((sum, row) => sum + row.count, 0);
}

// ---- field notes ------------------------------------------------------------

export interface NoteEntry {
  /** Activity the note was captured against. */
  activityId: string;
  /** Resolved activity title (falls back to the id when unknown). */
  activityTitle: string;
  /** The note's text. */
  text: string;
  /** ISO date (YYYY-MM-DD), day-granular, when present. */
  at?: string;
}

// A captured field note is one that actually carries text — an empty composer
// row left in a saved doc isn't a "note made". Both RunBlock and RunChild carry
// fieldnote text + an optional `at`, so this reads the common shape.
function isCapturedNote(node: { type: string; text?: string }): boolean {
  return node.type === "fieldnote" && Boolean((node.text || "").trim());
}

// Collect every captured field note from one run doc (top-level fieldnote
// blocks and any fieldnote children tucked under a block).
function notesFromDoc(doc: RunDoc): Array<{ text: string; at?: string }> {
  const out: Array<{ text: string; at?: string }> = [];
  for (const block of doc.blocks) {
    if (isCapturedNote(block)) out.push({ text: (block.text || "").trim(), at: block.at });
    for (const child of block.children || []) {
      if (isCapturedNote(child)) out.push({ text: (child.text || "").trim(), at: child.at });
    }
  }
  return out;
}

/**
 * Walk every saved Run List override and collect captured field notes, newest
 * first (notes with no date sort last). Only overrides hold captured notes — a
 * built-in activity's default doc has an empty notes block — so reading the
 * override map directly is both correct and lean. `byId` resolves titles.
 */
export function fieldNotesFromRunLists(
  runLists: Record<string, RunDoc>,
  byId: Record<string, Activity>
): NoteEntry[] {
  const entries: NoteEntry[] = [];
  for (const [activityId, doc] of Object.entries(runLists)) {
    if (!doc) continue;
    const activity = byId[activityId];
    for (const note of notesFromDoc(doc)) {
      entries.push({
        activityId,
        activityTitle: activity?.title || activityId,
        text: note.text,
        at: note.at,
      });
    }
  }
  entries.sort((a, b) => {
    if (a.at && b.at) return b.at.localeCompare(a.at);
    if (a.at) return -1;
    if (b.at) return 1;
    return 0;
  });
  return entries;
}

/** Number of distinct activities that carry at least one captured field note. */
export function activitiesWithNotes(entries: NoteEntry[]): number {
  return new Set(entries.map((e) => e.activityId)).size;
}

// ---- recent activity feed ---------------------------------------------------

export type RecentKind = "event" | "note";

export interface RecentItem {
  kind: RecentKind;
  /** Sort key in epoch ms (events use updatedAt; notes parse `at` at local noon). */
  ts: number;
  /** Primary line (event/activity title). */
  title: string;
  /** Secondary descriptor: the calendar date for an event, the note text for a note. */
  detail: string;
}

// Parse a day-granular ISO date ("YYYY-MM-DD") to epoch ms at local noon, so it
// orders sensibly against event timestamps without timezone edge wobble. NaN
// guards keep a malformed value from poisoning the sort.
function isoDateToTs(iso: string | undefined): number | null {
  if (!iso) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const ts = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12).getTime();
  return Number.isFinite(ts) ? ts : null;
}

/**
 * A unified, reverse-chronological feed of recent staff activity: calendar
 * events keyed by their last-write `updatedAt`, merged with captured field
 * notes keyed by their capture date. Trimmed to `limit`. Pure — the caller
 * formats the timestamps for display.
 */
export function recentActivity(
  events: Record<string, CalendarEvent>,
  notes: NoteEntry[],
  limit = 6
): RecentItem[] {
  const items: RecentItem[] = [];

  for (const event of Object.values(events)) {
    if (!event.updatedAt) continue;
    items.push({
      kind: "event",
      ts: event.updatedAt,
      title: event.title || "Untitled block",
      detail: event.date,
    });
  }

  for (const note of notes) {
    const ts = isoDateToTs(note.at);
    if (ts == null) continue;
    items.push({
      kind: "note",
      ts,
      title: note.activityTitle,
      detail: note.text,
    });
  }

  items.sort((a, b) => b.ts - a.ts);
  return items.slice(0, limit);
}

// ---- relative time ----------------------------------------------------------

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * A compact, locale-neutral "time ago" label for the feed ("just now", "3h
 * ago", "yesterday", "5d ago", then an absolute month/day past a week). `now`
 * is injectable so the reducer stays deterministic under test.
 */
export function relativeTime(ts: number, now: number = Date.now()): string {
  const delta = now - ts;
  if (delta < MINUTE) return "just now";
  if (delta < HOUR) {
    const m = Math.floor(delta / MINUTE);
    return m + "m ago";
  }
  if (delta < DAY) {
    const h = Math.floor(delta / HOUR);
    return h + "h ago";
  }
  const days = Math.floor(delta / DAY);
  if (days === 1) return "yesterday";
  if (days < 7) return days + "d ago";
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
