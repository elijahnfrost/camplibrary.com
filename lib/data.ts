// Camp Library — seed data + display helpers.
// Ported from the Claude Design prototype (camp-data.js) and tightened for practical camp setup.

import { normalizeHexColor } from "./color";
import type { Activity, AgeGroup, Category, CategoryId, Place } from "./types";

// Category order drives the shelves.
export const CATEGORIES: Category[] = [
  { id: "Game", label: "Games", numeral: "I" },
  { id: "Craft", label: "Crafts", numeral: "II" },
  { id: "Song", label: "Songs & Circle", numeral: "III" },
  { id: "Water", label: "Water & Wide", numeral: "IV" },
  { id: "Quiet", label: "Quiet Time", numeral: "V" },
];

export const ENERGY = ["", "Calm", "Lively", "Rowdy"] as const;

const PLACE_SHORT: Record<Place, string> = { Inside: "IN", Outside: "OUT", Both: "BOTH" };

// Age groups are a TAG. Each activity carries `ages` = list of group ids. The
// age spans use standard US grade↔age cutoffs (band min = lowest grade + 5,
// band max = highest grade + 6), so the bands touch cleanly at 9 / 12 / 15
// rather than carrying the old deliberate gaps and overlaps. A Grades⇄Ages
// switch relabels these same bands; the spans below are the single source for
// both the grade captions and the age captions.
export const AGE_GROUPS: AgeGroup[] = [
  { id: "pre", label: "Preschool", short: "PreK", lo: 0, hi: 0, min: 3, max: 5 },
  { id: "g13", label: "Grades 1–3", short: "Gr 1–3", lo: 1, hi: 3, min: 6, max: 9 },
  { id: "g46", label: "Grades 4–6", short: "Gr 4–6", lo: 4, hi: 6, min: 9, max: 12 },
  { id: "g79", label: "Grades 7–9", short: "Gr 7–9", lo: 7, hi: 9, min: 12, max: 15 },
  { id: "g1012", label: "Grades 10–12", short: "Gr 10–12", lo: 10, hi: 12, min: 15, max: 18 },
];

export function ageGroups(a: Pick<Activity, "ages">): AgeGroup[] {
  return AGE_GROUPS.filter((g) => (a.ages || []).indexOf(g.id) >= 0);
}

// Age captions come in two units the user can switch between: grade bands (the
// default — "Grades 4–6") and plain ages ("9–12 yrs"). Both are derived from the
// SAME fixed bands, so the toggle only relabels; the selection never changes.
export type AgeUnit = "grades" | "ages";

function ageSpanGrades(a: Pick<Activity, "ages">): string {
  const gs = ageGroups(a);
  if (!gs.length) return "Grades 4–6";
  const grades = gs.filter((g) => g.lo > 0);
  const hasPre = gs.some((g) => g.id === "pre");
  if (!grades.length) return "Preschool";
  const lo = Math.min(...grades.map((g) => g.lo));
  const hi = Math.max(...grades.map((g) => g.hi));
  if (hasPre) return "PreK–Gr " + hi;
  return "Grades " + lo + "–" + hi;
}

export function ageSpanAges(a: Pick<Activity, "ages">): string {
  const gs = ageGroups(a);
  if (!gs.length) return "9–12 yrs";
  const lo = Math.min(...gs.map((g) => g.min));
  const hi = Math.max(...gs.map((g) => g.max));
  return lo + "–" + hi + " yrs";
}

export function ageSpan(a: Pick<Activity, "ages">, unit: AgeUnit = "grades"): string {
  return unit === "ages" ? ageSpanAges(a) : ageSpanGrades(a);
}

export function ageLabel(a: Pick<Activity, "ages">, unit: AgeUnit = "grades"): string {
  return ageSpan(a, unit);
}

// One band's caption in the chosen unit — short for chips ("Gr 4–6" / "9–12")
// and long for menus ("Grades 4–6" / "9–12 yrs").
export function bandShort(group: AgeGroup, unit: AgeUnit): string {
  return unit === "ages" ? group.min + "–" + group.max : group.short;
}
export function bandLong(group: AgeGroup, unit: AgeUnit): string {
  return unit === "ages" ? group.min + "–" + group.max + " yrs" : group.label;
}

