import { ACTIVITIES, CATEGORIES, DAYS, durLabel } from "@/lib/data";
import { CampIcon } from "./icons";

interface HomeViewProps {
  activityCount: number;
  savedCount: number;
  plannedCount: number;
  onGo: (target: "library" | "schedule" | "saved" | "add") => void;
}

const PICK_COLORS = ["#85a45f", "#d9b152", "#5f7fb2", "#cf8062"];
const quickPicks = ACTIVITIES.slice(0, 4);

export function HomeView({ activityCount, savedCount, plannedCount, onGo }: HomeViewProps) {
  return (
    <div className="homeview fadein">
      <section className="homeview__hero" aria-labelledby="homeview-title">
        <div className="homeview__copy">
          <span className="homeview__kicker">Home base</span>
          <h1 id="homeview-title">
            Plan <em>the day</em>
          </h1>
          <p>Jump into the library, fill the schedule, or add a tested activity.</p>
          <div className="homeview__actions">
            <button type="button" className="btn btn--primary" onClick={() => onGo("library")}>
              <CampIcon.Library />
              Open Library
            </button>
            <button type="button" className="btn" onClick={() => onGo("schedule")}>
              <CampIcon.Calendar />
              Open Schedule
            </button>
          </div>
        </div>

        <div className="homeview__preview" aria-label="Today preview">
          <div className="homeview__today">
            <div className="homeview__today-head">
              <span>Today</span>
              <strong>{plannedCount}</strong>
              <small>planned</small>
            </div>
            <div className="homeview__picks" aria-label="Starter activities">
              {quickPicks.map((activity, index) => (
                <div className="homeview__pick" key={activity.id}>
                  <i style={{ background: PICK_COLORS[index] }} aria-hidden="true" />
                  <span>{activity.title}</span>
                  <small>{durLabel(activity)}</small>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="homeview__stats" aria-label="Camp Library summary">
        <button type="button" onClick={() => onGo("library")}>
          <strong>{activityCount}</strong>
          <span>Activities</span>
        </button>
        <button type="button" onClick={() => onGo("library")}>
          <strong>{CATEGORIES.length}</strong>
          <span>Shelves</span>
        </button>
        <button type="button" onClick={() => onGo("schedule")}>
          <strong>{DAYS.length}</strong>
          <span>Day planner</span>
        </button>
        <button type="button" onClick={() => onGo("saved")}>
          <strong>{savedCount}</strong>
          <span>Saved</span>
        </button>
      </section>

      <section className="homeview__grid" aria-label="Quick actions">
        <button type="button" className="homeview-card" onClick={() => onGo("library")}>
          <CampIcon.Search />
          <strong>Find an activity</strong>
          <span>Browse by age, place, type, or energy.</span>
        </button>
        <button type="button" className="homeview-card" onClick={() => onGo("schedule")}>
          <CampIcon.Calendar />
          <strong>Build the day</strong>
          <span>Fill blocks, move items, and print the plan.</span>
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
