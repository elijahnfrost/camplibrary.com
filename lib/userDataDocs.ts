// Camp Library — synced user-data documents.
//
// Each "doc" is one JSON value mirroring a localStorage key: favorites,
// custom activities, ratings, run-list overrides, playbook overrides, the
// library view mode, and the available-kit list. The same validators run on
// the client (hydrating localStorage) and on the server (validating API
// payloads before they reach Postgres), so the database only ever holds
// shapes the client renderers accept. No "use client" directive — this module
// must stay isomorphic.

import type { Activity, LibraryView } from "./types";
import { normalizeActivities } from "./activityValidation";
import { normalizePlaybook, type ActivityPlaybookData } from "./playbooks";
import { normalizeRunDoc, type RunDoc } from "./runList";
import type { StorageValidator } from "./store";
import { normalizeThemeAssignments, normalizeThemes, type Theme } from "./themes";
import { normalizeCamps, type Camp } from "./camps";
import { DEFAULT_LOCATIONS, normalizeLocationVocab } from "./locations";
import { normalizeHexColor } from "./color";
import { normalizeMaterialCatalog, type Material } from "./materialCatalog";
import { normalizeKitStock, type StockState } from "./kitStock";

export const USER_DOC_KEYS = [
  "favs",
  "extra",
  "ratings",
  "runLists",
  "playbookOverrides",
  "view",
  "availableMaterials",
  "materialCatalog",
  "kitStock",
  "themes",
  "themeAssignments",
  "camps",
  "locations",
  "locationColors",
  "deletedActivityIds",
] as const;

export type UserDocKey = (typeof USER_DOC_KEYS)[number];

export type DocValueMap = {
  favs: string[];
  extra: Activity[];
  ratings: Record<string, number>;
  runLists: Record<string, RunDoc>;
  playbookOverrides: Record<string, ActivityPlaybookData>;
  view: LibraryView;
  availableMaterials: string[];
  materialCatalog: Material[];
  kitStock: Record<string, StockState>;
  themes: Theme[];
  themeAssignments: Record<string, string>;
  camps: Camp[];
  locations: string[];
  locationColors: Record<string, string>;
  deletedActivityIds: string[];
};

// localStorage names predate the doc keys: "runLists.v2" (doc-model bump) and
// "playbooks" (historical name for playbook overrides) stay as-is on disk.
export const DOC_LOCAL_KEYS: { [K in UserDocKey]: string } = {
  favs: "favs",
  extra: "extra",
  ratings: "ratings",
  runLists: "runLists.v2",
  playbookOverrides: "playbooks",
  view: "view",
  availableMaterials: "availableMaterials",
  // Versioned name for the new doc (the catalog shape may evolve); the older
  // docs predate the convention and keep their bare names.
  materialCatalog: "materialCatalog.v1",
  // Versioned like the catalog — the 3-state stock map is new and may evolve.
  kitStock: "kitStock.v1",
  themes: "themes",
  themeAssignments: "themeAssignments",
  camps: "camps",
  locations: "locations",
  locationColors: "locationColors",
  deletedActivityIds: "deletedActivityIds",
};

const DOC_DEFAULT_FACTORIES: { [K in UserDocKey]: () => DocValueMap[K] } = {
  favs: () => [],
  extra: () => [],
  ratings: () => ({}),
  runLists: () => ({}),
  playbookOverrides: () => ({}),
  view: () => "deck",
  availableMaterials: () => [],
  materialCatalog: () => [],
  // {} is the first-class UNSET state — an untouched account keeps the lens inert.
  kitStock: () => ({}),
  themes: () => [],
  themeAssignments: () => ({}),
  camps: () => [],
  // A fresh camp starts with the standard places; once edited, the stored list
  // (even an empty one) wins — see normalizeLocationVocab.
  locations: () => [...DEFAULT_LOCATIONS],
  // Per-location color overrides default to none (every place reads its built-in
  // LOCATION_TINTS color until the user recolors it).
  locationColors: () => ({}),
  deletedActivityIds: () => [],
};

export function docDefault<K extends UserDocKey>(key: K): DocValueMap[K] {
  return DOC_DEFAULT_FACTORIES[key]();
}

export function isUserDocKey(value: unknown): value is UserDocKey {
  return typeof value === "string" && (USER_DOC_KEYS as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const stringArrayDoc: StorageValidator<string[]> = (value, fallback) =>
  Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string" && Boolean(item)))]
    : fallback;

export const ratingsDoc: StorageValidator<Record<string, number>> = (value, fallback) => {
  if (!isRecord(value)) return fallback;
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "number" && Number.isFinite(raw)) {
      out[key] = Math.max(0, Math.min(5, Math.round(raw)));
    }
  }
  return out;
};

