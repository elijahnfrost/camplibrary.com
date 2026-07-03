import { describe, expect, it } from "vitest";
import {
  activityFromForm,
  formFromActivity,
  quickActivity,
  newActivityId,
} from "./activityForm";
import type { Activity } from "./types";

function activity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: "cd-play-dough",
    title: "Play Dough",
    type: "Craft",
    place: "Both",
    ageMin: 6,
    ageMax: 12,
    durationMin: 30,
    groupMin: null,
    groupMax: null,
    energy: 1,
    prep: "Low",
    blurb: "Squish it.",
    // Verbose, comma-containing free text alongside a curated compact tag list —
    // the real seed shape (lib/seed/lanes/cd.ts).
    materials: ["Flour, all-purpose, ~2 cups per batch", "Table salt, ~1 cup per batch"],
    materialTags: ["Flour", "Salt"],
    steps: ["Mix it"],
    notes: "—",
    safety: "—",
    ages: ["g13", "g46"],
    rating: 0,
    ...overrides,
  };
}

// quickActivity backs the calendar create bar's "Save to library" path: a typed
// name + chosen length becomes a minimal, library-ready Activity in the Routine
// bucket — and, unlike the full form, a 0-minute length stays 0 (a reminder)
// instead of being clamped up to a default.
describe("quickActivity", () => {
  it("builds a Routine-bucket activity at the given length", () => {
    const a = quickActivity("Tie-dye shirts", newActivityId("Tie-dye shirts"), 45);
    expect(a.type).toBe("Routine");
    expect(a.durationMin).toBe(45);
    expect(a.title).toBe("Tie-dye shirts");
    expect(a.id).toMatch(/^tie-dye-shirts-/);
  });

  it("keeps a 0-minute length (a reminder), never clamping it up", () => {
    const a = quickActivity("Sunscreen check", "rm-test", 0);
    expect(a.durationMin).toBe(0);
  });

  it("clamps a negative or non-finite length to 0", () => {
    expect(quickActivity("x", "x1", -10).durationMin).toBe(0);
    expect(quickActivity("x", "x2", Number.NaN).durationMin).toBe(0);
  });

  it("falls back to a title when given only whitespace", () => {
    expect(quickActivity("   ", "blank", 30).title).toBe("Untitled activity");
  });
});

