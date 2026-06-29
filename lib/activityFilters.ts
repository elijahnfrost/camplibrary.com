import type { Activity, AgeGroupId, CategoryId } from "./types";
import { usesAnyMaterialTag } from "./materials";

// The set of categories the library shows. A multi-select: every id = show all
// (the default), a subset = show only those, [] = show none. Replaces the old
// single "All" | CategoryId so staff can narrow to any combination of shelves.
export type CatFilter = CategoryId[];
export type PlaceFilter = "All" | "Inside" | "Outside";
export type AgeFilter = "All" | AgeGroupId;
// "All", or a themeId. Themes are user-definable, so this can't be a fixed union.
export type ThemeFilter = "All" | string;

// How the library list is ordered. "az" = title A–Z; "rating" = approval rating
// high→low. Applies across all three browse views (deck/shelf/catalog).
export type LibrarySort = "az" | "rating";

export function isLibrarySort(value: unknown): value is LibrarySort {
  return value === "az" || value === "rating";
}

// Sort a copy of the list. For "rating" the highest approval rating comes first
// and UNRATED activities (rating 0 = "not run yet") always sink to the bottom —
// a plain descending sort does this since 0 is the lowest value. Ties (and the
// whole unrated block) fall back to A–Z so the order is stable and scannable.
export function sortActivities(items: Activity[], sort: LibrarySort): Activity[] {
  const byTitle = (a: Activity, b: Activity) =>
    a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
  if (sort === "rating") {
    return [...items].sort((a, b) => (b.rating || 0) - (a.rating || 0) || byTitle(a, b));
  }
  return [...items].sort(byTitle);
}

export interface ActivityFilterState {
  cats: CatFilter;
  place: PlaceFilter;
  age: AgeFilter;
  query: string;
  availableMaterialTags?: string[];
  /** Filter to one theme. Pairs with themeAssignments (activityId -> themeId)
   *  since the theme lives in a side map, not on the activity itself. */
  theme?: ThemeFilter;
  themeAssignments?: Record<string, string>;
  /** Inclusive duration window [lo, hi] in minutes. Omit (or pass the full
   *  bounds) to match any length. */
  minutes?: [number, number];
}

function searchableArray(values: unknown): string[] {
  return Array.isArray(values) ? values.filter((item): item is string => typeof item === "string") : [];
}

// Fold case AND accents so search is predictable however a word is typed:
// "Café", "cafe", and "café" all collapse to the same form. This matters in
// two real ways here — the seed catalog carries accented materials
// ("papier-mâché"), and mobile keyboards quietly (de)capitalize the field, so
// an accent-/case-sensitive match would silently miss what the user meant.
export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

// Split a raw query into normalized words. A multi-word query is matched word
// by word (AND, order-independent) rather than as one literal phrase, so
// "balloon relay" finds "Relay race with balloons" — not just the exact
// string "balloon relay". An empty/whitespace query yields no tokens.
export function searchTokens(query: string): string[] {
  return normalizeSearchText(query).split(/\s+/).filter(Boolean);
}

// The text an activity is searchable by, normalized once. This is the SINGLE
// haystack shared by the Library list and the calendar's QuickAdd picker, so a
// query behaves identically in both places. Titles, alt-names, and play details
// (blurb/materials/steps/notes/variations) are in on purpose — counselors
// remember activities by how they play ("the one with the sponge line") and by
// local/alternate names ("Octopus", "Goggaball") that never appear in the
// title. Hidden implementation fields like `safety` stay out.
export function activitySearchHaystack(a: Activity): string {
  return normalizeSearchText(
    [
      a.title,
      ...searchableArray(a.altNames),
      a.type,
      a.place,
      a.blurb,
      ...searchableArray(a.materials),
      ...searchableArray(a.materialTags),
      ...searchableArray(a.steps),
      typeof a.notes === "string" ? a.notes : "",
      ...searchableArray(a.variations),
    ].join(" ")
  );
}

// Free-text search: every word in `query` must appear somewhere in the
// activity's haystack (case-/accent-insensitive, any order). Empty query
// matches everything. Reused by both search surfaces — see callers.
export function matchesActivitySearch(a: Activity, query: string): boolean {
  const tokens = searchTokens(query);
  if (!tokens.length) return true;
  const hay = activitySearchHaystack(a);
  return tokens.every((token) => hay.includes(token));
}

export function matchesActivityFilters(a: Activity, filters: ActivityFilterState): boolean {
  if (!filters.cats.includes(a.type)) return false;
  if (filters.place === "Inside" && !(a.place === "Inside" || a.place === "Both")) return false;
  if (filters.place === "Outside" && !(a.place === "Outside" || a.place === "Both")) return false;
  if (filters.age !== "All" && (a.ages || []).indexOf(filters.age) < 0) return false;
  if (filters.theme && filters.theme !== "All" && (filters.themeAssignments?.[a.id] ?? "") !== filters.theme) {
    return false;
  }
  if (filters.minutes && (a.durationMin < filters.minutes[0] || a.durationMin > filters.minutes[1])) {
    return false;
  }
  if (!usesAnyMaterialTag(a, filters.availableMaterialTags || [])) return false;

  return matchesActivitySearch(a, filters.query);
}
