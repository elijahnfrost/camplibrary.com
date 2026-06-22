// Camp Library — playbook diagrams.
//
// A "playbook" is a small, data-driven set of field diagrams ("frames" / stages)
// attached to an activity. Everything a frame draws — the surface, the marked
// zones, the flags, the players, and the movement arrows — lives in this data so
// the same renderer can both display a diagram and edit it piece by piece.

export type PlaybookTeamId = "blue" | "red";
export type PlaybookArrowKind = PlaybookTeamId | "neutral";
export type PlaybookPoint = [number, number];
export type PlaybookMarkerKind = "runner" | "flag";
export type PlaybookZoneKind = "safe" | "jail" | "area";

// The generic, event-agnostic palette. A diagram piece picks a color by name so
// the same six earthy tokens drive markers, zone outlines, and arrows whether
// you are mapping Capture the Flag teams or craft stations. (`teal`/`clay` are
// the two original CTF team colors, kept first so migrated games look identical.)
export type PlaybookColorId = "teal" | "clay" | "amber" | "sage" | "dusk" | "ink";
export const PLAYBOOK_COLORS: PlaybookColorId[] = ["teal", "clay", "amber", "sage", "dusk", "ink"];

// A marker can be any of these shapes. `text` draws no glyph — just its label —
// so a marker doubles as a free-floating text label. `flag`/`pin` are camp-y
// map glyphs (a planted flag, a dropped map pin) for bases and stations.
export type PlaybookMarkerShape = "circle" | "square" | "triangle" | "diamond" | "flag" | "pin" | "text";
export const PLAYBOOK_SHAPES: PlaybookMarkerShape[] = [
  "circle",
  "square",
  "triangle",
  "diamond",
  "flag",
  "pin",
  "text",
];

// All coordinates live in a 0–100 square (the SVG viewBox), so a frame scales to
// any pane without re-layout.

// The generic placeable token. Replaces the CTF-only player/flag split with one
// piece that carries its own color + shape + optional caption, so a diagram can
// describe any event. Legacy players/flags still render (see PlayerShape /
// FlagShape) and migrate into markers the first time a diagram is edited.
export interface PlaybookMarker {
  id: string;
  x: number;
  y: number;
  color: PlaybookColorId;
  shape: PlaybookMarkerShape;
  // A short caption shown beneath the glyph (or, for shape "text", as the body).
  label?: string;
}

export interface PlaybookPlayer {
  id: string;
  team: PlaybookTeamId;
  x: number;
  y: number;
  role?: PlaybookMarkerKind;
}

export interface PlaybookFlag {
  id: string;
  team: PlaybookTeamId;
  x: number;
  y: number;
}

export interface PlaybookZone {
  id: string;
  kind: PlaybookZoneKind;
  // Optional palette color; when set it overrides the kind-derived outline so a
  // zone can mark anything ("Craft table", "Start line") in any color.
  color?: PlaybookColorId;
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
}

export interface PlaybookArrow {
  id: string;
  from: PlaybookPoint;
  to: PlaybookPoint;
  team?: PlaybookArrowKind;
  // Optional palette color; overrides the team-derived stroke when set.
  color?: PlaybookColorId;
}

export interface PlaybookFrame {
  id: string;
  name: string;
  caption: string;
  alt?: string;
  zones: PlaybookZone[];
  flags: PlaybookFlag[];
  players: PlaybookPlayer[];
  arrows: PlaybookArrow[];
  // The generic pieces. Optional so older stored frames (players/flags only)
  // stay valid; new and edited diagrams author markers here instead.
  markers?: PlaybookMarker[];
}

export interface PlaybookSurface {
  // Split the field down the middle with two tinted halves (team territories).
  split?: boolean;
  // Lay faint gridlines over the surface — handy for courts, station maps, and
  // relay courses where rough positions matter.
  grid?: boolean;
}

export interface ActivityPlaybookData {
  id: string;
  activityId: string;
  title: string;
  eyebrow?: string;
  summary: string;
  surface?: PlaybookSurface;
  frames: PlaybookFrame[];
}

/* ----------------------------------------------------------------------------
 * Factories — used by the editor to add new pieces with stable, unique ids.
 * ------------------------------------------------------------------------- */

