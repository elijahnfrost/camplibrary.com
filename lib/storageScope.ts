// Keys the anon→user-scope migration copies. The old planner's "schedule" and
// "schedulePlans" stay listed so historical plans keep following the account
// scope on disk (nothing reads them anymore, but nothing destroys them either).
export const SCOPED_STORAGE_KEYS = [
  "view",
  "availableMaterials",
  "materialCatalog",
  "favs",
  "extra",
  "playbooks",
  "runLists.v2",
  "schedule",
  "schedulePlans",
  "ratings",
  "calendarEvents.v1",
] as const;

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

const STORAGE_PREFIX = "camp:";

export function scopedStorageKey(scope: string, key: string): string {
  return scope + ":" + key;
}

export function migrateLegacyStorageKeys(
  storage: StorageLike,
  scope: string,
  keys: readonly string[] = SCOPED_STORAGE_KEYS,
): void {
  for (const key of keys) {
    const legacyKey = STORAGE_PREFIX + key;
    const scopedKey = STORAGE_PREFIX + scopedStorageKey(scope, key);
    if (storage.getItem(scopedKey) != null) continue;
    const legacyValue = storage.getItem(legacyKey);
    if (legacyValue != null) storage.setItem(scopedKey, legacyValue);
  }
}

// Carry an anon visitor's data into their account scope on first sign-in. Without
// this, anything created signed-out (events, favorites, custom activities) is
// stranded in the `anon` scope when the scope flips to `user:<id>` — the calendar
// looked empty after signing in. Copies each key only when the user scope doesn't
// already have it, so a returning user's account data is never clobbered. The
// carried docs upload via the cloud import; carried events adopt on first
// bootstrap (see lib/cloudStore). Idempotent and safe to re-run.
export function migrateAnonScopeKeys(
  storage: StorageLike,
  userScope: string,
  keys: readonly string[] = SCOPED_STORAGE_KEYS,
): void {
  if (!userScope.startsWith("user:")) return;
  for (const key of keys) {
    const anonKey = STORAGE_PREFIX + scopedStorageKey("anon", key);
    const userKey = STORAGE_PREFIX + scopedStorageKey(userScope, key);
    if (storage.getItem(userKey) != null) continue;
    const anonValue = storage.getItem(anonKey);
    if (anonValue != null) storage.setItem(userKey, anonValue);
  }
}
