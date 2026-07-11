"use client";

import { useMemo } from "react";
import { addDays, fromDateKey } from "@/lib/calendar/dates";
import {
  recurrenceIsTruncated,
  summarizeRecurrence,
  type NthWeekday,
  type RecurrenceRule,
} from "@/lib/calendar/recurrence";
import type { DateKey } from "@/lib/calendar/types";
import { Select } from "../floating/Select";
import { DatePopover } from "../floating/DatePopover";
import { PropRow } from "../ui/PropRow";
import { CampIcon } from "../ui/icons";

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
  onRestoreSkip,
}: {
  value: RecurrenceRule | undefined;
  startDate: DateKey;
  onChange: (rule: RecurrenceRule | undefined) => void;
  /** Un-skip one of the rule's exdates (edit posture, a series member): mints a
   *  fresh occurrence back on `date` and clears it from the survivors' exdates.
   *  Wired to CalendarShell's planRestoreOccurrence path. Absent = no Restore
   *  affordance (a brand-new repeat has no skips yet). */
  onRestoreSkip?: (date: DateKey) => void;
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

  // The weekday BLACKOUT (exceptWeekdays) — a daily/monthly/yearly rule can carve
  // out specific weekdays (e.g. "daily except Wed"). Weekly folds a blackout into
  // its positive set, so this row is hidden there. Toggling all seven off would
  // make the rule generate nothing, so we refuse the last removal by clamping.
  const except = value?.exceptWeekdays ?? [];
  function toggleExcept(day: number) {
    if (!value || value.freq === "weekly") return;
    const has = except.includes(day);
    const next = has ? except.filter((d) => d !== day) : [...except, day];
    if (next.length >= 7) return; // never black out every day
    if (!next.length) {
      const cleared = { ...value };
      delete cleared.exceptWeekdays;
      onChange(cleared);
      return;
    }
    onChange({ ...value, exceptWeekdays: next.sort((a, b) => a - b) });
  }

  function setUntil(next: DateKey) {
    if (!value) return;
    onChange({ ...value, until: next < startDate ? startDate : next });
  }

  // The repeat controls are property rows like every other event setting (the
  // parent .proplist supplies the frame). The lead "Repeat" row carries the
  // axis icon; the detail rows (weekday toggles, anchor, end date) drop the icon
  // so they indent beneath it. The plain-language summary closes it off — all
  // shown only once a repeat is switched on.
  return (
    <>
      <PropRow icon={CampIcon.Repeat} label="Repeat">
        <Select
          id="quickadd-repeat"
          value={preset}
          options={presetOptions}
          onChange={choosePreset}
          ariaLabel="Repeat"
        />
      </PropRow>

      {value?.freq === "weekly" && (
        <PropRow label="On">
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
        </PropRow>
      )}

      {(value?.freq === "monthly" || value?.freq === "yearly") && (
        <PropRow label="Repeat on">
          <Select
            id="quickadd-repeat-anchor"
            value={anchorMode}
            options={anchorOptions}
            onChange={chooseAnchor}
            ariaLabel="Repeat on"
          />
        </PropRow>
      )}

      {/* Weekday blackout — daily / monthly / yearly only (weekly folds it into
          the positive set, so the term never surfaces there). Toggle chips write
          rule.exceptWeekdays; the summary reflects them via summarizeRecurrence. */}
      {value && value.freq !== "weekly" && (
        <PropRow label="Except">
          <div className="repeatfield__days" role="group" aria-label="Except weekdays">
            {DAY_LETTERS.map((letter, day) => {
              const on = except.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  className={"repeatfield__day repeatfield__day--except" + (on ? " is-on" : "")}
                  aria-pressed={on}
                  aria-label={"Skip " + DAY_NAMES[day]}
                  onClick={() => toggleExcept(day)}
                >
                  {letter}
                </button>
              );
            })}
          </div>
        </PropRow>
      )}

      {value && (
        <PropRow label="Ends">
          <DatePopover
            id="quickadd-repeat-until"
            value={until}
            onChange={setUntil}
            ariaLabel="Repeat end date"
          />
        </PropRow>
      )}

      {/* Skipped dates — the rule's exdates, each with a Restore action that mints
          the occurrence back (edit posture, a series member). Collapsed to a count
          row that opens the list. Hidden when there are none or Restore isn't
          wired (a brand-new repeat has no skips). */}
      {value?.exdates?.length && onRestoreSkip ? (
        <PropRow label={"Skipped dates (" + value.exdates.length + ")"} className="prop-row--top">
          <div className="repeatfield__skips">
            {value.exdates.map((date) => (
              <div key={date} className="repeatfield__skip">
                <span className="repeatfield__skipdate">{fromDateKey(date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                <button
                  type="button"
                  className="repeatfield__restore"
                  onClick={() => onRestoreSkip(date)}
                >
                  Restore
                </button>
              </div>
            ))}
          </div>
        </PropRow>
      ) : null}

      {value && (
        <p className="repeatfield__summary">
          {summarizeRecurrence({ ...value, until })}
          {/* A quiet inline note when the 366-occurrence cap (or its scan-step
              backstops) cuts the series short of the picked "Ends" date, so
              staff never believe a series runs through a date it silently
              stopped short of (quickadd-3). Sourced from the pure helper in
              recurrence.ts, not duplicated here. */}
          {recurrenceIsTruncated(startDate, { ...value, until }) && (
            <span className="repeatfield__truncated"> · stops early (366-occurrence limit)</span>
          )}
        </p>
      )}
    </>
  );
}
