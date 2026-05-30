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

export interface ScheduleBlock {
  id: string;
  start: string;
  end: string;
  kind: ScheduleBlockKind;
  label: string;
  activityId?: string;
}

// A schedule maps a day index → ordered blocks for that day.
export type DaySchedule = ScheduleBlock[];
export type Schedule = Record<number, DaySchedule>;

export interface SavedDayPlan {
  id: string;
  name: string;
  blocks: DaySchedule;
  createdAt: number;
}

export interface Slot {
  id: string;
  time?: string;
  meal?: boolean;
  label?: string;
}

export type LibraryView = "shelf" | "deck" | "catalog";
export type TabId = "home" | "library" | "schedule" | "saved" | "add";
