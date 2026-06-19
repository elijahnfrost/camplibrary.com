"use client";

// The Print tab's console — every knob that shapes the printout. Built from the
// app's existing controls (SidebarSection, MiniSeg, ToggleSwitch, Select,
// DatePopover) so it reads as one switch-ledger, consistent with the library
// filter rail. State lives in PrintTab; this is a controlled view over it.

import { useEffect, useRef, useState } from "react";
import { addDays, fromDateKey, todayKey, toDateKey } from "@/lib/calendar/dates";
import type { DateKey } from "@/lib/calendar/types";
import type { Camp } from "@/lib/camps";
import type { PrintOptions, ScheduleDetail } from "@/lib/print/options";
import { MAX_PRINT_DAYS } from "@/lib/print/schedule";
import { MiniSeg, SidebarSection, ToggleSwitch } from "../primitives";
import { DatePopover } from "../floating/DatePopover";
import { Select } from "../floating/Select";

type Patch = Partial<PrintOptions>;

// The cover title pushes upstream on a short debounce so each keystroke doesn't
// reconcile the whole live preview. The local value stays responsive; it also
// resyncs if the title is changed elsewhere (it isn't today, but keeps it honest).
function TitleField({ value, onCommit }: { value: string; onCommit: (title: string) => void }) {
  const [draft, setDraft] = useState(value);
  const committed = useRef(value);
  useEffect(() => {
    if (value !== committed.current) {
      committed.current = value;
      setDraft(value);
    }
  }, [value]);
  useEffect(() => {
    if (draft === committed.current) return;
    const id = window.setTimeout(() => {
      committed.current = draft;
      onCommit(draft);
    }, 220);
    return () => window.clearTimeout(id);
  }, [draft, onCommit]);
  return (
    <input
      id="pc-title"
      type="text"
      className="input pc-title"
      value={draft}
      maxLength={80}
      placeholder="e.g. Week of Jan 16"
      aria-label="Custom cover title"
      onChange={(event) => setDraft(event.target.value)}
    />
  );
}

// Monday of the week containing `key` (the calendar weeks start Monday).
function weekStart(key: DateKey): DateKey {
  const d = fromDateKey(key);
  const offset = (d.getDay() + 6) % 7; // JS Sun=0 → Mon-based offset
  return addDays(key, -offset);
}

