"use client";

// The printable schedule document for a date range — the heart of the Print
// tab. One component renders both the on-screen preview (wrap="preview") and the
// hidden print artifact (wrap="root", which reuses the proven `.print-root`
// chrome-hiding from globals.css). Its `pd-` classes are styled on screen AND in
// print, so the preview is a true WYSIWYG of the page.
//
// Modularity lives in `options`: the date range + camp pick what's printed; the
// color / style / detail / append-run-sheets / rollup flags shape how.

import { useMemo, type CSSProperties, type ReactNode } from "react";
import { fromDateKey } from "@/lib/calendar/dates";
import { formatRangeLabel } from "@/lib/calendar/time";
import type { CalendarEvent } from "@/lib/calendar/types";
import type { ThemeResolver } from "@/lib/calendar/adapter";
import { ageSpan, durLabel, effectiveEventColor, ENERGY, groupLabel } from "@/lib/data";
import { materialNeedsForActivity, materialOptionsForActivities } from "@/lib/materials";
import type { Camp } from "@/lib/camps";
import type { Material } from "@/lib/materialCatalog";
import type { StockState } from "@/lib/kitStock";
import type { Theme } from "@/lib/themes";
import type { RunDoc } from "@/lib/runList";
import type { Activity } from "@/lib/types";
import { dietaryBySeverity, type DietaryEntry, type MealsDoc } from "@/lib/meals";
import { MEAL_KIND_LABEL } from "@/lib/print/mealGlyphs";
import { applyExclusions, buildScheduleDays, selectEvents, type ScheduleDay } from "@/lib/print/schedule";
import { hasSummaryContent, summarizeRunDoc, type RunSummary } from "@/lib/print/runSummary";
import { buildShoppingList } from "@/lib/print/shoppingList";
import { buildTimelineDays, timelineFit, timelineWindow } from "@/lib/print/timeline";
import {
  DOC_DENSITY_VALUE,
  FONT_SCALE_VALUE,
  type DocSection,
  type PrintOptions,
} from "@/lib/print/options";
import { PrintRunSheet } from "./PrintRunSheet";
import { CalendarTimeline } from "./CalendarTimeline";
import { DietaryLine } from "./DietaryLine";

export interface SchedulePrintData {
  events: Record<string, CalendarEvent>;
  byId: Record<string, Activity>;
  resolveRunDoc: (activity: Activity) => RunDoc;
  themeOf: ThemeResolver;
  camps: Camp[];
  // The effective kit-stock map (materialId -> have/low/out) and catalog, for
  // the "Shopping list — missing & low only" block. Optional: a caller that
  // hasn't threaded these through yet just doesn't get the narrowed list (the
  // checkbox that requests it still renders in Content, but the block quietly
  // omits itself — see SchedulePrintDocument's shoppingSection below).
  kitStock?: Record<string, StockState>;
  materialCatalog?: Material[];
  // The camp's dietary roster + menu notes (approved plan §H, "Meals on
  // paper") — powers the day-header dietary line. Optional, same pattern as
  // kitStock/materialCatalog above: a caller that hasn't wired it through yet
  // just doesn't get the dietary line rather than crashing.
  mealsDoc?: MealsDoc;
}

interface ResolvedEvent {
  event: CalendarEvent;
  activity: Activity | null;
  theme: Theme | null;
  tint: string;
}

function dayHeading(date: string): string {
  const d = fromDateKey(date);
  const weekday = d.toLocaleDateString(undefined, { weekday: "long" });
  const monthDay = d.toLocaleDateString(undefined, { month: "long", day: "numeric" });
  return weekday + " · " + monthDay;
}

// A short "Mon 6/16" chip for a shopping-list item's day(s) — compact enough
// to sit inline on a checklist row without wrapping.
function shortDayLabel(date: string): string {
  const d = fromDateKey(date);
  return d.toLocaleDateString(undefined, { weekday: "short", month: "numeric", day: "numeric" });
}

