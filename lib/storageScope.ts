// Keys the anon→user-scope migration copies. The old planner's "schedule" and
// "schedulePlans" stay listed so historical plans keep following the account
// scope on disk (nothing reads them anymore, but nothing destroys them either).
export const SCOPED_STORAGE_KEYS = [
  "view",
  "availableMaterials",
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