function monthBounds(key: DateKey): { start: DateKey; end: DateKey } {
  const d = fromDateKey(key);
  const start = toDateKey(new Date(d.getFullYear(), d.getMonth(), 1));
  const end = toDateKey(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  return { start, end };
}

const PRESETS: { id: string; label: string; range: () => { start: DateKey; end: DateKey } }[] = [
  { id: "today", label: "Today", range: () => ({ start: todayKey(), end: todayKey() }) },
  {
    id: "this-week",
    label: "This week",
    range: () => {
      const start = weekStart(todayKey());
      return { start, end: addDays(start, 6) };
    },
  },
  {
    id: "next-week",
    label: "Next week",
    range: () => {
      const start = addDays(weekStart(todayKey()), 7);
      return { start, end: addDays(start, 6) };
    },
  },
  { id: "this-month", label: "This month", range: () => monthBounds(todayKey()) },
];

function Row({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="pc-row">
      <label className="pc-row__text" htmlFor={htmlFor}>
        <span className="pc-row__label">{label}</span>
        {hint && <span className="pc-row__hint">{hint}</span>}
      </label>
      <div className="pc-row__control">{children}</div>
    </div>
  );
}

const DETAIL_OPTIONS: { id: ScheduleDetail; label: string; ariaLabel: string }[] = [
  { id: "times", label: "Times", ariaLabel: "Times and titles only" },
  { id: "summary", label: "Summary", ariaLabel: "Add facts and blurb" },
  { id: "tldr", label: "Run TLDR", ariaLabel: "Add a short run-sheet summary" },
];

export function PrintControls({
  options,
  onChange,
  camps,
}: {
  options: PrintOptions;
  onChange: (patch: Patch) => void;
  camps: Camp[];
}) {
  const rangeDays = (() => {
    const lo = fromDateKey(options.start).getTime();
    const hi = fromDateKey(options.end).getTime();
    const span = Math.round(Math.abs(hi - lo) / 86_400_000) + 1;
    return Math.min(span, MAX_PRINT_DAYS);
  })();

  const activePreset = PRESETS.find((preset) => {
    const r = preset.range();
    return r.start === options.start && r.end === options.end;
  })?.id;

  const campOptions = [
    { value: "", label: "All camps" },
    ...camps.map((camp) => ({ value: camp.id, label: camp.name })),
  ];

  return (
    <div className="print-console">
      <SidebarSection title="Dates">
        <div className="pc-presets" role="group" aria-label="Quick ranges">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={"pc-preset" + (activePreset === preset.id ? " is-on" : "")}
              aria-pressed={activePreset === preset.id}
              onClick={() => onChange(preset.range())}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <Row label="From" htmlFor="pc-start">
          <DatePopover
            id="pc-start"
            value={options.start}
            ariaLabel="Range start date"
            onChange={(start) => onChange({ start })}
          />
        </Row>
        <Row label="To" htmlFor="pc-end" hint={rangeDays + (rangeDays === 1 ? " day" : " days")}>
          <DatePopover
            id="pc-end"
            value={options.end}
            ariaLabel="Range end date"
            onChange={(end) => onChange({ end })}
          />
        </Row>
        {camps.length > 0 && (
          <Row label="Camp" htmlFor="pc-camp">
            <Select
              id="pc-camp"
              value={options.campId ?? ""}
              options={campOptions}
              ariaLabel="Which camp to print"
              onChange={(value) => onChange({ campId: value ? value : null })}
            />
          </Row>
        )}
      </SidebarSection>

      <SidebarSection title="Detail">
        <Row label="Per activity">
          <MiniSeg
            options={DETAIL_OPTIONS}
            value={options.scheduleDetail}
            ariaLabel="How much detail per activity"
            onChange={(scheduleDetail) => onChange({ scheduleDetail })}
          />
        </Row>
        <Row label="Full run sheets" hint="Append a sheet per activity">
          <ToggleSwitch
            on={options.appendRunSheets}
            ariaLabel="Append full run sheets"
            onChange={(appendRunSheets) => onChange({ appendRunSheets })}
          />
        </Row>
        <Row label="Materials list" hint="Combined kit for the range">
          <ToggleSwitch
            on={options.materialsRollup}
            ariaLabel="Include a combined materials list"
            onChange={(materialsRollup) => onChange({ materialsRollup })}
          />
        </Row>
      </SidebarSection>

      <SidebarSection title="Style">
        <Row label="Color">
          <MiniSeg
            options={[
              { id: "color", label: "Color" },
              { id: "mono", label: "Black & white" },
            ]}
            value={options.color}
            ariaLabel="Color or black and white"
            onChange={(color) => onChange({ color })}
          />
        </Row>
        <Row label="Formatting">
          <MiniSeg
            options={[
              { id: "styled", label: "Designed" },
              { id: "plain", label: "Plain" },
            ]}
            value={options.style}
            ariaLabel="Designed or plain formatting"
            onChange={(style) => onChange({ style })}
          />
        </Row>
      </SidebarSection>

      <SidebarSection title="Include">
        <Row label="All-day events">
          <ToggleSwitch
            on={options.includeAllDay}
            ariaLabel="Include all-day events"
            onChange={(includeAllDay) => onChange({ includeAllDay })}
          />
        </Row>
        <Row label="Empty days" hint="Keep days with nothing on them">
          <ToggleSwitch
            on={options.includeEmptyDays}
            ariaLabel="Include empty days"
            onChange={(includeEmptyDays) => onChange({ includeEmptyDays })}
          />
        </Row>
        <Row label="Themes" hint="Show each activity's theme">
          <ToggleSwitch
            on={options.showThemes}
            ariaLabel="Show themes"
            onChange={(showThemes) => onChange({ showThemes })}
          />
        </Row>
        <Row label="A page per day">
          <ToggleSwitch
            on={options.pageBreakPerDay}
            ariaLabel="Start each day on a new page"
            onChange={(pageBreakPerDay) => onChange({ pageBreakPerDay })}
          />
        </Row>
      </SidebarSection>

      <SidebarSection title="Cover title">
        <TitleField value={options.title} onCommit={(title) => onChange({ title })} />
      </SidebarSection>
    </div>
  );
}
