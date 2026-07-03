import { describe, expect, it } from "vitest";
import {
  defaultMealsDoc,
  dietaryBySeverity,
  DIETARY_DETAIL_MAX,
  DIETARY_LABEL_MAX,
  MENU_NOTE_MAX,
  menuNoteFor,
  normalizeMealsDoc,
  setMenuNote,
} from "./meals";

describe("normalizeMealsDoc", () => {
  it("yields an empty doc for malformed input", () => {
    expect(normalizeMealsDoc(null)).toEqual(defaultMealsDoc());
    expect(normalizeMealsDoc("nope")).toEqual({ dietary: [], menuNotes: {} });
    expect(normalizeMealsDoc([])).toEqual({ dietary: [], menuNotes: {} });
  });

  it("keeps well-formed dietary entries, dropping malformed ones and deduping by id", () => {
    const doc = normalizeMealsDoc({
      dietary: [
        { id: "d1", label: "Peanuts", severity: "severe", detail: "EpiPen in office" },
        { id: "d1", label: "Duplicate id", severity: "avoid" }, // dup id -> dropped
        { id: "", label: "No id" }, // dropped
        { id: "d2", label: "" }, // no label -> dropped
        { id: "d3", label: "Dairy" }, // severity defaults to "note"
        { id: "d4", label: "Gluten", severity: "bogus" }, // bad severity -> "note"
      ],
    });
    expect(doc.dietary).toEqual([
      { id: "d1", label: "Peanuts", severity: "severe", detail: "EpiPen in office" },
      { id: "d3", label: "Dairy", severity: "note" },
      { id: "d4", label: "Gluten", severity: "note" },
    ]);
  });

  it("trims and length-clamps label and detail", () => {
    const [entry] = normalizeMealsDoc({
      dietary: [
        {
          id: "d1",
          label: "  " + "x".repeat(DIETARY_LABEL_MAX + 20) + "  ",
          severity: "note",
          detail: "y".repeat(DIETARY_DETAIL_MAX + 20),
        },
      ],
    }).dietary;
    expect(entry.label.length).toBe(DIETARY_LABEL_MAX);
    expect(entry.detail?.length).toBe(DIETARY_DETAIL_MAX);
  });

  it("keeps date-keyed menu notes and drops malformed dates/kinds/empties", () => {
    const doc = normalizeMealsDoc({
      menuNotes: {
        "2026-07-08": { lunch: "  Pizza + salad  ", "am-snack": "Apples", bogus: "ignored", other: "" },
        "not-a-date": { lunch: "dropped" },
        "2026-07-09": { lunch: 7 }, // non-string -> dropped, day becomes empty -> dropped
      },
    });
    expect(doc.menuNotes).toEqual({
      "2026-07-08": { "am-snack": "Apples", lunch: "Pizza + salad" },
    });
  });

  it("clamps a menu note to the max length", () => {
    const doc = normalizeMealsDoc({
      menuNotes: { "2026-07-08": { lunch: "z".repeat(MENU_NOTE_MAX + 50) } },
    });
    expect(doc.menuNotes["2026-07-08"].lunch?.length).toBe(MENU_NOTE_MAX);
  });

  it("is deterministic: sorts date keys ascending", () => {
    const doc = normalizeMealsDoc({
      menuNotes: {
        "2026-07-10": { lunch: "b" },
        "2026-07-08": { lunch: "a" },
        "2026-07-09": { lunch: "c" },
      },
    });
    expect(Object.keys(doc.menuNotes)).toEqual(["2026-07-08", "2026-07-09", "2026-07-10"]);
  });
});

describe("dietaryBySeverity", () => {
  it("sorts severe first, then avoid, then note, keeping insertion order within a tier", () => {
    const doc = normalizeMealsDoc({
      dietary: [
        { id: "a", label: "A", severity: "note" },
        { id: "b", label: "B", severity: "severe" },
        { id: "c", label: "C", severity: "avoid" },
        { id: "d", label: "D", severity: "note" },
        { id: "e", label: "E", severity: "severe" },
      ],
    });
    expect(dietaryBySeverity(doc).map((x) => x.id)).toEqual(["b", "e", "c", "a", "d"]);
  });

  it("does not mutate the source doc", () => {
    const doc = normalizeMealsDoc({
      dietary: [
        { id: "a", label: "A", severity: "note" },
        { id: "b", label: "B", severity: "severe" },
      ],
    });
    dietaryBySeverity(doc);
    expect(doc.dietary.map((x) => x.id)).toEqual(["a", "b"]);
  });
});

describe("menuNoteFor / setMenuNote", () => {
  it("reads an empty string when no note is set", () => {
    expect(menuNoteFor(defaultMealsDoc(), "2026-07-08", "lunch")).toBe("");
  });

  it("sets, trims, and reads back a note without mutating the source", () => {
    const base = defaultMealsDoc();
    const next = setMenuNote(base, "2026-07-08", "lunch", "  Tacos  ");
    expect(menuNoteFor(next, "2026-07-08", "lunch")).toBe("Tacos");
    expect(menuNoteFor(base, "2026-07-08", "lunch")).toBe(""); // source untouched
  });

  it("clearing a note deletes the slot and prunes an emptied day", () => {
    let doc = setMenuNote(defaultMealsDoc(), "2026-07-08", "lunch", "Tacos");
    doc = setMenuNote(doc, "2026-07-08", "am-snack", "Fruit");
    doc = setMenuNote(doc, "2026-07-08", "lunch", "   "); // clear lunch
    expect(doc.menuNotes["2026-07-08"]).toEqual({ "am-snack": "Fruit" });
    doc = setMenuNote(doc, "2026-07-08", "am-snack", ""); // clear the last note
    expect(doc.menuNotes["2026-07-08"]).toBeUndefined();
  });

  it("ignores invalid date keys and meal kinds", () => {
    const base = defaultMealsDoc();
    expect(setMenuNote(base, "bad", "lunch", "x")).toBe(base);
    // @ts-expect-error — guard rejects an unknown meal kind at runtime.
    expect(setMenuNote(base, "2026-07-08", "brunch", "x")).toBe(base);
  });
});