let pieceSeq = 0;
export function playbookId(prefix: string): string {
  pieceSeq += 1;
  const stamp =
    typeof Date !== "undefined" && typeof Date.now === "function" ? Date.now().toString(36) : "0";
  return prefix + "-" + stamp + "-" + pieceSeq.toString(36);
}

export function newPlayer(team: PlaybookTeamId, x = 50, y = 50): PlaybookPlayer {
  return { id: playbookId("p"), team, x, y };
}

export function newFlag(team: PlaybookTeamId, x = 50, y = 50): PlaybookFlag {
  return { id: playbookId("f"), team, x, y };
}

export function newMarker(
  color: PlaybookColorId = "teal",
  shape: PlaybookMarkerShape = "circle",
  x = 50,
  y = 50,
  label?: string
): PlaybookMarker {
  return { id: playbookId("m"), color, shape, x, y, ...(label ? { label } : {}) };
}

// A text marker is just a marker with no glyph — a free-floating caption.
export function newTextMarker(color: PlaybookColorId = "ink", x = 50, y = 50): PlaybookMarker {
  return { id: playbookId("m"), color, shape: "text", x, y, label: "Label" };
}

export function newZone(kind: PlaybookZoneKind, x = 38, y = 38, color?: PlaybookColorId): PlaybookZone {
  const label = kind === "jail" ? "Jail" : kind === "safe" ? "Safe" : "Zone";
  return { id: playbookId("z"), kind, x, y, w: 24, h: 18, label, ...(color ? { color } : {}) };
}

export function newArrow(team: PlaybookArrowKind = "neutral"): PlaybookArrow {
  return { id: playbookId("a"), from: [40, 50], to: [60, 50], team };
}

// Map a legacy CTF team to its palette color so a migrated game keeps the exact
// two-tone look (blue → teal token #4d7a86, red → clay).
export function teamColor(team: PlaybookTeamId): PlaybookColorId {
  return team === "red" ? "clay" : "teal";
}

// Fold a frame's legacy players + flags into generic markers, leaving the
// originals cleared. Idempotent and non-destructive: a frame that already uses
// markers (or has neither) is returned untouched. The editor calls this on open
// so every diagram — including the built-in Capture the Flag book — is edited
// through one unified set of pieces, while un-edited stored data still renders
// via the legacy player/flag paths.
export function migrateFrameToMarkers(frame: PlaybookFrame): PlaybookFrame {
  const players = frame.players || [];
  const flags = frame.flags || [];
  if (players.length === 0 && flags.length === 0) return frame;

  const fromPlayers: PlaybookMarker[] = players.map((p) => ({
    id: p.id,
    x: p.x,
    y: p.y,
    color: teamColor(p.team),
    // Blue kept circles, red kept squares — preserve that team read.
    shape: p.team === "red" ? "square" : "circle",
  }));
  const fromFlags: PlaybookMarker[] = flags.map((f) => ({
    id: f.id,
    x: f.x,
    y: f.y,
    color: teamColor(f.team),
    shape: "flag",
  }));

  return {
    ...frame,
    players: [],
    flags: [],
    markers: [...(frame.markers || []), ...fromPlayers, ...fromFlags],
  };
}

export function newFrame(name = "New stage"): PlaybookFrame {
  return {
    id: playbookId("frame"),
    name,
    caption: "",
    zones: [],
    flags: [],
    players: [],
    arrows: [],
    markers: [],
  };
}

export function blankPlaybook(activityId: string, title: string): ActivityPlaybookData {
  return {
    id: playbookId("playbook"),
    activityId,
    title: title ? title + " diagram" : "Activity diagram",
    summary: "Drop markers, zones, labels, and arrows to map out how this runs.",
    surface: { split: false },
    frames: [{ ...newFrame("1. Setup") }],
  };
}

// A fully independent deep copy of a diagram. Playbook data is plain JSON
// (strings / numbers / arrays / objects), so a structured round-trip is both
// correct and the safest way to guarantee the copy shares no nested frame /
// marker / zone / arrow with the source.
export function clonePlaybook(playbook: ActivityPlaybookData): ActivityPlaybookData {
  return JSON.parse(JSON.stringify(playbook)) as ActivityPlaybookData;
}

