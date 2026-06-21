"use client";

// The blocked-out "timeline" layout for the Print tab — each day rendered as a
// Google-Calendar-style day view: an hour axis down the page with every event
// drawn as a block whose height tracks its duration and whose lane splits when
// events overlap. Geometry comes from lib/print/timeline (pure + tested); this
// component only maps it onto the `.print-doc` / `pd-*` physical-unit CSS so the
// preview is a true WYSIWYG of the printed sheet.

import { type CSSProperties } from "react";
import { fromDateKey } from "@/lib/calendar/dates";
import { formatClock, formatRangeLabel } from "@/lib/calendar/time";
import type { CalendarEvent } from "@/lib/calendar/types";
import {
  timelineHours,
  timelineGridHeightIn,
  type DayWindow,
  type TimelineBlock,
  type TimelineDay,
} from "@/lib/print/timeline";
import type { PrintOptions } from "@/lib/print/options";

// Below these block heights (inches) the meta lines won't fit, so we drop them
// and keep the title. Decided from geometry — not a CSS @container query — so it
// stays correct inside the Paged.js-cloned DOM where container support is shaky.
const SHOW_TIME_MIN_IN = 0.34;
const SHOW_TYPE_MIN_IN = 0.5;

interface ResolvedTint {
  tint: string;
  type: string | null;
  title: string;
}

function dayHeading(date: string): string {
  const d = fromDateKey(date);
  const weekday = d.toLocaleDateString(undefined, { weekday: "long" });
  const monthDay = d.toLocaleDateString(undefined, { month: "long", day: "numeric" });
  return weekday + " · " + monthDay;
}

function tintVar(tint: string, on: boolean): CSSProperties | undefined {
  return on ? ({ "--pd-tint": tint } as CSSProperties) : undefined;
}

function TimelineEventBlock({
  event,
  topPct,
  heightPct,
  col,
  cols,
  gridHeightIn,
  resolve,
  colorOn,
}: {
  event: CalendarEvent;
  topPct: number;
  heightPct: number;
  col: number;
  cols: number;
  gridHeightIn: number;
  resolve: (event: CalendarEvent) => ResolvedTint;
  colorOn: boolean;
}) {
  const { tint, type, title } = resolve(event);
  // Lay lanes out left→right; a thin gutter between lanes comes from CSS padding.
  const left = (col / cols) * 100;
  const width = (1 / cols) * 100;
  const blockHeightIn = (heightPct / 100) * gridHeightIn;
  const showTime = blockHeightIn >= SHOW_TIME_MIN_IN;
  const showType = type && blockHeightIn >= SHOW_TYPE_MIN_IN;
  const style: CSSProperties = {
    top: topPct + "%",
    height: heightPct + "%",
    left: left + "%",
    width: width + "%",
    ...(colorOn ? ({ "--pd-tint": tint } as CSSProperties) : {}),
  };
  return (
    <div className="pd-tl__block" style={style}>
      {showTime && <span className="pd-tl__time">{formatRangeLabel(event.startMin, event.endMin)}</span>}
      <span className="pd-tl__name">{title}</span>
      {showType && <span className="pd-tl__type">{type}</span>}
    </div>
  );
}

function TimelineDaySection({
  date,
  allDay,
  blocks,
  hours,
  gridHeightIn,
  resolve,
  colorOn,
}: {
  date: string;
  allDay: CalendarEvent[];
  blocks: TimelineBlock[];
  hours: ReturnType<typeof timelineHours>;
  gridHeightIn: number;
  resolve: (event: CalendarEvent) => ResolvedTint;
  colorOn: boolean;
}) {
  return (
    <section className="pd-tlday">
      <h2 className="pd-day__head">{dayHeading(date)}</h2>
      {allDay.length > 0 && (
        <div className="pd-tl__allday">
          <span className="pd-tl__alldaytag">All day</span>
          <ul className="pd-tl__alldaylist">
            {allDay.map((event) => (
              <li key={event.id} className="pd-tl__alldaychip" style={tintVar(resolve(event).tint, colorOn)}>
                {resolve(event).title}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="pd-tl__grid" style={{ height: gridHeightIn + "in" }}>
        <div className="pd-tl__axis" aria-hidden="true">
          {hours.map((hour) => (
            <span key={hour.min} className="pd-tl__hour" style={{ top: hour.topPct + "%" }}>
              {formatClock(hour.min, true)}
            </span>
          ))}
        </div>
        <div className="pd-tl__lanes">
          {hours.map((hour) => (
            <span key={hour.min} className="pd-tl__rule" style={{ top: hour.topPct + "%" }} aria-hidden="true" />
          ))}
          {blocks.length === 0 ? (
            <p className="pd-tl__empty">No activities scheduled.</p>
          ) : (
            blocks.map((block) => (
              <TimelineEventBlock
                key={block.event.id}
                event={block.event}
                topPct={block.topPct}
                heightPct={block.heightPct}
                col={block.col}
                cols={block.cols}
                gridHeightIn={gridHeightIn}
                resolve={resolve}
                colorOn={colorOn}
              />
            ))
          )}
        </div>
      </div>
    </section>
  );
}

export function CalendarTimeline({
  timelineDays,
  win,
  options,
  resolve,
}: {
  timelineDays: TimelineDay[];
  win: DayWindow;
  options: PrintOptions;
  resolve: (event: CalendarEvent) => ResolvedTint;
}) {
  const colorOn = options.color === "color";
  const hours = timelineHours(win);
  const gridHeightIn = timelineGridHeightIn(win, options.timelineDensity);

  return (
    <div className="pd-timeline">
      {timelineDays.map((day) => (
        <TimelineDaySection
          key={day.date}
          date={day.date}
          allDay={day.allDay}
          blocks={day.blocks}
          hours={hours}
          gridHeightIn={gridHeightIn}
          resolve={resolve}
          colorOn={colorOn}
        />
      ))}
    </div>
  );
}
