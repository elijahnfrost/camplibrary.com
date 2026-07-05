// Camp Library — the location vocabulary.
//
// A "location" (Gym, Pool, Classroom…) is the place a calendar block happens.
// Unlike the FIVE FIXED category Types, this vocabulary is user-editable: staff
// add, rename, and remove places from the location picker's "Manage locations…"
// screen, and the list is synced as its own `locations` document.
//
// Events store the place LABEL directly (not an id) — the per-event picker has
// always carried any saved value along as a toggleable row, so labels stay
// human-readable in the DB, the .ics feed, and Print. That keeps this module a
// plain ordered list of unique label strings, seeded with EVENT_LOCATION_OPTIONS.
// This module is isomorphic — its validator runs on the client (hydrate) AND on
// the server (validating API payloads) — so it carries no "use client".

import { EVENT_LOCATION_OPTIONS, EVENT_LOCATION_MAX_LENGTH } from "../calendar/types";

// What a fresh camp's location list starts with. The vocabulary doc defaults to
// this; once a user edits it, the stored list is authoritative (even when empty).
export const DEFAULT_LOCATIONS: readonly string[] = [...EVENT_LOCATION_OPTIONS];

const MAX_LOCATION_LABEL = EVENT_LOCATION_MAX_LENGTH;

// Cap the vocabulary so a malformed payload can't carry an unbounded list. The
// picker only ever offers a handful; this is purely a safety bound.
const MAX_LOCATIONS = 50;

// Tidy one label as it enters the vocabulary: trim and length-clamp. Returns ""
// for a blank label so callers can reject it.
export function canonicalLocationLabel(label: string): string {
  return label.trim().slice(0, MAX_LOCATION_LABEL);
}

// Validate a vocabulary value from an untrusted source (localStorage cache or
// API). Each entry is trimmed + clamped, blanks dropped, duplicates removed
// case-insensitively (FIRST spelling wins), and the list capped. A non-array
// falls back to the seed; an empty array stays empty (a user who removed every
// place keeps an empty list rather than silently getting the defaults back).
export function normalizeLocationVocab(value: unknown, fallback: readonly string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const place = canonicalLocationLabel(item);
    const key = place.toLowerCase();
    if (!place || seen.has(key)) continue;
    seen.add(key);
    out.push(place);
    if (out.length >= MAX_LOCATIONS) break;
  }
  return out;
}

// Append a new place to the vocabulary, returning the canonical label and the
// next list — or null when the label is blank or already present (case-
// insensitively), so the caller can no-op without creating a duplicate.
export function addLocation(
  vocab: readonly string[],
  label: string
): { label: string; next: string[] } | null {
  const place = canonicalLocationLabel(label);
  if (!place) return null;
  const key = place.toLowerCase();
  if (vocab.some((p) => p.toLowerCase() === key)) return null;
  return { label: place, next: [...vocab, place] };
}

// Rename `from` to `to` in the vocabulary, preserving its position. If `to`
// collides with another existing place this MERGES (the old slot drops, the
// surviving place keeps its position). Returns the canonical new label and the
// next list, or null when nothing changes (blank target or `from` absent).
export function renameLocation(
  vocab: readonly string[],
  from: string,
  to: string
): { label: string; next: string[] } | null {
  const place = canonicalLocationLabel(to);
  if (!place) return null;
  if (!vocab.some((p) => p === from)) return null;
  if (place === from) return null;
  const next: string[] = [];
  const seen = new Set<string>();
  for (const p of vocab) {
    const label = p === from ? place : p;
    const key = label.toLowerCase();
    if (seen.has(key)) continue; // merge: a duplicate slot collapses away
    seen.add(key);
    next.push(label);
  }
  // No-op guard: if the canonical list is byte-for-byte the original, nothing
  // changed (e.g. `to` only normalized back onto `from`).
  if (next.length === vocab.length && next.every((p, i) => p === vocab[i])) return null;
  return { label: place, next };
}

// Remove a place from the vocabulary. Events that already carry the label keep
// it (it rides along in their picker as a removable row) — deleting a place
// stops OFFERING it, it doesn't rewrite history. Returns the next list, or null
// when the label wasn't present.
export function removeLocation(vocab: readonly string[], label: string): string[] | null {
  if (!vocab.some((p) => p === label)) return null;
  return vocab.filter((p) => p !== label);
}
