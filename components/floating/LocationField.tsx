"use client";

// Per-event location: a plain, inline text field — NOT a popover. The staff type
// where the block happens (gym, field, playground) right in the row. Locations
// already used elsewhere on the calendar ride along in a native <datalist>, so a
// common place comes back with a keystroke without any pane opening. It stays
// "just a text box". value === undefined means "no location set".

import { useId, useMemo, useState } from "react";
import { EVENT_LOCATION_MAX_LENGTH } from "@/lib/calendar/types";

const MAX_SUGGESTIONS = 8;

export function LocationField({
  id,
  value,
  suggestions,
  onChange,
  ariaLabel,
}: {
  id?: string;
  /** The chosen location, or undefined when none is set. */
  value: string | undefined;
  /** Locations already used elsewhere — offered as native autocomplete. */
  suggestions: string[];
  /** undefined clears the location. */
  onChange: (value: string | undefined) => void;
  ariaLabel: string;
}) {
  const listId = useId();
  // The raw text the user is typing is kept locally so leading/trailing spaces
  // (mid-word edits) survive; the stored value is always trimmed (empty → clear).
  const [draft, setDraft] = useState(value ?? "");

  // Distinct, deduped, alphabetised places — offered as the datalist options.
  const options = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of suggestions) {
      const place = raw.trim();
      const key = place.toLowerCase();
      if (!place || seen.has(key)) continue;
      seen.add(key);
      out.push(place);
    }
    out.sort((a, b) => a.localeCompare(b));
    return out.slice(0, MAX_SUGGESTIONS);
  }, [suggestions]);

  function handle(next: string) {
    setDraft(next);
    const trimmed = next.trim().slice(0, EVENT_LOCATION_MAX_LENGTH);
    onChange(trimmed ? trimmed : undefined);
  }

  return (
    <div className="cloc">
      <input
        id={id}
        className="input cloc__input"
        type="text"
        value={draft}
        list={options.length ? listId : undefined}
        maxLength={EVENT_LOCATION_MAX_LENGTH}
        placeholder="Add location"
        aria-label={ariaLabel}
        onChange={(e) => handle(e.target.value)}
      />
      {options.length > 0 && (
        <datalist id={listId}>
          {options.map((place) => (
            <option key={place} value={place} />
          ))}
        </datalist>
      )}
    </div>
  );
}
