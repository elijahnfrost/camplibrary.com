"use client";

// The Print tab's controls — every knob that shapes the printout, built from the
// app's shared sidebar vocabulary so the Print rail reads as the SAME rail as the
// Library filters and the Calendar view settings (not a bespoke console). It
// renders into the primary sidebar on desktop (a portal from PrintTab) and into
// the mobile options sheet; state lives in PrintTab and this is a controlled
// view over it.
//
// Kept deliberately UNCLUTTERED: a headerless range widget leads (the mini-month's
// role), then a single "Format" section holds only the handful of choices you make
// per print — Layout, Detail, Color, and the two appendix toggles. Everything
// set-once or niche (Paper, pagination, theme/all-day/empty toggles, cover title,
// camp) folds behind ONE "More options" row — the Library "Available kit" pattern
// (a summary that IS a ledger row, expanding a sub-ledger). So the resting rail is
// short, and the rest is one tap away — never a wall of equal-weight switches.

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { addDays, fromDateKey, todayKey, toDateKey } from "@/lib/calendar/dates";
import type { DateKey } from "@/lib/calendar/types";
import type { Camp } from "@/lib/camps";
import type { PrintLayout, PrintOptions, ScheduleDetail, TimelineDensity } from "@/lib/print/options";
import { MAX_PRINT_DAYS } from "@/lib/print/schedule";
import { CampIcon } from "../icons";
import { MenuPicker, MiniSeg, ToggleSwitch } from "../primitives";
import { MiniRangeCalendar } from "./MiniRangeCalendar";

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
      className="input prail__titleinput"
      value={draft}
      maxLength={80}
      placeholder="e.g. Ocean Week"
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

// ---- Rail primitives (the shared ledger vocabulary) ------------------------

/** A titled, always-visible group: a small-caps header (the "Filter"/"View"
 *  section treatment) over a switch ledger. */
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="prail__group">
      <div className="prail__grouphead">
        <span className="prail__grouptitle">{title}</span>
      </div>
      <div className="ledger">{children}</div>
    </section>
  );
}

/** An inline ledger row: small-caps label left, a compact control right — the
 *  library/calendar shape, shared by `MiniSeg`, `MenuPicker`, and `ToggleSwitch`. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ledger__row">
      <span className="ledger__label">{label}</span>
      {children}
    </div>
  );
}

/** The secondary settings, folded behind ONE ledger row — the Library "Available
 *  kit" pattern: a `<summary>` that IS a ledger row (label left, chevron right),
 *  expanding a sub-ledger. Keeps the resting rail to its essentials. */
function MoreOptions({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="prail__more" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="prail__moresum ledger__row">
        <span className="ledger__label">More options</span>
        <span className="prail__morestate" aria-hidden="true">
          <CampIcon.ChevronDown />
        </span>
      </summary>
      <div className="prail__morepanel">
        <div className="ledger">{children}</div>
      </div>
    </details>
  );
}

const DETAIL_OPTIONS: { id: ScheduleDetail; label: string }[] = [
  { id: "times", label: "Times only" },
  { id: "summary", label: "Summary" },
  { id: "tldr", label: "Run TLDR" },
];

const LAYOUT_OPTIONS: { id: PrintLayout; label: string; ariaLabel: string }[] = [
  { id: "agenda", label: "Agenda", ariaLabel: "A list of events in order" },
  { id: "timeline", label: "Timeline", ariaLabel: "A blocked-out day grid by duration" },
];

const DENSITY_OPTIONS: { id: TimelineDensity; label: string }[] = [
  { id: "compact", label: "Compact" },
  { id: "cozy", label: "Cozy" },
  { id: "roomy", label: "Roomy" },
];

