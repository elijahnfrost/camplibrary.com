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

// All coordinates live in a 0–100 square (the SVG viewBox), so a frame scales to
// any pane without re-layout.
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
}

export interface PlaybookSurface {
  // Split the field down the middle with two tinted halves (team territories).
  split?: boolean;
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

export function newZone(kind: PlaybookZoneKind, x = 38, y = 38): PlaybookZone {
  const label = kind === "jail" ? "Jail" : kind === "safe" ? "Safe" : "Zone";
  return { id: playbookId("z"), kind, x, y, w: 24, h: 18, label };
}

export function newArrow(team: PlaybookArrowKind = "neutral"): PlaybookArrow {
  return { id: playbookId("a"), from: [40, 50], to: [60, 50], team };
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
  };
}

export function blankPlaybook(activityId: string, title: string): ActivityPlaybookData {
  return {
    id: playbookId("playbook"),
    activityId,
    title: title ? title + " diagram" : "Activity diagram",
    summary: "Drag the pieces to show how the game is set up and played.",
    surface: { split: false },
    frames: [{ ...newFrame("1. Setup") }],
  };
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
    return {
      id: str(raw.id, playbookId("frame")),
      name: str(raw.name, "Stage " + (i + 1)),
      caption: str(raw.caption, ""),
      alt: typeof raw.alt === "string" ? raw.alt : undefined,
      zones: zones.map((z) => ({
        id: str(z.id, playbookId("z")),
        kind: z.kind === "jail" ? "jail" : z.kind === "area" ? "area" : "safe",
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
    surface: isRecord(value.surface) ? { split: value.surface.split === true } : { split: false },
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

export const PLAYBOOKS_BY_ACTIVITY_ID: Record<string, ActivityPlaybookData> = {
  [CAPTURE_FLAG_PLAYBOOK.activityId]: CAPTURE_FLAG_PLAYBOOK,
};
