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
  // Routines & quick adds: the repeated, utility "order of operations" of the
  // day — circle time, the feelings check-in, attention signals, line-up,
  // clean-up — AND the home for anything typed on the fly from the calendar's
  // create bar (a one-tap block or a 0-min reminder). Not a game, not a craft;
  // a shelf of its own. Reminders saved to the library live here too.
  { id: "Routine", label: "Routines & quick adds", numeral: "VI" },
];

// Every category id, in shelf order — the "all categories shown" state for the
// library's multi-select Type filter (the default, and what "Select all" / a
// filter clear-all resets to).
export const ALL_CATEGORY_IDS: CategoryId[] = CATEGORIES.map((c) => c.id);

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

function ageGroups(a: Pick<Activity, "ages">): AgeGroup[] {
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

function ageSpanAges(a: Pick<Activity, "ages">): string {
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
  // A 0-minute library entry is a reminder (a no-time nudge), not a "0 min"
  // block — read it as what it is everywhere the length is shown.
  if (a.durationMin === 0) return "Reminder";
  return a.durationMin + " min";
}

// Category color is centralized here so calendar events, chips, and open slots
// share one earthy source of truth.
const CATEGORY_TINTS: Record<CategoryId, string> = {
  Game: "#3f6b45", // pine — intentionally identical to --accent (the brand green); Game is the "green" category
  Craft: "#b3603f", // terracotta
  Song: "#d99a3c", // amber
  Water: "#4d7a86", // muted river
  Quiet: "#4a4660", // dusk
  Routine: "#9b6a73", // muted mauve — the warm "gather round" tone, distinct from terracotta and dusk
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

// A custom event (no backing activity) reads as a plain stone gray under the
// rating/location/theme modes — distinct from RATING_NEUTRAL (the warmer, lighter
// kraft of an UNRATED activity) so the two grays never collapse into one shade.
// Cooler + a touch darker than RATING_NEUTRAL: "no activity here" vs "activity,
// just not rated/placed yet."
export const CUSTOM_NEUTRAL = "#9c9486";

// The default tint for a reminder marker — a muted, dusty terracotta-coral.
// Warm and clearly "a marker", but softer than the Craft clay so a thin
// reminder line reads as a quiet nudge that belongs, not an alarm. A saved
// reminder can override it (Reminder.color); otherwise every reminder uses this.
const REMINDER_TINT = "#c2715a";

// Resolve a reminder's marker color: its own override, else the default tint.
export function reminderTint(color?: string): string {
  return normalizeHexColor(color) ?? REMINDER_TINT;
}

// Where-it-happens → an earthy tint, one per built-in place so the "Color by →
// Location" mode reads each place at a glance. Kept clearly distinct from one
// another and on-palette with CATEGORY_TINTS / THEME_PALETTE (greens, clays,
// slates from the same warm family). Gym deliberately mirrors the pine Game
// tint — the gym IS the green room. Keys are the SEED place labels (the starter
// vocabulary); a user-added or legacy free-text place not in the map falls back
// to the neutral stone.
export const LOCATION_TINTS: Record<string, string> = {
  Gym: "#3f6b45", // pine — the indoor green
  Classroom: "#4a6b86", // slate blue — desks & paper
  Kitchen: "#9a5a4a", // clay — the warm kitchen
  Playground: "#c46b3f", // terracotta — the painted blacktop
  Fields: "#7a8c3f", // olive grass — the wide-open field
  Pool: "#3a8ea3", // pool teal — the water, distinct from the classroom slate
  "Baseball pitch": "#b08a3c", // dirt amber — the infield
};

// Resolve a location list to its tint: the FIRST place wins (row-order is the
// editor's deterministic order). A user-chosen color override (keyed by the place
// LABEL, like the rest of the location model) wins first; then the built-in
// LOCATION_TINTS default; then the neutral stone for missing/legacy/free-text
// places — simple and stable, no per-string hashing.
export function locationColor(
  locations: readonly string[] | undefined,
  colors?: Record<string, string>
): string {
  const first = locations && locations.length ? locations[0] : undefined;
  if (!first) return CUSTOM_NEUTRAL;
  const override = colors && normalizeHexColor(colors[first]);
  return override || LOCATION_TINTS[first] || CUSTOM_NEUTRAL;
}

// How every calendar event's color is resolved. "custom" is today's behavior
// (per-event/activity override → category tint); the others recolor by a single
// axis so the schedule can be read as "by type", "by favoritism", "by place" or
// "by theme" without touching any event's stored color.
export type ColorMode = "custom" | "type" | "rating" | "location" | "theme";

const COLOR_MODES: readonly ColorMode[] = ["custom", "type", "rating", "location", "theme"];

export function isColorMode(value: unknown): value is ColorMode {
  return typeof value === "string" && (COLOR_MODES as readonly string[]).includes(value);
}

// The ONE tint resolver the calendar adapter routes every event through, keyed
// by the active ColorMode. Structural param types (no CalendarEvent import) keep
// this central + unit-testable from the isomorphic boundary. The theme tint is
// resolved once by the caller (it already has the ThemeResolver) and passed in.
export function eventTint(
  mode: ColorMode,
  {
    event,
    activity,
    themeTint,
    locationColors,
  }: {
    event: { color?: string; kind?: string; locations?: readonly string[] };
    activity?: Pick<Activity, "color" | "type" | "rating">;
    themeTint?: string;
    /** The user's per-location color overrides (place label → hex). Consulted
     *  only by the "location" mode; see locationColor. */
    locationColors?: Record<string, string>;
  }
): string {
  switch (mode) {
    case "type":
      // By category: a custom event has no type → the neutral category tint.
      return categoryTint(activity?.type);
    case "rating":
      // By favoritism: a custom event is a plain stone (no activity to rate);
      // an unrated activity is the warm kraft; a rated one rides the warm scale.
      if (!activity) return CUSTOM_NEUTRAL;
      return ratingColor(activity.rating);
    case "location":
      // By place: the event's first location maps to its earthy tint (a user
      // override wins over the built-in default — see locationColor).
      return locationColor(event.locations, locationColors);
    case "theme":
      // By theme: the activity's theme color, else the neutral stone.
      return themeTint || CUSTOM_NEUTRAL;
    case "custom":
    default:
      // Today's behavior, untouched: per-event/activity override → category tint.
      return effectiveEventColor(event, activity);
  }
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
