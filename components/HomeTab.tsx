"use client";

// The Home surface: the app's landing screen, reframed as a TODAY BOARD — the
// single operator's morning glance. A warm welcome, an operational read of
// today's schedule (Now/Next pills, meal indicators), and a calm "this week"
// strip for orientation. Read-only and link-only — it never mutates; every
// tile routes into the Calendar or Library surfaces that own the real work.

import { useEffect, useMemo, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import type { CalendarEvent } from "@/lib/calendar/types";
import { addDays, todayKey } from "@/lib/calendar/dates";
import { formatClockCompact, nowMinutes } from "@/lib/calendar/time";
import { durLabel, effectiveEventColor } from "@/lib/data";
import type { Activity } from "@/lib/types";
import type { CatFilter } from "@/lib/activityFilters";
import { CampIcon } from "./icons";
import { LoadingVeil } from "./primitives";

// Short display labels for the meal-flagged event indicator — trivially
// derived from the kebab-case MealKind values already on the event.
const MEAL_KIND_LABEL: Record<string, string> = {
  breakfast: "Breakfast",
  "am-snack": "AM Snack",
  lunch: "Lunch",
  "pm-snack": "PM Snack",
  other: "Meal",
};

// "Sunday · June 14" — the dateline under the kicker.
function formatTodayLine(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

// Time-of-day greeting so the landing feels alive across a camp day.
function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

// One scheduled row in today's column: time + script title, carrying the same
// 3px category spine the calendar rail, catalog rows, and placed event cards
// use (--cal-tint). Activity-backed rows open the viewer; plain events don't.
// `status` marks the block currently underway ("now") or up next ("next"), a
// meal badge surfaces event.mealKind when present.
function ScheduleRow({
  event,
  activity,
  status,
  onOpen,
}: {
  event: CalendarEvent;
  activity: Activity | null;
  status?: "now" | "next";
  onOpen?: (activity: Activity, event: CalendarEvent) => void;
}) {
  const tint = activity ? effectiveEventColor(event, activity) : event.color ?? "var(--line)";
  const time = event.allDay ? "All day" : formatClockCompact(event.startMin);
  const meta = activity
    ? activity.type + " · " + durLabel(activity)
    : "Custom block";
  const mealLabel = event.mealKind ? MEAL_KIND_LABEL[event.mealKind] ?? "Meal" : null;
  const body = (
    <>
      <span className="home-sched__time">{time}</span>
      <span className="home-sched__main">
        <span className="home-sched__title">{event.title || (activity ? activity.title : "Untitled")}</span>
        <span className="home-sched__meta">
          {meta}
          {mealLabel && <span className="home-sched__meal">{mealLabel}</span>}
        </span>
      </span>
      {status && (
        <span className={"home-sched__badge home-sched__badge--" + status}>
          {status === "now" ? "Now" : "Next"}
        </span>
      )}
    </>
  );
  if (activity && onOpen) {
    return (
      <button
        type="button"
        className="home-sched__row home-sched__row--link"
        style={{ "--cal-tint": tint } as CSSProperties}
        onClick={() => onOpen(activity, event)}
      >
        {body}
      </button>
    );
  }
  return (
    <div className="home-sched__row" style={{ "--cal-tint": tint } as CSSProperties}>
      {body}
    </div>
  );
}

// Compact per-day count for the "this week" strip.
function WeekDayCell({
  label,
  count,
  isToday,
  onOpen,
}: {
  label: string;
  count: number;
  isToday: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className={"home-week__day" + (isToday ? " home-week__day--today" : "")}
      onClick={onOpen}
      aria-label={label + ": " + count + (count === 1 ? " activity" : " activities")}
    >
      <span className="home-week__day-label">{label}</span>
      <span className="home-week__day-count">{count}</span>
    </button>
  );
}

export function HomeTab({
  actions,
  activities,
  byId,
  favs,
  isFav,
  onToggleFav,
  events,
  onOpenActivity,
  onOpenEventActivity,
  onGoCalendar,
  onGoLibrary,
  onContextMenu,
  isSignedIn,
  authEnabled,
  adminEmail,
  onStaffSignIn,
  onStaffSignUp,
  onOpenAccount,
  hasLoaded = true,
}: {
  /** Rendered at the right of the welcome header (the auth pill). */
  actions?: ReactNode;
  activities: Activity[];
  byId: Record<string, Activity>;
  /** Saved activity ids, newest first (drives the favorites lead). */
  favs: string[];
  isFav: (id: string) => boolean;
  onToggleFav: (id: string) => void;
  events: Record<string, CalendarEvent>;
  /** Open the activity viewer from a favorite cover (no event context). */
  onOpenActivity: (activity: Activity) => void;
  /** Open the viewer from a today's-schedule row (carries event date/time). */
  onOpenEventActivity: (activity: Activity, event: CalendarEvent) => void;
  onGoCalendar: () => void;
  /** Jump to the Library, optionally pre-filtered to a set of categories. */
  onGoLibrary: (cats: CatFilter) => void;
  onContextMenu?: (activity: Activity, event: MouseEvent) => void;
  /** Whether a staff account is currently signed in (drives the guide CTAs). */
  isSignedIn: boolean;
  /** Whether auth is configured in this workspace at all. */
  authEnabled: boolean;
  /** Address new staff email to request an invite code. */
  adminEmail: string;
  onStaffSignIn: () => void;
  onStaffSignUp: () => void;
  onOpenAccount: () => void;
  /** First-load readiness from the cloud store. While false (a signed-in cold
   *  load whose bootstrap hasn't resolved), the events-driven section shows a calm
   *  loading line instead of "Nothing planned" — so loading ≠ genuinely empty. */
  hasLoaded?: boolean;
}) {
  const today = todayKey();

  // Minute-tick clock driving the Now/Next pills — the only new state this
  // board adds. Cleans up its interval on unmount.
  const [clockMin, setClockMin] = useState<number>(() => nowMinutes());
  useEffect(() => {
    const id = window.setInterval(() => setClockMin(nowMinutes()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // Today's timed events, earliest first; all-day events float to the top.
  const todaysEvents = useMemo(
    () =>
      Object.values(events)
        .filter((e) => e.date === today)
        .sort((a, b) => {
          if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
          return a.startMin - b.startMin;
        }),
    [events, today]
  );

  // The block underway right now (clockMin within [startMin,endMin)) and the
  // next upcoming block after it — timed events only, all-day blocks never
  // carry a Now/Next pill since they have no clock window.
  const { nowEventId, nextEventId } = useMemo(() => {
    let nowId: string | null = null;
    let nextId: string | null = null;
    let nextStart = Infinity;
    for (const e of todaysEvents) {
      if (e.allDay) continue;
      if (clockMin >= e.startMin && clockMin < e.endMin) {
        nowId = e.id;
      } else if (e.startMin >= clockMin && e.startMin < nextStart) {
        nextStart = e.startMin;
        nextId = e.id;
      }
    }
    // Don't double-badge: the "next" slot only applies when nothing is
    // running right now, or once the running block is different from it.
    if (nowId && nextId === nowId) nextId = null;
    return { nowEventId: nowId, nextEventId: nextId };
  }, [todaysEvents, clockMin]);

  // This week: per-day event counts for the next 5 days (today included),
  // each tapping through to the calendar. A calm orientation strip in place
  // of the old favorites deck / per-category counts.
  const weekDays = useMemo(() => {
    const days = Array.from({ length: 5 }, (_, i) => addDays(today, i));
    const counts = new Map<string, number>();
    for (const e of Object.values(events)) {
      counts.set(e.date, (counts.get(e.date) ?? 0) + 1);
    }
    return days.map((date, i) => ({
      date,
      label: i === 0 ? "Today" : new Date(date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short" }),
      count: counts.get(date) ?? 0,
      isToday: i === 0,
    }));
  }, [events, today]);

  return (
    <div className="app__scroll">
      <div className="home">
        <header className="home__welcome">
          <div className="home__welcome-copy">
            <span className="home__kicker">{formatTodayLine()} · Welcome back</span>
            <h1 className="home__greeting">{greeting()}, counselor</h1>
          </div>
          {actions && <div className="home__welcome-actions">{actions}</div>}
        </header>

        <div className="home__grid">
          <div className="home__plan">
            <section className="home__col home__col--sched" aria-labelledby="home-sched-title">
              <div className="home__sec-head">
                <span className="home__sec-title" id="home-sched-title">
                  Today&rsquo;s schedule
                </span>
                <button type="button" className="home__sec-link" onClick={onGoCalendar}>
                  Open calendar
                  <CampIcon.ChevronRight />
                </button>
              </div>
              {todaysEvents.length > 0 ? (
                <div className="home-sched">
                  {todaysEvents.map((event) => (
                    <ScheduleRow
                      key={event.id}
                      event={event}
                      activity={event.activityId ? byId[event.activityId] ?? null : null}
                      status={event.id === nowEventId ? "now" : event.id === nextEventId ? "next" : undefined}
                      onOpen={onOpenEventActivity}
                    />
                  ))}
                </div>
              ) : !hasLoaded ? (
                // Cold signed-in load: the schedule comes from synced events that
                // haven't arrived yet — show a calm loading line, not the "nothing
                // planned" empty-state, so loading reads differently from empty.
                <LoadingVeil label="Loading your schedule…" />
              ) : (
                <div className="home-empty">
                  <span className="home-empty__mark" aria-hidden="true">
                    <CampIcon.Calendar />
                  </span>
                  <p className="home-empty__title">Nothing planned for today yet.</p>
                  <p className="home-empty__hint">
                    Open the calendar to drop activities onto a day — drag from the library or
                    tap an empty slot.
                  </p>
                  <button type="button" className="btn btn--quiet btn--sm" onClick={onGoCalendar}>
                    <CampIcon.Plus />
                    Plan the day
                  </button>
                </div>
              )}
            </section>

            <section className="home__col home__col--week" aria-labelledby="home-week-title">
              <div className="home__sec-head">
                <span className="home__sec-title" id="home-week-title">
                  This week
                </span>
              </div>
              <div className="home-week">
                {weekDays.map((day) => (
                  <WeekDayCell
                    key={day.date}
                    label={day.label}
                    count={day.count}
                    isToday={day.isToday}
                    onOpen={onGoCalendar}
                  />
                ))}
              </div>
            </section>
          </div>

          <aside className="home__aside">
            <section className="home-guide" aria-labelledby="home-guide-title">
              <div className="home__sec-head">
                <span className="home__sec-title" id="home-guide-title">
                  {isSignedIn ? "Quick reference" : "New here? Getting started"}
                </span>
              </div>
              <div className="home-guide__card">
                <ol className="home-guide__steps">
                  <li className="home-guide__step">
                    <span className="home-guide__num" aria-hidden="true">
                      1
                    </span>
                    <div className="home-guide__body">
                      <span className="home-guide__step-title">Browse freely</span>
                      <span className="home-guide__step-copy">
                        Anyone can explore the full activity library and the camp calendar — no
                        account needed. Each activity opens to a clean, printable run sheet.
                      </span>
                    </div>
                  </li>
                  <li className="home-guide__step">
                    <span className="home-guide__num" aria-hidden="true">
                      2
                    </span>
                    <div className="home-guide__body">
                      <span className="home-guide__step-title">Sign in to save &amp; plan</span>
                      <span className="home-guide__step-copy">
                        Counselors sign in with Google or a password to save favorites, rate
                        activities, edit run lists, and build the day on the calendar.
                      </span>
                    </div>
                  </li>
                  <li className="home-guide__step">
                    <span className="home-guide__num" aria-hidden="true">
                      3
                    </span>
                    <div className="home-guide__body">
                      <span className="home-guide__step-title">Need an invite code?</span>
                      <span className="home-guide__step-copy">
                        New staff accounts are created with an invite code. Email{" "}
                        <a className="home-guide__link" href={"mailto:" + adminEmail}>
                          {adminEmail}
                        </a>{" "}
                        to request one, then use it on the sign-up screen.
                      </span>
                    </div>
                  </li>
                </ol>
                {isSignedIn ? (
                  <div className="home-guide__actions">
                    <button type="button" className="btn btn--quiet btn--sm btn--block" onClick={onOpenAccount}>
                      <CampIcon.User />
                      You&rsquo;re signed in — manage account
                    </button>
                  </div>
                ) : authEnabled ? (
                  <div className="home-guide__actions">
                    <button type="button" className="btn btn--primary btn--sm" onClick={onStaffSignIn}>
                      <CampIcon.User />
                      Staff sign in
                    </button>
                    <button type="button" className="btn btn--quiet btn--sm" onClick={onStaffSignUp}>
                      Have a code? Sign up
                    </button>
                  </div>
                ) : (
                  <p className="home-guide__note">
                    Staff accounts aren&rsquo;t configured in this workspace yet, so editing tools
                    are unavailable — but everything is fully browsable.
                  </p>
                )}
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
