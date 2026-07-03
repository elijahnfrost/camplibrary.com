// Camp Library — meals: the dietary roster and date-keyed menu notes.
//
// Meals themselves are ordinary CalendarEvents flagged with a mealKind (see
// lib/calendar/types) — this module holds the two SIDECAR surfaces that don't
// belong on any single event:
//
//   • a flat, camp-level DIETARY roster (allergies / avoidances the staff must
//     honor at every meal), and
//   • date-keyed MENU NOTES ("today: pizza + salad bar"), joined at render.
//
// Menu notes live HERE, keyed by (date, mealKind), rather than as this-scoped
// edits on the meal recurring series. If they rode the series, regenerating the
// meal schedule could erase a whole season of menus in one stroke; a separate
// doc means series regeneration can never touch them.
//
// v1 keeps the dietary roster FLAT — one camp-wide list, with no per-entry
// campId and no mealKind targeting. Isomorphic: the validators run on the
// client (hydrate) AND on untrusted server payloads, so no "use client" and no
// Date.now()/randomness in the validators.

import { isDateKey, MEAL_KINDS, type DateKey, type MealKind } from "./calendar/types";

// How urgent a dietary entry is. "severe" (anaphylaxis / medical) sorts first so
// the highest-stakes constraints are never buried; "avoid" is a firm no; "note"
// is an FYI (preference, mild sensitivity).
export type DietarySeverity = "note" | "avoid" | "severe";
export const DIETARY_SEVERITIES = ["note", "avoid", "severe"] as const;
const SEVERITY_SET = new Set<string>(DIETARY_SEVERITIES);
// Ordering weight — higher shows first. Used by dietaryBySeverity.
const SEVERITY_RANK: Record<DietarySeverity, number> = { severe: 2, avoid: 1, note: 0 };

const MEAL_KIND_SET = new Set<string>(MEAL_KINDS);

export const DIETARY_LABEL_MAX = 80;
export const DIETARY_DETAIL_MAX = 280;
export const MENU_NOTE_MAX = 280;

// Defensive caps so an untrusted payload can't carry unbounded maps.
const MAX_DIETARY = 50;
const MAX_MENU_DATES = 400;

// One row on the dietary roster. `label` is the headline ("peanuts", "gluten");
// `detail` is optional context ("carries an EpiPen", "cross-contamination ok").
export interface DietaryEntry {
  id: string;
  label: string;
  severity: DietarySeverity;
  detail?: string;
}

// menuNotes: date → (mealKind → note text). Sparse — only days/meals with a
// note written appear.
export interface MealsDoc {
  dietary: DietaryEntry[];
  menuNotes: Record<DateKey, Partial<Record<MealKind, string>>>;
}

// A fresh, empty meals doc — nothing on the roster, no menu notes.
export function defaultMealsDoc(): MealsDoc {
  return { dietary: [], menuNotes: {} };
}

function normalizeDietaryEntry(raw: unknown): DietaryEntry | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  const id = typeof v.id === "string" ? v.id.trim() : "";
  const label = typeof v.label === "string" ? v.label.trim().slice(0, DIETARY_LABEL_MAX) : "";
  if (!id || !label) return null;
  const severity: DietarySeverity =
    typeof v.severity === "string" && SEVERITY_SET.has(v.severity)
      ? (v.severity as DietarySeverity)
      : "note";
  const entry: DietaryEntry = { id, label, severity };
  const detail = typeof v.detail === "string" ? v.detail.trim().slice(0, DIETARY_DETAIL_MAX) : "";
  if (detail) entry.detail = detail;
  return entry;
}

// Deterministic: the roster keeps input order (deduped by id), menu notes are
// rebuilt in sorted date + fixed meal-kind order so the client hydrate and the
// server store always agree byte-for-byte.
export function normalizeMealsDoc(value: unknown): MealsDoc {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return defaultMealsDoc();
  const v = value as Record<string, unknown>;

  const dietary: DietaryEntry[] = [];
  const seen = new Set<string>();
  if (Array.isArray(v.dietary)) {
    for (const item of v.dietary) {
      const entry = normalizeDietaryEntry(item);
      if (entry && !seen.has(entry.id)) {
        seen.add(entry.id);
        dietary.push(entry);
        if (dietary.length >= MAX_DIETARY) break;
      }
    }
  }

  const menuNotes: Record<DateKey, Partial<Record<MealKind, string>>> = {};
  if (typeof v.menuNotes === "object" && v.menuNotes !== null && !Array.isArray(v.menuNotes)) {
    const src = v.menuNotes as Record<string, unknown>;
    let dateCount = 0;
    for (const dateKey of Object.keys(src).sort()) {
      if (!isDateKey(dateKey)) continue;
      const perMeal = src[dateKey];
      if (typeof perMeal !== "object" || perMeal === null || Array.isArray(perMeal)) continue;
      const mealSrc = perMeal as Record<string, unknown>;
      const day: Partial<Record<MealKind, string>> = {};
      // Fixed meal-kind order for determinism.
      for (const mealKind of MEAL_KINDS) {
        const text = mealSrc[mealKind];
        if (typeof text !== "string") continue;
        const trimmed = text.trim().slice(0, MENU_NOTE_MAX);
        if (trimmed) day[mealKind] = trimmed;
      }
      if (Object.keys(day).length) {
        menuNotes[dateKey] = day;
        dateCount += 1;
        if (dateCount >= MAX_MENU_DATES) break;
      }
    }
  }

  return { dietary, menuNotes };
}

// Roster sorted for display: severity first (severe → avoid → note), ties keep
// insertion order (stable). Pure — returns a new array, doesn't mutate.
export function dietaryBySeverity(doc: MealsDoc): DietaryEntry[] {
  return doc.dietary
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const bySeverity = SEVERITY_RANK[b.entry.severity] - SEVERITY_RANK[a.entry.severity];
      return bySeverity !== 0 ? bySeverity : a.index - b.index;
    })
    .map((x) => x.entry);
}

// The menu note for one (date, mealKind), or "" when none is set.
export function menuNoteFor(doc: MealsDoc, date: DateKey, mealKind: MealKind): string {
  return doc.menuNotes[date]?.[mealKind] ?? "";
}

// Pure updater: set (or clear) one (date, mealKind) menu note, returning a new
// doc. A blank/whitespace-only note DELETES the slot (and prunes an emptied
// day), so clearing a note never leaves an empty husk behind.
export function setMenuNote(
  doc: MealsDoc,
  date: DateKey,
  mealKind: MealKind,
  text: string
): MealsDoc {
  if (!isDateKey(date) || !MEAL_KIND_SET.has(mealKind)) return doc;
  const trimmed = text.trim().slice(0, MENU_NOTE_MAX);
  const menuNotes = { ...doc.menuNotes };
  const day = { ...(menuNotes[date] ?? {}) };
  if (trimmed) {
    day[mealKind] = trimmed;
  } else {
    delete day[mealKind];
  }
  if (Object.keys(day).length) {
    menuNotes[date] = day;
  } else {
    delete menuNotes[date];
  }
  return { ...doc, menuNotes };
}

let dietaryIdCounter = 0;

export function createDietaryId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return "diet-" + crypto.randomUUID();
  }
  dietaryIdCounter += 1;
  return "diet-" + Date.now().toString(36) + "-" + dietaryIdCounter.toString(36);
}