export const activitiesDoc: StorageValidator<Activity[]> = (value, fallback) =>
  normalizeActivities(value, fallback);

// Per-activity playbook overrides — lets any diagram (including built-in ones)
// be edited and persisted without mutating the seed data.
export const playbookOverridesDoc: StorageValidator<Record<string, ActivityPlaybookData>> = (
  value,
  fallback
) => {
  if (!isRecord(value)) return fallback;
  const out: Record<string, ActivityPlaybookData> = {};
  for (const [key, raw] of Object.entries(value)) {
    const normalized = normalizePlaybook(raw);
    if (normalized) out[key] = normalized;
  }
  return out;
};

// Per-activity Run List overrides — hand-edited instruction documents that
// supersede the doc derived from the activity's flat steps/notes/safety. Same
// pattern as playbook overrides; built-in and custom books both persist here.
export const runListOverridesDoc: StorageValidator<Record<string, RunDoc>> = (value, fallback) => {
  if (!isRecord(value)) return fallback;
  const out: Record<string, RunDoc> = {};
  for (const [key, raw] of Object.entries(value)) {
    const normalized = normalizeRunDoc(raw);
    if (normalized) out[key] = normalized;
  }
  return out;
};

export const viewDoc: StorageValidator<LibraryView> = (value, fallback) =>
  value === "shelf" || value === "deck" || value === "catalog" ? value : fallback;

// The user-definable theme vocabulary, and the activityId -> themeId map that
// assigns one to each activity. Both validators run client + server.
export const themesDoc: StorageValidator<Theme[]> = (value, fallback) =>
  normalizeThemes(value, fallback);

export const themeAssignmentsDoc: StorageValidator<Record<string, string>> = (value, fallback) =>
  normalizeThemeAssignments(value, fallback);

// The user's camps (separate scheduling containers; the catalog stays shared).
export const campsDoc: StorageValidator<Camp[]> = (value, fallback) => normalizeCamps(value, fallback);

// The user-editable location vocabulary (places a block can happen). Events
// store the label directly, so this is a plain ordered list of unique strings.
export const locationsDoc: StorageValidator<string[]> = (value, fallback) =>
  normalizeLocationVocab(value, fallback);

// Per-location color overrides: place LABEL → validated hex. Mirrors the ratings
// map (a sparse override layer over a fixed default), so it rides existing
// zero-DDL round-trips. Non-hex values and non-string keys are dropped, so the
// renderers and color resolvers only ever see clean hex strings.
export const locationColorsDoc: StorageValidator<Record<string, string>> = (value, fallback) => {
  if (!isRecord(value)) return fallback;
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    const hex = normalizeHexColor(raw);
    if (key && hex) out[key] = hex;
  }
  return out;
};

// The materials catalog (names + substitution + flags for the kit vocabulary).
// The pure validator lives in lib/materialCatalog.ts (isomorphic); it ignores
// the fallback because normalizeMaterialCatalog always yields a clean array.
export const materialCatalogDoc: StorageValidator<Material[]> = (value) =>
  normalizeMaterialCatalog(value);

// The 3-state kit stock map (material id → have/low/out). The pure validator
// lives in lib/kitStock.ts (isomorphic); it ignores the fallback because
// normalizeKitStock always yields a clean {} on malformed input.
export const kitStockDoc: StorageValidator<Record<string, StockState>> = (value) =>
  normalizeKitStock(value);

export const DOC_VALIDATORS: { [K in UserDocKey]: StorageValidator<DocValueMap[K]> } = {
  favs: stringArrayDoc,
  extra: activitiesDoc,
  ratings: ratingsDoc,
  runLists: runListOverridesDoc,
  playbookOverrides: playbookOverridesDoc,
  view: viewDoc,
  availableMaterials: stringArrayDoc,
  materialCatalog: materialCatalogDoc,
  kitStock: kitStockDoc,
  themes: themesDoc,
  themeAssignments: themeAssignmentsDoc,
  camps: campsDoc,
  locations: locationsDoc,
  locationColors: locationColorsDoc,
  deletedActivityIds: stringArrayDoc,
};

export function normalizeDoc<K extends UserDocKey>(key: K, raw: unknown): DocValueMap[K] {
  return DOC_VALIDATORS[key](raw, docDefault(key));
}
