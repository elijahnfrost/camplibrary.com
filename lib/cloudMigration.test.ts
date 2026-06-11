import { describe, expect, it } from "vitest";
import { collectLocalDocsForImport } from "./cloudMigration";

function fakeStorage(entries: Record<string, string>) {
  return {
    getItem: (key: string) => (key in entries ? entries[key] : null),
  };
}

const SCOPE = "user:test";

describe("collectLocalDocsForImport", () => {
  it("collects scoped keys, mapping legacy localStorage names to doc keys", () => {
    const storage = fakeStorage({
      ["camp:" + SCOPE + ":favs"]: JSON.stringify(["ctf"]),
      ["camp:" + SCOPE + ":runLists.v2"]: JSON.stringify({
        ctf: { blocks: [{ id: "b1", type: "step", text: "Go" }] },
      }),
      ["camp:" + SCOPE + ":playbooks"]: JSON.stringify({}),
      ["camp:" + SCOPE + ":view"]: JSON.stringify("shelf"),
    });
    const docs = collectLocalDocsForImport(storage, SCOPE);
    expect(Object.keys(docs).sort()).toEqual(["favs", "runLists", "view"]);
    expect(docs.favs).toEqual(["ctf"]);
    expect(docs.view).toBe("shelf");
  });

  it("skips defaults, empties, other scopes, and corrupt JSON", () => {
    const storage = fakeStorage({
      ["camp:" + SCOPE + ":favs"]: JSON.stringify([]),
      ["camp:" + SCOPE + ":view"]: JSON.stringify("deck"),
      ["camp:" + SCOPE + ":ratings"]: "{corrupt",
      ["camp:anon:extra"]: JSON.stringify([{ id: "x" }]),
    });
    expect(collectLocalDocsForImport(storage, SCOPE)).toEqual({});
  });

  it("normalizes values before importing them", () => {
    const storage = fakeStorage({
      ["camp:" + SCOPE + ":ratings"]: JSON.stringify({ ctf: 99, junk: "x" }),
    });
    expect(collectLocalDocsForImport(storage, SCOPE)).toEqual({ ratings: { ctf: 5 } });
  });
});
