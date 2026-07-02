// The seeded materials catalog + the curation-aware ref resolver.
//
// Derived at runtime from the committed library (SEED_ACTIVITIES) and the
// hand-authored curation layer (material-curation.json), rather than emitted by
// a build step — the seed-events source isn't in every workspace, and the
// derivation is deterministic and cheap (one pass over ~500 activities' tags,
// done once at module load). The curation JSON is the single reviewable artifact.
//
//   • SEED_MATERIAL_CATALOG       — the default catalog (the `materialCatalog`
//                                   user-doc's default; the stored doc wins once edited).
//   • resolveRefs(activity)       — an activity's requirement refs, with the
//                                   "X or Y" bundles resolved to category refs.
//   • DEFAULT_AVAILABLE_MATERIALS — the pre-seeded on-hand kit (availableMaterials default).

import type { Activity } from "../types";
import { buildCatalogFromActivities, type MaterialCatalog, type MaterialCuration, type MaterialRef } from "../materialCatalog";
import { SEED_ACTIVITIES } from "./index";
import curationData from "./material-curation.json";
import onHandData from "./material-onhand.json";

const CURATION = curationData as unknown as MaterialCuration;

const built = buildCatalogFromActivities(SEED_ACTIVITIES, CURATION);

export const SEED_MATERIAL_CATALOG: MaterialCatalog = built.catalog;

/** An activity's canonical requirement refs. Prefers attached `materialRefs`;
 *  otherwise derives from its tags + curation (bundle → category remap). */
export function resolveRefs(activity: Activity): MaterialRef[] {
  return activity.materialRefs && activity.materialRefs.length ? activity.materialRefs : built.refsFor(activity);
}

const CATALOG_IDS = new Set(SEED_MATERIAL_CATALOG.materials.map((m) => m.id));

/** The camp's pre-seeded on-hand kit (catalog ids), filtered to live catalog ids. */
export const DEFAULT_AVAILABLE_MATERIALS: string[] = ((onHandData as { onHand: string[] }).onHand || []).filter((id) =>
  CATALOG_IDS.has(id)
);
