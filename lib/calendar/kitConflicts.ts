// Same-day kit contention — kept pure so it's unit-tested in isolation
// (CalendarShell wires it to the day-header Gather chip, the Gather popover, and
// the placement warnings). Mirrors stops.ts: one deterministic grouping module,
// no rendering, nothing persisted.
//
// The problem: two blocks on the same day can each need the parachute at times
// that OVERLAP — the camp owns one parachute, so it can't be in two places at
// once. That's a HARD conflict. Softer: a material two blocks both burn through
// on one day (a consumable, or an item stock has flagged "low") — enough of it
// might not be left for the second block. That's a SOFT warning. And the day's
// whole GATHER list — every distinct material the day needs, with its coverage
// status — is the third output, so a chip can summarize the day at a glance.
//
// Everything reads from the SAME resolveRefs / coverage vocabulary the run sheet
// and the library kit filter use, so a material id means the same thing here.

import type { Activity } from "../types";
import type { CalendarEvent } from "./types";
import { type Material } from "../materialCatalog";
import { isStocked, type StockState } from "../kitStock";
import { resolveRefs } from "../materials";

// The coverage status of ONE needed material on the day, reusing the run sheet's
// per-need language: on hand ("have"), thin ("low"), depleted ("out"), covered by
// a stand-in ("substituted", with the substitute's id in viaId), or nowhere to be
// found ("missing" — no own stock and no substitute either).
export type KitItemStatus = "have" | "low" | "out" | "missing" | "substituted";

// One row in the day's gather list: a distinct material the day needs, its
// coverage status, and the events that call for it (ordered, deduped).
export interface DayKitItem {
  id: string;
  label: string;
  status: KitItemStatus;
  /** The catalog id of the stand-in satisfying this need, when status is
   *  "substituted" (so the UI can say "↔ via <name>"). */
  viaId?: string;
  eventIds: string[];
}

// A same-day contention (hard OR soft), naming the material and the events in it.
export interface KitConflict {
  id: string;
  label: string;
  eventIds: string[];
}

export interface DayKit {
  items: DayKitItem[];
  hardConflicts: KitConflict[];
  softWarnings: KitConflict[];
}

// An event contributes kit only when it's a real, timed block backed by an
// activity: a reminder (0-min, endMin === startMin) and an all-day event gather
// nothing (they don't hold materials in space and time), and an event with no
// activityId has no resolvable kit. This is the single gate every path uses.
function contributes(event: CalendarEvent): boolean {
  if (event.allDay) return false;
  if (event.endMin === event.startMin) return false; // 0-min reminder
  return Boolean(event.activityId);
}

// Half-open overlap on [startMin, endMin): two blocks contend only when one
// starts strictly before the other ends AND vice versa — so blocks that merely
// TOUCH (a 10:00–10:30 and a 10:30–11:00) do NOT overlap, matching the calendar's
// exclusive-end convention everywhere else.
function overlaps(a: CalendarEvent, b: CalendarEvent): boolean {
  return a.startMin < b.endMin && b.startMin < a.endMin;
}

// Index the catalog's `plenty` flag by id — an item flagged plenty is never a
// hard conflict (the camp owns enough copies to share across overlaps).
function plentyIds(catalog?: Material[]): Set<string> {
  const set = new Set<string>();
  if (catalog) for (const entry of catalog) if (entry.plenty) set.add(entry.id);
  return set;
}

// Index the catalog's `consumable` flag by id — a consumable needed by two blocks
// is a soft warning (it gets used up; not enough may be left for the second).
function consumableIds(catalog?: Material[]): Set<string> {
  const set = new Set<string>();
  if (catalog) for (const entry of catalog) if (entry.consumable) set.add(entry.id);
  return set;
}

