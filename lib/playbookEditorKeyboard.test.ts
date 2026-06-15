import { describe, expect, it } from "vitest";
import type { PlaybookFrame } from "./playbooks";
import {
  describePlaybookSelection,
  nudgePlaybookSelection,
  type PlaybookSelection,
} from "./playbookEditorKeyboard";

const frame: PlaybookFrame = {
  id: "stage-1",
  name: "Setup",
  caption: "",
  zones: [{ id: "zone-1", kind: "safe", x: 92, y: 90, w: 8, h: 9, label: "Home base" }],
  flags: [{ id: "flag-1", team: "red", x: 95, y: 95 }],
  players: [
    { id: "player-1", team: "blue", x: 4, y: 4, role: "runner" },
    { id: "player-2", team: "red", x: 54, y: 45 },
  ],
  arrows: [{ id: "arrow-1", from: [98, 50], to: [99, 60], team: "blue" }],
  markers: [
    { id: "marker-1", x: 4, y: 4, color: "amber", shape: "pin", label: "Craft table" },
    { id: "marker-2", x: 60, y: 60, color: "ink", shape: "text", label: "Start" },
  ],
};

describe("playbook editor keyboard helpers", () => {
  it("describes focusable pieces with clear labels", () => {
    expect(describePlaybookSelection(frame, { type: "player", id: "player-1" })).toBe(
      "Blue runner 1. Use arrow keys to move. Press Delete to remove."
    );
    expect(describePlaybookSelection(frame, { type: "flag", id: "flag-1" })).toBe(
      "Red flag 1. Use arrow keys to move. Press Delete to remove."
    );
    expect(describePlaybookSelection(frame, { type: "zone", id: "zone-1" })).toBe(
      "Home base safe zone. Use arrow keys to move. Press Delete to remove."
    );
    expect(describePlaybookSelection(frame, { type: "arrow", id: "arrow-1" })).toBe(
      "Blue arrow 1. Use arrow keys to move. Press Delete to remove."
    );
    expect(describePlaybookSelection(frame, { type: "marker", id: "marker-1" })).toBe(
      "Craft table — amber pin marker 1. Use arrow keys to move. Press Delete to remove."
    );
    expect(describePlaybookSelection(frame, { type: "marker", id: "marker-2" })).toBe(
      "Start — label 2. Use arrow keys to move. Press Delete to remove."
    );
  });

  it("nudges the selected piece and clamps it inside the field", () => {
    expect(
      nudgePlaybookSelection(frame, { type: "player", id: "player-1" }, { dx: -10, dy: -10 }).players[0]
    ).toMatchObject({ x: 3, y: 3 });

    expect(
      nudgePlaybookSelection(frame, { type: "flag", id: "flag-1" }, { dx: 10, dy: 10 }).flags[0]
    ).toMatchObject({ x: 96, y: 96 });

    expect(
      nudgePlaybookSelection(frame, { type: "zone", id: "zone-1" }, { dx: 8, dy: 8 }).zones[0]
    ).toMatchObject({ x: 91, y: 90 });

    expect(
      nudgePlaybookSelection(frame, { type: "arrow", id: "arrow-1" }, { dx: 4, dy: 4 }).arrows[0]
    ).toMatchObject({ from: [99, 54], to: [99, 64] });

    expect(
      nudgePlaybookSelection(frame, { type: "marker", id: "marker-1" }, { dx: -10, dy: -10 }).markers?.[0]
    ).toMatchObject({ x: 3, y: 3 });
  });

  it("returns the same frame when selection no longer exists", () => {
    const missing: PlaybookSelection = { type: "player", id: "missing" };

    expect(nudgePlaybookSelection(frame, missing, { dx: 1, dy: 1 })).toBe(frame);
    expect(describePlaybookSelection(frame, missing)).toBe("Diagram item. Use arrow keys to move. Press Delete to remove.");
  });
});
