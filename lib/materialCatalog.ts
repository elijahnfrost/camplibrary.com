// Camp Library — the materials catalog.
//
// A synced user doc that names the kit vocabulary a camp actually owns. Each
// Material entry gives a slug id (the SAME materialTagId slug that ties the
// on-hand doc, the run-sheet checklist, and the library kit filter together)
// a friendly display name, optional substitution links, and consumable/plenty
// flags for the later stock-and-coverage lens.
//
// The catalog is LAZILY populated: nothing seeds it, and an activity can
// reference a material id that has no catalog entry yet (a legacy kit label, an
// id minted in the edit form before catalog writes exist). Every renderer must
// therefore fall back to a humanized slug when an id is absent from the catalog
// — that is exactly what catalogNameFor does.
//
// Identity rule (load-bearing): an entry's `id` is the materialTagId slug of its
// name AT BIRTH and is FROZEN thereafter. A rename edits `name` only; ids never
// change, because stock keys and per-placement substitutions reference ids
// forever. Deletion is soft (`archived: true`) for the same reason — an id that
// anything ever referenced must keep resolving.
//
// No "use client" directive — this module is isomorphic. The validator runs on
// the client (hydrating localStorage) AND on the server (validating API
// payloads before Postgres), exactly like every other synced doc.

import { materialTagId } from "./materials";

export interface Material {
  // The frozen slug identity (materialTagId of the birth name). Join key across
  // the on-hand set, the kit filter, run-sheet needs, and future stock keys.
  id: string;
  // The friendly display name. Renames edit this; the id stays put.
  name: string;
  // Other catalog ids that satisfy this need (a substitution group). Ids, not
  // names, so a rename of a substitute never breaks the link.
  substitutes?: string[];
  // Later stock/coverage lens hints. Carried through verbatim; unused here.
  consumable?: boolean;
  plenty?: boolean;
  // Soft delete — entries are never removed (ids are referenced forever). An
  // archived entry still resolves its name, it's just hidden from pickers.
  archived?: boolean;
}

// Cap on catalog size. Generous — a real camp owns dozens of kinds of things,
// not hundreds — but bounded so a corrupt payload can't balloon the doc.
const MAX_ENTRIES = 300;
const MAX_NAME = 80;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// A list of catalog ids (substitutes): trimmed, de-duped, empties + non-strings
// dropped. Kept as ids even when the referenced entry doesn't exist yet — the
// catalog is lazily populated and a substitute can be added later.
function idList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value) {
    const id = typeof raw === "string" ? raw.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

// Turn a bare slug id back into a readable label ("pool-noodles" → "Pool
// noodles", "flags-and-pinnies" → "Flags & pinnies"). Deterministic and pure;
// used as the last-resort label when an id has no catalog entry.
export function humanizeMaterialId(id: string): string {
  const words = id
    .split("-")
    .filter(Boolean)
    .map((word) => (word === "and" ? "&" : word));
  if (!words.length) return id;
  const joined = words.join(" ");
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

// The display name for a material id: the catalog entry's name when present,
// else a humanized slug. The catalog is lazily populated, so unknown ids MUST
// still render — this is the single accessor every surface uses so behavior is
// consistent whether or not an entry exists yet.
export function catalogNameFor(catalog: Material[] | undefined, id: string): string {
  if (catalog) {
    const entry = catalog.find((material) => material.id === id);
    if (entry) return entry.name;
  }
  return humanizeMaterialId(id);
}

// Isomorphic validator: dedupe by id, clamp names, validate substitutes, drop
// malformed entries, cap size. Deterministic — the same input always yields the
// same output, so client and server agree. Unknown keys on an entry are NOT
// carried (the catalog shape is closed and small); only the known fields ride.
export function normalizeMaterialCatalog(value: unknown): Material[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: Material[] = [];
  for (const raw of value) {
    if (out.length >= MAX_ENTRIES) break;
    if (!isRecord(raw)) continue;
    const id = trimmedString(raw.id);
    if (!id || seen.has(id)) continue;
    const name = trimmedString(raw.name).slice(0, MAX_NAME);
    if (!name) continue;
    seen.add(id);
    const entry: Material = { id, name };
    const substitutes = idList(raw.substitutes).filter((sub) => sub !== id);
    if (substitutes.length) entry.substitutes = substitutes;
    if (raw.consumable === true) entry.consumable = true;
    if (raw.plenty === true) entry.plenty = true;
    if (raw.archived === true) entry.archived = true;
    out.push(entry);
  }
  return out;
}

// Mint a fresh catalog entry from a typed name — the birth-slug becomes the
// frozen id. Not wired into the edit form yet (catalog writes are a later
// chunk); exposed so that chunk and its tests share one minting rule.
export function materialFromName(name: string): Material | null {
  const trimmed = name.trim().slice(0, MAX_NAME);
  const id = materialTagId(trimmed);
  if (!id || !trimmed) return null;
  return { id, name: trimmed };
}
