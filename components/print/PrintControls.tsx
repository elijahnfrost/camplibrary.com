"use client";

// The Print tab's controls — every knob that shapes the printout, built from the
// app's shared sidebar vocabulary so the Print rail reads as the SAME rail as the
// Library filters and the Calendar view settings (not a bespoke console). It
// renders into the primary sidebar on desktop (a portal from PrintTab) and into
// the mobile options sheet; state lives in PrintTab and this is a controlled
// view over it.
//
// Kept deliberately UNCLUTTERED: a headerless range widget leads (the mini-month's
// role), then a handful of collapsible groups hold the choices you make per
// print — Layout/Detail/Color lead OPEN (most-changed); Page setup, Content,
// and Appendix fold closed (set-once or niche) — the Library "Available kit"
// pattern (a summary that IS a ledger row, expanding a sub-ledger). So the
// resting rail is short, and the rest is one tap away — never a wall of
// equal-weight switches.

import { useEffect, useRef, useState, type CSSProperties, type FC, type ReactNode } from "react";
import { addDays, fromDateKey, startOfWeek, todayKey, toDateKey } from "@/lib/calendar/dates";
import type { CalendarEvent, DateKey } from "@/lib/calendar/types";
import { formatRangeLabel } from "@/lib/calendar/time";
import type { Camp } from "@/lib/content/camps";
import type { Activity } from "@/lib/types";
import type {
  DocDensity,
  DocSection,
  FontScale,
  PrintLayout,
  PrintOptions,
  ScheduleDetail,
} from "@/lib/print/options";
import { normalizeSearchText, searchTokens } from "@/lib/activity/activityFilters";
import { MAX_PRINT_DAYS, type ScheduleDay } from "@/lib/print/schedule";
import { CampIcon } from "../ui/icons";
import { MenuPicker, MiniSeg, ToggleSwitch } from "../ui/primitives";
import { MiniRangeCalendar } from "./MiniRangeCalendar";

type Patch = Partial<PrintOptions>;
type IconCmp = FC<{ className?: string }>;

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

