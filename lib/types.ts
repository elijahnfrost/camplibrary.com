// Camp Library — shared domain types.

import type { ActivityPlaybookData } from "@/lib/playbooks";

export type CategoryId = "Game" | "Craft" | "Song" | "Water" | "Quiet";
export type Place = "Inside" | "Outside" | "Both";
export type AgeGroupId = "pre" | "g13" | "g46" | "g79" | "g1012";
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
  // Alternate names the activity is known by — camp games travel under many
  // names (Gaga Ball ⇄ "Goggaball" / "Octoball"; Sharks & Minnows ⇄ "Octopus").
  // Display-only as an "also known as" line, and folded into the library search
  // haystack so a counselor who only knows the local name still finds the book.
  // Optional + absent by default, so existing literals/seeds need no backfill.
  altNames?: string[];
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
  materialTags?: string[];
  steps: string[];
  notes: string;
  safety: string;
  ages: AgeGroupId[];
  rating: number; // 0–5 (0 = not run yet)
  // The activity's default color (validated hex). Its color everywhere it shows,
  // and the seed when placed on the calendar. Absent = fall back to the category
  // tint — resolved lazily by effectiveActivityColor (lib/data), so no backfill.
  color?: string;
  // Optional hand-drawn field diagrams (stages) shown inside "How to play".
  // Custom books carry their own; built-in books fall back to the registry.
  playbook?: ActivityPlaybookData;
}

export type LibraryView = "shelf" | "deck" | "catalog";

export type TabId = "home" | "library" | "calendar" | "print" | "staff" | "admin";
