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
  // Optional hand-drawn field diagrams (stages) shown inside "How to play".
  // Custom books carry their own; built-in books fall back to the registry.
  playbook?: ActivityPlaybookData;
}

export type LibraryView = "shelf" | "deck" | "catalog";

export type TabId = "home" | "library" | "calendar" | "staff" | "admin";
