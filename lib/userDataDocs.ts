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

export const USER_DOC_KEYS = [
  "favs",
  "extra",
  "ratings",
  "runLists",
  "playbookOverrides",
  "view",
  "availableMaterials",
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
};

const DOC_DEFAULT_FACTORIES: { [K in UserDocKey]: () => DocValueMap[K] } = {
  favs: () => [],
  extra: () => [],
  ratings: () => ({}),
  runLists: () => ({}),
  playbookOverrides: () => ({}),
  view: () => "deck",
  availableMaterials: () => [],
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

export const DOC_VALIDATORS: { [K in UserDocKey]: StorageValidator<DocValueMap[K]> } = {
  favs: stringArrayDoc,
  extra: activitiesDoc,
  ratings: ratingsDoc,
  runLists: runListOverridesDoc,
  playbookOverrides: playbookOverridesDoc,
  view: viewDoc,
  availableMaterials: stringArrayDoc,
};

export function normalizeDoc<K extends UserDocKey>(key: K, raw: unknown): DocValueMap[K] {
  return DOC_VALIDATORS[key](raw, docDefault(key));
}
