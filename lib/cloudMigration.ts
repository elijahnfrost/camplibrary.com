// One-time localStorage → cloud migration for signed-in users. Collection is
// pure (storage injected) so it's unit-testable; the upload itself lives in
// the cloud store. The marker is per-user-scope, and the server inserts with
// ON CONFLICT DO NOTHING, so re-runs and multi-device races are harmless.

import { scopedStorageKey } from "./storageScope";
import {
  DOC_LOCAL_KEYS,
  USER_DOC_KEYS,
  docDefault,
  normalizeDoc,
  type UserDocKey,
} from "./userDataDocs";

export const MIGRATION_MARKER_KEY = "cloudMigrated.v1";

type StorageLike = {
  getItem(key: string): string | null;
};

const STORAGE_PREFIX = "camp:";

function isDefaultValue(key: UserDocKey, value: unknown): boolean {
  return JSON.stringify(value) === JSON.stringify(docDefault(key));
}

// Reads each synced key from the scope's localStorage, normalizes it, and
// drops values that are empty/defaults — nothing worth uploading.
export function collectLocalDocsForImport(
  storage: StorageLike,
  scope: string
): Partial<Record<UserDocKey, unknown>> {
  const out: Partial<Record<UserDocKey, unknown>> = {};
  for (const key of USER_DOC_KEYS) {
    const fullKey = STORAGE_PREFIX + scopedStorageKey(scope, DOC_LOCAL_KEYS[key]);
    const raw = storage.getItem(fullKey);
    if (raw == null) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const normalized = normalizeDoc(key, parsed);
    if (isDefaultValue(key, normalized)) continue;
    out[key] = normalized;
  }
  return out;
}