describe("material form round-trip", () => {
  it("seeds rows from the curated tags (tier 2), preferring them over free text", () => {
    const rows = formFromActivity(activity(), "").materialRefs;
    // Compact curated labels, NOT the verbose comma strings — and no fragmenting.
    expect(rows).toEqual([
      { id: "flour", label: "Flour" },
      { id: "salt", label: "Salt" },
    ]);
  });

  it("carries an UNTOUCHED activity's material fields through byte-for-byte", () => {
    const original = activity();
    const form = formFromActivity(original, "");
    // No edits to the rows → verbatim carry-through (no re-slug, no tag clobber).
    const saved = activityFromForm(form, original.id);
    expect(saved.materials).toBe(original.materials); // same reference — no rebuild
    expect(saved.materialTags).toBe(original.materialTags);
    expect(saved.materialRefs).toBeUndefined(); // origin had none; not synthesized
  });

  it("regenerates canonical refs + legacy mirrors when the rows change", () => {
    const form = formFromActivity(activity(), "");
    // Add a row (edit) → the save path regenerates all three material fields.
    const edited = {
      ...form,
      materialRefs: [...form.materialRefs, { id: "water", label: "Water", minted: true }],
    };
    const saved = activityFromForm(edited, "cd-play-dough");
    expect(saved.materialRefs).toEqual([{ id: "flour" }, { id: "salt" }, { id: "water" }]);
    expect(saved.materialTags).toEqual(["Flour", "Salt", "Water"]);
    // The verbose free-text mirror is replaced by clean labels once edited.
    expect(saved.materials).toEqual(["Flour", "Salt", "Water"]);
  });

  it("does NOT clobber a curated materialTags list on a save that only touched notes", () => {
    const form = formFromActivity(activity(), "");
    // Attach a qty note to the first row — a change, so mirrors regenerate, but
    // the curated tag vocabulary ("Flour"/"Salt") must SURVIVE, not fragment into
    // slugs of the old comma-containing free text.
    const edited = {
      ...form,
      materialRefs: form.materialRefs.map((row, i) => (i === 0 ? { ...row, note: "2 cups" } : row)),
    };
    const saved = activityFromForm(edited, "cd-play-dough");
    expect(saved.materialTags).toEqual(["Flour", "Salt"]);
    expect(saved.materialRefs).toEqual([{ id: "flour", note: "2 cups" }, { id: "salt" }]);
    // The note rides into the legacy free-text line for old consumers.
    expect(saved.materials).toEqual(["Flour — 2 cups", "Salt"]);
  });

  it("preserves a typed label after save + reload with an EMPTY catalog", () => {
    // Start from a custom activity with a comma-containing label typed by hand.
    const form = formFromActivity(
      activity({ materials: [], materialTags: [], materialRefs: undefined }),
      ""
    );
    const edited = {
      ...form,
      materialRefs: [{ id: "flour-all-purpose", label: "Flour, all-purpose", minted: true }],
    };
    const saved = activityFromForm(edited, "custom-1");
    // Reload the form from the saved activity with NO catalog — the label must be
    // recovered identically (from the aligned materialTags mirror).
    const reloaded = formFromActivity(saved, "");
    expect(reloaded.materialRefs).toEqual([{ id: "flour-all-purpose", label: "Flour, all-purpose" }]);
  });

  it("re-slugs a MINTED row's id on rename but keeps a STORED row's id frozen", () => {
    // A stored row (from the seed): rename changes only the label, id stays put.
    const seeded = formFromActivity(activity(), "").materialRefs[0];
    expect(seeded).toEqual({ id: "flour", label: "Flour" });

    // Simulate the editor rename via the save path: change the stored row's label.
    const form = formFromActivity(activity(), "");
    const renamedStored = {
      ...form,
      materialRefs: form.materialRefs.map((row, i) =>
        i === 0 ? { ...row, label: "Bread flour" } : row
      ),
    };
    const saved = activityFromForm(renamedStored, "cd-play-dough");
    // Id frozen ("flour"), label updated in the mirror.
    expect(saved.materialRefs?.[0]).toEqual({ id: "flour" });
    expect(saved.materialTags?.[0]).toBe("Bread flour");
  });

  it("drops empty rows and dedupes by id at save", () => {
    const form = formFromActivity(activity({ materials: [], materialTags: [], materialRefs: undefined }), "");
    const edited = {
      ...form,
      materialRefs: [
        { id: "cones", label: "Cones", minted: true },
        { id: "cones", label: "Cones again", minted: true }, // dup id → dropped
        { id: "", label: "", minted: true }, // empty → dropped
      ],
    };
    const saved = activityFromForm(edited, "custom-1");
    expect(saved.materialRefs).toEqual([{ id: "cones" }]);
    expect(saved.materialTags).toEqual(["Cones"]);
  });

  it("carries an empty origin verbatim (byte-stable, no synthesized fields)", () => {
    // quickActivity's shape: empty materials + empty materialTags, no refs. An
    // untouched save must reproduce it exactly, not drop the [] the origin had.
    const original = activity({ materials: [], materialTags: [], materialRefs: undefined });
    const form = formFromActivity(original, "");
    const saved = activityFromForm(form, original.id);
    expect(saved.materials).toBe(original.materials);
    expect(saved.materialTags).toBe(original.materialTags); // the [] carries through
    expect(saved.materialRefs).toBeUndefined();
  });

  it("regenerates to ABSENT fields when the kit is edited down to empty", () => {
    // Origin HAS kit; the user clears every row → a real change, so mirrors
    // regenerate and the optional fields drop out (no [] noise).
    const form = formFromActivity(activity(), "");
    const saved = activityFromForm({ ...form, materialRefs: [] }, "cd-play-dough");
    expect(saved.materials).toEqual([]);
    expect(saved.materialTags).toBeUndefined();
    expect(saved.materialRefs).toBeUndefined();
  });
});
