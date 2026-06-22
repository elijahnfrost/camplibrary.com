# AI Authoring Guide

## Definitive Statement

An AI editing Camp Library from CloudCode, Claude Code, or another GitHub-aware tool
must treat `tools/camp-mcp` as the source-of-truth write interface. Do not hand-edit
database rows, localStorage snapshots, or seed activity arrays to create schedules.
Use the MCP tools so every event, activity, run list, diagram, camp, theme, and rating
passes the same validators the app uses.

## Required Operating Sequence

1. Run `list_context` (or `search_activities` to resolve one activity by name).
   Read the real activity ids, custom activity ids, camps, themes, age bands, and
   fixed categories before writing anything. When you only need a specific book —
   "that octopus tag game" — `search_activities` returns the matching id directly.
2. Decide whether the work is an activity, a calendar event, or both.
   `Gaga Ball`, `Capture the Flag`, and the built-in library entries are activities.
   A scheduled block on a date is an event.
3. For a new or updated activity, call `add_custom_activity` with a stable `id`.
   Stable ids make future bulk edits deterministic. Existing built-in ids can be
   promoted into user-owned editable records by writing the same id.
4. Write the complete run sheet with `set_run_list`.
   This tool replaces the activity's whole instruction document. Always send the
   complete desired run list, not a fragment.
5. Write diagrams with `set_diagram`, or embed a diagram child inside a run-list step.
   Coordinates are always `0..100`, never pixels.
6. Put one-off activities on the calendar with `upsert_event` or `create_day_schedule`.
   Use `create_series` for anything described as every, each, repeating, daily,
   weekday, weekly, monthly, yearly, or continuing into future dates. Prefer
   `activityId`; `activityTitle` and exact title matches are accepted for common
   one-off cases like `Gaga Ball`.
7. Verify with `list_events`.
   For edits/deletes, get ids from `list_events`, then reuse those UUIDs. Partial
   `upsert_event` edits preserve omitted fields for non-repeating events. If a
   listed event has `seriesId`/`recurrence`, use `edit_series` or `delete_series`
   and choose an explicit scope: `this`, `following`, or `all`.

## MCP Tool Inventory

Use every relevant tool instead of overloading one write path:

| Tool | Use |
| --- | --- |
| `list_context` | Discover real ids for activities, camps, themes, categories, and age bands. |
| `search_activities` | Find a specific activity id by name/alt-name/type/blurb/materials. Prefer this over `list_context` when you know roughly what you want — `list_context` dumps all 200+. |
| `list_events` | Inspect scheduled events and get UUIDs for edit/delete. |
| `upsert_event` | Create or edit one non-repeating event. Existing ids support partial edits. Carries per-event `color` and `location`. Refuses series occurrences; use `edit_series` for those. |
| `create_day_schedule` | Bulk-create one non-repeating sequenced day from ordered blocks. |
| `recolor_events` | Set/clear the per-event color override on a batch (by `ids`, or every placement of an `activityId`, optionally a date range). `color:null` clears. |
| `duplicate_event` | Clone one event into a standalone copy (detached from any series); optional new `date`/`startMin`. |
| `delete_event` | Delete a non-repeating scheduled event by UUID. Refuses series occurrences. |
| `delete_events` | Hard-delete several non-repeating events at once by UUID. Refuses series occurrences. |
| `create_series` / `edit_series` / `delete_series` | Create/scope-edit/scope-delete a repeating event (this / following / all). |
| `add_custom_activity` | Add or update a library activity with a stable id (accepts a default `color`). |
| `set_activity_color` | Set/clear a library activity's DEFAULT color (works on built-ins via promotion; `color:null` resets to the category tint). |
| `set_run_list` | Replace an activity's run sheet. |
| `set_diagram` | Replace an activity-level field diagram. |
| `add_camp` | Create a scheduling container and get its `campId`. |
| `edit_camp` | Rename a camp and/or move its viewing hours (drop-off → pickup). |
| `delete_camp` | Remove a camp (its events fall back to unscoped, not deleted). |
| `add_theme` | Create a theme tag. |
| `edit_theme` | Rename a theme. |
| `delete_theme` | Delete a theme and purge its assignments. |
| `assign_theme` | Attach a theme to an activity. |
| `unassign_theme` | Remove an activity's theme tag. |
| `set_rating` | Set an activity rating from `0` to `5`. |

## Run-Sheet Capability Checklist

A high-quality AI-authored run sheet must consider every supported block and child
type. Use the capability when it adds real counselor value; do not pad the document
with fake content.

Top-level block types:

| Block type | Use |
| --- | --- |
| `details` | Structured overview details owned by the app scaffold. Usually let the UI derive this. |
| `heading` | Separate phases such as Setup, How to Play, Reset, or Debrief. |
| `materials` | Checklist of required equipment. |
| `step` | Numbered counselor action. This is the main spine of the run sheet. |
| `note` | Non-safety counselor guidance or reminders. |
| `safety` | Standalone safety rule that should be visually prominent. |
| `variation` | Alternate rules for age, space, group size, or difficulty. |
| `playbook` | Diagram-oriented section when the visual plan is the main content. |

