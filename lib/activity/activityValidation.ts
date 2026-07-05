import { normalizeHexColor } from "../content/color";
import { AGE_GROUPS, CATEGORIES } from "../content/data";
import { normalizeActivityAlternates } from "./alternates";
import { normalizePlaybook } from "./playbooks";
import { MAX_ACTIVITY_DURATION_MIN as TOTAL_MIN } from "../calendar/time";
import type {
  Activity,
  ActivityLink,
  ActivityMedia,
  AgeGroupId,
  CategoryId,
  MaterialRef,
  Place,
  Prep,
} from "../types";

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

// A list-of-lists of strings (e.g. per-step sub-steps). Inner arrays are
// trimmed + empties dropped; the outer shape is preserved by index so it stays
// aligned to `steps`. Non-arrays and fully-empty rows collapse to [].
function stringMatrix(value: unknown): string[][] {
  if (!Array.isArray(value)) return [];
  return value.map((row) => stringArray(row));
}

function mediaArray(value: unknown): ActivityMedia[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): ActivityMedia | null => {
      if (!isRecord(item)) return null;
      const url = trimmedString(item.url);
      if (!url) return null;
      const title = trimmedString(item.title);
      return title ? { title, url } : { url };
    })
    .filter((item): item is ActivityMedia => Boolean(item));
}

// Canonical kit references: an id (trimmed, ≤80) plus an optional note (trimmed,
// ≤120). Malformed rows are dropped and empty-id rows can't ride through, so a
// consumer only ever sees clean refs. Ids are NOT de-duped here — resolveRefs
// dedupes at read time, and the form owns row identity — but the shape is clean.
function materialRefArray(value: unknown): MaterialRef[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): MaterialRef | null => {
      if (!isRecord(item)) return null;
      const id = trimmedString(item.id).slice(0, 80);
      if (!id) return null;
      const note = trimmedString(item.note).slice(0, 120);
      return note ? { id, note } : { id };
    })
    .filter((item): item is MaterialRef => Boolean(item));
}

function linkArray(value: unknown): ActivityLink[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): ActivityLink | null => {
      if (!isRecord(item)) return null;
      const url = trimmedString(item.url);
      if (!url) return null;
      const label = trimmedString(item.label);
      return label ? { label, url } : { url };
    })
    .filter((item): item is ActivityLink => Boolean(item));
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

function deriveAgesFromRange(ageMin: number, ageMax: number): AgeGroupId[] {
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
  // Spread the raw record first so keys this build doesn't know (fields added by
  // a newer client) round-trip instead of being erased by a stale client's next
  // whole-doc save. Every field this build DOES know is overwritten below —
  // known-but-optional fields via delete-then-reattach — so a malformed value
  // can never ride through the spread and shadow a validated one.
  const activity = { ...value } as unknown as Activity;
  activity.id = id;
  activity.title = trimmedString(value.title) || "Untitled activity";
  activity.type = categoryId(value.type);
  activity.place = place(value.place);
  activity.ageMin = ageMin;
  activity.ageMax = ageMax;
  activity.durationMin = Math.min(TOTAL_MIN, positiveWholeNumber(value.durationMin) ?? DEFAULT_DURATION_MIN);
  activity.groupMin = positiveWholeNumber(value.groupMin);
  activity.groupMax = positiveWholeNumber(value.groupMax);
  activity.energy = clampedWholeNumber(value.energy, 1, 0, 3);
  activity.prep = prep(value.prep);
  activity.blurb = trimmedString(value.blurb);
  activity.materials = stringArray(value.materials);
  activity.steps = stringArray(value.steps);
  activity.notes = trimmedString(value.notes);
  activity.safety = trimmedString(value.safety);
  activity.ages = ages;
  activity.rating = clampedWholeNumber(value.rating, 0, 0, 5);

  // Alternate names: de-duped, trimmed, empties removed.
  delete activity.altNames;
  if (Array.isArray(value.altNames)) {
    const altNames = [...new Set(stringArray(value.altNames))];
    if (altNames.length) activity.altNames = altNames;
  }

  delete activity.materialTags;
  if (Array.isArray(value.materialTags)) {
    activity.materialTags = stringArray(value.materialTags);
  }

  // Canonical kit references. Validated (id + optional note), attached only when
  // at least one row survives — so a malformed payload leaves the field absent
  // rather than an empty array, mirroring the other optionals.
  delete activity.materialRefs;
  if (Array.isArray(value.materialRefs)) {
    const materialRefs = materialRefArray(value.materialRefs);
    if (materialRefs.length) activity.materialRefs = materialRefs;
  }

  // Default backup plans. Registered on Activity via module augmentation in
  // lib/alternates; validated with the SAME rules as the event list (title ≤80
  // required, reason whitelist default "rain", locations rules, cap 3), attached
  // only when at least one clean row survives — so a malformed payload leaves the
  // field absent, mirroring the other optionals.
  delete activity.alternates;
  if (Array.isArray(value.alternates)) {
    const alternates = normalizeActivityAlternates(value.alternates);
    if (alternates.length) activity.alternates = alternates;
  }

  delete activity.color;
  const color = normalizeHexColor(value.color);
  if (color) activity.color = color;

  delete activity.playbook;
  const playbook = normalizePlaybook(value.playbook);
  if (playbook) activity.playbook = playbook;

  delete activity.media;
  const media = mediaArray(value.media);
  if (media.length) activity.media = media;

  delete activity.links;
  const links = linkArray(value.links);
  if (links.length) activity.links = links;

  delete activity.variations;
  if (Array.isArray(value.variations)) {
    const variations = stringArray(value.variations);
    if (variations.length) activity.variations = variations;
  }

  delete activity.subsets;
  if (Array.isArray(value.subsets)) {
    const subsets = stringMatrix(value.subsets);
    // Keep only when at least one row carries a sub-step, but preserve the full
    // shape (including empty rows) so index-alignment to `steps` survives.
    if (subsets.some((row) => row.length)) activity.subsets = subsets;
  }

  return activity;
}

export function normalizeActivities(value: unknown, fallback: Activity[]): Activity[] {
  if (!Array.isArray(value)) return fallback;
  return value.map(normalizeActivity).filter((activity): activity is Activity => Boolean(activity));
}
