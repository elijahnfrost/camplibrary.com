// Camp hours — the configurable visible window of the calendar.
//
// The calendar's day used to be a single hardcoded 8:00–18:00 band that only
// auto-extended around stray events. Real camps don't share one schedule: the
// pre-K camp starts at 8:00 with no early drop-off, while the older camps open
// at 7:30. This module makes those hours an explicit, editable setting.
//
// Each camp is one of the three age groups (AGE_GROUPS). It carries an `open`
// (early drop-off) and `close` (pickup) time, plus an `enabled` flag for when a
// camp isn't running. The visible grid is the union of the enabled camps'
// hours — the earliest open through the latest close — which becomes the
// authoritative base window. effectiveWindow() only ever stretches that base
// further out around events, so nothing clips.

import { AGE_GROUPS } from "@/lib/data";
import type { AgeGroupId } from "@/lib/types";
import { DAY_END_MIN, DAY_START_MIN, SNAP_MIN, formatClock, snapMinutes, type DayWindow } from "./time";

export type CampHours = {
  /** Whether this camp's hours expand the visible grid (off when it isn't running). */
  enabled: boolean;
  /** Earliest visible minute from midnight — the camp's drop-off. */
  openMin: number;
  /** Latest visible minute from midnight — the camp's pickup (grid's lower bound). */
  closeMin: number;
};

export type CampHoursMap = Record<AgeGroupId, CampHours>;

// The selectable range for the open/close pickers — a generous camp day so the
// dropdowns stay short while covering every realistic drop-off and pickup.
export const EARLIEST_OPEN_MIN = 6 * 60; // 6:00 am
export const LATEST_CLOSE_MIN = 20 * 60; // 8:00 pm

// Defaults mirror the real schedule: pre-K opens at 8:00 (no early drop-off);
// the older camps open at 7:30. Pickup defaults to 6:00 pm for all three. The
// union (7:30 am – 6:00 pm) is the calendar's out-of-the-box window.
export const DEFAULT_CAMP_HOURS: CampHoursMap = {
  pre: { enabled: true, openMin: 8 * 60, closeMin: 18 * 60 },
  g13: { enabled: true, openMin: 7 * 60 + 30, closeMin: 18 * 60 },
  g46: { enabled: true, openMin: 7 * 60 + 30, closeMin: 18 * 60 },
};

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
const snapClamp = (n: number, lo: number, hi: number): number => clamp(snapMinutes(n), lo, hi);

// Force a single camp's open/close onto the snap grid, inside the selectable
// range, with at least one slot between them (open strictly before close).
function clampOpenClose(openMin: number, closeMin: number): { openMin: number; closeMin: number } {
  const open = snapClamp(openMin, EARLIEST_OPEN_MIN, LATEST_CLOSE_MIN - SNAP_MIN);
  let close = snapClamp(closeMin, EARLIEST_OPEN_MIN + SNAP_MIN, LATEST_CLOSE_MIN);
  if (close <= open) close = Math.min(LATEST_CLOSE_MIN, open + SNAP_MIN);
  return { openMin: open, closeMin: close };
}

// Move a camp's open time, pushing close out if the move would cross it.
export function withOpen(camp: CampHours, openMin: number): CampHours {
  const open = snapClamp(openMin, EARLIEST_OPEN_MIN, LATEST_CLOSE_MIN - SNAP_MIN);
  const closeMin = camp.closeMin <= open ? Math.min(LATEST_CLOSE_MIN, open + SNAP_MIN) : camp.closeMin;
  return { ...camp, openMin: open, closeMin };
}

// Move a camp's close time, pulling open in if the move would cross it.
export function withClose(camp: CampHours, closeMin: number): CampHours {
  const close = snapClamp(closeMin, EARLIEST_OPEN_MIN + SNAP_MIN, LATEST_CLOSE_MIN);
  const openMin = camp.openMin >= close ? Math.max(EARLIEST_OPEN_MIN, close - SNAP_MIN) : camp.openMin;
  return { ...camp, openMin, closeMin: close };
}

// The grid window: the union of the enabled camps' hours. With no camp enabled
// we fall back to the classic 8:00–18:00 band so the calendar is never empty.
export function windowFromCampHours(hours: CampHoursMap): DayWindow {
  const active = AGE_GROUPS.map((group) => hours[group.id]).filter((camp) => camp?.enabled);
  if (!active.length) return { startMin: DAY_START_MIN, endMin: DAY_END_MIN };
  return {
    startMin: Math.min(...active.map((camp) => camp.openMin)),
    endMin: Math.max(...active.map((camp) => camp.closeMin)),
  };
}

// Parse an untrusted value (the localStorage cache) into a full CampHoursMap,
// falling back per-field to the defaults so a partial or corrupt blob still
// yields a usable, in-range config.
export function normalizeCampHours(raw: unknown): CampHoursMap {
  const out: CampHoursMap = {
    pre: { ...DEFAULT_CAMP_HOURS.pre },
    g13: { ...DEFAULT_CAMP_HOURS.g13 },
    g46: { ...DEFAULT_CAMP_HOURS.g46 },
  };
  if (typeof raw !== "object" || raw === null) return out;
  const value = raw as Record<string, unknown>;
  for (const group of AGE_GROUPS) {
    const entry = value[group.id];
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const fallback = DEFAULT_CAMP_HOURS[group.id];
    const enabled = typeof e.enabled === "boolean" ? e.enabled : fallback.enabled;
    const openRaw = typeof e.openMin === "number" && Number.isFinite(e.openMin) ? e.openMin : fallback.openMin;
    const closeRaw =
      typeof e.closeMin === "number" && Number.isFinite(e.closeMin) ? e.closeMin : fallback.closeMin;
    out[group.id] = { enabled, ...clampOpenClose(openRaw, closeRaw) };
  }
  return out;
}

// Storage validator for useLocalStorage<CampHoursMap>.
export function campHoursStorage(value: unknown): CampHoursMap {
  return normalizeCampHours(value);
}

// 15-minute clock options spanning the selectable range, for the open/close
// dropdowns (e.g. "7:30 am", "8:00 am", …).
export function hourOptions(): { value: number; label: string }[] {
  const options: { value: number; label: string }[] = [];
  for (let m = EARLIEST_OPEN_MIN; m <= LATEST_CLOSE_MIN; m += SNAP_MIN) {
    options.push({ value: m, label: formatClock(m) });
  }
  return options;
}
