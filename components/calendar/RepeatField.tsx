"use client";

import { useMemo } from "react";
import { addDays, fromDateKey } from "@/lib/calendar/dates";
import { summarizeRecurrence, type NthWeekday, type RecurrenceRule } from "@/lib/calendar/recurrence";
import type { DateKey } from "@/lib/calendar/types";
import { Select } from "../floating/Select";
import { DatePopover } from "../floating/DatePopover";

// The recurrence control inside QuickAdd: a preset picker (none / daily / weekday
// / weekly / monthly / yearly), weekday toggles when weekly, a month/year anchor
// toggle (on day N, or on the Nth weekday), and an end date. It edits a
// RecurrenceRule (or undefined for a one-off); CalendarShell turns that into the
// materialized series on save.

type Preset = "none" | "daily" | "weekdays" | "weekly" | "monthly" | "yearly";

const WEEKDAYS_MF = [1, 2, 3, 4, 5];
const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ORDINALS: Record<number, string> = { 1: "first", 2: "second", 3: "third", 4: "fourth", [-1]: "last" };

// Default horizon when a repeat is first switched on: six weeks reads as a
// camp-season length without being open-ended.
function defaultUntil(start: DateKey): DateKey {
  return addDays(start, 7 * 6);
}

function presetOf(rule: RecurrenceRule | undefined): Preset {
  if (!rule) return "none";
  if (rule.freq === "daily") return "daily";
  if (rule.freq === "monthly") return "monthly";
  if (rule.freq === "yearly") return "yearly";
  const wd = rule.weekdays ?? [];
  if (wd.length === 5 && WEEKDAYS_MF.every((d) => wd.includes(d))) return "weekdays";
  return "weekly";
}

// The nth-weekday anchor for a date, e.g. "3rd Tuesday" or "last Friday" — `-1`
// when the date is the last occurrence of its weekday in the month.
function nthAnchorOf(key: DateKey): NthWeekday {
  const d = fromDateKey(key);
  const day = d.getDate();
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const week = day + 7 > daysInMonth ? -1 : Math.ceil(day / 7);
  return { week, weekday: d.getDay() };
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
      { value: "monthly", label: "Monthly" },
      { value: "yearly", label: "Yearly" },
    ],
    []
  );

  // Monthly/yearly anchor: "day" stores no anchor (the expander derives the
  // day-of-month from the start, so it follows the date for free); "weekday"
  // stores an nth-weekday anchor derived from the current start date.
  const anchorMode: "day" | "weekday" = value?.nthWeekday ? "weekday" : "day";
  const startDay = fromDateKey(startDate).getDate();
  const startNth = nthAnchorOf(startDate);
  const monthLabel = fromDateKey(startDate).toLocaleDateString(undefined, { month: "short" });
  const anchorOptions = useMemo(
    () => [
      {
        value: "day" as const,
        label:
          value?.freq === "yearly" ? "On " + monthLabel + " " + startDay : "On day " + startDay,
      },
      {
        value: "weekday" as const,
        label: "On the " + (ORDINALS[startNth.week] ?? "") + " " + DAY_NAMES[startNth.weekday],
      },
    ],
    [value?.freq, monthLabel, startDay, startNth.week, startNth.weekday]
  );

  function choosePreset(next: Preset) {
    if (next === "none") return onChange(undefined);
    if (next === "daily") return onChange({ freq: "daily", interval: 1, until });
    if (next === "weekdays")
      return onChange({ freq: "weekly", interval: 1, weekdays: [...WEEKDAYS_MF], until });
    if (next === "monthly") return onChange({ freq: "monthly", interval: 1, until });
    if (next === "yearly") return onChange({ freq: "yearly", interval: 1, until });
    onChange({ freq: "weekly", interval: 1, weekdays: [...weekdays].sort((a, b) => a - b), until });
  }

  function chooseAnchor(mode: "day" | "weekday") {
    if (!value || (value.freq !== "monthly" && value.freq !== "yearly")) return;
    if (mode === "weekday") {
      onChange({ ...value, monthDay: undefined, nthWeekday: nthAnchorOf(startDate) });
    } else {
      onChange({ ...value, monthDay: undefined, nthWeekday: undefined });
    }
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

      {(value?.freq === "monthly" || value?.freq === "yearly") && (
        <div className="repeatfield__row">
          <div className="field repeatfield__anchor">
            <label className="field__label" htmlFor="quickadd-repeat-anchor">
              Repeat on
            </label>
            <Select
              id="quickadd-repeat-anchor"
              value={anchorMode}
              options={anchorOptions}
              onChange={chooseAnchor}
              ariaLabel="Repeat on"
            />
          </div>
        </div>
      )}

      {value && <p className="repeatfield__summary">{summarizeRecurrence({ ...value, until })}</p>}
    </div>
  );
}
