# Activity Playbook SOP

## Current State

Activity playbooks are coach-view field diagrams embedded in an activity's book under
"How to play". Every diagram is **editable in place** and new books can ship their own
diagrams. Capture the Flag is the built-in example.

Key files:

- `lib/playbooks.ts` — data model, factories (`newPlayer`/`newFlag`/`newZone`/`newArrow`/`newFrame`/`blankPlaybook`), the `normalizePlaybook` guard, and the built-in `PLAYBOOKS_BY_ACTIVITY_ID` registry.
- `components/ActivityPlaybook.tsx` — read-only renderer + the shared SVG shape primitives (`FieldSurface`, `ZoneShape`, `FlagShape`, `PlayerShape`, `ArrowShape`). The same primitives draw both the static diagram and the editor, so a viewed diagram and an edited one are pixel-identical.
- `components/PlaybookEditor.tsx` — the interactive editor (drag/add/remove pieces, manage stages).

## Data Model

```ts
ActivityPlaybookData = {
  id, activityId, title, summary,
  eyebrow?,                 // optional
  surface?: { split?: boolean },   // split = two tinted team halves + midline
  frames: PlaybookFrame[],
}

PlaybookFrame = {
  id, name, caption, alt?,
  zones:   PlaybookZone[],    // { id, kind: "safe"|"jail"|"area", x, y, w, h, label? }
  flags:   PlaybookFlag[],    // { id, team: "blue"|"red", x, y }
  players: PlaybookPlayer[],  // { id, team, x, y, role?: "runner"|"flag" }
  arrows:  PlaybookArrow[],   // { id, from:[x,y], to:[x,y], team?: "blue"|"red"|"neutral" }
}
```

All coordinates live in a `0–100` square (the SVG viewBox), so a frame scales to any
pane with no re-layout. `normalizePlaybook` repairs partial/hand-edited data so a bad
shape can never crash the render.

## Where Diagrams Live (persistence)

- **Custom books** carry their diagram on `Activity.playbook` (persisted with the book in `extra`).
- **Built-in books** (e.g. Capture the Flag) start from `PLAYBOOKS_BY_ACTIVITY_ID`; edits are
  saved with the full edited activity in the `camp:overrides` localStorage map — the seed data is
  never mutated, and diagram edits stay together with title/material/step edits.
- Resolution order in `CampApp`: edited activity override → seed/custom activity with
  `Activity.playbook` → built-in `PLAYBOOKS_BY_ACTIVITY_ID` registry → none.

## Editing flow

- In a book, **double-click any stage** (or press "Edit diagram") to open the editor.
- Tools: add Blue/Red player, Flag, Zone, Arrow. New pieces appear on the field, then drag to place.
- Select a piece to change team / marker (plain/runner/carrier) / zone type+label / arrow color, or remove it.
- Drag a zone to move it; drag its bottom-right corner handle to resize.
- Manage stages with the numbered tabs (`+` adds one); rename/caption each stage; duplicate or delete a stage.
- "Save diagram" persists; "Cancel" discards.
- New books: the **Add** form has a "Diagram" section — "Add a diagram" opens the same editor; it submits with the book.

## Authoring Checklist

- Match the activity's instructions, materials, safety notes, age range, and group size.
- Keep each frame readable at narrow book widths.
- Use three to five frames for games with movement over time; one frame for a static craft/table setup.
- Use visible captions for counselors and `alt` text for screen readers (the editor falls back to the caption if `alt` is empty).
- Avoid color-only meaning: blue is circles, red is squares; add labels/markers as needed.
- Keep player counts realistic for the activity.
- Keep diagram strokes consistent: outer field border strongest, midfield lighter, zones/jails lightest.
- Do not let zones overlap. Safe zones, jails, labels, flags, arrows, and player markers need visible breathing room.
- Do not show a base flag and a carried flag for the same object in the same frame. Use the carried marker only once possession changes.
- Keep zone labels inside their zone and away from flags, players, arrows, and page edges.
- Keep safety boundaries away from trees, slopes, roads, water, and hard obstacles unless the activity explicitly requires those areas.

## AI Authoring Rules

- AI can draft playbook JSON, but physical safety language must be reviewed by a human.
- AI must not invent unsafe mechanics that conflict with the activity safety field.
- AI must reconcile generated materials with `Activity.materials`.
- AI must state assumptions for group size, space, age range, and win condition.
- AI-generated coordinates must stay in the 0–100 coordinate space.

## Review Checklist

- Open the activity in book view; double-click a stage and confirm the editor opens.
- Add, drag, reteam, and remove a piece; resize a zone; add and delete a stage; Save and reopen — confirm it persisted.
- Confirm frames do not overflow or clip on mobile-width and desktop-width panes.
- Confirm arrows, flags, players, zones are understandable without color alone.
- Confirm no piece overlaps another piece, arrowhead, label, or zone boundary in a saved diagram.
- Confirm carried-object frames do not duplicate the same object at its base.
- Confirm every read-only SVG has a useful title and description.
- Confirm generated marker IDs cannot collide when more than one playbook is mounted.
- Run `npm run typecheck` and `npm run build`.

## Verification

```sh
npm run typecheck
npm run build
```

Preview the built-in example directly at:

```text
http://localhost:3000/?activity=capture-flag
```

## Revert

```sh
git restore app/globals.css components/CampApp.tsx components/DetailSheet.tsx components/AddView.tsx lib/types.ts
rm components/ActivityPlaybook.tsx components/PlaybookEditor.tsx lib/playbooks.ts docs/playbook-sop.md
```