// A short, human label for the chosen span — e.g. "Mon, Jun 16 → Sun, Jun 22".
function rangeReadout(start: DateKey, end: DateKey): string {
  const fmt = (key: DateKey) =>
    fromDateKey(key).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  return start === end ? fmt(start) : fmt(start) + " → " + fmt(end);
}

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

  const activeIndex = PRESETS.findIndex((preset) => {
    const r = preset.range();
    return r.start === options.start && r.end === options.end;
  });

  const campOptions = [
    { id: "", label: "All camps" },
    ...camps.map((camp) => ({ id: camp.id, label: camp.name })),
  ];

  return (
    <div className="prail">
      {/* Range — the headerless lead widget (the mini-month's role on the calendar
          rail): quick-range pills, the inline range calendar, then the readout. */}
      <div className="prail__range">
        {/* A single full-width segmented control (the app's seg-slide vocabulary):
            the active range glides under a thumb; a custom (calendar-picked) range
            hides it. Replaces the old 2×2 button grid — one tidy row. */}
        <div
          className={"prail__quickrange seg-slide" + (activeIndex < 0 ? " is-custom" : "")}
          role="group"
          aria-label="Quick ranges"
          style={{ "--seg-n": PRESETS.length, "--seg-i": Math.max(0, activeIndex) } as CSSProperties}
        >
          {PRESETS.map((preset, i) => {
            const on = activeIndex === i;
            return (
              <button
                key={preset.id}
                type="button"
                className={on ? "is-on" : undefined}
                aria-pressed={on}
                onClick={() => onChange(preset.range())}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
        <MiniRangeCalendar
          value={{ start: options.start, end: options.end }}
          onChange={(range) => onChange(range)}
          maxDays={MAX_PRINT_DAYS}
          today={todayKey()}
        />
        <div className="prail__readout">
          <span className="prail__readout-range">{rangeReadout(options.start, options.end)}</span>
          <span className="prail__readout-count">
            {rangeDays} {rangeDays === 1 ? "day" : "days"}
          </span>
        </div>
      </div>

      {/* Format — only the choices you actually make per print: the day's shape
          (Layout + Detail), color, and the two appendix toggles. Everything else
          folds into "More options" below, so the rail stays short. */}
      <Group title="Format">
        <Row label="Layout">
          <MiniSeg
            options={LAYOUT_OPTIONS}
            value={options.layout}
            ariaLabel="Schedule layout"
            onChange={(layout) => onChange({ layout })}
          />
        </Row>
        {options.layout === "timeline" ? (
          <MenuPicker
            label="Spacing"
            options={DENSITY_OPTIONS}
            value={options.timelineDensity}
            ariaLabel="Timeline spacing"
            onChange={(timelineDensity) => onChange({ timelineDensity })}
          />
        ) : (
          <MenuPicker
            label="Detail"
            options={DETAIL_OPTIONS}
            value={options.scheduleDetail}
            ariaLabel="How much detail per activity"
            onChange={(scheduleDetail) => onChange({ scheduleDetail })}
          />
        )}
        <Row label="Color">
          <MiniSeg
            options={[
              { id: "color", label: "Color" },
              { id: "mono", label: "B & W" },
            ]}
            value={options.color}
            ariaLabel="Color or black and white"
            onChange={(color) => onChange({ color })}
          />
        </Row>
        <Row label="Full run sheets">
          <ToggleSwitch
            on={options.appendRunSheets}
            ariaLabel="Append full run sheets"
            onChange={(appendRunSheets) => onChange({ appendRunSheets })}
          />
        </Row>
        <Row label="Materials list">
          <ToggleSwitch
            on={options.materialsRollup}
            ariaLabel="Include a combined materials list"
            onChange={(materialsRollup) => onChange({ materialsRollup })}
          />
        </Row>

        {/* The set-once / niche knobs — out of sight until needed. */}
        <MoreOptions>
          <Row label="Paper">
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
          <Row label="A page per day">
            <ToggleSwitch
              on={options.pageBreakPerDay}
              ariaLabel="Start each day on a new page"
              onChange={(pageBreakPerDay) => onChange({ pageBreakPerDay })}
            />
          </Row>
          <Row label="Show themes">
            <ToggleSwitch
              on={options.showThemes}
              ariaLabel="Show themes"
              onChange={(showThemes) => onChange({ showThemes })}
            />
          </Row>
          <Row label="All-day events">
            <ToggleSwitch
              on={options.includeAllDay}
              ariaLabel="Include all-day events"
              onChange={(includeAllDay) => onChange({ includeAllDay })}
            />
          </Row>
          <Row label="Empty days">
            <ToggleSwitch
              on={options.includeEmptyDays}
              ariaLabel="Include empty days"
              onChange={(includeEmptyDays) => onChange({ includeEmptyDays })}
            />
          </Row>
          {camps.length > 0 && (
            <MenuPicker
              label="Camp"
              options={campOptions}
              value={options.campId ?? ""}
              ariaLabel="Which camp to print"
              onChange={(value) => onChange({ campId: value ? value : null })}
            />
          )}
          <Row label="Cover title">
            <TitleField value={options.title} onCommit={(title) => onChange({ title })} />
          </Row>
        </MoreOptions>
      </Group>
    </div>
  );
}
