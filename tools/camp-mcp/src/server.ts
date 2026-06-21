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
      "Create OR edit one calendar event. Times are minutes from local midnight, snapped to a 15-minute grid. Provide startMin+endMin for a timed event, or allDay:true. activityId (a real id from list_context) links a library activity and forces kind='activity'; omit it for a free-form custom event. Pass an existing id to edit in place; omit id to create.",
    inputSchema: {
      date: DATE,
      startMin: z.number().int().min(0).max(1440).optional().describe("e.g. 540 = 9:00am"),
      endMin: z.number().int().min(0).max(1440).optional(),
      allDay: z.boolean().optional(),
      title: z.string().max(200).optional(),
      activityId: z.string().max(120).optional(),
      campId: z.string().optional(),
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
    description: "Remove an event by its UUID (idempotent).",
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
      "Add a fully custom activity to the library so events can reference it. type is one of the 5 fixed categories (default Game); place Inside/Outside/Both; ages from the 5 fixed bands (pre/g13/g46/g79/g1012). Returns the saved activity (or null if it failed validation).",
    inputSchema: {
      title: z.string().min(1),
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
