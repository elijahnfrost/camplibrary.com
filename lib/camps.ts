// Camp Library — camps.
//
// A "camp" is a lightweight, switchable scheduling container (e.g. "Summer Day
// Camp 2026"). Camps own ONLY their calendar events — the Library catalog stays
// global and shared across every camp. An event belongs to a camp via an
// optional `campId` that rides in the event payload (zero DDL); the camp list
// itself is a new synced user-doc. Single-camp users never see camp UI: the
// list starts empty and the calendar shows everything until the first camp is
// made. Isomorphic — the validator runs on the client AND on untrusted server
// payloads, so no "use client" directive.

export interface Camp {
  id: string;
  name: string;
  createdAt: number;
}

export const MAX_CAMP_NAME = 60;

function normalizeCamp(value: unknown): Camp | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const id = typeof v.id === "string" ? v.id.trim() : "";
  const name = typeof v.name === "string" ? v.name.trim().slice(0, MAX_CAMP_NAME) : "";
  if (!id || !name) return null;
  const createdAt =
    typeof v.createdAt === "number" && Number.isFinite(v.createdAt) ? v.createdAt : 0;
  return { id, name, createdAt };
}

// The camps doc: a list of unique-id camps in creation order. Deterministic so
// the client hydrate and the server store always agree.
export function normalizeCamps(value: unknown, fallback: Camp[]): Camp[] {
  if (!Array.isArray(value)) return fallback;
  const seen = new Set<string>();
  const out: Camp[] = [];
  for (const item of value) {
    const camp = normalizeCamp(item);
    if (camp && !seen.has(camp.id)) {
      seen.add(camp.id);
      out.push(camp);
    }
  }
  return out;
}

let campIdCounter = 0;

export function createCampId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return "camp-" + crypto.randomUUID();
  }
  campIdCounter += 1;
  return "camp-" + Date.now().toString(36) + "-" + campIdCounter.toString(36);
}