function rangeLabel(start: string, end: string): string {
  const a = fromDateKey(start);
  const b = fromDateKey(end);
  const lo = a.getTime() <= b.getTime() ? a : b;
  const hi = a.getTime() <= b.getTime() ? b : a;
  const sameYear = lo.getFullYear() === hi.getFullYear();
  const loStr = lo.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });
  if (lo.getTime() === hi.getTime()) {
    return lo.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
  }
  const hiStr = hi.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return loStr + " – " + hiStr;
}

function tintStyle(tint: string, on: boolean): CSSProperties | undefined {
  return on ? ({ "--pd-tint": tint } as CSSProperties) : undefined;
}

// A meal block's print glyph — the same small fork+spoon mark the calendar
// uses (components/calendar/CalendarShell.tsx's MealGlyph), inlined here
// since print can't import from components/calendar/* (off limits) and the
// glyph is tiny enough not to warrant a shared module of its own.
function MealGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path d="M7 3v7M5 3v4a2 2 0 0 0 2 2M9 3v4a2 2 0 0 1-2 2M7 11v10" />
      <path d="M15 3c-1.5 0-2.5 2-2.5 5s1 4 2.5 4 2.5-1 2.5-4-1-5-2.5-5zM15 12v9" />
    </svg>
  );
}

function EventFacts({ activity }: { activity: Activity }) {
  const kit = materialNeedsForActivity(activity).length;
  const facts = [
    ageSpan(activity),
    groupLabel(activity) === "Any size" ? "Any size" : groupLabel(activity) + " kids",
    activity.place,
    durLabel(activity),
    activity.energy ? ENERGY[activity.energy] : null,
    activity.prep === "None" ? "No prep" : activity.prep + " prep",
    kit ? kit + (kit === 1 ? " item" : " items") : null,
  ].filter((value): value is string => Boolean(value));
  return (
    <ul className="pd-facts pd-facts--inline">
      {facts.map((fact) => (
        <li key={fact}>{fact}</li>
      ))}
    </ul>
  );
}

