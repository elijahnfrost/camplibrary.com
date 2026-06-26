"use client";

// Bulk-edit panel for a multi-event selection (T3). A focused Modal that reuses
// the SHARED editor primitives directly (ColorField, LocationField, Select,
// ToggleSwitch on the ledger vocabulary) in a "leave unchanged unless touched"
// model — deliberately separate from QuickAdd (which T1 owns) so the two never
// collide. Each field carries a per-field "Change" toggle: only fields whose
// toggle is ON are sent back, so an untouched field is never written across the
// selection. Color/location use `undefined` to mean CLEAR (vs absent = leave).

import { useState } from "react";
import { categoryTint } from "@/lib/data";
import { Modal } from "../Modal";
import { ToggleSwitch } from "../primitives";
import { ColorField } from "../floating/ColorField";
import { LocationField } from "../floating/LocationField";
import { Select } from "../floating/Select";
import type { BulkEditChanges } from "./CalendarShell";

// Day-shift choices: ± a week of whole days, 0 = no change.
const DAY_SHIFTS: { value: number; label: string }[] = [
  { value: -7, label: "−7 days" },
  { value: -2, label: "−2 days" },
  { value: -1, label: "−1 day" },
  { value: 0, label: "No change" },
  { value: 1, label: "+1 day" },
  { value: 2, label: "+2 days" },
  { value: 7, label: "+7 days" },
];

// Time-shift choices in minutes (grid-aligned), 0 = no change.
const TIME_SHIFTS: { value: number; label: string }[] = [
  { value: -120, label: "−2 hours" },
  { value: -60, label: "−1 hour" },
  { value: -30, label: "−30 min" },
  { value: -15, label: "−15 min" },
  { value: 0, label: "No change" },
  { value: 15, label: "+15 min" },
  { value: 30, label: "+30 min" },
  { value: 60, label: "+1 hour" },
  { value: 120, label: "+2 hours" },
];

// All-day: a three-way Leave / All day / Timed (so neither state is forced).
type AllDayChoice = "leave" | "on" | "off";
const ALLDAY_CHOICES: { value: AllDayChoice; label: string }[] = [
  { value: "leave", label: "Leave as is" },
  { value: "on", label: "All day" },
  { value: "off", label: "Timed" },
];

export function BulkEditPanel({
  count,
  suggestions,
  onApply,
  onClose,
}: {
  /** How many events the edit will touch. */
  count: number;
  /** Locations already used elsewhere — offered as native autocomplete. */
  suggestions: string[];
  /** Apply the touched fields across the selection (one undoable commit). */
  onApply: (changes: BulkEditChanges) => void;
  onClose: () => void;
}) {
  // Per-field "change this" toggles — a field is applied only when its toggle is
  // on (the leave-unchanged model). Color/location values: undefined = clear.
  const [changeColor, setChangeColor] = useState(false);
  const [color, setColor] = useState<string | undefined>(undefined);
  const [changeLocation, setChangeLocation] = useState(false);
  const [location, setLocation] = useState<string | undefined>(undefined);
  const [allDay, setAllDay] = useState<AllDayChoice>("leave");
  const [dayShift, setDayShift] = useState(0);
  const [minShift, setMinShift] = useState(0);

  // Anything touched? Gates the Apply button so an empty edit can't fire.
  const dirty =
    changeColor || changeLocation || allDay !== "leave" || dayShift !== 0 || minShift !== 0;

  function apply() {
    const changes: BulkEditChanges = {};
    if (changeColor) changes.color = color; // undefined → reset to tag color
    if (changeLocation) changes.location = location; // undefined → clear
    if (allDay !== "leave") changes.allDay = allDay === "on";
    if (dayShift !== 0) changes.dayShift = dayShift;
    if (minShift !== 0) changes.minShift = minShift;
    onApply(changes);
  }

  const noun = count === 1 ? "event" : "events";

  return (
    <Modal label={"Edit " + count + " " + noun} onClose={onClose} overlayProps={{ className: "overlay--card" }}>
      <div className="overlay__bar">
        <h2 className="filtersheet__title">
          Edit {count} {noun}
        </h2>
      </div>
      <div className="overlay__body bulkedit">
        <p className="bulkedit__hint">Only the rows you switch on are applied — everything else is left as is.</p>
        <div className="ledger bulkedit__settings">
          <div className="ledger__row">
            <span className="ledger__label">Color</span>
            <div className="bulkedit__field">
              <ToggleSwitch on={changeColor} onChange={setChangeColor} ariaLabel="Change color" />
              {changeColor && (
                <ColorField
                  value={color}
                  fallback={categoryTint(undefined)}
                  onChange={setColor}
                  ariaLabel="Bulk event color"
                />
              )}
            </div>
          </div>
          <div className="ledger__row">
            <span className="ledger__label">Location</span>
            <div className="bulkedit__field">
              <ToggleSwitch on={changeLocation} onChange={setChangeLocation} ariaLabel="Change location" />
              {changeLocation && (
                <LocationField
                  value={location}
                  suggestions={suggestions}
                  onChange={setLocation}
                  ariaLabel="Bulk event location"
                />
              )}
            </div>
          </div>
          <div className="ledger__row">
            <span className="ledger__label">All day</span>
            <Select
              value={allDay}
              options={ALLDAY_CHOICES}
              onChange={setAllDay}
              ariaLabel="Bulk all-day"
            />
          </div>
          <div className="ledger__row">
            <span className="ledger__label">Move days</span>
            <Select value={dayShift} options={DAY_SHIFTS} onChange={setDayShift} ariaLabel="Shift by days" />
          </div>
          <div className="ledger__row">
            <span className="ledger__label">Shift time</span>
            <Select value={minShift} options={TIME_SHIFTS} onChange={setMinShift} ariaLabel="Shift by time" />
          </div>
        </div>
      </div>
      <div className="bulkedit__foot">
        <button type="button" className="btn btn--ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn--primary" onClick={apply} disabled={!dirty}>
          Apply to {count} {noun}
        </button>
      </div>
    </Modal>
  );
}
