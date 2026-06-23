import type { Activity, AgeGroupId, CategoryId } from "./types";
import { usesAnyMaterialTag } from "./materials";

export type CatFilter = "All" | CategoryId;
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
  cat: CatFilter;
  place: PlaceFilter;
  age: AgeFilter;
  query: string;
  availableMaterialTags?: string[];
  /** Filter to one theme. Pairs with themeAssignments (activityId -> themeId)
   *  since the theme lives in a side map, not on the activity itself. */
  theme?: ThemeFilter;
  themeAssignments?: Record<string, string>;
}

function searchableArray(values: unknown): string[] {
  return Array.isArray(values) ? values.filter((item): item is string => typeof item === "string") : [];
}

export function matchesActivityFilters(a: Activity, filters: ActivityFilterState): boolean {
  if (filters.cat !== "All" && a.type !== filters.cat) return false;
  if (filters.place === "Inside" && !(a.place === "Inside" || a.place === "Both")) return false;
  if (filters.place === "Outside" && !(a.place === "Outside" || a.place === "Both")) return false;
  if (filters.age !== "All" && (a.ages || []).indexOf(filters.age) < 0) return false;
  if (filters.theme && filters.theme !== "All" && (filters.themeAssignments?.[a.id] ?? "") !== filters.theme) {
    return false;
  }
  if (!usesAnyMaterialTag(a, filters.availableMaterialTags || [])) return false;

  const q = filters.query.trim().toLowerCase();
  if (!q) return true;

  // Steps and notes are searchable on purpose: counselors remember activities
  // by play details ("the one with the sponge line"), not just titles. Alt-names
  // are in the haystack too: many games are searched by a local/alternate name
  // ("Octopus", "Goggaball") that never appears in the title.
  const hay = (
    a.title +
    " " +
    searchableArray(a.altNames).join(" ") +
    " " +
    a.type +
    " " +
    a.place +
    " " +
    a.blurb +
    " " +
    searchableArray(a.materials).join(" ") +
    " " +
    searchableArray(a.materialTags).join(" ") +
    " " +
    searchableArray(a.steps).join(" ") +
    " " +
    (typeof a.notes === "string" ? a.notes : "")
  ).toLowerCase();
  return hay.includes(q);
}
