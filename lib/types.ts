// Camp Library — shared domain types.

export type CategoryId = "Game" | "Craft" | "Song" | "Water" | "Quiet";
export type Place = "Inside" | "Outside" | "Both";
export type AgeGroupId = "pre" | "g13" | "g46";
export type Prep = "None" | "Low" | "Medium" | "High";

export interface Category {
  id: CategoryId;
  label: string;
  numeral: string;
}

export interface AgeGroup {
  id: AgeGroupId;
  label: string;
  short: string;
  lo: number;
  hi: number;
  min: number;
  max: number;
}

export interface Activity {
  id: string;
  title: string;
  type: CategoryId;
  place: Place;
  ageMin: number;
  ageMax: number;
  durationMin: number;
  groupMin: number | null;
  groupMax: number | null;
  energy: number; // 0–3 (0 = unset)
  prep: Prep;
  blurb: string;
  materials: string[];
  steps: string[];
  notes: string;
  safety: string;
  ages: AgeGroupId[];
  rating: number; // 0–5 (0 = not run yet)
}

export type ScheduleBlockKind = "activity" | "label";

// How a block is realized:
//  "fixed"       — final: a custom label, OR a pinned library activity (= legacy behavior).
//  "open"        — a typed placeholder ("a Game here") the counselor fills per day.
//  "conditional" — auto-fills from a per-weekday / rotation / category rule at apply time.
// undefined is treated as "fixed" so all existing data stays valid.
export type BlockFill = "fixed" | "open" | "conditional";

export type ConditionalRule =
  | { mode: "rotate"; pool: string[] } // cycle activityIds across the applied days
  | { mode: "byWeekday"; map: Partial<Record<number, string>> } // dayIndex -> activityId
  | { mode: "byCategory"; category: CategoryId }; // best saved/top-rated of type, else stay open

export interface ScheduleBlock {
  id: string;
  start: string;
  end: string;
  kind: ScheduleBlockKind;
  label: string;
  activityId?: string;
  // --- template superpowers (all optional; absent === a plain fixed block) ---
  fill?: BlockFill;
  category?: CategoryId; // for open / conditional: what TYPE fills here
  rule?: ConditionalRule; // present only when fill === "conditional"
}

// A schedule maps a day index → ordered blocks for that day.
export type DaySchedule = ScheduleBlock[];
export type Schedule = Record<number, DaySchedule>;

// A reusable DAY template — a named list of blocks (fixed / open / conditional)
// you can stamp across many days at once. Strict superset of the old SavedDayPlan,
// so old saved plans parse unchanged.
export interface DayTemplate {
  id: string;
  name: string;
  blocks: DaySchedule;
  createdAt: number;
  updatedAt?: number;
  origin?: "day" | "scratch";
}

// Back-compat alias — old code/storage referred to "SavedDayPlan".
export type SavedDayPlan = DayTemplate;

export type ApplyMode = "replace" | "merge" | "fill";

export interface Slot {
  id: string;
  time?: string;
  meal?: boolean;
  label?: string;
}

export type LibraryView = "shelf" | "deck" | "catalog";
// "schedule" is the week/agenda overview; "calendar" is the single-day interactive workspace.
export type TabId = "home" | "library" | "schedule" | "calendar" | "saved" | "add";
