// Camp Library — the print "Shopping list (missing & low only)" builder.
//
// A narrower read over the materials roll-up: instead of every distinct
// material the printed range needs, list ONLY the ones actually worth buying
// — missing entirely, or on hand but running low. Built on the SAME coverage
// rules the Materials tab / library "Can run" filter use (lib/materials.ts
// `coverage` / `resolveRefs` / `isStocked`), so "covered by a substitute" and
// "low" read identically everywhere in the app. Pure + unit-testable: no
// React, no DOM.

import type { DateKey } from "@/lib/calendar/types";
import { resolveRefs } from "@/lib/materials";
import type { Material } from "@/lib/materialCatalog";
import { isStocked, type StockState } from "@/lib/kitStock";
import type { Activity } from "@/lib/types";
import type { ScheduleDay } from "./schedule";

export interface ShoppingListItem {
  id: string;
  label: string;
  // "missing" = uncovered (no on-hand item or substitute); "low" = covered,
  // but the covering item (own stock or the substitute standing in) is
  // running thin.
  status: "missing" | "low";
  // The DateKeys of days in range whose activities need this item, in day
  // order — the paper list's "which day(s) need it" line.
  dates: DateKey[];
}

interface ItemState {
  label: string;
  status: "missing" | "low";
  dates: Set<DateKey>;
}

// Build the shopping list for a set of scheduled days, given the day-by-day
// events (already resolved to activities via `byId`), the effective kit-stock
// map, and the material catalog (for substitution + display names). Returns
// [] when stock has never been reviewed (an empty map — the coverage lens's
// "unset" state): a blank inventory can't tell missing/low apart from
// unreviewed, so printing every material as "missing" would be actively wrong.
export function buildShoppingList(
  days: ScheduleDay[],
  byId: Record<string, Activity>,
  stock: Record<string, StockState>,
  catalog: Material[] | undefined
): ShoppingListItem[] {
  if (Object.keys(stock).length === 0) return [];

  const substitutesById = new Map<string, string[]>();
  for (const entry of catalog ?? []) {
    if (entry.substitutes?.length) substitutesById.set(entry.id, entry.substitutes);
  }

  const items = new Map<string, ItemState>();
  const note = (id: string, label: string, status: "missing" | "low", date: DateKey) => {
    const existing = items.get(id);
    if (!existing) {
      items.set(id, { label, status, dates: new Set([date]) });
      return;
    }
    existing.dates.add(date);
    // "missing" always wins over "low": one day's flat-out absence outranks
    // another day's merely-thin reading for the same material.
    if (status === "missing") existing.status = "missing";
  };

  for (const day of days) {
    const seenActivities = new Set<string>();
    for (const event of day.events) {
      if (!event.activityId) continue;
      const activity = byId[event.activityId];
      if (!activity || seenActivities.has(activity.id)) continue;
      seenActivities.add(activity.id);

      // Skip zero-need activities up front (coverage() reads them "ready",
      // nothing to shop for).
      const needs = resolveRefs(activity, catalog);
      if (!needs.length) continue;

      for (const need of needs) {
        const own = stock[need.id];
        if (isStocked(own)) {
          if (own === "low") note(need.id, need.label, "low", day.date);
          continue; // covered by its own stock — never "missing"
        }
        // Not covered by its own id — check substitutes.
        const subs = substitutesById.get(need.id) ?? [];
        const viaId = subs.find((sub) => isStocked(stock[sub]));
        if (viaId) {
          if (stock[viaId] === "low") note(need.id, need.label, "low", day.date);
          continue; // covered via a substitute (in stock, not low)
        }
        note(need.id, need.label, "missing", day.date);
      }
    }
  }

  return [...items.entries()]
    .map(([id, state]) => ({
      id,
      label: state.label,
      status: state.status,
      dates: [...state.dates].sort(),
    }))
    .sort((a, b) => (a.status !== b.status ? (a.status === "missing" ? -1 : 1) : a.label.localeCompare(b.label)));
}
