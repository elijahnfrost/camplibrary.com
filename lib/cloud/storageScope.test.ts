import { describe, expect, it } from "vitest";
import { migrateAnonScopeKeys, migrateLegacyStorageKeys, scopedStorageKey } from "./storageScope";

class MemoryStorage {
  private items = new Map<string, string>();

  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

describe("storage scope migration", () => {
  it("copies legacy keys into the active scope without deleting the legacy value", () => {
    const storage = new MemoryStorage();
    storage.setItem("camp:favs", "[\"capture-flag\"]");

    migrateLegacyStorageKeys(storage, "anon", ["favs"]);

    expect(storage.getItem("camp:favs")).toBe("[\"capture-flag\"]");
    expect(storage.getItem("camp:" + scopedStorageKey("anon", "favs"))).toBe("[\"capture-flag\"]");
  });

  it("does not overwrite an existing scoped key", () => {
    const storage = new MemoryStorage();
    storage.setItem("camp:favs", "[\"capture-flag\"]");
    storage.setItem("camp:" + scopedStorageKey("user:user_123", "favs"), "[\"gaga-ball\"]");

    migrateLegacyStorageKeys(storage, "user:user_123", ["favs"]);

    expect(storage.getItem("camp:" + scopedStorageKey("user:user_123", "favs"))).toBe("[\"gaga-ball\"]");
  });
});

describe("anon → user scope migration", () => {
  const anonKey = (k: string) => "camp:" + scopedStorageKey("anon", k);
  const userKey = (k: string) => "camp:" + scopedStorageKey("user:user_123", k);

  it("carries anon-scope events + docs into a fresh account scope", () => {
    const storage = new MemoryStorage();
    storage.setItem(anonKey("calendarEvents.v1"), "[{\"id\":\"e1\"}]");
    storage.setItem(anonKey("favs"), "[\"capture-flag\"]");

    migrateAnonScopeKeys(storage, "user:user_123", ["calendarEvents.v1", "favs"]);

    expect(storage.getItem(userKey("calendarEvents.v1"))).toBe("[{\"id\":\"e1\"}]");
    expect(storage.getItem(userKey("favs"))).toBe("[\"capture-flag\"]");
    // Anon copy is left intact (signing back out keeps the anon view).
    expect(storage.getItem(anonKey("favs"))).toBe("[\"capture-flag\"]");
  });

  it("never clobbers existing account data", () => {
    const storage = new MemoryStorage();
    storage.setItem(anonKey("favs"), "[\"capture-flag\"]");
    storage.setItem(userKey("favs"), "[\"gaga-ball\"]");

    migrateAnonScopeKeys(storage, "user:user_123", ["favs"]);

    expect(storage.getItem(userKey("favs"))).toBe("[\"gaga-ball\"]");
  });

  it("is a no-op for the anon scope itself", () => {
    const storage = new MemoryStorage();
    storage.setItem(anonKey("favs"), "[\"capture-flag\"]");

    migrateAnonScopeKeys(storage, "anon", ["favs"]);

    // No user scope written; nothing copied onto itself.
    expect(storage.getItem(anonKey("favs"))).toBe("[\"capture-flag\"]");
  });
});
