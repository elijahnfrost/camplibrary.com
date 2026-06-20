// View model for the Notion-style calendar: the fixed Day/Week/Month views plus
// a configurable N-day window (the "Number of days" picker, 2–9). Pure, local
// date math — no FullCalendar, no DOM — so the range/title/storage logic is unit
// testable on its own (mirrors lib/calendar/dates.ts).

export type FixedViewId = "timeGridDay" | "timeGridWeek" | "dayGridMonth";

/** The configurable N-day window (Notion's "Number of days"). */
export type NDaysView = { type: "ndays"; n: number };

/** The active view descriptor passed around the header + shell. */
export type ViewKey = FixedViewId | NDaysView;

/** Stored preference adds "auto" (resolve Day/Week by pointer on first paint). */
export type StoredViewPref = ViewKey | "auto";

// The first weekday the MONTH grids (the main Month view + the sidebar
// mini-month) lay out on — Notion's "Start week on". 0 = Sunday, 1 = Monday.
// The timed Day/Week/N-day views are a rolling, day-aligned strip, so they
// don't key off a week start; this only orders the month grids' columns.
export type WeekStart = 0 | 1;
export const DEFAULT_WEEK_START: WeekStart = 1; // Monday — the camp Mon–Fri rhythm

// Validator for useLocalStorage("calendarWeekStart"): only the two valid
// weekday indices round-trip; anything else (garbage / a future 2–6 value)
// falls back so a stale store can't offset the grid to a mid-week start.
export function parseWeekStart(raw: unknown, fallback: WeekStart = DEFAULT_WEEK_START): WeekStart {
  return raw === 0 || raw === 1 ? raw : fallback;
}

// Notion offers 2–9 days in the submenu (1 = Day, "0"/7 = Week are their own
// views). Clamp anything out of range so a stale/garbage stored value can't
// render a 0-column or absurdly wide grid.
export const NDAYS_MIN = 2;
export const NDAYS_MAX = 9;

export function clampNDays(n: number): number {
  // NaN can't be ordered, so it falls back to the floor; ±Infinity clamps
  // naturally to MAX / MIN through the min/max below.
  if (Number.isNaN(n)) return NDAYS_MIN;
  return Math.min(NDAYS_MAX, Math.max(NDAYS_MIN, Math.round(n)));
}

export function isNDaysView(view: ViewKey): view is NDaysView {
  return typeof view === "object" && view.type === "ndays";
}

/** Stable string id for the active view (label lookups, equality, the FC type). */
export function viewKeyId(view: ViewKey): string {
  return isNDaysView(view) ? "ndays:" + clampNDays(view.n) : view;
}

// The rolling, day-aligned N-day window: it starts on the anchor's own day (not
// snapped to a week) and runs N days — the same philosophy as the rolling week,
// so picking a day in the mini-month or paging keeps a continuous N-wide strip.
// `end` is exclusive (FullCalendar's range convention). firstDay is accepted for
// signature parity with the week helpers but a day-aligned window ignores it.
export function nDayRange(anchor: Date, n: number, _firstDay = 1): { start: Date; end: Date } {
  const days = clampNDays(n);
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + days);
  return { start, end };
}

// "Jun 18 – 22, 2026" for the header title of an N-day window (or "Jun 18, 2026"
// for a single day). Collapses the shared month/year the way Notion/Google do,
// and only spells both years out when the window straddles a New Year.
export function viewTitle(start: Date, n: number): string {
  const days = Math.max(1, Math.round(n)); // 1 = Day view; don't floor to NDAYS_MIN
  if (days === 1) {
    return start.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }
  const last = new Date(start);
  last.setDate(last.getDate() + days - 1); // inclusive last visible day
  const sameYear = start.getFullYear() === last.getFullYear();
  const sameMonth = sameYear && start.getMonth() === last.getMonth();
  if (sameMonth) {
    const mon = start.toLocaleDateString(undefined, { month: "short" });
    return mon + " " + start.getDate() + " – " + last.getDate() + ", " + last.getFullYear();
  }
  if (sameYear) {
    const a = start.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const b = last.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return a + " – " + b + ", " + last.getFullYear();
  }
  const opts = { month: "short", day: "numeric", year: "numeric" } as const;
  return start.toLocaleDateString(undefined, opts) + " – " + last.toLocaleDateString(undefined, opts);
}

// Validator for useLocalStorage("calendarView"). Accepts the legacy literals
// (older builds only stored the three fixed views or "auto") and the new N-day
// object form; anything else falls back. Because the stored value round-trips as
// JSON, the N-day view persists as { type: "ndays", n } directly — no separate
// serializer needed.
export function parseStoredView(raw: unknown, fallback: StoredViewPref): StoredViewPref {
  if (raw === "auto" || raw === "timeGridDay" || raw === "timeGridWeek" || raw === "dayGridMonth") {
    return raw;
  }
  if (
    typeof raw === "object" &&
    raw !== null &&
    (raw as { type?: unknown }).type === "ndays" &&
    Number.isFinite((raw as { n?: unknown }).n as number)
  ) {
    return { type: "ndays", n: clampNDays((raw as { n: number }).n) };
  }
  // Tolerate a string form ("ndays:5") in case a value was ever stored that way.
  if (typeof raw === "string" && raw.startsWith("ndays:")) {
    const n = Number(raw.slice("ndays:".length));
    if (Number.isFinite(n)) return { type: "ndays", n: clampNDays(n) };
  }
  return fallback;
}
