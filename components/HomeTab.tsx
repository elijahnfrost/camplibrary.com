"use client";

// The Home surface: the app's landing screen. A warm welcome, a synopsis of
// the day (today's schedule pulled from the calendar), the camp's fan-favorite
// activities (saved first, then top-rated), and quick ways into the Library by
// category. Read-only and link-only — it never mutates; every tile routes into
// the Calendar or Library surfaces that own the real work.

import { useMemo, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import type { CalendarEvent } from "@/lib/calendar/types";
import { todayKey } from "@/lib/calendar/dates";
import { formatClockCompact } from "@/lib/calendar/time";
import { ageLabel, CATEGORIES, categoryTint, durLabel, effectiveEventColor, ENERGY, monogram, ratingColor } from "@/lib/data";
import { useAgeUnit } from "./ageUnit";
import type { Activity, CategoryId } from "@/lib/types";
import type { CatFilter } from "@/lib/activityFilters";
import { CampIcon } from "./icons";
import { LoadingVeil, SaveButton } from "./primitives";

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
function ScheduleRow({
  event,
  activity,
  onOpen,
}: {
  event: CalendarEvent;
  activity: Activity | null;
  onOpen?: (activity: Activity, event: CalendarEvent) => void;
}) {
  const tint = activity ? effectiveEventColor(event, activity) : event.color ?? "var(--line)";
  const time = event.allDay ? "All day" : formatClockCompact(event.startMin);
  const meta = activity
    ? activity.type + " · " + durLabel(activity)
    : "Custom block";
  const body = (
    <>
      <span className="home-sched__time">{time}</span>
      <span className="home-sched__main">
        <span className="home-sched__title">{event.title || (activity ? activity.title : "Untitled")}</span>
        <span className="home-sched__meta">{meta}</span>
      </span>
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

// A favorite cover: the same deck-card anatomy as the Library deck view (plate
// tinted by rating, monogram, save ribbon), shrunk for the home grid.
function FavoriteCard({
  activity,
  saved,
  onOpen,
  onToggleFav,
  onContextMenu,
}: {
  activity: Activity;
  saved: boolean;
  onOpen: (activity: Activity) => void;
  onToggleFav: (id: string) => void;
  onContextMenu?: (activity: Activity, event: MouseEvent) => void;
}) {
  const ageUnit = useAgeUnit();
  return (
    <div
      className="deck-card home-fav"
      onContextMenu={onContextMenu ? (e) => onContextMenu(activity, e) : undefined}
    >
      <div className="plate" style={{ background: ratingColor(activity.rating) }} aria-hidden="true">
        <div className="plate__grid" />
        <span className="plate__cat">{activity.type}</span>
        <span className="plate__mono">{monogram(activity.title)}</span>
      </div>
      <div className="deck-card__body">
        <div className="deck-card__title">{activity.title}</div>
        <div className="deck-card__meta">
          {durLabel(activity)} · {activity.place}
          <br />
          {ageLabel(activity, ageUnit)} · {ENERGY[activity.energy]}
        </div>
      </div>
      <button
        type="button"
        className="deck-card__open stretch"
        aria-label={activity.title}
        onClick={() => onOpen(activity)}
      />
      <span className="plate__star">
        <SaveButton on={saved} onToggle={() => onToggleFav(activity.id)} variant="ribbon" />
      </span>
    </div>
  );
}

const FAVORITE_SLOTS = 6;

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
  /** Jump to the Library, optionally pre-filtered to one category. */
  onGoLibrary: (cat: CatFilter) => void;
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

  // Favorites: the user's saved activities first (in save order), then the
  // highest-rated activities to fill the row — so a fresh camp still sees its
  // crowd-pleasers, and a counselor who's saved things sees their own picks.
  const favorites = useMemo(() => {
    const picked: Activity[] = [];
    const seen = new Set<string>();
    for (const id of favs) {
      const a = byId[id];
      if (a && !seen.has(id)) {
        picked.push(a);
        seen.add(id);
        if (picked.length >= FAVORITE_SLOTS) return picked;
      }
    }
    const topRated = [...activities]
      .filter((a) => !seen.has(a.id))
      .sort((a, b) => b.rating - a.rating || a.title.localeCompare(b.title));
    for (const a of topRated) {
      picked.push(a);
      if (picked.length >= FAVORITE_SLOTS) break;
    }
    return picked;
  }, [activities, byId, favs]);

  // Per-category counts for the browse strip.
  const countByType = useMemo(() => {
    const counts: Record<CategoryId, number> = { Game: 0, Craft: 0, Song: 0, Water: 0, Quiet: 0 };
    for (const a of activities) counts[a.type] += 1;
    return counts;
  }, [activities]);

  const savedCount = favs.filter((id) => byId[id]).length;
  const favoritesLabel = savedCount > 0 ? "Your saved activities" : "Camp favorites";

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

            <section className="home__col home__col--favs" aria-labelledby="home-fav-title">
              <div className="home__sec-head">
                <span className="home__sec-title" id="home-fav-title">
                  {favoritesLabel}
                </span>
                <button type="button" className="home__sec-link" onClick={() => onGoLibrary("All")}>
                  All {activities.length} activities
                  <CampIcon.ChevronRight />
                </button>
              </div>
              {favorites.length > 0 ? (
                <div className="home-favs">
                  {favorites.map((a) => (
                    <FavoriteCard
                      key={a.id}
                      activity={a}
                      saved={isFav(a.id)}
                      onOpen={onOpenActivity}
                      onToggleFav={onToggleFav}
                      onContextMenu={onContextMenu}
                    />
                  ))}
                </div>
              ) : (
                <div className="home-empty">
                  <span className="home-empty__mark" aria-hidden="true">
                    <CampIcon.Library />
                  </span>
                  <p className="home-empty__title">The library is empty.</p>
                  <button type="button" className="btn btn--quiet btn--sm" onClick={() => onGoLibrary("All")}>
                    Browse the library
                  </button>
                </div>
              )}
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

            <section className="home__browse" aria-labelledby="home-browse-title">
              <div className="home__sec-head">
                <span className="home__sec-title" id="home-browse-title">
                  Browse by type
                </span>
              </div>
              <div className="home-types">
                {CATEGORIES.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="home-type"
                    style={{ "--cal-tint": categoryTint(c.id) } as CSSProperties}
                    onClick={() => onGoLibrary(c.id)}
                  >
                    <span className="home-type__dot" aria-hidden="true" />
                    <span className="home-type__label">{c.label}</span>
                    <span className="home-type__count">{countByType[c.id]}</span>
                  </button>
                ))}
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
