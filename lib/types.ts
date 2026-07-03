// Camp Library — shared domain types.

import type { ActivityPlaybookData } from "@/lib/playbooks";

export type CategoryId = "Game" | "Craft" | "Song" | "Water" | "Quiet" | "Routine";
export type Place = "Inside" | "Outside" | "Both";
export type AgeGroupId = "pre" | "g13" | "g46" | "g79" | "g1012";
export type Prep = "None" | "Low" | "Medium" | "High";

export interface Category {
  id: CategoryId;
  label: string;
  numeral: string;
}

// A piece of embedded media on an activity — a demo video, a tutorial, or a
// reference page. `url` must be a specific, real http(s) resource: never a
// fabricated id and never a search page (a `youtube.com/results?...` "search this
// game" link is not a demo). A YouTube/Vimeo link plays inline, anything else
// renders as a link card (lib/embed.ts). `title` is the short caption shown with
// it. The built-in seed never ships search URLs — see scripts/build-seed.mjs.
export interface ActivityMedia {
  title?: string;
  url: string;
}

// A reference link on an activity — an external website with a friendly label.
// Renders as a tappable link card on the run sheet. Kept distinct from `media`
// so "watch a demo" and "read more / source" read as separate ideas. `url` must
// be a specific destination (an article/how-to page), never a `google.com/search`
// or other search URL. The built-in seed only ships verified source links.
export interface ActivityLink {
  label?: string;
  url: string;
}

// A reference from an activity to a kit item it needs. The canonical materials
// model going forward: `id` is a materialTagId slug (the join key to the on-hand
// set, the kit filter, and — eventually — the materials catalog), and `note` is
// an optional per-placement qty/detail ("~2 cups per batch"). The legacy
// `materials` free-text and `materialTags` arrays are kept as derived mirrors so
// exports and older clients keep working; resolveRefs (lib/materials.ts) reads
// materialRefs first, falling back to those mirrors. Optional + absent by
// default, so existing literals/seeds need no backfill.
export interface MaterialRef {
  id: string;
  note?: string;
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
  // Canonical kit references (id + optional note). When present, the single
  // source of truth for an activity's needs; `materials`/`materialTags` are
  // derived mirrors kept for legacy consumers. resolveRefs prefers this tier.
  materialRefs?: MaterialRef[];
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
  // Default backup plans this activity carries — the seed a placement inherits
  // when its own event.alternates is absent. Same AlternateRef shape + rules as
  // the per-event list; validated in lib/activityValidation (delete-then-
  // reattach), resolved by lib/alternates.resolveAlternates.
  alternates?: import("./calendar/types").AlternateRef[];
  // Embedded demo videos / tutorials. Seeded into the derived run doc as "Media"
  // details (inline players for YouTube/Vimeo, link cards otherwise). Optional +
  // absent by default, so existing literals/seeds need no backfill.
  media?: ActivityMedia[];
  // External reference links (a how-to page, the source article). Seeded into the
  // run doc as link-card "Media" details alongside `media`.
  links?: ActivityLink[];
  // Alternate rules / scalings (by age, space, group size, weather). Surfaced as
  // "Variation" blocks on the run sheet under a Variations heading.
  variations?: string[];
  // Per-step sub-steps, aligned by index to `steps` (`subsets[i]` are the
  // sub-steps for `steps[i]`). Surfaced as "Sub-step" details under their step.
  subsets?: string[][];
}

export type LibraryView = "shelf" | "deck" | "catalog";

export type TabId = "home" | "library" | "calendar" | "materials" | "print" | "staff" | "admin";
