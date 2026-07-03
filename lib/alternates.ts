// Camp Library — backup plans ("alternates") for a placement.
//
// Two facets share one AlternateRef shape (see lib/calendar/types):
//   · activity-level DEFAULTS  — the rainy-day / overflow / open-choice fallbacks
//     an author attaches to a library activity (Activity.alternates, registered
//     here via module augmentation + validated in lib/activityValidation).
//   · event-level OVERRIDES    — a placement's own list on CalendarEvent.alternates,
//     ABSENT = inherit the activity default, PRESENT (including []) = authoritative
//     for this day.
//
// resolveAlternates picks the effective list for a placement; planPromote swaps
// the primary with a chosen backup (a self-inverse edit that writes the post-swap
// list back onto event.alternates — copy-on-write). Everything here is pure and
// deterministic (no Date.now, no crypto) so the calendar can call it in a memo
// and a test can lock its behavior.

import {
  ALTERNATES_MAX,
  ALTERNATE_TITLE_MAX_LENGTH,
  type AlternateReason,
  type AlternateRef,
  type CalendarEvent,
} from "./calendar/types";
import type { Activity } from "./types";

// The reason whitelist — mirrors lib/calendar/types' private set. Kept here
// (not imported) so this module owns its own validation without reaching into
// the event normalizer's internals; the default is "rain" (the wave's headline
// use), matching the event normalizer.
const ALTERNATE_REASONS = new Set<AlternateReason>(["rain", "overflow", "choice"]);

const EVENT_LOCATION_MAX_LENGTH = 80;
const EVENT_LOCATIONS_MAX = 12;

// Trim + clamp + dedupe (case-insensitive) + cap a locations list — the same
// rules the event normalizer applies, kept local so both stay in step without a
// cross-module private import.
function normalizeLocationList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const place = item.trim().slice(0, EVENT_LOCATION_MAX_LENGTH);
    const key = place.toLowerCase();
    if (!place || seen.has(key)) continue;
    seen.add(key);
    out.push(place);
    if (out.length >= EVENT_LOCATIONS_MAX) break;
  }
  return out;
}

// Parse an untrusted value into a clean AlternateRef[] — the activity-side twin
// of the event normalizer's private normalizeAlternates: a title (trimmed, ≤80,
// required — a title-less row is dropped), a whitelisted reason defaulting to
// "rain", an optional activityId, and an optional locations list. Capped at
// ALTERNATES_MAX. Deterministic; a garbage value collapses to [].
export function normalizeActivityAlternates(value: unknown): AlternateRef[] {
  if (!Array.isArray(value)) return [];
  const out: AlternateRef[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const v = item as Record<string, unknown>;
    const title =
      typeof v.title === "string" ? v.title.trim().slice(0, ALTERNATE_TITLE_MAX_LENGTH) : "";
    if (!title) continue;
    const ref: AlternateRef = {
      title,
      reason:
        typeof v.reason === "string" && ALTERNATE_REASONS.has(v.reason as AlternateReason)
          ? (v.reason as AlternateReason)
          : "rain",
    };
    if (typeof v.activityId === "string" && v.activityId) ref.activityId = v.activityId;
    const locations = normalizeLocationList(v.locations);
    if (locations.length) ref.locations = locations;
    out.push(ref);
    if (out.length >= ALTERNATES_MAX) break;
  }
  return out;
}

// The effective backup list for a placement. The empty-array-authoritative rule:
// an event that carries `alternates` (even []) OWNS the list for this day —
// including "no backups here"; ONLY an absent event list inherits the activity's
// defaults. A custom event (no activity) with no event list resolves to [].
export function resolveAlternates(
  event: Pick<CalendarEvent, "alternates">,
  activity: Activity | undefined | null
): AlternateRef[] {
  if (event.alternates !== undefined) return event.alternates;
  return activity?.alternates ?? [];
}

// Whether a resolved list carries a rain-reason backup — drives the umbrella vs
// generic glyph on the card and the day-header rain lens.
export function hasRainAlternate(list: readonly AlternateRef[]): boolean {
  return list.some((a) => a.reason === "rain");
}

// Promote a backup to primary — ONE pure, self-inverse swap.
//
// Given the RESOLVED list (so a first promote copies the activity defaults onto
// the event), swap the primary title/activityId/kind with the alternate at
// `index`, and park the DISPLACED primary back in the list at that slot as a
// backup (title + optional activityId + the primary's locations, if any). The
// alternate's own locations become the event's places when it carries them;
// otherwise the event keeps its places. The post-swap list is written to
// event.alternates (copy-on-write). NOTHING else is touched — times, pinned,
// mealKind, materialSubs, note, series fields all ride through untouched.
//
// Self-inverse: promote(promote(e, i), i) ≡ e (the demoted primary sits back at
// slot i, so promoting it again restores the original). updatedAt is left to the
// caller (this stays deterministic).
export function planPromote(
  event: CalendarEvent,
  index: number,
  resolved: readonly AlternateRef[]
): CalendarEvent {
  const alt = resolved[index];
  if (!alt) return event;

  // The displaced primary, demoted to a backup entry in the alternate's old slot.
  // It keeps the same reason the alternate carried, so a rain backup swapped in
  // leaves a rain backup (the original) swapped out — the axis is preserved.
  const demoted: AlternateRef = { title: event.title, reason: alt.reason };
  if (event.activityId) demoted.activityId = event.activityId;
  if (event.locations && event.locations.length) demoted.locations = [...event.locations];

  const nextList = resolved.map((ref, i) => (i === index ? demoted : ref));

  const next: CalendarEvent = { ...event, title: alt.title, alternates: nextList };
  // kind follows the ref: an activity-backed alternate is an "activity" placement,
  // a title-only one is "custom". Keep activityId in lockstep.
  if (alt.activityId) {
    next.activityId = alt.activityId;
    next.kind = "activity";
  } else {
    delete next.activityId;
    next.kind = "custom";
  }
  // The alternate's locations, when it names any, replace the event's places (a
  // rain swap that still says "Fields" is the bug this guards). When it names
  // none, the event keeps whatever it had — the primary's places ride through.
  if (alt.locations && alt.locations.length) {
    next.locations = [...alt.locations];
  }
  return next;
}
