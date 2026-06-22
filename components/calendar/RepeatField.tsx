"use client";

import { useMemo } from "react";
import { addDays, fromDateKey } from "@/lib/calendar/dates";
import { summarizeRecurrence, type RecurrenceRule } from "@/lib/calendar/recurrence";
import type { DateKey } from "@/lib/calendar/types";
import { Select } from "../floating/Select";
import { DatePopover } from "../floating/DatePopover";

// The recurrence control inside QuickAdd's pick-a-time posture: a preset picker
// (none / daily / weekday / weekly), weekday toggles when weekly, and an end
// date. It edits a RecurrenceRule (or undefined for a one-off); CalendarShell
// turns that into the materialized series on save.

type Preset = "none" | "daily" | "weekdays" | "weekly";

const WEEKDAYS_MF = [1, 2, 3, 4, 5];
const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Default horizon when a repeat is first switched on: six weeks reads as a
// camp-season length without being open-ended.
function defaultUntil(start: DateKey): DateKey {
  return addDays(start, 7 * 6);
}

function presetOf(rule: RecurrenceRule | undefined): Preset {
  if (!rule) return "none";
  if (rule.freq === "daily") return "daily";
  const wd = rule.weekdays ?? [];
  if (wd.length === 5 && WEEKDAYS_MF.every((d) => wd.includes(d))) return "weekdays";
  return "weekly";
}

export function RepeatField({
  value,
  startDate,
  onChange,
}: {
  value: RecurrenceRule | undefined;
  startDate: DateKey;
  onChange: (rule: RecurrenceRule | undefined) => void;
}) {
  const preset = presetOf(value);
  // Keep the end date ≥ the event's own date even as the date moves around in
  // the editor; the displayed/summary value always reflects that clamp.
  const until = value ? (value.until < startDate ? startDate : value.until) : defaultUntil(startDate);
  const startDow = fromDateKey(startDate).getDay();
  const weekdays =
    value?.freq === "weekly" && value.weekdays?.length ? value.weekdays : [startDow];

  const presetOptions = useMemo<{ value: Preset; label: string }[]>(
    () => [
      { value: "none", label: "Does not repeat" },
      { value: "daily", label: "Every day" },
      { value: "weekdays", label: "Every weekday (Mon–Fri)" },
      { value: "weekly", label: "Weekly" },
    ],
    []
  );

  function choosePreset(next: Preset) {
    if (next === "none") return onChange(undefined);
    if (next === "daily") return onChange({ freq: "daily", interval: 1, until });
    if (next === "weekdays")
      return onChange({ freq: "weekly", interval: 1, weekdays: [...WEEKDAYS_MF], until });
    onChange({ freq: "weekly", interval: 1, weekdays: [...weekdays].sort((a, b) => a - b), until });
  }

  function toggleWeekday(day: number) {
    if (!value || value.freq !== "weekly") return;
    const current = value.weekdays?.length ? value.weekdays : [startDow];
    const next = current.includes(day) ? current.filter((d) => d !== day) : [...current, day];
    if (!next.length) return; // a weekly rule keeps at least one day
    onChange({ ...value, weekdays: next.sort((a, b) => a - b) });
  }

  function setUntil(next: DateKey) {
    if (!value) return;
    onChange({ ...value, until: next < startDate ? startDate : next });
  }

  return (
    <div className="repeatfield">
      <div className="repeatfield__row">
        <div className="field repeatfield__preset">
          <label className="field__label" htmlFor="quickadd-repeat">
            Repeat
          </label>
          <Select
            id="quickadd-repeat"
            value={preset}
            options={presetOptions}
            onChange={choosePreset}
            ariaLabel="Repeat"
          />
        </div>
        {value && (
          <div className="field repeatfield__until">
            <label className="field__label" htmlFor="quickadd-repeat-until">
              Ends
            </label>
            <DatePopover
              id="quickadd-repeat-until"
              value={until}
              onChange={setUntil}
              ariaLabel="Repeat end date"
            />
          </div>
        )}
      </div>

      {value?.freq === "weekly" && (
        <div className="repeatfield__days" role="group" aria-label="Repeat on">
          {DAY_LETTERS.map((letter, day) => {
            const on = weekdays.includes(day);
            return (
              <button
                key={day}
                type="button"
                className={"repeatfield__day" + (on ? " is-on" : "")}
                aria-pressed={on}
                aria-label={DAY_NAMES[day]}
                onClick={() => toggleWeekday(day)}
              >
                {letter}
              </button>
            );
          })}
        </div>
      )}

      {value && <p className="repeatfield__summary">{summarizeRecurrence({ ...value, until })}</p>}
    </div>
  );
}