/* ----------------------------------------------------------------------------
 * Normalizer — keeps stored / round-tripped data from ever crashing the render
 * even if it is partial or hand-edited. Only ever produces valid shapes.
 * ------------------------------------------------------------------------- */

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function str(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function team(value: unknown): PlaybookTeamId {
  return value === "red" ? "red" : "blue";
}

function arrowKind(value: unknown): PlaybookArrowKind {
  return value === "red" ? "red" : value === "blue" ? "blue" : "neutral";
}

function color(value: unknown): PlaybookColorId | undefined {
  return typeof value === "string" && (PLAYBOOK_COLORS as string[]).includes(value)
    ? (value as PlaybookColorId)
    : undefined;
}

function markerShape(value: unknown): PlaybookMarkerShape {
  return typeof value === "string" && (PLAYBOOK_SHAPES as string[]).includes(value)
    ? (value as PlaybookMarkerShape)
    : "circle";
}

function point(value: unknown, fallback: PlaybookPoint): PlaybookPoint {
  if (Array.isArray(value) && value.length >= 2) {
    return [num(value[0], fallback[0]), num(value[1], fallback[1])];
  }
  return fallback;
}

export function normalizePlaybook(value: unknown): ActivityPlaybookData | null {
  if (!isRecord(value) || !Array.isArray(value.frames)) return null;

  const frames: PlaybookFrame[] = value.frames.filter(isRecord).map((raw, i) => {
    const zones = Array.isArray(raw.zones) ? raw.zones.filter(isRecord) : [];
    const flags = Array.isArray(raw.flags) ? raw.flags.filter(isRecord) : [];
    const players = Array.isArray(raw.players) ? raw.players.filter(isRecord) : [];
    const arrows = Array.isArray(raw.arrows) ? raw.arrows.filter(isRecord) : [];
    const markers = Array.isArray(raw.markers) ? raw.markers.filter(isRecord) : [];
    return {
      id: str(raw.id, playbookId("frame")),
      name: str(raw.name, "Stage " + (i + 1)),
      caption: str(raw.caption, ""),
      alt: typeof raw.alt === "string" ? raw.alt : undefined,
      zones: zones.map((z) => ({
        id: str(z.id, playbookId("z")),
        kind: z.kind === "jail" ? "jail" : z.kind === "area" ? "area" : "safe",
        color: color(z.color),
        x: num(z.x, 38),
        y: num(z.y, 38),
        w: Math.max(4, num(z.w, 24)),
        h: Math.max(4, num(z.h, 18)),
        label: typeof z.label === "string" ? z.label : undefined,
      })),
      flags: flags.map((fl) => ({
        id: str(fl.id, playbookId("f")),
        team: team(fl.team),
        x: num(fl.x, 50),
        y: num(fl.y, 50),
      })),
      players: players.map((p) => ({
        id: str(p.id, playbookId("p")),
        team: team(p.team),
        x: num(p.x, 50),
        y: num(p.y, 50),
        role: p.role === "runner" || p.role === "flag" ? p.role : undefined,
      })),
      arrows: arrows.map((ar) => ({
        id: str(ar.id, playbookId("a")),
        from: point(ar.from, [40, 50]),
        to: point(ar.to, [60, 50]),
        team: arrowKind(ar.team),
        color: color(ar.color),
      })),
      markers: markers.map((m) => ({
        id: str(m.id, playbookId("m")),
        x: num(m.x, 50),
        y: num(m.y, 50),
        color: color(m.color) ?? "teal",
        shape: markerShape(m.shape),
        label: typeof m.label === "string" ? m.label : undefined,
      })),
    };
  });

  if (frames.length === 0) return null;

  return {
    id: str(value.id, playbookId("playbook")),
    activityId: str(value.activityId, ""),
    title: str(value.title, "Activity diagram"),
    eyebrow: typeof value.eyebrow === "string" ? value.eyebrow : undefined,
    summary: str(value.summary, ""),
    surface: isRecord(value.surface)
      ? { split: value.surface.split === true, grid: value.surface.grid === true }
      : { split: false },
    frames,
  };
}

/* ----------------------------------------------------------------------------
 * Built-in playbook: Capture the Flag.
 * ------------------------------------------------------------------------- */

const CTF_ZONES: PlaybookZone[] = [
  { id: "safe-blue", kind: "safe", x: 9, y: 40, w: 16, h: 23, label: "Safe" },
  { id: "safe-red", kind: "safe", x: 75, y: 40, w: 16, h: 23, label: "Safe" },
  { id: "jail-blue", kind: "jail", x: 6, y: 70, w: 15, h: 21, label: "Jail" },
  { id: "jail-red", kind: "jail", x: 79, y: 9, w: 15, h: 21, label: "Jail" },
];

const CAPTURE_FLAG_PLAYBOOK: ActivityPlaybookData = {
  id: "capture-flag-playbook",
  activityId: "capture-flag",
  title: "Capture the Flag playbook",
  eyebrow: "Coach view",
  summary: "Set the field, raid, then return the flag.",
  surface: { split: true },
  frames: [
    {
      id: "setup",
      name: "1. Build the field",
      caption:
        "Split the field in half. Put one flag deep in each territory and mark a jail near each flag lane.",
      alt: "The field is split into blue and red halves. Each side has one flag deep in its territory, a safe area around the flag, and a jail near the opposing flag lane. No players are shown in this setup stage.",
      zones: CTF_ZONES,
      flags: [
        { id: "flag-blue", team: "blue", x: 14, y: 50 },
        { id: "flag-red", team: "red", x: 86, y: 50 },
      ],
      players: [],
      arrows: [],
    },
    {
      id: "raid",
      name: "2. Cross, tag, and free",
      caption:
        "Players cross midfield to grab the other flag. Tagged players go to jail until a teammate frees them.",
      alt: "Blue sends two runners through the middle and lower lane toward the red flag. Red defenders collapse from the upper-right and middle-right. One blue player is held in red jail near the red flag lane.",
      zones: CTF_ZONES,
      flags: [
        { id: "flag-blue", team: "blue", x: 14, y: 50 },
        { id: "flag-red", team: "red", x: 86, y: 50 },
      ],
      players: [
        { id: "b1", team: "blue", x: 16, y: 18 },
        { id: "b2", team: "blue", x: 28, y: 30 },
        { id: "b3", team: "blue", x: 44, y: 38, role: "runner" },
        { id: "b4", team: "blue", x: 57, y: 50, role: "runner" },
        { id: "b5", team: "blue", x: 41, y: 68 },
        { id: "b6", team: "blue", x: 28, y: 82 },
        { id: "b7", team: "blue", x: 35, y: 22 },
        { id: "b8", team: "blue", x: 18, y: 58 },
        { id: "b9", team: "blue", x: 34, y: 76 },
        { id: "b10", team: "blue", x: 91, y: 35 },
        { id: "r1", team: "red", x: 84, y: 18 },
        { id: "r2", team: "red", x: 78, y: 34 },
        { id: "r3", team: "red", x: 70, y: 44 },
        { id: "r4", team: "red", x: 75, y: 58 },
        { id: "r5", team: "red", x: 84, y: 76 },
        { id: "r6", team: "red", x: 60, y: 34 },
        { id: "r7", team: "red", x: 63, y: 66 },
        { id: "r8", team: "red", x: 88, y: 50 },
        { id: "r9", team: "red", x: 68, y: 82 },
        { id: "r10", team: "red", x: 52, y: 74 },
      ],
      arrows: [
        { id: "a1", from: [36, 42], to: [58, 48], team: "blue" },
        { id: "a2", from: [45, 70], to: [66, 60], team: "blue" },
        { id: "a3", from: [74, 36], to: [61, 44], team: "red" },
      ],
    },
    {
      id: "return",
      name: "3. Carry it home",
      caption:
        "A team scores by carrying the other flag back across midfield into its own territory.",
      alt: "A blue runner carries the red flag from the right half back across midfield. Blue blockers form a screen near center while red defenders chase from above and below. One red player waits in blue jail. The red base flag is not repeated because the carried flag is shown on the runner.",
      zones: CTF_ZONES,
      flags: [{ id: "flag-blue", team: "blue", x: 14, y: 50 }],
      players: [
        { id: "b1", team: "blue", x: 18, y: 20 },
        { id: "b2", team: "blue", x: 30, y: 28 },
        { id: "b3", team: "blue", x: 54, y: 47, role: "flag" },
        { id: "b4", team: "blue", x: 46, y: 50 },
        { id: "b5", team: "blue", x: 42, y: 62 },
        { id: "b6", team: "blue", x: 28, y: 80 },
        { id: "b7", team: "blue", x: 38, y: 34 },
        { id: "b8", team: "blue", x: 22, y: 60 },
        { id: "b9", team: "blue", x: 34, y: 74 },
        { id: "b10", team: "blue", x: 91, y: 35 },
        { id: "r1", team: "red", x: 84, y: 18 },
        { id: "r2", team: "red", x: 70, y: 32 },
        { id: "r3", team: "red", x: 64, y: 42 },
        { id: "r4", team: "red", x: 68, y: 56 },
        { id: "r5", team: "red", x: 84, y: 76 },
        { id: "r6", team: "red", x: 56, y: 30 },
        { id: "r7", team: "red", x: 57, y: 64 },
        { id: "r8", team: "red", x: 76, y: 50 },
        { id: "r9", team: "red", x: 68, y: 82 },
        { id: "r10", team: "red", x: 9, y: 65 },
      ],
      arrows: [
        { id: "a1", from: [55, 47], to: [36, 49], team: "blue" },
        { id: "a2", from: [36, 49], to: [20, 52], team: "blue" },
        { id: "a3", from: [68, 56], to: [56, 48], team: "red" },
        { id: "a4", from: [56, 30], to: [47, 42], team: "red" },
      ],
    },
  ],
};

/* ----------------------------------------------------------------------------
 * Built-in playbook: Sharks & Minnows.
 *
 * Authored with the generic marker vocabulary (no legacy blue/red team pieces),
 * so the CTF team legend stays suppressed and the diagram reads on its own. Role
 * is carried two ways a child can follow: the three zone labels name the bands
 * ("Minnows start" / "Sharks' ocean" / "Safe shore"), and the only captioned
 * markers are the sharks — minnows are an unlabeled blue school, the tagged
 * minnow is the one dusk diamond that says where it's headed ("Tagged → shark").
 * The three shared zones repeat across stages so the field never jumps; only the
 * tokens move, telling the story setup → dash → everyone's a shark.
 * ------------------------------------------------------------------------- */

// Safe zones are wide enough that their centered uppercase labels fit inside the
// dashed box instead of spilling into the ocean (a narrow zone clips its label).
const SM_ZONES: PlaybookZone[] = [
  { id: "sm-start", kind: "safe", x: 5, y: 14, w: 22, h: 72, label: "Minnows" },
  { id: "sm-ocean", kind: "area", x: 29, y: 14, w: 42, h: 72, label: "Sharks' ocean" },
  { id: "sm-shore", kind: "safe", x: 73, y: 14, w: 22, h: 72, label: "Safe shore" },
];

const SHARKS_MINNOWS_PLAYBOOK: ActivityPlaybookData = {
  id: "sharks-minnows-playbook",
  activityId: "sharks-minnows",
  title: "Sharks & Minnows playbook",
  eyebrow: "Coach view",
  summary:
    "Set two shores with the ocean between them, then dash across — every minnow a shark tags becomes a shark too.",
  surface: { split: false },
  frames: [
    {
      id: "sm-setup",
      name: "1. Set the ocean",
      caption:
        "Mark two shores with the ocean between. Minnows gather on their shore; the sharks wait in the water. Sharks can only tag in the ocean — both shores are safe, and a tag is just a touch.",
      alt:
        "A wide field in three bands. On the left, a green 'Minnows' zone holds a school of blue dots, one labelled 'Minnow'. The middle is a large 'Sharks ocean' band with two red shark triangles, each labelled 'Shark', facing the minnows. On the right is an empty green 'Safe shore' zone. Nobody is moving yet.",
      zones: SM_ZONES,
      flags: [],
      players: [],
      arrows: [],
      markers: [
        { id: "sm1-shark1", x: 44, y: 40, color: "clay", shape: "triangle", label: "Shark" },
        { id: "sm1-shark2", x: 56, y: 60, color: "clay", shape: "triangle", label: "Shark" },
        { id: "sm1-m1", x: 10, y: 24, color: "teal", shape: "circle", label: "Minnow" },
        { id: "sm1-m2", x: 19, y: 35, color: "teal", shape: "circle" },
        { id: "sm1-m3", x: 10, y: 47, color: "teal", shape: "circle" },
        { id: "sm1-m4", x: 19, y: 58, color: "teal", shape: "circle" },
        { id: "sm1-m5", x: 10, y: 69, color: "teal", shape: "circle" },
        { id: "sm1-m6", x: 17, y: 80, color: "teal", shape: "circle" },
      ],
    },
    {
      id: "sm-dash",
      name: "2. Dash across",
      caption:
        "On 'Go!' every minnow sprints for the far shore. Sharks tag who they can — a tagged minnow stops where it's caught and turns into a shark.",
      alt:
        "The same field. Blue minnow dots run rightward across the ocean, each driven by an arrow toward the safe shore, and two have already reached the right green zone. A red shark triangle lunges (red arrow) at a dusk diamond labelled 'Tagged → shark' near the bottom of the ocean. A second shark cuts in from the right.",
      zones: SM_ZONES,
      flags: [],
      players: [],
      arrows: [
        { id: "sm2-a1", from: [32, 28], to: [76, 26], team: "neutral" },
        { id: "sm2-a2", from: [28, 52], to: [76, 50], team: "neutral" },
        { id: "sm2-a3", from: [50, 74], to: [78, 72], team: "neutral" },
        { id: "sm2-a4", from: [55, 58], to: [43, 63], team: "red" },
      ],
      markers: [
        { id: "sm2-shark1", x: 45, y: 38, color: "clay", shape: "triangle", label: "Shark" },
        { id: "sm2-shark2", x: 60, y: 56, color: "clay", shape: "triangle", label: "Shark" },
        { id: "sm2-tagged", x: 40, y: 64, color: "dusk", shape: "diamond", label: "Tagged → shark" },
        { id: "sm2-m1", x: 34, y: 28, color: "teal", shape: "circle" },
        { id: "sm2-m2", x: 30, y: 52, color: "teal", shape: "circle" },
        { id: "sm2-m3", x: 52, y: 74, color: "teal", shape: "circle" },
        { id: "sm2-m4", x: 64, y: 34, color: "teal", shape: "circle" },
        { id: "sm2-safe1", x: 83, y: 36, color: "teal", shape: "circle" },
        { id: "sm2-safe2", x: 88, y: 58, color: "teal", shape: "circle" },
      ],
    },
    {
      id: "sm-grow",
      name: "3. Tagged become sharks",
      caption:
        "Everyone tagged is now a shark, so the ocean fills up each round. The minnows who reached the shore line up to run back. The last minnow left starts as the shark next game.",
      alt:
        "The same field. The right green 'Safe shore' zone now holds four blue minnow dots that made it across. The ocean is crowded with red shark triangles — one, near where the tagged minnow was, is labelled 'Just tagged' to show it just turned. One lone blue dot labelled 'Minnow' is still mid-ocean with an arrow toward the safe shore, about to be chased.",
      zones: SM_ZONES,
      flags: [],
      players: [],
      arrows: [{ id: "sm3-a1", from: [33, 48], to: [74, 46], team: "neutral" }],
      markers: [
        { id: "sm3-shark1", x: 40, y: 34, color: "clay", shape: "triangle", label: "Shark" },
        { id: "sm3-shark2", x: 54, y: 30, color: "clay", shape: "triangle", label: "Shark" },
        { id: "sm3-shark3", x: 42, y: 64, color: "clay", shape: "triangle", label: "Just tagged" },
        { id: "sm3-shark4", x: 62, y: 56, color: "clay", shape: "triangle", label: "Shark" },
        { id: "sm3-run", x: 30, y: 48, color: "teal", shape: "circle", label: "Minnow" },
        { id: "sm3-safe1", x: 82, y: 28, color: "teal", shape: "circle" },
        { id: "sm3-safe2", x: 88, y: 42, color: "teal", shape: "circle" },
        { id: "sm3-safe3", x: 82, y: 56, color: "teal", shape: "circle" },
        { id: "sm3-safe4", x: 88, y: 70, color: "teal", shape: "circle" },
      ],
    },
  ],
};

export const PLAYBOOKS_BY_ACTIVITY_ID: Record<string, ActivityPlaybookData> = {
  [CAPTURE_FLAG_PLAYBOOK.activityId]: CAPTURE_FLAG_PLAYBOOK,
  [SHARKS_MINNOWS_PLAYBOOK.activityId]: SHARKS_MINNOWS_PLAYBOOK,
};