Step/detail/material/playbook child types:

| Child type | Use |
| --- | --- |
| `substep` | Break one counselor action into smaller actions. |
| `note` | Attach a tip to a specific step. |
| `safety` | Attach a hazard or boundary rule to a specific step. |
| `variation` | Attach a modification to a specific step. |
| `materials` | Attach a material checklist where it is used. |
| `diagram` | Embed a field diagram directly in the run sheet flow. |
| `video` | Add a known external demo URL. Do not invent video links. |

Diagram tools inside `set_diagram` or a `diagram` child:

| Diagram piece | Use |
| --- | --- |
| `frames` | Show stages over time. Use multiple frames for movement games. |
| `zones` | Mark safe areas, jails, bases, lanes, courts, or boundaries. |
| `markers` | Place players, flags, pins, labels, or objects. |
| `arrows` | Show movement, passes, rotations, or flow. |
| `surface.split` | Show two-team territory games. |
| `surface.grid` | Use for layout precision when helpful. |
| `frame.alt` | Required prose description for accessibility and print. |

Allowed diagram marker colors: `teal`, `clay`, `amber`, `sage`, `dusk`, `ink`.
Allowed marker shapes: `circle`, `square`, `triangle`, `diamond`, `flag`, `pin`,
`text`. Allowed zone kinds: `safe`, `jail`, `area`. Allowed arrow teams:
`blue`, `red`, `neutral`.

## Event Authoring Rules

- Every event must have a UUID. Omit `id` only when creating a new event.
- Reuse an existing `id` from `list_events` to edit in place.
- For timed events, use minutes from local midnight: `540` is 9:00 am.
- Times snap to the 15-minute grid and must remain inside `0..1440`.
- Use `allDay: true` for all-day events.
- Use `activityId` for activity-backed events. Use `kind: "custom"` or
  `activityId: null` for plain events such as lunch, assembly, or pickup.
- Use `campId` from `list_context` or `add_camp` when scheduling inside a camp.
- Use `location` for gym, field, playground, room, or water area.
- Color resolves `event.color → activity.color → category tint`. To recolor one
  placement, set `color` on `upsert_event` (or batch with `recolor_events`); to
  recolor an activity everywhere, use `set_activity_color`. `null` clears, falling
  back down that chain. Colors are hex (`#3f6b45` or `#abc`).
- Do not create repeats by calling `upsert_event` once per date. Use
  `create_series` with a recurrence rule and an inclusive `until` date so future
  occurrences share `seriesId` and can later be edited or deleted with
  `this`/`following`/`all` scope.
- When editing or deleting an event returned by `list_events`, check for
  `seriesId`. If it is present, use `edit_series` or `delete_series`, never
  `upsert_event`, `delete_event`, or `delete_events`.

## Activity Authoring Rules

- Prefer stable lowercase kebab ids: `gaga-ball`, `capture-flag`, `water-relay`.
- Use the five fixed categories only: `Game`, `Craft`, `Song`, `Water`, `Quiet`.
- Use the five fixed age bands only: `pre`, `g13`, `g46`, `g79`, `g1012`.
- Include `altNames` for local names and search aliases.
- Keep `materials`, `steps`, `notes`, and `safety` aligned with the run sheet.
- If a built-in activity should be edited, write the same id with
  `add_custom_activity`; the app will treat it as the editable user-owned version.

## Example: Rich Activity + Event Flow

```json
{
  "tool": "add_custom_activity",
  "input": {
    "id": "gaga-ball",
    "title": "Gaga Ball",
    "altNames": ["Gaga", "Ga-ga ball", "Octoball"],
    "type": "Game",
    "place": "Outside",
    "durationMin": 20,
    "ages": ["g13", "g46", "g79"],
    "materials": ["Soft foam ball", "Gaga pit or taped octagon"],
    "safety": "Open-hand hits only; keep hits below the knee."
  }
}
```

Then call `set_run_list` for `activityId: "gaga-ball"` with headings, materials,
steps, substeps, notes, safety calls, variations, and at least one diagram when the
space layout matters. Finally call `upsert_event`:

```json
{
  "date": "2026-07-06",
  "startMin": 540,
  "endMin": 570,
  "activityId": "gaga-ball",
  "location": "Gaga pit"
}
```

## Verification Before Finishing

An AI should not report completion until it has:

1. Called `list_events` for the affected date range.
2. Confirmed every created event has an id, date, title, and correct activity link.
3. Re-opened edited activities through `list_context` and confirmed ids/titles.
4. Confirmed run lists and diagrams were written with `set_run_list`/`set_diagram`
   without tool errors.
5. Reported any assumptions about ages, space, group size, materials, or safety.