// This week per the CALENDAR's own week-start preference, when reachable — a
// direct, read-only localStorage peek (the same "camp:" + JSON.parse contract
// lib/store.ts's useLocalStorage uses) so the Print rail's "This week" preset
// agrees with whatever the calendar's mini-month/Month grid currently starts
// on, without importing any calendar component or touching calendar files.
// Falls back to Mon–Fri (the camp's core week) when localStorage is
// unavailable (SSR) or the stored value isn't the expected 0/1 weekday index.
function thisWeekRange(): { start: DateKey; end: DateKey } {
  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem("camp:calendarWeekStart");
      const parsed = raw != null ? (JSON.parse(raw) as unknown) : undefined;
      const firstDay = parsed === 0 || parsed === 1 ? parsed : undefined;
      if (firstDay !== undefined) {
        const start = toDateKey(startOfWeek(fromDateKey(todayKey()), firstDay));
        return { start, end: addDays(start, 6) };
      }
    } catch {
      // fall through to the Mon–Fri default below
    }
  }
  const mon = weekStart(todayKey());
  return { start: mon, end: addDays(mon, 4) };
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
  icon: Icon,
  defaultOpen = false,
  badge,
  badgeLabel,
  children,
}: {
  title: string;
  icon?: IconCmp;
  defaultOpen?: boolean;
  // print-15: an active-state count shown on the COLLAPSED header, so a group
  // that rests closed (like Content) doesn't hide the fact that it's no
  // longer at its all-in default. Omitted (0/undefined) renders nothing.
  badge?: number;
  badgeLabel?: string;
  children: ReactNode;
}) {
  return (
    <details className="prail__group prail__group--collapsible" open={defaultOpen}>
      <summary className="prail__grouphead prail__groupsum">
        <span className="prail__grouptitle">
          {Icon && <Icon className="ledger__ic" />}
          {title}
          {Boolean(badge) && (
            <span className="filtertrigger__count" aria-label={badgeLabel} title={badgeLabel}>
              {badge}
            </span>
          )}
        </span>
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
function Row({ label, icon: Icon, children }: { label: string; icon?: IconCmp; children: ReactNode }) {
  return (
    <div className="ledger__row">
      <span className="ledger__label">
        {Icon && <Icon className="ledger__ic" />}
        {label}
      </span>
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

// print-8: ONE name for this section everywhere it appears — the umbrella
// "Shopping list" (matching the Content/Appendix toggles below), not the old
// third label "Materials list" this reorder panel used only for itself.
const SECTION_LABEL: Record<DocSection, string> = {
  rollup: "Shopping list",
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
// The search results cap — raised from the old hard 6 (print-2/print-12): with
// the "N selected" chips row now showing every pick regardless of range/cap
// (below), a slightly wider results list means fewer legitimately-matching
// activities get silently hidden while still keeping the list scannable.
const RUN_SHEET_RESULT_CAP = 12;

function RunSheetPicker({
  activities,
  selected,
  byId,
  onChange,
}: {
  // The range/camp-SCOPED pool to search when adding a new pick.
  activities: Activity[];
  selected: string[];
  // The FULL catalog — used to resolve already-picked ids so a pick that has
  // fallen out of the current date range/camp scope still shows (and can
  // still be removed) instead of silently vanishing from the picker while
  // still printing (print-2 + print-12).
  byId: Record<string, Activity>;
  onChange: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const selectedSet = new Set(selected);
  // Resolved via the FULL catalog (not the scoped `activities` list), in pick
  // order, so an out-of-range pick still shows up as a removable chip instead
  // of disappearing while it keeps silently printing.
  const picked = selected
    .map((id) => byId[id])
    .filter((a): a is Activity => Boolean(a));
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
        .slice(0, RUN_SHEET_RESULT_CAP)
    : [];

  return (
    <div className="prail__runsheets">
      <span className="ledger__label">
        <CampIcon.Note className="ledger__ic" />
        Individual run sheets
        {picked.length > 0 && <span className="filtertrigger__count">{picked.length}</span>}
      </span>
      {picked.length > 0 && (
        <div className="prail__rschips">
          {picked.map((a) => (
            <button
              key={a.id}
              type="button"
              className="chip is-on prail__rschip"
              onClick={() => onChange(selected.filter((id) => id !== a.id))}
              aria-label={"Remove " + a.title}
              title={a.title}
            >
              {a.title}
              <CampIcon.Close />
            </button>
          ))}
        </div>
      )}
      {activities.length > 0 ? (
        <div className="prail__rssearch">
          <label className="searchfield">
            <CampIcon.Search />
            <input
              className="searchfield__input"
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
              <button
                type="button"
                className="searchfield__clear"
                onClick={() => setQuery("")}
                aria-label="Clear search"
              >
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
// sections (Shopping list / Schedule / Run sheets) can be reordered without a
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

// One-click presets — a shortcut that sets a whole bundle of options at once
// (same onChange/localStorage persistence path every other control uses), NOT
// a new mode: every fold still works exactly the same after clicking one. Two
// bundles cover the two most common "just print the thing" asks: the day's
// paper run sheets for the counselors on shift, and a light week-at-a-glance
// agenda for the office wall.
//
// print-7: a preset must reset EVERY piece of per-print state a prior session
// could have left behind — not just the fields it cares about — or "just
// print the thing" can silently print filtered/empty (a leftover camp filter,
// excluded days/events, or individually-picked run sheets from a previous
// print). RESET_FIELDS below is spread into every bundle's patch so a preset
// can never forget one; `campId: null` is the documented "no filter" default
// (see PrintOptions.campId).
const RESET_FIELDS: Patch = {
  campId: null,
  excludedDays: [],
  excludedEventIds: [],
  runSheetIds: [],
};

const PRESET_BUNDLES: { id: string; label: string; ariaLabel: string; patch: () => Patch }[] = [
  {
    id: "today-runsheets",
    label: "Today's run sheets",
    ariaLabel: "Set up today's run sheets: today's date, full run sheets on, minimal schedule detail",
    patch: () => ({
      ...RESET_FIELDS,
      start: todayKey(),
      end: todayKey(),
      layout: "agenda",
      scheduleDetail: "times",
      appendRunSheets: true,
    }),
  },
  {
    id: "week-agenda",
    label: "This week — agenda",
    ariaLabel: "Set up this week's agenda: this week's dates, agenda layout, run sheets off",
    patch: () => ({
      ...RESET_FIELDS,
      ...thisWeekRange(),
      layout: "agenda",
      scheduleDetail: "summary",
      appendRunSheets: false,
    }),
  },
];

function PresetsRow({ onChange }: { onChange: (patch: Patch) => void }) {
  return (
    <div className="prail__presets" role="group" aria-label="Print presets">
      {PRESET_BUNDLES.map((preset) => (
        <button
          key={preset.id}
          type="button"
          className="btn btn--ghost btn--sm prail__preset"
          aria-label={preset.ariaLabel}
          onClick={() => onChange(preset.patch())}
        >
          <CampIcon.Bolt />
          <span>{preset.label}</span>
        </button>
      ))}
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
  announce,
}: {
  options: PrintOptions;
  onChange: (patch: Patch) => void;
  camps: Camp[];
  scheduledActivities: Activity[];
  // The days in range (with sorted events), unfiltered by the exclusion sets, so
  // the content picker can show every day/event as a toggle.
  scheduleDays: ScheduleDay[];
  byId: Record<string, Activity>;
  // The same live-region announcer the print/export actions use — reused here
  // (print-11) so a clamped date-range pick gets the same visible feedback
  // mechanism instead of failing silently.
  announce: (message: string) => void;
}) {
  // print-15: the combined count for the Content group's collapsed-header
  // badge — every excluded day PLUS every individually-excluded event (an
  // event inside an already-excluded day still counts; it's still "excluded",
  // just redundantly so — simplest to read, and it can never under-report).
  const exclusionCount = options.excludedDays.length + options.excludedEventIds.length;

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
      {/* Presets — one-click bundles ABOVE the folds (a shortcut, not a new
          mode): every fold still works normally after clicking one. */}
      <PresetsRow onChange={onChange} />

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
          onClamped={(maxDays) => announce("Range limited to " + maxDays + " days")}
        />
        <div className="prail__readout">
          <span className="prail__readout-range">{rangeReadout(options.start, options.end)}</span>
          <span className="prail__readout-count">
            {rangeDays} {rangeDays === 1 ? "day" : "days"}
          </span>
        </div>
      </div>

      {/* Layout — the choices you actually make per print: the day's shape
          (Layout, and — agenda only — Detail), color, and text size. Leads
          OPEN, since it's the most-changed group. Spacing merged into Page
          setup's single Density control (print-6) — it now drives BOTH the
          doc-wide padding AND (while Layout=Timeline) the timeline row height,
          so it doesn't need its own context-sensitive slot here anymore. */}
      <CollapsibleGroup title="Layout" icon={CampIcon.List} defaultOpen>
        <Row label="Layout" icon={CampIcon.List}>
          <MiniSeg
            options={LAYOUT_OPTIONS}
            value={options.layout}
            ariaLabel="Schedule layout"
            onChange={(layout) => onChange({ layout })}
          />
        </Row>
        {/* Context-sensitive: per-event Detail only applies to the agenda list
            (the timeline shows title/time/type on the block itself). */}
        {options.layout !== "timeline" && (
          <MenuPicker
            label="Detail"
            icon={CampIcon.Heading}
            options={DETAIL_OPTIONS}
            value={options.scheduleDetail}
            ariaLabel="How much detail per activity"
            onChange={(scheduleDetail) => onChange({ scheduleDetail })}
          />
        )}
        <Row label="Color" icon={CampIcon.Palette}>
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
        <Row label="Text size" icon={CampIcon.Heading}>
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
      <CollapsibleGroup title="Page setup" icon={CampIcon.Print}>
        <Row label="Paper" icon={CampIcon.Card}>
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
        {/* ONE density knob for the whole document (print-6 merged the old
            timeline-only "Spacing" control in here): it tightens/loosens every
            page's paddings everywhere, AND — while Layout=Timeline — the
            timeline grid's row height, so "Tight" always means "fits more on
            a page" in either layout. */}
        <MenuPicker
          label="Density"
          icon={CampIcon.Sort}
          options={DOC_DENSITY_OPTIONS}
          value={options.density}
          ariaLabel="Spacing density of the printed page, including the timeline row height"
          onChange={(density) => onChange({ density })}
        />
        <Row label="A page per day" icon={CampIcon.Calendar}>
          <ToggleSwitch
            on={options.pageBreakPerDay}
            ariaLabel="Start each day on a new page"
            onChange={(pageBreakPerDay) => onChange({ pageBreakPerDay })}
          />
        </Row>
        <Row label="Title cover" icon={CampIcon.BookOpen}>
          <ToggleSwitch
            on={options.showCover}
            ariaLabel="Print the title cover header"
            onChange={(showCover) => onChange({ showCover })}
          />
        </Row>
        {/* Context-sensitive: the cover title only matters when the cover prints. */}
        {options.showCover && (
          <Row label="Cover title" icon={CampIcon.Heading}>
            <TitleField value={options.title} onCommit={(title) => onChange({ title })} />
          </Row>
        )}
      </CollapsibleGroup>

      {/* Content — what appears in the schedule: the optional camp scope, the
          all-day / empty-day / theme display gates, then the per-day/per-event
          include picker. Defaults to all in; unchecking adds to the ephemeral
          exclusion sets. Set-once, so CLOSED — but print-15 adds a count badge
          on the collapsed header for the days+events currently excluded, so a
          non-default exclusion state is never silently hidden behind the fold. */}
      <CollapsibleGroup
        title="Content"
        icon={CampIcon.Filter}
        badge={exclusionCount}
        badgeLabel={exclusionCount + " excluded"}
      >
        {/* Context-sensitive: the camp scope only appears when there's more than
            one camp to choose between. */}
        {camps.length > 0 && (
          <MenuPicker
            label="Camp"
            icon={CampIcon.Home}
            options={campOptions}
            value={options.campId ?? ""}
            ariaLabel="Which camp to print"
            onChange={(value) => onChange({ campId: value ? value : null })}
          />
        )}
        <Row label="All-day events" icon={CampIcon.Sun}>
          <ToggleSwitch
            on={options.includeAllDay}
            ariaLabel="Include all-day events"
            onChange={(includeAllDay) => onChange({ includeAllDay })}
          />
        </Row>
        <Row label="Empty days" icon={CampIcon.Calendar}>
          <ToggleSwitch
            on={options.includeEmptyDays}
            ariaLabel="Include empty days"
            onChange={(includeEmptyDays) => onChange({ includeEmptyDays })}
          />
        </Row>
        <Row label="Show themes" icon={CampIcon.Palette}>
          <ToggleSwitch
            on={options.showThemes}
            ariaLabel="Show themes"
            onChange={(showThemes) => onChange({ showThemes })}
          />
        </Row>
        {/* print-8: ONE name for this section — "Shopping list" is the
            umbrella (this is the narrower "missing & low only" variant of
            it), matching the Appendix toggle below and the Document-sections
            entry above. */}
        <Row label="Shopping list — missing & low only" icon={CampIcon.Box}>
          <ToggleSwitch
            on={options.shoppingListOnly}
            ariaLabel="Narrow the shopping list to only what's missing or low"
            // Turning this on only does something once the umbrella shopping
            // list itself is on — flip that along with it so the checkbox
            // reads as "yes, print the narrowed list" without a second trip
            // to Appendix.
            onChange={(shoppingListOnly) =>
              onChange({ shoppingListOnly, materialsRollup: shoppingListOnly ? true : options.materialsRollup })
            }
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
      <CollapsibleGroup title="Document sections" icon={CampIcon.Sort} defaultOpen>
        <SectionOrder order={options.sectionOrder} onChange={(sectionOrder) => onChange({ sectionOrder })} />
      </CollapsibleGroup>

      {/* Appendix — what gets stapled on AFTER the schedule. Distinct from the
          inline "Run TLDR" detail (a per-event summary in the schedule itself).
          Niche, so CLOSED. */}
      <CollapsibleGroup title="Appendix" icon={CampIcon.Clipboard}>
        <p className="prail__grouphint">
          Added after the schedule — separate from the inline &ldquo;Run TLDR&rdquo; detail in Layout.
        </p>
        <Row label="Full run sheets" icon={CampIcon.Note}>
          <ToggleSwitch
            on={options.appendRunSheets}
            ariaLabel="Append full run sheets for every scheduled activity"
            onChange={(appendRunSheets) => onChange({ appendRunSheets })}
          />
        </Row>
        {/* Individually-picked run sheets print ADDITIVELY to "Full run
            sheets" (see SchedulePrintDocument's runSheetActivities) — so the
            picker shows whenever there's something to search OR something
            already picked, independent of the "Full run sheets" toggle above.
            Gating this on `appendRunSheets` (as before) hid existing picks —
            and their remove affordance — the moment that toggle was off,
            which is the same "picks go invisible" failure mode print-2 +
            print-12 fix for the out-of-range case. */}
        {(scheduledActivities.length > 0 || options.runSheetIds.length > 0) && (
          <RunSheetPicker
            activities={scheduledActivities}
            selected={options.runSheetIds}
            byId={byId}
            onChange={(runSheetIds) => onChange({ runSheetIds })}
          />
        )}
        {/* The umbrella toggle — print-8 renamed from "Shopping list
            (combined)" to just "Shopping list" (the narrower variant above
            already says "missing & low only", so it doesn't need the umbrella
            to also say "combined"). Turning this OFF also turns off the
            narrower toggle: leaving `shoppingListOnly: true` set but inert
            would be the same kind of stale-flag trap print-7 fixed for
            presets — better to keep the two toggles honestly in sync. */}
        <Row label="Shopping list" icon={CampIcon.Box}>
          <ToggleSwitch
            on={options.materialsRollup}
            ariaLabel="Include a shopping list"
            onChange={(materialsRollup) =>
              onChange({ materialsRollup, shoppingListOnly: materialsRollup ? options.shoppingListOnly : false })
            }
          />
        </Row>
      </CollapsibleGroup>
    </div>
  );
}
