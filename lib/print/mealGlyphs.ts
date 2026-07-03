// Camp Library — print-only meal labels (approved plan §H, "Meals on paper").
//
// The calendar shows a meal-flagged event with a small fork+spoon SVG glyph
// (components/calendar/CalendarShell.tsx's MealGlyph) plus its human label in
// a couple of places (CalendarTodayCard's MEAL_KIND_LABEL, CalendarShell's
// MEAL_KIND_LABELS). Print can't import from components/calendar/* (off
// limits), and lib/meals.ts is off limits to EDIT (a parallel branch is
// landing a shared MEAL_KIND_LABELS constant there) — so this is a small,
// local, print-only label map mirroring the same kebab-case MealKind values.
//
// TODO(meals-labels): once the shared MEAL_KIND_LABELS constant lands in
// lib/meals.ts, replace this local map with an import of that instead.

import type { MealKind } from "@/lib/calendar/types";

export const MEAL_KIND_LABEL: Record<MealKind, string> = {
  breakfast: "Breakfast",
  "am-snack": "AM snack",
  lunch: "Lunch",
  "pm-snack": "PM snack",
  other: "Meal",
};
