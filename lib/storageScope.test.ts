import { describe, expect, it } from "vitest";
import { migrateLegacyStorageKeys, scopedStorageKey } from "./storageScope";

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
