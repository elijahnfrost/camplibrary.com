// Camp Library MCP server (stdio).
//
// Exposes schedule/event/diagram/run-list/customization tools that write
// straight to the production Camp Library database through the app's own
// validators. Register with an MCP client, e.g. Claude Code:
//
//   claude mcp add camp-library \
//     --env DATABASE_URL=postgres://… \
//     --env CAMP_ADMIN_CLERK_USER_ID=user_… \
//     -- npx tsx /ABS/PATH/tools/camp-mcp/src/server.ts
//
// The two env vars are required (see src/config.ts). Nothing is committed.

import "./quiet";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadEnv } from "./config";
import * as store from "./store";

loadEnv();

const COLOR = z.enum(["teal", "clay", "amber", "sage", "dusk", "ink"]);
const SHAPE = z.enum(["circle", "square", "triangle", "diamond", "flag", "pin", "text"]);
const ZONE_KIND = z.enum(["safe", "jail", "area"]);
const ARROW_TEAM = z.enum(["blue", "red", "neutral"]);
const COORD = z.number().min(0).max(100);
const POINT = z.tuple([COORD, COORD]);
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");
const HEX = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "color must be a hex like #2f6f4e or #abc")
  .describe("Per-event color override (hex). Omit to inherit the activity/category tint.");
const SCOPE = z.enum(["this", "following", "all"]);
const RECURRENCE = z
  .object({
    freq: z.enum(["daily", "weekly", "monthly", "yearly"]),
    interval: z.number().int().min(1).max(52).optional().describe("every N days/weeks/months/years (default 1)"),
    weekdays: z
      .array(z.number().int().min(0).max(6))
      .optional()
      .describe("weekly only: which weekdays land an occurrence, 0=Sun..6=Sat (defaults to the start day)"),
    monthDay: z.number().int().min(1).max(31).optional().describe("monthly/yearly: day-of-month anchor (skips months without it)"),
    nthWeekday: z
      .object({ week: z.number().int().describe("1..4 = first..fourth, -1 = last"), weekday: z.number().int().min(0).max(6) })
      .optional()
      .describe("monthly/yearly: nth-weekday anchor, e.g. {week:3,weekday:2} = 3rd Tuesday. Mutually exclusive with monthDay."),
    until: DATE.describe("inclusive last date the series may place an occurrence"),
    exdates: z.array(DATE).optional().describe("specific occurrence dates to skip (EXDATE)"),
  })
  .describe("Repeat rule. Capped at 366 occurrences regardless of `until`.");

const markerSchema = z.object({
  x: COORD,
  y: COORD,
  color: COLOR,
  shape: SHAPE,
  label: z.string().optional(),
});
const zoneSchema = z.object({
  kind: ZONE_KIND,
  x: COORD,
  y: COORD,
  w: z.number().min(1).max(100),
  h: z.number().min(1).max(100),
  color: COLOR.optional(),
  label: z.string().optional(),
});
const arrowSchema = z.object({
  from: POINT,
  to: POINT,
  team: ARROW_TEAM.optional(),
  color: COLOR.optional(),
});
const frameSchema = z.object({
  name: z.string().optional(),
  caption: z.string().optional(),
  alt: z.string().optional().describe("Prose description of the layout (used by PDF/print + screen readers)"),
  markers: z.array(markerSchema).optional(),
  zones: z.array(zoneSchema).optional(),
  arrows: z.array(arrowSchema).optional(),
});

const runChildSchema = z.object({
  type: z.enum(["note", "safety", "video", "variation", "substep", "diagram", "materials"]),
  text: z.string().optional(),
  title: z.string().optional().describe("video: title"),
  url: z.string().optional().describe("video: YouTube/Vimeo/link"),
  diagram: z
    .object({ title: z.string().optional(), summary: z.string().optional(), frames: z.array(frameSchema).min(1) })
    .optional()
    .describe("diagram child: an embedded field diagram"),
});
const runBlockSchema = z.object({
  type: z.enum(["details", "step", "heading", "note", "safety", "variation", "playbook", "materials"]),
  text: z.string().optional(),
  time: z.string().optional().describe("step: small time/cue chip, e.g. '0:00 · setup'"),
  title: z.string().optional(),
  collapsed: z.boolean().optional(),
  children: z.array(runChildSchema).optional().describe("only step/details/materials/playbook may carry children"),
});

const server = new McpServer({ name: "camp-library", version: "1.0.0" });

function text(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}
function fail(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
}

