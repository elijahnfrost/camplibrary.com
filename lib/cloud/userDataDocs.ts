// Camp Library — synced user-data documents.
//
// Each "doc" is one JSON value mirroring a localStorage key: favorites,
// custom activities, ratings, run-list overrides, playbook overrides, the
// library view mode, and the available-kit list. The same validators run on
// the client (hydrating localStorage) and on the server (validating API
// payloads before they reach Postgres), so the database only ever holds
// shapes the client renderers accept. No "use client" directive — this module
// must stay isomorphic.

import type { Activity, LibraryView } from "../types";
import { normalizeActivities } from "../activity/activityValidation";
import { normalizePlaybook, type ActivityPlaybookData } from "../activity/playbooks";
import { normalizeRunDoc, type RunDoc } from "../activity/runList";
import type { StorageValidator } from "./store";
import { normalizeThemeAssignments, normalizeThemes, type Theme } from "../content/themes";
import { normalizeCamps, type Camp } from "../content/camps";
import { DEFAULT_LOCATIONS, normalizeLocationVocab } from "../content/locations";
import { normalizeHexColor } from "../content/color";
import { normalizeMaterialCatalog, type Material } from "../materials/materialCatalog";
import { normalizeKitStock, type StockState } from "../materials/kitStock";
import { normalizeGuides, type GuideBand } from "../calendar/guides";
import { DEFAULT_CAMP_DOCUMENTS, normalizeCampDocuments, type CampDocument } from "../content/campDocuments";

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
  "guides",
  "documents",
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
  guides: GuideBand[];
  documents: CampDocument[];
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
  guides: "guides.v1",
  documents: "documents.v1",
};

const DOC_DEFAULT_FACTORIES: { [K in UserDocKey]: () => DocValueMap[K] } = {
  favs: () => [],
  extra: () => [],
  ratings: () => ({}),
  runLists: () => ({}),
  playbookOverrides: () => ({}),
  // Shelf is the Library's default landing view (core app identity) — a
  // stored preference (any of the three) always wins over this default.
  view: () => "shelf",
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
  guides: () => [],
  // A fresh account sees the prepared seed PDFs; once the list is edited the
  // stored array wins (same "default then stored overrides" contract as camps).
  documents: () => [...DEFAULT_CAMP_DOCUMENTS],
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

const stringArrayDoc: StorageValidator<string[]> = (value, fallback) =>
  Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string" && Boolean(item)))]
    : fallback;

const ratingsDoc: StorageValidator<Record<string, number>> = (value, fallback) => {
  if (!isRecord(value)) return fallback;
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "number" && Number.isFinite(raw)) {
      out[key] = Math.max(0, Math.min(5, Math.round(raw)));
    }
  }
  return out;
};

const activitiesDoc: StorageValidator<Activity[]> = (value, fallback) =>
  normalizeActivities(value, fallback);

// Per-activity playbook overrides — lets any diagram (including built-in ones)
// be edited and persisted without mutating the seed data.
const playbookOverridesDoc: StorageValidator<Record<string, ActivityPlaybookData>> = (
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
const runListOverridesDoc: StorageValidator<Record<string, RunDoc>> = (value, fallback) => {
  if (!isRecord(value)) return fallback;
  const out: Record<string, RunDoc> = {};
  for (const [key, raw] of Object.entries(value)) {
    const normalized = normalizeRunDoc(raw);
    if (normalized) out[key] = normalized;
  }
  return out;
};

const viewDoc: StorageValidator<LibraryView> = (value, fallback) =>
  value === "shelf" || value === "deck" || value === "catalog" ? value : fallback;

// The user-definable theme vocabulary, and the activityId -> themeId map that
// assigns one to each activity. Both validators run client + server.
const themesDoc: StorageValidator<Theme[]> = (value, fallback) =>
  normalizeThemes(value, fallback);

const themeAssignmentsDoc: StorageValidator<Record<string, string>> = (value, fallback) =>
  normalizeThemeAssignments(value, fallback);

// The user's camps (separate scheduling containers; the catalog stays shared).
const campsDoc: StorageValidator<Camp[]> = (value, fallback) => normalizeCamps(value, fallback);

// The user-editable location vocabulary (places a block can happen). Events
// store the label directly, so this is a plain ordered list of unique strings.
const locationsDoc: StorageValidator<string[]> = (value, fallback) =>
  normalizeLocationVocab(value, fallback);

// Per-location color overrides: place LABEL → validated hex. Mirrors the ratings
// map (a sparse override layer over a fixed default), so it rides existing
// zero-DDL round-trips. Non-hex values and non-string keys are dropped, so the
// renderers and color resolvers only ever see clean hex strings.
const locationColorsDoc: StorageValidator<Record<string, string>> = (value, fallback) => {
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
const materialCatalogDoc: StorageValidator<Material[]> = (value) =>
  normalizeMaterialCatalog(value);

// The 3-state kit stock map (material id → have/low/out). The pure validator
// lives in lib/kitStock.ts (isomorphic); it ignores the fallback because
// normalizeKitStock always yields a clean {} on malformed input.
const kitStockDoc: StorageValidator<Record<string, StockState>> = (value) =>
  normalizeKitStock(value);

// The day-structure guide bands. The pure validator lives in
// lib/calendar/guides.ts (isomorphic); it ignores the fallback because
// normalizeGuides always yields a clean array on malformed input.
const guidesDoc: StorageValidator<GuideBand[]> = (value) => normalizeGuides(value);

// The downloadable camp documents (seed PDFs + uploaded files). The pure
// validator lives in lib/content/campDocuments.ts (isomorphic); it drops malformed
// rows and keeps only sources the browser can actually open.
const documentsDoc: StorageValidator<CampDocument[]> = (value, fallback) =>
  normalizeCampDocuments(value, fallback);

const DOC_VALIDATORS: { [K in UserDocKey]: StorageValidator<DocValueMap[K]> } = {
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
  guides: guidesDoc,
  documents: documentsDoc,
};

export function normalizeDoc<K extends UserDocKey>(key: K, raw: unknown): DocValueMap[K] {
  return DOC_VALIDATORS[key](raw, docDefault(key));
}
