// Pure edits on the camps array — the day-structure and guidance-band changes
// the camp manager makes. Each takes the current camps and returns the next
// array without mutating it; there are no cloud writes or staff gates here (the
// useCampMutations hook wraps these with requireStaff + cloud.setDoc). Extracted
// from that hook so the fiddly parts — hour clamping, the delete-when-empty of an
// override map, and the "fork the shared guides baseline into the camp on first
// edit" rule — are unit-tested instead of living inline in a component.
import { clampOverrideWindow, type Camp, type CampSnapMin, type Weekday } from "./camps";
import type { GuideBand } from "@/lib/calendar/guides";
import type { DateKey } from "@/lib/calendar/types";

type HourWindow = { openMin: number; closeMin: number };

// Set (or clear) a camp's per-weekday hours. "default" removes the override,
// "closed" stores an explicit closed marker (null), a window is clamped to the
// override bounds. The whole `weekdayHours` map is dropped once it's empty, so a
// camp with no overrides carries no field.
export function setWeekdayHours(
  camps: Camp[],
  id: string,
  weekday: Weekday,
  value: "default" | "closed" | HourWindow
): Camp[] {
  return camps.map((c) => {
    if (c.id !== id) return c;
    const weekdayHours = { ...(c.weekdayHours ?? {}) };
    if (value === "default") delete weekdayHours[weekday];
    else if (value === "closed") weekdayHours[weekday] = null;
    else weekdayHours[weekday] = clampOverrideWindow(value.openMin, value.closeMin);
    const next: Camp = { ...c };
    if (Object.keys(weekdayHours).length) next.weekdayHours = weekdayHours;
    else delete next.weekdayHours;
    return next;
  });
}

// Set (or clear) a camp's dated-exception hours. `null` removes the exception,
// "closed" stores an explicit closed day, a window is clamped. The `dateHours`
// map is dropped once empty.
export function setDateHours(
  camps: Camp[],
  id: string,
  date: DateKey,
  value: "closed" | HourWindow | null
): Camp[] {
  return camps.map((c) => {
    if (c.id !== id) return c;
    const dateHours = { ...(c.dateHours ?? {}) };
    if (value === null) delete dateHours[date];
    else if (value === "closed") dateHours[date] = null;
    else dateHours[date] = clampOverrideWindow(value.openMin, value.closeMin);
    const next: Camp = { ...c };
    if (Object.keys(dateHours).length) next.dateHours = dateHours;
    else delete next.dateHours;
    return next;
  });
}

export function setSnap(camps: Camp[], id: string, snapMin: CampSnapMin): Camp[] {
  return camps.map((c) => (c.id === id ? { ...c, snapMin } : c));
}

// The guidance-band edits share one rule: a camp that hasn't set its own bands
// inherits `sharedGuides` (the legacy shared doc) as its baseline, and the first
// edit FORKS that baseline into the camp (`c.guides ?? sharedGuides`), after
// which the camp's bands diverge freely. `band` is passed in (id already minted)
// so these stay pure.
export function addGuide(camps: Camp[], campId: string, band: GuideBand, sharedGuides: GuideBand[]): Camp[] {
  return camps.map((c) => (c.id === campId ? { ...c, guides: [...(c.guides ?? sharedGuides), band] } : c));
}

export function updateGuide(
  camps: Camp[],
  campId: string,
  id: string,
  patch: Partial<GuideBand>,
  sharedGuides: GuideBand[]
): Camp[] {
  return camps.map((c) =>
    c.id === campId
      ? { ...c, guides: (c.guides ?? sharedGuides).map((b) => (b.id === id ? { ...b, ...patch } : b)) }
      : c
  );
}

export function removeGuide(camps: Camp[], campId: string, id: string, sharedGuides: GuideBand[]): Camp[] {
  return camps.map((c) =>
    c.id === campId ? { ...c, guides: (c.guides ?? sharedGuides).filter((b) => b.id !== id) } : c
  );
}
