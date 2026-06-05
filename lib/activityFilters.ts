import type { Activity, AgeGroupId, CategoryId } from "./types";
import { hasRequiredMaterials } from "./materials";

export type CatFilter = "All" | CategoryId;
export type PlaceFilter = "All" | "Inside" | "Outside";
export type AgeFilter = "All" | AgeGroupId;

export interface ActivityFilterState {
  cat: CatFilter;
  place: PlaceFilter;
  age: AgeFilter;
  query: string;
  availableMaterialTags?: string[];
}

function searchableArray(values: unknown): string[] {
  return Array.isArray(values) ? values.filter((item): item is string => typeof item === "string") : [];
}

export function matchesActivityFilters(a: Activity, filters: ActivityFilterState): boolean {
  if (filters.cat !== "All" && a.type !== filters.cat) return false;
  if (filters.place === "Inside" && !(a.place === "Inside" || a.place === "Both")) return false;
  if (filters.place === "Outside" && !(a.place === "Outside" || a.place === "Both")) return false;
  if (filters.age !== "All" && (a.ages || []).indexOf(filters.age) < 0) return false;
  if (!hasRequiredMaterials(a, filters.availableMaterialTags || [])) return false;

  const q = filters.query.trim().toLowerCase();
  if (!q) return true;

  const hay = (
    a.title +
    " " +
    a.type +
    " " +
    a.place +
    " " +
    a.blurb +
    " " +
    searchableArray(a.materials).join(" ") +
    " " +
    searchableArray(a.materialTags).join(" ")
  ).toLowerCase();
  return hay.includes(q);
}
