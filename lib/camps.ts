// Camp Library — camps.
//
// A "camp" is a lightweight, switchable scheduling container (e.g. "Summer Day
// Camp 2026"). Camps own ONLY their calendar events — the Library catalog stays
// global and shared across every camp. An event belongs to a camp via an
// optional `campId` that rides in the event payload (zero DDL); the camp list
// itself is a synced user-doc. Single-camp users never see camp UI: the list
// starts empty and the calendar shows everything until the first camp is made.
//
// Each camp also carries its own viewing hours (drop-off → pickup), which set how
// far the calendar day is drawn. These used to be an age-keyed, localStorage-only
// model living apart from camps; folding them onto the camp object means hours
// sync (camps is a synced doc) and follow the active camp. Isomorphic — the
// validator runs on the client AND on untrusted server payloads, so no
// "use client" directive.

import { DAY_END_MIN, DAY_START_MIN, SNAP_MIN, snapMinutes, type DayWindow } from "./calendar/time";

export interface Camp {
  id: string;
  name: string;
  createdAt: number;
  /** Earliest visible minute from midnight — the camp's drop-off. */
  openMin: number;
  /** Latest visible minute from midnight — the camp's pickup. */
  closeMin: number;
}

export const MAX_CAMP_NAME = 60;

// The selectable range for the open/close pickers — a generous camp day so the
// dropdowns stay short while covering every realistic drop-off and pickup.
export const EARLIEST_OPEN_MIN = 6 * 60; // 6:00 am
export const LATEST_CLOSE_MIN = 20 * 60; // 8:00 pm

// A new camp's hours: 7:30 am – 6:00 pm, the historical default camp day (the
// union the old age-keyed model produced out of the box).
export const DEFAULT_OPEN_MIN = 7 * 60 + 30;
export const DEFAULT_CLOSE_MIN = 18 * 60;

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
const snapClamp = (n: number, lo: number, hi: number): number => clamp(snapMinutes(n), lo, hi);

// Force a camp's open/close onto the snap grid, inside the selectable range, with
// at least one slot between them (open strictly before close).
export function clampOpenClose(openMin: number, closeMin: number): { openMin: number; closeMin: number } {
  const open = snapClamp(openMin, EARLIEST_OPEN_MIN, LATEST_CLOSE_MIN - SNAP_MIN);
  let close = snapClamp(closeMin, EARLIEST_OPEN_MIN + SNAP_MIN, LATEST_CLOSE_MIN);
  if (close <= open) close = Math.min(LATEST_CLOSE_MIN, open + SNAP_MIN);
  return { openMin: open, closeMin: close };
}

// Move a camp's open time, pushing close out if the move would cross it.
export function withCampOpen(camp: Camp, openMin: number): Camp {
  const open = snapClamp(openMin, EARLIEST_OPEN_MIN, LATEST_CLOSE_MIN - SNAP_MIN);
  const closeMin = camp.closeMin <= open ? Math.min(LATEST_CLOSE_MIN, open + SNAP_MIN) : camp.closeMin;
  return { ...camp, openMin: open, closeMin };
}

// Move a camp's close time, pulling open in if the move would cross it.
export function withCampClose(camp: Camp, closeMin: number): Camp {
  const close = snapClamp(closeMin, EARLIEST_OPEN_MIN + SNAP_MIN, LATEST_CLOSE_MIN);
  const openMin = camp.openMin >= close ? Math.max(EARLIEST_OPEN_MIN, close - SNAP_MIN) : camp.openMin;
  return { ...camp, openMin, closeMin: close };
}

// The calendar's base window for an (optionally absent) active camp: the camp's
// own hours, or the classic 8:00–18:00 band when no camp is active. effectiveWindow
// only ever stretches this outward around events, so nothing clips.
export function campDayWindow(camp: Camp | null | undefined): DayWindow {
  if (!camp) return { startMin: DAY_START_MIN, endMin: DAY_END_MIN };
  return { startMin: camp.openMin, endMin: camp.closeMin };
}

// 15-minute clock options spanning the selectable range, for the open/close
// dropdowns (e.g. "7:30 am", "8:00 am", …). Imported lazily by the camp manager
// (which carries its own formatClock) to keep this module free of display code.
export function hourOptionMinutes(): number[] {
  const out: number[] = [];
  for (let m = EARLIEST_OPEN_MIN; m <= LATEST_CLOSE_MIN; m += SNAP_MIN) out.push(m);
  return out;
}

function normalizeCamp(value: unknown): Camp | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const id = typeof v.id === "string" ? v.id.trim() : "";
  const name = typeof v.name === "string" ? v.name.trim().slice(0, MAX_CAMP_NAME) : "";
  if (!id || !name) return null;
  const createdAt =
    typeof v.createdAt === "number" && Number.isFinite(v.createdAt) ? v.createdAt : 0;
  // Hours default to the historical camp day when absent (older camps predate
  // per-camp hours) and are clamped onto the grid when present.
  const openRaw =
    typeof v.openMin === "number" && Number.isFinite(v.openMin) ? v.openMin : DEFAULT_OPEN_MIN;
  const closeRaw =
    typeof v.closeMin === "number" && Number.isFinite(v.closeMin) ? v.closeMin : DEFAULT_CLOSE_MIN;
  // Spread the raw record first so keys this build doesn't know (fields added by
  // a newer client — per-day hours, snap…) round-trip instead of being erased by
  // a stale client's next whole-doc save. Every field this build DOES know is
  // overwritten after the spread, so junk can never shadow a validated value.
  return { ...v, id, name, createdAt, ...clampOpenClose(openRaw, closeRaw) } as Camp;
}

// The camps doc: a list of unique-id camps in creation order. Deterministic so
// the client hydrate and the server store always agree.
export function normalizeCamps(value: unknown, fallback: Camp[]): Camp[] {
  if (!Array.isArray(value)) return fallback;
  const seen = new Set<string>();
  const out: Camp[] = [];
  for (const item of value) {
    const camp = normalizeCamp(item);
    if (camp && !seen.has(camp.id)) {
      seen.add(camp.id);
      out.push(camp);
    }
  }
  return out;
}

let campIdCounter = 0;

export function createCampId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return "camp-" + crypto.randomUUID();
  }
  campIdCounter += 1;
  return "camp-" + Date.now().toString(36) + "-" + campIdCounter.toString(36);
}
