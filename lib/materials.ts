import type { Activity } from "./types";

export interface MaterialOption {
  id: string;
  label: string;
  count: number;
}

function compact(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function materialTagId(label: string): string {
  return compact(label)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  values.forEach((value) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    out.push(value);
  });
  return out;
}

export function materialTagsFromMaterials(materials: string[]): string[] {
  return unique(materials.map(materialTagId).filter(Boolean));
}

function stringTags(values: unknown): string[] {
  return Array.isArray(values) ? values.filter((value): value is string => typeof value === "string") : [];
}

function rawMaterialTags(activity: Activity): string[] {
  const materialTags = stringTags(activity.materialTags);
  return materialTags.length ? materialTags : stringTags(activity.materials);
}

export function requiredMaterialTagIds(activity: Activity): string[] {
  return unique(rawMaterialTags(activity).map(materialTagId).filter(Boolean));
}

export interface MaterialNeed {
  id: string;
  label: string;
}

// One row per distinct material an activity needs, in authored order, with a
// human label. Ids match the global "materials I have" set, so the detail-view
// checklist and the library "Available kit" filter stay in sync.
export function materialNeedsForActivity(activity: Activity): MaterialNeed[] {
  const seen = new Set<string>();
  const out: MaterialNeed[] = [];
  rawMaterialTags(activity).forEach((raw) => {
    const id = materialTagId(raw);
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push({ id, label: compact(raw) });
  });
  return out;
}

export function materialOptionsForActivities(activities: Activity[]): MaterialOption[] {
  const labels = new Map<string, string>();
  const counts = new Map<string, number>();

  activities.forEach((activity) => {
    const activityIds = new Set<string>();
    rawMaterialTags(activity).forEach((raw) => {
      const id = materialTagId(raw);
      if (!id) return;
      if (!labels.has(id)) labels.set(id, compact(raw));
      activityIds.add(id);
    });
    activityIds.forEach((id) => counts.set(id, (counts.get(id) || 0) + 1));
  });

  return [...counts.entries()]
    .map(([id, count]) => ({ id, label: labels.get(id) || id, count }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function hasRequiredMaterials(activity: Activity, availableMaterialTagIds: string[]): boolean {
  if (!availableMaterialTagIds.length) return true;
  const available = new Set(availableMaterialTagIds);
  return requiredMaterialTagIds(activity).every((id) => available.has(id));
}
