import { ACTIVITIES, CATEGORIES, DAYS } from "@/lib/data";
import { CampIcon } from "./icons";

interface HomeViewProps {
  activityCount: number;
  savedCount: number;
  plannedCount: number;
  onGo: (target: "library" | "schedule" | "saved" | "add") => void;
}

const BOOK_HEIGHTS = [92, 68, 112, 80, 104, 65, 98];
const BOOK_COLORS = ["#85a45f", "#d9b152", "#5f7fb2", "#cf8062", "#7a9e8a", "#b07d55", "#a67bb5"];
const quickPicks = ACTIVITIES.slice(0, 7);

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

        <div className="homeview__preview" aria-hidden="true">
          <div className="homeview__note">
            <span>Today</span>
            <strong>{plannedCount} planned</strong>
          </div>
          <div className="homeview__books">
            {quickPicks.map((activity, index) => (
              <span
                key={activity.id}
                className="homeview__book"
                style={{
                  background: BOOK_COLORS[index],
                  height: BOOK_HEIGHTS[index],
                  ...(index === 1
                    ? { transform: "rotate(17deg)", transformOrigin: "bottom center" }
                    : index === 5
                      ? { transform: "rotate(-15deg)", transformOrigin: "bottom center" }
                      : undefined),
                }}
              >
                {activity.title}
              </span>
            ))}
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
