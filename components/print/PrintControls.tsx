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
import type { CalendarEvent, DateKey } from "@/lib/calendar/types";
import { formatRangeLabel } from "@/lib/calendar/time";
import type { Camp } from "@/lib/camps";
import type { Activity } from "@/lib/types";
import type {
  DocDensity,
  DocSection,
  FontScale,
  PrintLayout,
  PrintOptions,
  ScheduleDetail,
  TimelineDensity,
} from "@/lib/print/options";
import { normalizeSearchText, searchTokens } from "@/lib/activityFilters";
import { MAX_PRINT_DAYS, type ScheduleDay } from "@/lib/print/schedule";
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

/** A COLLAPSIBLE titled group — the same `<details>`/`<summary>` disclosure the
 *  "More options" row used, but the summary IS the group header (small-caps title
 *  left, a chevron right that rotates open). Generalizes the old `MoreOptions`
 *  so every section can fold: frequently-changed groups lead `defaultOpen`, the
 *  rest rest closed. Native `<summary>` is keyboard-operable and the chevron
 *  signals state; the panel fade is reduced-motion-guarded in CSS. */
function CollapsibleGroup({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="prail__group prail__group--collapsible" open={defaultOpen}>
      <summary className="prail__grouphead prail__groupsum">
        <span className="prail__grouptitle">{title}</span>
        <span className="prail__morestate" aria-hidden="true">
          <CampIcon.ChevronDown />
        </span>
      </summary>
      <div className="prail__grouppanel">
        <div className="ledger">{children}</div>
      </div>
    </details>
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

const FONT_SCALE_OPTIONS: { id: FontScale; label: string }[] = [
  { id: "small", label: "Small" },
  { id: "regular", label: "Regular" },
  { id: "large", label: "Large" },
];

const DOC_DENSITY_OPTIONS: { id: DocDensity; label: string }[] = [
  { id: "tight", label: "Tight" },
  { id: "regular", label: "Regular" },
  { id: "airy", label: "Airy" },
];

const SECTION_LABEL: Record<DocSection, string> = {
  rollup: "Materials list",
  schedule: "Schedule",
  appendix: "Run sheets",
};

// A short, human label for the chosen span — e.g. "Mon, Jun 16 → Sun, Jun 22".
function rangeReadout(start: DateKey, end: DateKey): string {
  const fmt = (key: DateKey) =>
    fromDateKey(key).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  return start === end ? fmt(start) : fmt(start) + " → " + fmt(end);
}

// Search-and-add for individual run sheets: pick specific scheduled activities to
// append a full sheet for, additive to the "Full run sheets" toggle. Modeled on
// the QuickAdd / kit search — a filtered list to add from, removable chips for the
// current picks. Searches only what's scheduled in the current range/camp.
function RunSheetPicker({
  activities,
  selected,
  onChange,
}: {
  activities: Activity[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const selectedSet = new Set(selected);
  const picked = activities.filter((a) => selectedSet.has(a.id));
  // Multi-word + accent-/case-insensitive, matching the rest of the app's
  // search. Picking a run sheet is name-based, so the haystack stays title +
  // alt-names (not the full play-detail haystack the Library searches).
  const tokens = searchTokens(query);
  const matches = tokens.length
    ? activities
        .filter((a) => {
          if (selectedSet.has(a.id)) return false;
          const hay = normalizeSearchText(a.title + " " + (a.altNames ?? []).join(" "));
          return tokens.every((token) => hay.includes(token));
        })
        .slice(0, 6)
    : [];

  return (
    <div className="prail__runsheets">
      <span className="ledger__label">Individual run sheets</span>
      {picked.length > 0 && (
        <div className="prail__rschips">
          {picked.map((a) => (
            <button
              key={a.id}
              type="button"
              className="chip is-on prail__rschip"
              onClick={() => onChange(selected.filter((id) => id !== a.id))}
              aria-label={"Remove " + a.title}
            >
              {a.title}
              <CampIcon.Close />
            </button>
          ))}
        </div>
      )}
      {activities.length > 0 ? (
        <div className="prail__rssearch">
          <label className="material-filter__search">
            <CampIcon.Search />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Add a scheduled activity"
              aria-label="Search scheduled activities to add a run sheet"
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} aria-label="Clear search">
                <CampIcon.Close />
              </button>
            )}
          </label>
          {matches.length > 0 && (
            <div className="prail__rsresults" role="listbox" aria-label="Matching activities">
              {matches.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="prail__rsresult"
                  onClick={() => {
                    onChange([...selected, a.id]);
                    setQuery("");
                  }}
                >
                  <CampIcon.Plus />
                  {a.title}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <p className="prail__grouphint">Schedule some activities to add their sheets here.</p>
      )}
    </div>
  );
}

// Section order: a tiny ordered ledger with up/down nudges, so cover-relative
// sections (Materials list / Schedule / Run sheets) can be reordered without a
// drag library. The cover is toggled separately (it always leads). Order persists.
function SectionOrder({ order, onChange }: { order: DocSection[]; onChange: (order: DocSection[]) => void }) {
  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length) return;
    const next = [...order];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
  };
  return (
    <div className="prail__sections" role="list" aria-label="Section order">
      {order.map((id, index) => (
        <div className="prail__section" role="listitem" key={id}>
          <span className="prail__sectionidx" aria-hidden="true">
            {index + 1}
          </span>
          <span className="prail__sectionlabel">{SECTION_LABEL[id]}</span>
          <span className="prail__sectionmove">
            <button
              type="button"
              onClick={() => move(index, index - 1)}
              disabled={index === 0}
              aria-label={"Move " + SECTION_LABEL[id] + " up"}
            >
              <CampIcon.ChevronUp />
            </button>
            <button
              type="button"
              onClick={() => move(index, index + 1)}
              disabled={index === order.length - 1}
              aria-label={"Move " + SECTION_LABEL[id] + " down"}
            >
              <CampIcon.ChevronDown />
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}

// Per-day / per-event include picker: the days in range, each a checkbox row that
// expands to its events (also checkboxes). Toggling tracks the EXCLUSION sets so
// "everything in" needs no per-print state. Ephemeral selection, like the range.
function ContentPicker({
  days,
  byId,
  excludedDays,
  excludedEventIds,
  onChange,
}: {
  days: ScheduleDay[];
  byId: Record<string, Activity>;
  excludedDays: string[];
  excludedEventIds: string[];
  onChange: (patch: Patch) => void;
}) {
  const dayOut = new Set(excludedDays);
  const eventOut = new Set(excludedEventIds);

  const setDay = (date: string, on: boolean) => {
    const next = new Set(dayOut);
    if (on) next.delete(date);
    else next.add(date);
    onChange({ excludedDays: [...next] });
  };
  const setEvent = (id: string, on: boolean) => {
    const next = new Set(eventOut);
    if (on) next.delete(id);
    else next.add(id);
    onChange({ excludedEventIds: [...next] });
  };

  const dayLabel = (date: string) =>
    fromDateKey(date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const eventLabel = (event: CalendarEvent) => {
    const name = (event.activityId ? byId[event.activityId]?.title : null) || event.title || "Untitled";
    const time = event.allDay ? "All day" : formatRangeLabel(event.startMin, event.endMin);
    return { name, time };
  };

  if (days.length === 0) {
    return <p className="prail__grouphint">Nothing scheduled in this range to include or skip.</p>;
  }

  return (
    <div className="prail__content">
      {days.map((day) => {
        const dayOn = !dayOut.has(day.date);
        return (
          <div className="prail__cday" key={day.date}>
            <label className="prail__crow prail__crow--day">
              <input
                type="checkbox"
                checked={dayOn}
                onChange={(event) => setDay(day.date, event.target.checked)}
                aria-label={"Include " + dayLabel(day.date)}
              />
              <span className="prail__cname">{dayLabel(day.date)}</span>
              <span className="prail__ccount">{day.events.length}</span>
            </label>
            {dayOn &&
              day.events.map((event) => {
                const { name, time } = eventLabel(event);
                return (
                  <label className="prail__crow prail__crow--event" key={event.id}>
                    <input
                      type="checkbox"
                      checked={!eventOut.has(event.id)}
                      onChange={(e) => setEvent(event.id, e.target.checked)}
                      aria-label={"Include " + name}
                    />
                    <span className="prail__cname">{name}</span>
                    <span className="prail__ctime">{time}</span>
                  </label>
                );
              })}
          </div>
        );
      })}
    </div>
  );
}

export function PrintControls({
  options,
  onChange,
  camps,
  scheduledActivities,
  scheduleDays,
  byId,
}: {
  options: PrintOptions;
  onChange: (patch: Patch) => void;
  camps: Camp[];
  scheduledActivities: Activity[];
  // The days in range (with sorted events), unfiltered by the exclusion sets, so
  // the content picker can show every day/event as a toggle.
  scheduleDays: ScheduleDay[];
  byId: Record<string, Activity>;
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

      {/* Layout — the choices you actually make per print: the day's shape
          (Layout + its context-sensitive Spacing/Detail), color, and text size.
          Leads OPEN, since it's the most-changed group. */}
      <CollapsibleGroup title="Layout" defaultOpen>
        <Row label="Layout">
          <MiniSeg
            options={LAYOUT_OPTIONS}
            value={options.layout}
            ariaLabel="Schedule layout"
            onChange={(layout) => onChange({ layout })}
          />
        </Row>
        {/* Context-sensitive: a timeline has Spacing (grid height); an agenda has
            Detail (per-event richness). Only the one that applies shows. */}
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
        <Row label="Text size">
          <MiniSeg
            options={FONT_SCALE_OPTIONS}
            value={options.fontScale}
            ariaLabel="Document text size"
            onChange={(fontScale) => onChange({ fontScale })}
          />
        </Row>
      </CollapsibleGroup>

      {/* Page setup — the paper itself: stock, density, pagination, and the cover.
          Set-once for most prints, so it rests CLOSED. */}
      <CollapsibleGroup title="Page setup">
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
        <MenuPicker
          label="Density"
          options={DOC_DENSITY_OPTIONS}
          value={options.density}
          ariaLabel="Spacing density of the printed page"
          onChange={(density) => onChange({ density })}
        />
        <Row label="A page per day">
          <ToggleSwitch
            on={options.pageBreakPerDay}
            ariaLabel="Start each day on a new page"
            onChange={(pageBreakPerDay) => onChange({ pageBreakPerDay })}
          />
        </Row>
        <Row label="Page numbers">
          <ToggleSwitch
            on={options.pageNumbers}
            ariaLabel="Show a page-number footer"
            onChange={(pageNumbers) => onChange({ pageNumbers })}
          />
        </Row>
        <Row label="Title cover">
          <ToggleSwitch
            on={options.showCover}
            ariaLabel="Print the title cover header"
            onChange={(showCover) => onChange({ showCover })}
          />
        </Row>
        {/* Context-sensitive: the cover title only matters when the cover prints. */}
        {options.showCover && (
          <Row label="Cover title">
            <TitleField value={options.title} onCommit={(title) => onChange({ title })} />
          </Row>
        )}
      </CollapsibleGroup>

      {/* Content — what appears in the schedule: the optional camp scope, the
          all-day / empty-day / theme display gates, then the per-day/per-event
          include picker. Defaults to all in; unchecking adds to the ephemeral
          exclusion sets. Set-once, so CLOSED. */}
      <CollapsibleGroup title="Content">
        {/* Context-sensitive: the camp scope only appears when there's more than
            one camp to choose between. */}
        {camps.length > 0 && (
          <MenuPicker
            label="Camp"
            options={campOptions}
            value={options.campId ?? ""}
            ariaLabel="Which camp to print"
            onChange={(value) => onChange({ campId: value ? value : null })}
          />
        )}
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
        <Row label="Show themes">
          <ToggleSwitch
            on={options.showThemes}
            ariaLabel="Show themes"
            onChange={(showThemes) => onChange({ showThemes })}
          />
        </Row>
        <ContentPicker
          days={scheduleDays}
          byId={byId}
          excludedDays={options.excludedDays}
          excludedEventIds={options.excludedEventIds}
          onChange={onChange}
        />
      </CollapsibleGroup>

      {/* Document sections — reorder the document's parts (the cover always leads,
          toggled in Page setup). A short, ordered ledger with up/down nudges.
          Leads OPEN: a frequently-tweaked, high-signal control. */}
      <CollapsibleGroup title="Document sections" defaultOpen>
        <SectionOrder order={options.sectionOrder} onChange={(sectionOrder) => onChange({ sectionOrder })} />
      </CollapsibleGroup>

      {/* Appendix — what gets stapled on AFTER the schedule. Distinct from the
          inline "Run TLDR" detail (a per-event summary in the schedule itself).
          Niche, so CLOSED. */}
      <CollapsibleGroup title="Appendix">
        <p className="prail__grouphint">
          Added after the schedule — separate from the inline &ldquo;Run TLDR&rdquo; detail in Layout.
        </p>
        <Row label="Full run sheets">
          <ToggleSwitch
            on={options.appendRunSheets}
            ariaLabel="Append full run sheets for every scheduled activity"
            onChange={(appendRunSheets) => onChange({ appendRunSheets })}
          />
        </Row>
        {/* Context-sensitive: the per-activity sheet picker only matters once
            run sheets are turned on AND there's something scheduled to pick. */}
        {options.appendRunSheets && scheduledActivities.length > 0 && (
          <RunSheetPicker
            activities={scheduledActivities}
            selected={options.runSheetIds}
            onChange={(runSheetIds) => onChange({ runSheetIds })}
          />
        )}
        <Row label="Shopping list (combined)">
          <ToggleSwitch
            on={options.materialsRollup}
            ariaLabel="Include a combined shopping list"
            onChange={(materialsRollup) => onChange({ materialsRollup })}
          />
        </Row>
      </CollapsibleGroup>
    </div>
  );
}
