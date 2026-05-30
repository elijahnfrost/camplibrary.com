import type { Activity } from "@/lib/types";
import { durLabel, ratingColor } from "@/lib/data";
import { formatClock } from "@/lib/scheduleTime";
import { CampIcon } from "./icons";

export interface HomeTodayItem {
  activity: Activity;
  start: string;
}

interface HomeViewProps {
  dayName: string;
  today: HomeTodayItem[];
  plannedCount: number;
  saved: Activity[];
  recent: Activity[];
  activityCount: number;
  savedCount: number;
  plansCount: number;
  onGo: (target: "library" | "schedule" | "saved" | "add") => void;
  onOpen: (a: Activity) => void;
}

export function HomeView({
  dayName,
  today,
  plannedCount,
  saved,
  recent,
  activityCount,
  savedCount,
  plansCount,
  onGo,
  onOpen,
}: HomeViewProps) {
  return (
    <div className="homeview fadein">
      <section className="homeview__hero" aria-labelledby="homeview-title">
        <div className="homeview__copy">
          <span className="homeview__kicker">Home base · {dayName}</span>
          <h1 id="homeview-title">
            Plan <em>the day</em>
          </h1>
          <p>Jump into the library, fill the schedule, or add a tested activity.</p>
          <div className="homeview__actions">
            <button type="button" className="btn btn--primary" onClick={() => onGo("schedule")}>
              <CampIcon.Calendar />
              {plannedCount ? "Open today's plan" : "Build the day"}
            </button>
            <button type="button" className="btn" onClick={() => onGo("library")}>
              <CampIcon.Library />
              Open Library
            </button>
          </div>
        </div>

        <div className="homeview__preview" aria-label={dayName + " preview"}>
          <button
            type="button"
            className="homeview__today"
            onClick={() => onGo("schedule")}
            aria-label={"Open the schedule for " + dayName}
          >
            <div className="homeview__today-head">
              <span>{dayName}</span>
              <strong>{plannedCount}</strong>
              <small>planned</small>
            </div>
            {today.length ? (
              <div className="homeview__picks" aria-label="Today's activities">
                {today.slice(0, 5).map(({ activity, start }) => (
                  <div className="homeview__pick" key={activity.id}>
                    <i style={{ background: ratingColor(activity.rating) }} aria-hidden="true" />
                    <span>{activity.title}</span>
                    <small>{formatClock(start)}</small>
                  </div>
                ))}
              </div>
            ) : (
              <div className="homeview__today-empty">
                <p>Nothing planned for {dayName} yet.</p>
                <span>Tap to build the day.</span>
              </div>
            )}
          </button>
        </div>
      </section>

      <section className="homeview__stats" aria-label="Camp Library summary">
        <button type="button" onClick={() => onGo("library")}>
          <strong>{activityCount}</strong>
          <span>Activities</span>
        </button>
        <button type="button" onClick={() => onGo("schedule")}>
          <strong>{plannedCount}</strong>
          <span>Planned today</span>
        </button>
        <button type="button" onClick={() => onGo("saved")}>
          <strong>{savedCount}</strong>
          <span>Saved</span>
        </button>
        <button type="button" onClick={() => onGo("schedule")}>
          <strong>{plansCount}</strong>
          <span>Templates</span>
        </button>
      </section>

      {saved.length > 0 && (
        <section className="homeview__rail" aria-label="Saved shortlist">
          <div className="homeview__rail-head">
            <span>Saved shortlist</span>
            <button type="button" onClick={() => onGo("saved")}>
              See all
            </button>
          </div>
          <div className="homeview__rail-row">
            {saved.slice(0, 4).map((a) => (
              <button type="button" className="homeview__mini" key={a.id} onClick={() => onOpen(a)}>
                <i style={{ background: ratingColor(a.rating) }} aria-hidden="true" />
                <span>{a.title}</span>
                <small>{durLabel(a)}</small>
              </button>
            ))}
          </div>
        </section>
      )}

      {recent.length > 0 && (
        <section className="homeview__rail" aria-label="Recently added">
          <div className="homeview__rail-head">
            <span>Recently added</span>
            <button type="button" onClick={() => onGo("library")}>
              See all
            </button>
          </div>
          <div className="homeview__rail-row">
            {recent.slice(0, 4).map((a) => (
              <button type="button" className="homeview__mini" key={a.id} onClick={() => onOpen(a)}>
                <i style={{ background: ratingColor(a.rating) }} aria-hidden="true" />
                <span>{a.title}</span>
                <small>{a.type}</small>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="homeview__grid" aria-label="Quick actions">
        <button type="button" className="homeview-card" onClick={() => onGo("schedule")}>
          <CampIcon.Calendar />
          <strong>Build &amp; reuse a day</strong>
          <span>Fill blocks, save a template, apply it across the week.</span>
        </button>
        <button type="button" className="homeview-card" onClick={() => onGo("add")}>
          <CampIcon.Plus />
          <strong>Catalog your own</strong>
          <span>Add tested games, crafts, songs, or quiet fillers.</span>
        </button>
      </section>
    </div>
  );
}