// The substitution groups (id → its stand-in ids), so a need can check whether a
// stand-in is on hand — the SAME lookup coverage() builds.
function substitutesById(catalog?: Material[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  if (catalog) {
    for (const entry of catalog) {
      if (entry.substitutes?.length) map.set(entry.id, entry.substitutes);
    }
  }
  return map;
}

// The coverage status of one need, exactly as coverage() decides it per-need:
// own stock present (have/low), else a stand-in present ("substituted"), else
// "out" when the item is explicitly out of stock, else "missing" (never
// reviewed / no stand-in). When the stock map is UNSET ({}) the lens is inert —
// every need reads "have" so nothing is decorated (a fresh account sees no red).
function needStatus(
  id: string,
  stock: Record<string, StockState>,
  subs: Map<string, string[]>,
  stockUnset: boolean
): { status: KitItemStatus; viaId?: string } {
  if (stockUnset) return { status: "have" };
  const own = stock[id];
  if (own === "have") return { status: "have" };
  if (own === "low") return { status: "low" };
  // Own item out/absent — try substitutes (a "low" stand-in still satisfies).
  const viaId = (subs.get(id) ?? []).find((sub) => isStocked(stock[sub]));
  if (viaId) return { status: "substituted", viaId };
  if (own === "out") return { status: "out" };
  return { status: "missing" };
}

// Deterministic gather list + hard/soft contention for ONE day's events. Pure:
// the same events + stock + catalog always yield the same output, so it's safe to
// call from render (the chip, the popover) and from the placement-warning probes.
//
// `events` need not be pre-filtered to a single day — but in practice callers pass
// one day's events (the conflict rules are same-day by construction). Order of
// the input events doesn't matter; every list is sorted before it's returned.
export function dayKit(
  events: CalendarEvent[],
  byId: Record<string, Activity>,
  stock: Record<string, StockState>,
  catalog?: Material[]
): DayKit {
  const stockUnset = Object.keys(stock).length === 0;
  const plenty = plentyIds(catalog);
  const consumable = consumableIds(catalog);
  const subs = substitutesById(catalog);

  // Only real, timed, activity-backed blocks gather kit — sorted up front so the
  // eventIds lists and the pairwise overlap scan are both deterministic.
  const blocks = events
    .filter(contributes)
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin || a.id.localeCompare(b.id));

  // Per material id: its label (first seen), the events that need it (via EXACT
  // refs — the join key), and whether any of those needs is satisfied ONLY by a
  // substitute (never counts toward a hard conflict — under-warning is the safe
  // failure direction). We resolve each block's refs once.
  const labelById = new Map<string, string>();
  const eventsByNeed = new Map<string, CalendarEvent[]>();
  for (const block of blocks) {
    const activity = byId[block.activityId as string];
    if (!activity) continue;
    for (const ref of resolveRefs(activity, catalog)) {
      if (!labelById.has(ref.id)) labelById.set(ref.id, ref.label);
      const arr = eventsByNeed.get(ref.id);
      if (arr) arr.push(block);
      else eventsByNeed.set(ref.id, [block]);
    }
  }

  // The gather list: one row per distinct need, its coverage status, and the
  // events that call for it. Sorted by label then id so the render order is
  // stable regardless of which block happened to resolve a ref first.
  const items: DayKitItem[] = [];
  for (const [id, needEvents] of eventsByNeed) {
    const { status, viaId } = needStatus(id, stock, subs, stockUnset);
    const item: DayKitItem = {
      id,
      label: labelById.get(id) ?? id,
      status,
      eventIds: needEvents.map((event) => event.id),
    };
    if (viaId) item.viaId = viaId;
    items.push(item);
  }
  items.sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));

  // Hard conflicts: a material needed by two+ blocks whose times OVERLAP, via
  // EXACT refs (a substitute-satisfied need never contends — see above), and not
  // flagged `plenty`. We collect the set of block ids caught in ANY overlapping
  // pair for that material, so three staggered blocks that pairwise overlap all
  // land in one conflict.
  const hardConflicts: KitConflict[] = [];
  for (const [id, needEvents] of eventsByNeed) {
    if (needEvents.length < 2 || plenty.has(id)) continue;
    const caught = new Set<string>();
    for (let i = 0; i < needEvents.length; i += 1) {
      for (let j = i + 1; j < needEvents.length; j += 1) {
        if (overlaps(needEvents[i], needEvents[j])) {
          caught.add(needEvents[i].id);
          caught.add(needEvents[j].id);
        }
      }
    }
    if (caught.size >= 2) {
      // Keep the caught ids in the blocks' chronological order (blocks is sorted).
      const eventIds = blocks.filter((block) => caught.has(block.id)).map((block) => block.id);
      hardConflicts.push({ id, label: labelById.get(id) ?? id, eventIds });
    }
  }
  hardConflicts.sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));

  // Soft warnings: a material needed by two+ blocks on the day (times irrelevant)
  // that's either catalog `consumable` OR currently stock "low" — either way, not
  // enough may be left for the second block. A material can be BOTH a hard
  // conflict and a soft warning (a "low" parachute two overlapping blocks share);
  // the two lists are independent, and the UI pins hard conflicts on top anyway.
  const softWarnings: KitConflict[] = [];
  for (const [id, needEvents] of eventsByNeed) {
    if (needEvents.length < 2) continue;
    const isConsumable = consumable.has(id);
    const isLow = !stockUnset && stock[id] === "low";
    if (!isConsumable && !isLow) continue;
    softWarnings.push({
      id,
      label: labelById.get(id) ?? id,
      eventIds: needEvents.map((event) => event.id),
    });
  }
  softWarnings.sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));

  return { items, hardConflicts, softWarnings };
}

// Does an event participate in ANY hard conflict on its day? A cheap probe over a
// dayKit result, used by the placement-warning paths to compare BEFORE/AFTER a
// drop, resize, or save — a warning fires only when the NEW placement joins a hard
// conflict the OLD one didn't. Returns the conflicting materials (id + label +
// the OTHER events) so the caller can name them.
export function conflictsForEvent(day: DayKit, eventId: string): KitConflict[] {
  return day.hardConflicts.filter((conflict) => conflict.eventIds.includes(eventId));
}