function EventTldr({ summary }: { summary: RunSummary }) {
  return (
    <div className="pd-tldr">
      {summary.steps.length > 0 && (
        <ol className="pd-tldr__steps">
          {summary.steps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      )}
      {summary.safety.length > 0 && (
        <p className="pd-tldr__line pd-tldr__line--safety">
          <span>Safety</span> {summary.safety.join(" ")}
        </p>
      )}
      {summary.materials.length > 0 && (
        <p className="pd-tldr__line">
          <span>Kit</span> {summary.materials.join(", ")}
        </p>
      )}
      {summary.hasDiagram && <p className="pd-tldr__line pd-tldr__diagram">Field diagram on the run sheet.</p>}
    </div>
  );
}

function ScheduleEvent({
  resolved,
  options,
  summary,
}: {
  resolved: ResolvedEvent;
  options: PrintOptions;
  summary: RunSummary | null;
}) {
  const { event, activity, theme, tint } = resolved;
  const colorOn = options.color === "color";
  const timeLabel = event.allDay ? "All day" : formatRangeLabel(event.startMin, event.endMin);
  const showDetail = options.scheduleDetail !== "times" && activity;
  const mealLabel = event.mealKind ? MEAL_KIND_LABEL[event.mealKind] ?? "Meal" : null;

  return (
    <li className="pd-event" style={tintStyle(tint, colorOn)}>
      <div className="pd-event__time">{timeLabel}</div>
      <div className="pd-event__body">
        <div className="pd-event__head">
          <span className="pd-event__name">{activity?.title || event.title || "Untitled"}</span>
          {activity && <span className="pd-event__type">{activity.type}</span>}
          {mealLabel && (
            <span className="pd-event__meal">
              <MealGlyph className="pd-event__mealicon" />
              {mealLabel}
            </span>
          )}
          {options.showThemes && theme && (
            <span className="pd-event__theme" style={tintStyle(theme.tint, colorOn)}>
              {theme.label}
            </span>
          )}
        </div>
        {showDetail && activity?.blurb ? <p className="pd-event__blurb">{activity.blurb}</p> : null}
        {showDetail && activity ? <EventFacts activity={activity} /> : null}
        {options.scheduleDetail === "tldr" && summary && hasSummaryContent(summary) ? (
          <EventTldr summary={summary} />
        ) : null}
      </div>
    </li>
  );
}

function ScheduleDaySection({
  day,
  resolve,
  options,
  summaries,
  severeDietary,
}: {
  day: ScheduleDay;
  resolve: (event: CalendarEvent) => ResolvedEvent;
  options: PrintOptions;
  summaries: Record<string, RunSummary>;
  severeDietary: DietaryEntry[];
}) {
  return (
    <section className="pd-day">
      <h2 className="pd-day__head">{dayHeading(day.date)}</h2>
      <DietaryLine entries={severeDietary} />
      {day.events.length ? (
        <ol className="pd-events">
          {day.events.map((event) => {
            const resolved = resolve(event);
            const summary = resolved.activity ? summaries[resolved.activity.id] ?? null : null;
            return <ScheduleEvent key={event.id} resolved={resolved} options={options} summary={summary} />;
          })}
        </ol>
      ) : (
        <p className="pd-empty">No activities scheduled.</p>
      )}
    </section>
  );
}

export function SchedulePrintDocument({
  options,
  data,
  wrap,
}: {
  options: PrintOptions;
  data: SchedulePrintData;
  wrap: "preview" | "root";
}) {
  const { events, byId, resolveRunDoc, themeOf, camps, kitStock, materialCatalog, mealsDoc } = data;

  const campIds = useMemo(() => new Set(camps.map((c) => c.id)), [camps]);

  // Meals on paper (§H): SEVERE dietary entries only, computed once for the
  // whole document — the roster is camp-wide (v1 has no per-camp targeting;
  // see lib/meals.ts), so every day header in this print shares the same list.
  const severeDietary = useMemo(
    () => (mealsDoc ? dietaryBySeverity(mealsDoc).filter((entry) => entry.severity === "severe") : []),
    [mealsDoc]
  );

  const days = useMemo(() => {
    const selected = selectEvents(events, {
      start: options.start,
      end: options.end,
      campId: options.campId,
      campIds,
      includeAllDay: options.includeAllDay,
    });
    const built = buildScheduleDays(selected, options.start, options.end, options.includeEmptyDays);
    return applyExclusions(built, options.excludedDays, options.excludedEventIds);
  }, [
    events,
    campIds,
    options.start,
    options.end,
    options.campId,
    options.includeAllDay,
    options.includeEmptyDays,
    options.excludedDays,
    options.excludedEventIds,
  ]);

  const resolve = useMemo(() => {
    return (event: CalendarEvent): ResolvedEvent => {
      const activity = event.activityId ? byId[event.activityId] ?? null : null;
      const theme = activity ? themeOf(activity.id) : null;
      return { event, activity, theme, tint: effectiveEventColor(event, activity ?? undefined) };
    };
  }, [byId, themeOf]);

  // Timeline (blocked-out) layout: a shared hour window across the whole range
  // (so every day's axis lines up), the positioned blocks, and the does-it-fit
  // check that drives the "won't fit one page" notice.
  const isTimeline = options.layout === "timeline";
  const timelineWin = useMemo(() => timelineWindow(days.flatMap((day) => day.events)), [days]);
  const timelineDays = useMemo(() => buildTimelineDays(days, timelineWin), [days, timelineWin]);
  const timelineTint = useMemo(() => {
    return (event: CalendarEvent) => {
      const r = resolve(event);
      // Prefer the live activity title (matches the agenda's fallback chain) so a
      // renamed activity isn't shown under a stale denormalized title.
      return {
        tint: r.tint,
        type: r.activity?.type ?? null,
        title: r.activity?.title || event.title || "Untitled",
        // print-5: the timeline now carries theme data too (label + tint), so
        // "Show themes" isn't silently dead when Layout=Timeline — the block
        // itself decides whether it has room to show it (mirrors how it
        // already hides the type line on a short block).
        theme: r.theme,
        // Meals on paper (§H): the meal glyph is driven off the event's own
        // mealKind flag, same as the agenda.
        mealLabel: event.mealKind ? MEAL_KIND_LABEL[event.mealKind] ?? "Meal" : null,
      };
    };
  }, [resolve]);
  const tlFit = useMemo(
    () => timelineFit(timelineDays, timelineWin, options.density),
    [timelineDays, timelineWin, options.density]
  );

  // Distinct activities scheduled in range, in first-seen order — drives the
  // materials roll-up and the appended run sheets (one per activity, not per
  // booking, so an activity scheduled twice prints a single sheet).
  const distinctActivities = useMemo(() => {
    const seen = new Set<string>();
    const out: Activity[] = [];
    for (const day of days) {
      for (const event of day.events) {
        if (!event.activityId) continue;
        const activity = byId[event.activityId];
        if (activity && !seen.has(activity.id)) {
          seen.add(activity.id);
          out.push(activity);
        }
      }
    }
    return out;
  }, [days, byId]);

  // TLDR summaries only when that detail level is active.
  const summaries = useMemo(() => {
    if (options.scheduleDetail !== "tldr") return {};
    const out: Record<string, RunSummary> = {};
    for (const activity of distinctActivities) {
      out[activity.id] = summarizeRunDoc(activity, resolveRunDoc(activity));
    }
    return out;
  }, [options.scheduleDetail, distinctActivities, resolveRunDoc]);

  const rollup = useMemo(
    () => (options.materialsRollup ? materialOptionsForActivities(distinctActivities) : []),
    [options.materialsRollup, distinctActivities]
  );

  // The narrowed "missing & low only" shopping list — a paper checklist, not a
  // full inventory recap. Needs the effective kit-stock map + catalog; when
  // they weren't threaded in (kitStock undefined) or stock has never been
  // reviewed (an empty map), buildShoppingList returns [] and the block
  // quietly omits itself rather than printing a wrong/empty-looking checklist.
  const shoppingList = useMemo(
    () =>
      options.materialsRollup && options.shoppingListOnly && kitStock
        ? buildShoppingList(days, byId, kitStock, materialCatalog)
        : [],
    [options.materialsRollup, options.shoppingListOnly, kitStock, materialCatalog, days, byId]
  );

  // Run sheets to append: every scheduled activity when "Full run sheets" is on,
  // PLUS any individually-picked ones — deduped, in scheduled order then pick order.
  const runSheetActivities = useMemo(() => {
    const seen = new Set<string>();
    const out: typeof distinctActivities = [];
    const add = (activity: (typeof distinctActivities)[number] | undefined) => {
      if (activity && !seen.has(activity.id)) {
        seen.add(activity.id);
        out.push(activity);
      }
    };
    if (options.appendRunSheets) distinctActivities.forEach(add);
    for (const id of options.runSheetIds) add(byId[id]);
    return out;
  }, [options.appendRunSheets, options.runSheetIds, distinctActivities, byId]);

  const campName = options.campId ? camps.find((c) => c.id === options.campId)?.name ?? null : null;
  const eventCount = days.reduce((sum, day) => sum + day.events.length, 0);
  const heading = options.title.trim() || rangeLabel(options.start, options.end);
  const subtitleParts = [
    campName,
    options.title.trim() ? rangeLabel(options.start, options.end) : null,
    eventCount + (eventCount === 1 ? " activity" : " activities"),
  ].filter((value): value is string => Boolean(value));

  const docClass =
    "print-doc" +
    " print-doc--" +
    options.color +
    " print-doc--" +
    options.style +
    " print-doc--" +
    options.layout +
    (options.pageBreakPerDay ? " print-doc--paged" : "");

  // The print scale's two user-facing multipliers, set as CSS vars on the doc
  // root so every pd- type/spacing token (which read --pd-scale / --pd-pad-scale)
  // grows or tightens in lockstep — no per-rule edits.
  const docStyle = {
    "--pd-scale": FONT_SCALE_VALUE[options.fontScale],
    "--pd-pad-scale": DOC_DENSITY_VALUE[options.density],
  } as CSSProperties;

  // The materials roll-up, PLUS the narrowed "missing & low only" shopping
  // list when that checkbox is on — both live in the reorderable "rollup"
  // slot so moving one section moves both. The shopping list renders even if
  // the full roll-up is hidden by rollup.length === 0 (an empty full list is
  // still worth a "nothing to buy" absence, and a non-empty shopping list is
  // the more actionable of the two anyway).
  const rollupSection =
    rollup.length > 0 || shoppingList.length > 0 ? (
      <section className="pd-rollup" key="rollup">
        {rollup.length > 0 && (
          <>
            <h2 className="pd-rollup__head">Materials for the range</h2>
            <ul className="pd-rollup__list">
              {rollup.map((item) => (
                <li key={item.id}>
                  <span className="pd-rollup__box" aria-hidden="true" />
                  <span className="pd-rollup__label">{item.label}</span>
                  {item.count > 1 && <span className="pd-rollup__count">×{item.count}</span>}
                </li>
              ))}
            </ul>
          </>
        )}
        {shoppingList.length > 0 && (
          <div className="pd-shopping">
            <h2 className="pd-rollup__head pd-shopping__head">Shopping list — missing &amp; low only</h2>
            <ul className="pd-shopping__list">
              {shoppingList.map((item) => (
                <li key={item.id} className={"pd-shopping__item pd-shopping__item--" + item.status}>
                  <span className="pd-rollup__box" aria-hidden="true" />
                  <span className="pd-shopping__label">{item.label}</span>
                  <span className="pd-shopping__status">{item.status === "low" ? "low" : "missing"}</span>
                  <span className="pd-shopping__days">{item.dates.map(shortDayLabel).join(", ")}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    ) : null;

  // The day-by-day body (agenda or timeline) — the schedule section.
  const scheduleSection =
    eventCount === 0 && days.length === 0 ? (
      <p className="pd-empty pd-empty--doc" key="schedule">
        Nothing scheduled in this range.
      </p>
    ) : isTimeline ? (
      <CalendarTimeline
        key="schedule"
        timelineDays={timelineDays}
        win={timelineWin}
        options={options}
        resolve={timelineTint}
        severeDietary={severeDietary}
      />
    ) : (
      <div className="pd-schedule" key="schedule">
        {days.map((day) => (
          <ScheduleDaySection
            key={day.date}
            day={day}
            resolve={resolve}
            options={options}
            summaries={summaries}
            severeDietary={severeDietary}
          />
        ))}
      </div>
    );

  // The appended full run sheets — the appendix section.
  const appendixSection =
    runSheetActivities.length > 0 ? (
      <div className="pd-runsheets" key="appendix">
        <h2 className="pd-runsheets__head">Run sheets</h2>
        {runSheetActivities.map((activity) => (
          <PrintRunSheet
            key={activity.id}
            activity={activity}
            runDoc={resolveRunDoc(activity)}
            kitStock={kitStock}
            materialCatalog={materialCatalog}
          />
        ))}
      </div>
    ) : null;

  const sectionNodes: Record<DocSection, ReactNode> = {
    rollup: rollupSection,
    schedule: scheduleSection,
    appendix: appendixSection,
  };

  const body = (
    <div className={docClass} style={docStyle}>
      {options.showCover && (
        <header className="pd-cover">
          <span className="pd-kicker">{campName || "Camp Library"}</span>
          <h1 className="pd-cover__title">{heading}</h1>
          {subtitleParts.length > 0 && <p className="pd-cover__sub">{subtitleParts.join(" · ")}</p>}
        </header>
      )}

      {eventCount === 0 && wrap === "preview" && (
        <p className="pd-hint">
          Nothing scheduled in this range yet — widen the dates, switch camps, or turn on “Empty days” to
          lay out blank day sheets.
        </p>
      )}

      {/* When a day's blocked-out grid is taller than a page at this spacing it
          can't print on one sheet — say so and point at the fix (preview only,
          so the notice never lands in the actual printout). */}
      {isTimeline && !tlFit.fits && wrap === "preview" && (
        <p className="pd-warn" role="status">
          <strong>This won’t fit on one page.</strong> A day’s timeline is about{" "}
          {tlFit.tallestIn.toFixed(1)}in tall at this density (a page holds ~{tlFit.budgetIn.toFixed(1)}in).
          Switch Density to Tight, or narrow the date range, to fit each day on its own page.
        </p>
      )}

      {options.sectionOrder.map((id) => sectionNodes[id])}
    </div>
  );

  if (wrap === "root") {
    return (
      <div className="print-root" aria-hidden="true">
        {body}
      </div>
    );
  }
  return body;
}
