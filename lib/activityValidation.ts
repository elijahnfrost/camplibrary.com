import { normalizeHexColor } from "./color";
import { AGE_GROUPS, CATEGORIES } from "./data";
import { normalizePlaybook } from "./playbooks";
import { MAX_ACTIVITY_DURATION_MIN as TOTAL_MIN } from "./calendar/time";
import type { Activity, AgeGroupId, CategoryId, Place, Prep } from "./types";

const AGE_GROUP_IDS = new Set<string>(AGE_GROUPS.map((group) => group.id));
const CATEGORY_IDS = new Set<string>(CATEGORIES.map((category) => category.id));
const PLACES = new Set<string>(["Inside", "Outside", "Both"]);
const PREPS = new Set<string>(["None", "Low", "Medium", "High"]);
const DEFAULT_AGES: AgeGroupId[] = ["g46"];
const DEFAULT_DURATION_MIN = 20;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function wholeNumber(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed == null ? null : Math.round(parsed);
}

function positiveWholeNumber(value: unknown): number | null {
  const parsed = wholeNumber(value);
  return parsed != null && parsed > 0 ? parsed : null;
}

function clampedWholeNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = wholeNumber(value);
  if (parsed == null) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function validAges(value: unknown): AgeGroupId[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter((item): item is AgeGroupId => typeof item === "string" && AGE_GROUP_IDS.has(item))
    ),
  ];
}

export function deriveAgesFromRange(ageMin: number, ageMax: number): AgeGroupId[] {
  const lo = Math.min(ageMin, ageMax);
  const hi = Math.max(ageMin, ageMax);
  // Bands now touch at their boundaries (…9, 12, 15…); a shared boundary belongs
  // to the LOWER band, so the upper bound is strict (`hi > group.min`). Without
  // this an elementary 6–12 activity would spill up into Grades 7–9.
  const ids = AGE_GROUPS.filter((group) => lo <= group.max && hi > group.min).map((group) => group.id);
  return ids.length ? ids : [...DEFAULT_AGES];
}

function rangeFromAges(ages: AgeGroupId[]): { ageMin: number; ageMax: number } {
  const groups = AGE_GROUPS.filter((group) => ages.includes(group.id));
  if (!groups.length) return rangeFromAges(DEFAULT_AGES);
  return {
    ageMin: Math.min(...groups.map((group) => group.min)),
    ageMax: Math.max(...groups.map((group) => group.max)),
  };
}

function normalizeAgeFields(value: Record<string, unknown>): {
  ages: AgeGroupId[];
  ageMin: number;
  ageMax: number;
} {
  const storedAges = validAges(value.ages);
  const rawMin = wholeNumber(value.ageMin);
  const rawMax = wholeNumber(value.ageMax);

  if (storedAges.length) {
    const fromAges = rangeFromAges(storedAges);
    const nextMin = rawMin ?? fromAges.ageMin;
    const nextMax = rawMax ?? fromAges.ageMax;
    return {
      ages: storedAges,
      ageMin: Math.min(nextMin, nextMax),
      ageMax: Math.max(nextMin, nextMax),
    };
  }

  if (rawMin != null && rawMax != null) {
    return {
      ages: deriveAgesFromRange(rawMin, rawMax),
      ageMin: Math.min(rawMin, rawMax),
      ageMax: Math.max(rawMin, rawMax),
    };
  }

  const fallback = rangeFromAges(DEFAULT_AGES);
  return { ages: [...DEFAULT_AGES], ...fallback };
}

function categoryId(value: unknown): CategoryId {
  return typeof value === "string" && CATEGORY_IDS.has(value) ? (value as CategoryId) : "Game";
}

function place(value: unknown): Place {
  return typeof value === "string" && PLACES.has(value) ? (value as Place) : "Both";
}

function prep(value: unknown): Prep {
  return typeof value === "string" && PREPS.has(value) ? (value as Prep) : "Low";
}

export function normalizeActivity(value: unknown): Activity | null {
  if (!isRecord(value)) return null;
  const id = trimmedString(value.id);
  if (!id) return null;

  const { ageMin, ageMax, ages } = normalizeAgeFields(value);
  const activity: Activity = {
    id,
    title: trimmedString(value.title) || "Untitled activity",
    type: categoryId(value.type),
    place: place(value.place),
    ageMin,
    ageMax,
    durationMin: Math.min(TOTAL_MIN, positiveWholeNumber(value.durationMin) ?? DEFAULT_DURATION_MIN),
    groupMin: positiveWholeNumber(value.groupMin),
    groupMax: positiveWholeNumber(value.groupMax),
    energy: clampedWholeNumber(value.energy, 1, 0, 3),
    prep: prep(value.prep),
    blurb: trimmedString(value.blurb),
    materials: stringArray(value.materials),
    steps: stringArray(value.steps),
    notes: trimmedString(value.notes),
    safety: trimmedString(value.safety),
    ages,
    rating: clampedWholeNumber(value.rating, 0, 0, 5),
  };

  // Alternate names ride alongside the rebuilt object; without this re-attach the
  // clean rebuild would silently drop them on every save (same rule as
  // materialTags/color/playbook). De-duped, trimmed, empties removed.
  if (Array.isArray(value.altNames)) {
    const altNames = [...new Set(stringArray(value.altNames))];
    if (altNames.length) activity.altNames = altNames;
  }

  if (Array.isArray(value.materialTags)) {
    activity.materialTags = stringArray(value.materialTags);
  }

  // Per-item color rides in the payload; re-attach or the clean rebuild strips it.
  const color = normalizeHexColor(value.color);
  if (color) activity.color = color;

  const playbook = normalizePlaybook(value.playbook);
  if (playbook) activity.playbook = playbook;

  return activity;
}

export function normalizeActivities(value: unknown, fallback: Activity[]): Activity[] {
  if (!Array.isArray(value)) return fallback;
  return value.map(normalizeActivity).filter((activity): activity is Activity => Boolean(activity));
}