function codeAge(a: Pick<Activity, "ages">): string {
  const gs = ageGroups(a);
  const grades = gs.filter((g) => g.lo > 0);
  const hasPre = gs.some((g) => g.id === "pre");
  if (!grades.length) return "PreK";
  const lo = Math.min(...grades.map((g) => g.lo));
  const hi = Math.max(...grades.map((g) => g.hi));
  return hasPre ? "K–" + hi : lo + "–" + hi;
}

export function code(a: Pick<Activity, "type" | "place" | "ages">): string {
  return a.type.charAt(0) + " · " + PLACE_SHORT[a.place] + " · " + codeAge(a);
}

export function groupLabel(a: Pick<Activity, "groupMin" | "groupMax">): string {
  if (a.groupMin == null) return "Any size";
  if (a.groupMax == null) return a.groupMin + "+";
  return a.groupMin + "–" + a.groupMax;
}

export function durLabel(a: Pick<Activity, "durationMin">): string {
  return a.durationMin + " min";
}

// Compact one-line descriptor used on calendar events and library rows.
export function activityMeta(a: Pick<Activity, "type" | "place" | "ages" | "durationMin" | "energy">): string {
  return code(a) + " · " + durLabel(a) + " · " + ENERGY[a.energy];
}

// Category color is centralized here so calendar events, chips, and open slots
// share one earthy source of truth.
const CATEGORY_TINTS: Record<CategoryId, string> = {
  Game: "#3f6b45", // pine — intentionally identical to --accent (the brand green); Game is the "green" category
  Craft: "#b3603f", // terracotta
  Song: "#d99a3c", // amber
  Water: "#4d7a86", // muted river
  Quiet: "#4a4660", // dusk
};
export function categoryTint(id: CategoryId | undefined): string {
  return id ? CATEGORY_TINTS[id] : "#8f8470";
}

// One shared color resolver, layered over categoryTint. Color lives on BOTH a
// library activity (its default everywhere + the seed when placed) and a
// calendar event (per-placement override). Resolution is lazy and decoupled:
//   event.color  ?? activity.color ?? categoryTint(activity.type)
// so an untouched item "starts" at its tag color with no backfill/migration,
// and clearing a color simply falls back down the chain ("reset to tag color").
// Structural param types keep this usable from the isomorphic boundary without
// importing the calendar event type.
export function effectiveActivityColor(activity: Pick<Activity, "color" | "type">): string {
  return normalizeHexColor(activity.color) ?? categoryTint(activity.type);
}
export function effectiveEventColor(
  event: { color?: string },
  activity?: Pick<Activity, "color" | "type">
): string {
  return (
    normalizeHexColor(event.color) ??
    normalizeHexColor(activity?.color) ??
    categoryTint(activity?.type)
  );
}

// Approval rating → warm sequential color scale (low = clay, high = green) so
// the shelf ranks by color. One step more chroma at the low end so the scale
// survives the light desaturated paper.
const RATING_COLORS: Record<number, string> = {
  1: "#c4906f",
  2: "#d2a87a",
  3: "#d4bc74",
  4: "#aebf86",
  5: "#85a45f",
};
const RATING_NEUTRAL = "#ddd2b8"; // unrated — a blank kraft cover, not a hole in the shelf
export const RATING_WORD: Record<number, string> = {
  0: "Not run yet",
  1: "Rough day",
  2: "So-so",
  3: "Solid",
  4: "Crowd-pleaser",
  5: "Camp favorite",
};

export function ratingColor(r: number | undefined): string {
  if (!r || r < 1) return RATING_NEUTRAL;
  return RATING_COLORS[Math.max(1, Math.min(5, Math.round(r)))];
}

// ---------- seed activities ----------
// The built-in library now lives in lib/seed — split into per-category lane
// modules (generated by scripts/build-seed.mjs from researched, validated
// drafts) plus hand-authored reserved staples. Keeping the data out of this
// file lets it stay focused on display helpers and under the size guideline.
export { SEED_ACTIVITIES as ACTIVITIES } from "./seed";

export function monogram(title: string): string {
  return title.trim().charAt(0).toUpperCase();
}