server.registerTool(
  "list_context",
  {
    title: "List schedule context",
    description:
      "Orientation call. Returns the catalog to author against: the 5 fixed activity types (Game/Craft/Song/Water/Quiet), the 5 fixed age bands, every library + custom activity (id/title/type), and the owner's camps, themes, and theme assignments. Read this first so you reference real activity ids.",
    inputSchema: {},
  },
  async () => {
    try {
      return text(await store.listContext());
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "list_events",
  {
    title: "List calendar events",
    description: "Read existing events in a date range (inclusive) to plan around them or get ids to edit/delete. Omit dates for all events.",
    inputSchema: { from: DATE.optional(), to: DATE.optional() },
  },
  async ({ from, to }) => {
    try {
      return text(await store.listEvents({ from, to }));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "upsert_event",
  {
    title: "Create or edit an event",
    description:
      "Create OR edit one NON-repeating calendar event or one materialized occurrence. Times are minutes from local midnight, snapped to a 15-minute grid. For edits, pass an existing id and only the fields you want to change; omitted title/activity/time/location fields are preserved. activityId or activityTitle links a library activity and forces kind='activity'; exact title matches like 'Gaga Ball' also auto-link. Use kind:'custom' or activityId:null for a plain custom event. For a REPEATING event use create_series; to edit/delete a repeating set, use edit_series / delete_series.",
    inputSchema: {
      date: DATE.optional().describe("required for new events; optional when editing an existing id"),
      startMin: z.number().int().min(0).max(1440).optional().describe("e.g. 540 = 9:00am"),
      endMin: z.number().int().min(0).max(1440).optional(),
      allDay: z.boolean().optional(),
      kind: z.enum(["activity", "custom"]).optional(),
      title: z.string().max(200).optional(),
      activityId: z.string().max(120).nullable().optional(),
      activityTitle: z.string().max(200).nullable().optional(),
      campId: z.string().nullable().optional(),
      color: HEX.nullable().optional().describe("hex color like #3f6b45; null clears"),
      location: z.string().max(80).nullable().optional(),
      id: z.string().uuid().optional().describe("reuse to edit an existing event"),
    },
  },
  async (args) => {
    try {
      return text(await store.upsertEvent(args));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "create_day_schedule",
  {
    title: "Lay out a whole day",
    description:
      "Author a full day from an ordered list of blocks, auto-sequencing start times back-to-back on the 15-minute grid from dayStartMin. Each block becomes one event. The fastest 'build me a day' verb.",
    inputSchema: {
      date: DATE,
      dayStartMin: z.number().int().min(0).max(1440).optional().describe("default 540 = 9:00am"),
      campId: z.string().optional(),
      blocks: z
        .array(z.object({ title: z.string().optional(), durationMin: z.number().positive(), activityId: z.string().optional() }))
        .min(1),
    },
  },
  async (args) => {
    try {
      return text(await store.createDaySchedule(args));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "delete_event",
  {
    title: "Delete an event",
    description: "Remove a single NON-repeating event by its UUID (idempotent). To remove part of a repeating series use delete_series; to remove several arbitrary events at once use delete_events.",
    inputSchema: { id: z.string().uuid() },
  },
  async ({ id }) => {
    try {
      await store.deleteEvent(id);
      return text({ ok: true, id });
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "delete_events",
  {
    title: "Delete several events",
    description: "Hard-delete multiple events at once by their UUIDs (idempotent). Independent of any series — for a repeating event use delete_series instead. Returns how many actually existed.",
    inputSchema: { ids: z.array(z.string().uuid()).min(1) },
  },
  async ({ ids }) => {
    try {
      return text(await store.deleteEvents(ids));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "create_series",
  {
    title: "Create a repeating event",
    description:
      "Materialize a repeating event into one real calendar row per occurrence date (the app's series model — every occurrence shares a seriesId and the same rule, so any one can later describe/edit the whole series). `date` is the FIRST occurrence and is ALWAYS included even if it doesn't satisfy the rule's anchor. Times are minutes from midnight on the 15-minute grid (or allDay:true). Returns the seriesId, a human summary of the rule, and the occurrence dates.",
    inputSchema: {
      date: DATE.describe("first occurrence (always included)"),
      startMin: z.number().int().min(0).max(1440).optional(),
      endMin: z.number().int().min(0).max(1440).optional(),
      allDay: z.boolean().optional(),
      title: z.string().max(200).optional(),
      activityId: z.string().max(120).optional(),
      campId: z.string().optional(),
      color: HEX.optional(),
      recurrence: RECURRENCE,
    },
  },
  async (args) => {
    try {
      return text(await store.createSeries(args));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "edit_series",
  {
    title: "Edit a repeating event",
    description:
      "Scoped edit of an event that belongs to a series (the Google-Calendar 'this / this-and-following / all' model). `id` is any occurrence in the series. Unspecified fields inherit that occurrence's current values, so you can change just the title or time. The repeat rule is kept as-is unless you pass a new `recurrence` (regenerates the affected slice) or `stopRepeating:true` (collapses the chosen scope to a single non-repeating event). scope 'following'/'all' regenerate occurrences from the edited template; previously skipped days stay skipped.",
    inputSchema: {
      id: z.string().uuid().describe("any occurrence in the series"),
      scope: SCOPE,
      date: DATE.optional().describe("move the edited occurrence to this date (defaults to its current date)"),
      startMin: z.number().int().min(0).max(1440).optional(),
      endMin: z.number().int().min(0).max(1440).optional(),
      allDay: z.boolean().optional(),
      title: z.string().max(200).optional(),
      activityId: z.string().max(120).optional(),
      campId: z.string().optional(),
      color: HEX.optional(),
      recurrence: RECURRENCE.optional().describe("new repeat rule to apply going forward; omit to keep the current rule"),
      stopRepeating: z.boolean().optional().describe("true = stop repeating for this scope (collapse to a single event)"),
    },
  },
  async (args) => {
    try {
      return text(await store.editSeries(args));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "delete_series",
  {
    title: "Delete repeating event(s)",
    description:
      "Scoped delete of a repeating event, mirroring the app. `id` is any occurrence in the series. scope 'this' SKIPS just that one day (removes it and records the date so a later edit won't bring it back); 'following' removes that occurrence and every later one; 'all' removes the entire series.",
    inputSchema: { id: z.string().uuid().describe("any occurrence in the series"), scope: SCOPE },
  },
  async ({ id, scope }) => {
    try {
      return text(await store.deleteSeries({ id, scope }));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "set_diagram",
  {
    title: "Set an activity's visual field diagram",
    description:
      "Create or replace the field diagram for an activity (keyed by activityId). A diagram is one or more frames (stages). All coordinates are in a 0–100 square (NOT pixels). Markers use one of 6 colors (teal/clay/amber/sage/dusk/ink) and 7 shapes (circle/square/triangle/diamond/flag/pin/text; 'text' renders just its label). Zones are rectangles (kind safe/jail/area). Arrows connect two points. Always write frame.alt prose for accessibility. Replaces any existing diagram for that activity; other activities' diagrams are preserved.",
    inputSchema: {
      activityId: z.string(),
      title: z.string().optional(),
      summary: z.string().optional(),
      surface: z.object({ split: z.boolean().optional(), grid: z.boolean().optional() }).optional(),
      frames: z.array(frameSchema).min(1),
    },
  },
  async (args) => {
    try {
      return text(await store.setDiagram(args));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "set_run_list",
  {
    title: "Set an activity's run list (instructions)",
    description:
      "Create or replace the step-by-step Run List for an activity (keyed by activityId). Blocks are the spine: 'step' (numbered action, may carry children), 'heading', 'note', 'safety', 'variation', 'materials', 'details'. A step's children can be note/safety/video/variation/substep/materials, or a 'diagram' child carrying an embedded field diagram. Replaces any existing run list for that activity.",
    inputSchema: { activityId: z.string(), blocks: z.array(runBlockSchema).min(1) },
  },
  async (args) => {
    try {
      return text(await store.setRunList(args));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "add_camp",
  { title: "Add a camp", description: "Create a new camp (scheduling container). Returns its id for use as campId on events.", inputSchema: { name: z.string().min(1).max(60) } },
  async ({ name }) => {
    try {
      return text(await store.addCamp(name));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "add_theme",
  { title: "Add a theme", description: "Create a theme tag (e.g. 'Ocean Week'). Tint is auto-assigned from the fixed 8-color palette. Returns its id for assign_theme.", inputSchema: { label: z.string().min(1).max(40) } },
  async ({ label }) => {
    try {
      return text(await store.addTheme(label));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "assign_theme",
  { title: "Assign a theme to an activity", description: "Tag an activity with a theme (activityId -> themeId).", inputSchema: { activityId: z.string(), themeId: z.string() } },
  async ({ activityId, themeId }) => {
    try {
      await store.assignTheme(activityId, themeId);
      return text({ ok: true, activityId, themeId });
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "set_rating",
  { title: "Rate an activity", description: "Set an activity's rating 0–5 (0 = not run yet).", inputSchema: { activityId: z.string(), rating: z.number().int().min(0).max(5) } },
  async ({ activityId, rating }) => {
    try {
      await store.setRating(activityId, rating);
      return text({ ok: true, activityId, rating });
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "add_custom_activity",
  {
    title: "Add a custom library activity",
    description:
      "Add or update a custom library activity so events can reference it. Provide a stable id to upsert in place; omit id to create one. type is one of the 5 fixed categories (default Game); place Inside/Outside/Both; ages from the 5 fixed bands (pre/g13/g46/g79/g1012). Returns the saved activity (or null if it failed validation).",
    inputSchema: {
      id: z.string().min(1).max(120).optional(),
      title: z.string().min(1),
      altNames: z
        .array(z.string())
        .optional()
        .describe("Alternate names this game is known by (searchable); e.g. ['Octopus','Fishes and Sharks']"),
      type: z.enum(["Game", "Craft", "Song", "Water", "Quiet"]).optional(),
      place: z.enum(["Inside", "Outside", "Both"]).optional(),
      durationMin: z.number().int().positive().optional(),
      ages: z.array(z.enum(["pre", "g13", "g46", "g79", "g1012"])).optional(),
      blurb: z.string().optional(),
      steps: z.array(z.string()).optional(),
      notes: z.string().optional(),
      safety: z.string().optional(),
      materials: z.array(z.string()).optional(),
      prep: z.enum(["None", "Low", "Medium", "High"]).optional(),
    },
  },
  async (args) => {
    try {
      return text(await store.addCustomActivity(args));
    } catch (err) {
      return fail(err);
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("camp-library MCP server failed to start:", err);
  process.exit(1);
});
