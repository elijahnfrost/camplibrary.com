# AI Authoring Guide

## Definitive Statement

An AI editing Camp Library from CloudCode, Claude Code, or another GitHub-aware tool
must treat `tools/camp-mcp` as the source-of-truth write interface. Do not hand-edit
database rows, localStorage snapshots, or seed activity arrays to create schedules.
Use the MCP tools so every event, activity, run list, diagram, camp, theme, and rating
passes the same validators the app uses.

## Required Operating Sequence

1. Run `list_context`.
   Read the real activity ids, custom activity ids, camps, themes, age bands, and
   fixed categories before writing anything.
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
6. Put activities on the calendar with `upsert_event` or `create_day_schedule`.
   Prefer `activityId`; `activityTitle` and exact title matches are accepted for
   common cases like `Gaga Ball`.
7. Verify with `list_events`.
   For edits/deletes, get ids from `list_events`, then reuse those UUIDs. Partial
   `upsert_event` edits preserve omitted fields.

## MCP Tool Inventory

Use every relevant tool instead of overloading one write path:

| Tool | Use |
| --- | --- |
| `list_context` | Discover real ids for activities, camps, themes, categories, and age bands. |
| `list_events` | Inspect scheduled events and get UUIDs for edit/delete. |
| `upsert_event` | Create or edit one event. Existing ids support partial edits. |
| `create_day_schedule` | Bulk-create one sequenced day from ordered blocks. |
| `delete_event` | Delete a scheduled event by UUID. |
| `add_custom_activity` | Add or update a library activity with a stable id. |
| `set_run_list` | Replace an activity's run sheet. |
| `set_diagram` | Replace an activity-level field diagram. |
| `add_camp` | Create a scheduling container and get its `campId`. |
| `add_theme` | Create a theme tag. |
| `assign_theme` | Attach a theme to an activity. |
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
| `video` | Add a *specific, verified* external demo URL. Never invent a video id, and never use a search URL — a `youtube.com/results?search_query=...` "search for this game" link is **not** a demo. If you don't have a real, specific video, omit it. |

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

## Activity Authoring Rules

- Prefer stable lowercase kebab ids: `gaga-ball`, `capture-flag`, `water-relay`.
- Use the five fixed categories only: `Game`, `Craft`, `Song`, `Water`, `Quiet`.
- Use the five fixed age bands only: `pre`, `g13`, `g46`, `g79`, `g1012`.
- Include `altNames` for local names and search aliases.
- Keep `materials`, `steps`, `notes`, and `safety` aligned with the run sheet.
- **`media` and `links` must be specific, *verified* URLs — or omitted.** A good
  tutorial helps most where the run-sheet steps leave a technique ambiguous
  (crafts: folding/weaving/knots; STEM demos). Add one there; skip activities a
  counselor can already run from the steps.
  - **Verify before adding.** Find the URL via a real web search, then actually
    open it (WebFetch) and confirm it (a) resolves to a live page/video — not a
    404, removed/private video, or error — and (b) genuinely matches *this*
    activity/technique. Never invent, guess, or autocomplete a URL (no made-up
    `youtube.com/watch?v=...` ids, no guessed article paths).
  - **Never a search URL.** No `google.com/search?q=...`, no
    `youtube.com/results?search_query=...`. "Search YouTube/Google for *sharks and
    minnows*" is not a resource — ship a real link or none.
  - **Where verified links live:** curate them in `lib/seed/links.json`, keyed by
    final activity id (`{ "<id>": { "media": [{title,url}], "links": [{label,url}] } }`).
    `scripts/build-seed.mjs` merges them onto the catalog (a video → inline player
    via `media`; an article → link card via `links`), sorted ahead of the generic
    director-source link.
  - The build pipeline enforces hygiene: `build-seed.mjs` drops any search URL, and
    `lib/seed/seed.test.ts` fails the build if a search URL ships or a `links.json`
    entry points at a non-existent activity.
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
