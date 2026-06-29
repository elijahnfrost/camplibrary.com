// Camp Library — quick reminders (hand-authored, type "Routine", 0-minute).
//
// The no-time nudges that used to live in a separate "quick reminders" list:
// the little prompts that take no clock time but are easy to forget — a bathroom
// & water break, a litter sweep, handing out the prize. Now they ARE library
// entries (durationMin 0), so the calendar's one create bar can search and place
// them like anything else, and staff can save their own. A 0-minute book reads as
// "Reminder" everywhere the length shows (see durLabel) and drops on the calendar
// as the thin dot/marker rather than a block. Hand-authored + preserved across
// seed rebuilds as a static lane (see scripts/build-seed.mjs). No media/links.

import type { Activity } from "@/lib/types";

// A 0-minute reminder book carries the same fields as any activity; only the id,
// title, alt-names, and blurb vary. The shared base keeps the type-correct
// defaults in one place (fresh arrays per entry so nothing is shared by ref).
function reminder(
  id: string,
  title: string,
  blurb: string,
  altNames: string[]
): Activity {
  return {
    id,
    title,
    altNames,
    type: "Routine",
    place: "Both",
    ageMin: 4,
    ageMax: 16,
    ages: ["pre", "g13", "g46", "g79", "g1012"],
    durationMin: 0,
    groupMin: null,
    groupMax: null,
    energy: 1,
    prep: "None",
    rating: 0,
    blurb,
    materials: [],
    materialTags: [],
    steps: [],
    notes: "A quick reminder — a no-time nudge dropped on the schedule so it isn't forgotten.",
    safety: "—",
  };
}

export const rmActivities: Activity[] = [
  reminder(
    "rm-bathroom-break",
    "Bathroom break",
    "A no-time nudge to send the group for a bathroom break.",
    ["Restroom break", "Washroom break"]
  ),
  reminder(
    "rm-water-break",
    "Water break",
    "A no-time nudge to stop for water — especially on hot days.",
    ["Hydration break", "Drink water"]
  ),
  reminder(
    "rm-pick-up-trash",
    "Pick up trash",
    "A no-time nudge to do a quick litter sweep of the space.",
    ["Litter sweep", "Tidy the area"]
  ),
  reminder(
    "rm-pick-a-prize",
    "Pick a prize",
    "A no-time nudge to let campers pick a prize.",
    ["Prize time", "Treasure box"]
  ),
];
