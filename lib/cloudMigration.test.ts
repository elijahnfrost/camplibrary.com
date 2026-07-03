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
      // "deck" is a real stored preference (the doc default is "shelf" — see
      // userDataDocs.ts), so it's expected to import, unlike the next test's
      // default-value case.
      ["camp:" + SCOPE + ":view"]: JSON.stringify("deck"),
    });
    const docs = collectLocalDocsForImport(storage, SCOPE);
    expect(Object.keys(docs).sort()).toEqual(["favs", "runLists", "view"]);
    expect(docs.favs).toEqual(["ctf"]);
    expect(docs.view).toBe("deck");
  });

  it("skips defaults, empties, other scopes, and corrupt JSON", () => {
    const storage = fakeStorage({
      ["camp:" + SCOPE + ":favs"]: JSON.stringify([]),
      // "shelf" is the doc default (Shelf is the Library's default landing
      // view — see userDataDocs.ts), so it's skipped like any other default.
      ["camp:" + SCOPE + ":view"]: JSON.stringify("shelf"),
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
