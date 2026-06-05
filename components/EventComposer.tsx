"use client";

import { useMemo, useState, type CSSProperties, type FormEvent } from "react";
import type { Activity, BlockFill, CategoryId, ConditionalRule } from "@/lib/types";
import { activityMeta, CATEGORIES, categoryTint, DAYS } from "@/lib/data";
import {
  campMinutes,
  DAY_END_MIN,
  DURATION_OPTIONS,
  formatClock,
  MIN_DURATION_MIN,
  minutesToCamp,
  startOptions,
} from "@/lib/scheduleTime";
import { CampIcon } from "./icons";
import { useDialogFocus } from "./useDialogFocus";

export type EventDraft = {
  kind: "activity" | "label";
  activityId?: string;
  label: string;
  start: string;
  end: string;
  fill?: BlockFill;
  category?: CategoryId;
  rule?: ConditionalRule;
};

export type ComposerState = {
  blockId?: string;
  tab: "library" | "custom" | "open";
  activityId?: string;
  label: string;
  start: string;
  durationMin: number;
  category?: CategoryId;
  rule?: ConditionalRule;
};

export const CAT_LABEL: Record<CategoryId, string> = {
  Game: "Game",
  Craft: "Craft",
  Song: "Song",
  Water: "Water activity",
  Quiet: "Quiet activity",
};

export function EventComposer({
  dayName,
  allActivities,
  initial,
  onSubmit,
  onClose,
}: {
  dayName: string;
  allActivities: Activity[];
  initial: ComposerState;
  onSubmit: (draft: EventDraft, blockId?: string) => void;
  onClose: () => void;
}) {
  const initialByDay = initial.rule && initial.rule.mode === "byWeekday" ? initial.rule.map : {};
  const [tab, setTab] = useState<"library" | "custom" | "open">(initial.tab);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState<CategoryId | "All">(initial.category ?? "All");
  const [activityId, setActivityId] = useState<string | undefined>(initial.activityId);
  const [label, setLabel] = useState(initial.label);
  const [category, setCategory] = useState<CategoryId>(initial.category ?? "Game");
  const [varyByDay, setVaryByDay] = useState(Object.keys(initialByDay).length > 0);
  const [byDay, setByDay] = useState<Partial<Record<number, string>>>(initialByDay);
  const [start, setStart] = useState(initial.start);
  const [durationMin, setDurationMin] = useState(initial.durationMin);

  const isEdit = Boolean(initial.blockId);
  const dialogRef = useDialogFocus<HTMLDivElement>(onClose);

  const categoryActivities = useMemo(
    () => allActivities.filter((activity) => activity.type === category),
    [allActivities, category]
  );
  const categoryActivityIds = useMemo(
    () => new Set(categoryActivities.map((activity) => activity.id)),
    [categoryActivities]
  );

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allActivities.filter((activity) => {
      if (catFilter !== "All" && activity.type !== catFilter) return false;
      if (!q) return true;
      return (activity.title + " " + activity.type + " " + activity.blurb).toLowerCase().includes(q);
    });
  }, [allActivities, catFilter, search]);

  const durationChoices = useMemo(() => {
    const set = new Set<number>(DURATION_OPTIONS);
    set.add(durationMin);
    return [...set].sort((a, b) => a - b);
  }, [durationMin]);

  const startChoices = useMemo(() => {
    const options = startOptions();
    if (!options.some((option) => option.value === start)) {
      options.push({ value: start, label: formatClock(start) });
      options.sort((a, b) => campMinutes(a.value) - campMinutes(b.value));
    }
    return options;
  }, [start]);

  function chooseActivity(activity: Activity) {
    setActivityId(activity.id);
    setDurationMin(Math.max(MIN_DURATION_MIN, activity.durationMin));
  }

  const canSubmit = tab === "library" ? Boolean(activityId) : tab === "open" ? true : label.trim().length > 0;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;

    const startMinutes = campMinutes(start);
    const endLimit = startMinutes >= DAY_END_MIN ? 24 * 60 : DAY_END_MIN;
    const endMinutes = Math.min(endLimit, startMinutes + durationMin);
    const start24 = minutesToCamp(startMinutes);
    const end24 = minutesToCamp(endMinutes);

    if (tab === "library") {
      const activity = allActivities.find((a) => a.id === activityId);
      onSubmit(
        {
          kind: "activity",
          activityId,
          label: activity ? activity.title : "Activity",
          start: start24,
          end: end24,
          fill: "fixed",
        },
        initial.blockId
      );
    } else if (tab === "open") {
      const map: Partial<Record<number, string>> = {};
      if (varyByDay) {
        for (const [day, id] of Object.entries(byDay)) {
          if (id && categoryActivityIds.has(id)) map[Number(day)] = id;
        }
      }
      const hasRule = Object.keys(map).length > 0;
      onSubmit(
        {
          kind: "activity",
          label: "Choose a " + CAT_LABEL[category],
          start: start24,
          end: end24,
          fill: hasRule ? "conditional" : "open",
          category,
          rule: hasRule ? { mode: "byWeekday", map } : undefined,
        },
        initial.blockId
      );
    } else {
      onSubmit(
        {
          kind: "label",
          label: label.trim(),
          start: start24,
          end: end24,
          fill: "fixed",
        },
        initial.blockId
      );
    }
  }

  return (
    <div
      ref={dialogRef}
      className="composer-scrim"
      role="dialog"
      aria-modal="true"
      aria-label={(isEdit ? "Edit" : "Add") + " event"}
      tabIndex={-1}
    >
      <div className="composer-backdrop" onClick={onClose} />
      <form className="composer fadein" onSubmit={submit}>
        <header className="composer__head">
          <div>
            <span className="composer__kicker">{isEdit ? "Edit event" : "Add to " + dayName}</span>
            <h2 className="composer__title">{isEdit ? "Edit event" : "New event"}</h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <CampIcon.Close />
          </button>
        </header>

        <div className="composer__seg" role="group" aria-label="Event type">
          <button
            type="button"
            aria-pressed={tab === "library"}
            className={tab === "library" ? "is-on" : ""}
            onClick={() => setTab("library")}
          >
            Library
          </button>
          <button
            type="button"
            aria-pressed={tab === "open"}
            className={tab === "open" ? "is-on" : ""}
            onClick={() => setTab("open")}
          >
            Open slot
          </button>
          <button
            type="button"
            aria-pressed={tab === "custom"}
            className={tab === "custom" ? "is-on" : ""}
            onClick={() => setTab("custom")}
          >
            Custom
          </button>
        </div>

        {tab === "library" && (
          <div className="composer__library">
            <label className="schedule-search composer__search">
              <CampIcon.Search />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search activities..."
                aria-label="Search activities"
                autoFocus
              />
            </label>
            <div className="composer__catrow" role="group" aria-label="Filter by type">
              <button
                type="button"
                className={"chip" + (catFilter === "All" ? " is-on" : "")}
                onClick={() => setCatFilter("All")}
              >
                All
              </button>
              {CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={"chip" + (catFilter === c.id ? " is-on" : "")}
                  onClick={() => setCatFilter(catFilter === c.id ? "All" : c.id)}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <div className="composer__list" aria-label="Activities">
              {matches.length ? (
                matches.map((activity) => (
                  <button
                    type="button"
                    key={activity.id}
                    aria-pressed={activityId === activity.id}
                    className={"composer__option" + (activityId === activity.id ? " is-on" : "")}
                    onClick={() => chooseActivity(activity)}
                  >
                    <span className="composer__option-title">{activity.title}</span>
                    <span className="composer__option-meta">{activityMeta(activity)}</span>
                  </button>
                ))
              ) : (
                <div className="composer__empty">No activities match.</div>
              )}
            </div>
          </div>
        )}

        {tab === "open" && (
          <div className="field composer__custom">
            <span className="field__label" id="composer-open-label">
              A blank slot to fill per day
            </span>
            <p className="composer__hint">
              Reserve a time for a kind of activity; choose the exact one later, or let a template
              fill it differently each day.
            </p>
            <div className="composer__catrow" role="group" aria-labelledby="composer-open-label">
              {CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={"chip" + (category === c.id ? " is-on" : "")}
                  aria-pressed={category === c.id}
                  onClick={() => {
                    if (c.id !== category) setByDay({});
                    setCategory(c.id);
                  }}
                  style={category === c.id ? ({ "--chip-on": categoryTint(c.id) } as CSSProperties) : undefined}
                >
                  {c.label}
                </button>
              ))}
            </div>

            <label className="composer__vary">
              <input type="checkbox" checked={varyByDay} onChange={(event) => setVaryByDay(event.target.checked)} />
              <span>Vary by weekday</span>
              <small>auto-fill a specific activity on chosen days</small>
            </label>

            {varyByDay && (
              <div className="vary-grid" role="group" aria-label="Activity by weekday">
                {DAYS.map((day, index) => (
                  <div className="vary-row" key={day}>
                    <span className="vary-row__day">{day.slice(0, 3)}</span>
                    <select
                      className="input"
                      value={byDay[index] ?? ""}
                      onChange={(event) =>
                        setByDay((prev) => {
                          const next = { ...prev };
                          if (event.target.value) next[index] = event.target.value;
                          else delete next[index];
                          return next;
                        })
                      }
                      aria-label={day + " activity"}
                    >
                      <option value="">Leave open</option>
                      {categoryActivities.map((activity) => (
                        <option key={activity.id} value={activity.id}>
                          {activity.title}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "custom" && (
          <div className="field composer__custom">
            <label className="field__label" htmlFor="composer-label">
              Label
            </label>
            <input
              id="composer-label"
              className="input"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Lunch, free swim, rest hour..."
              autoFocus
            />
          </div>
        )}

        <div className="composer__times">
          <div className="field">
            <label className="field__label" htmlFor="composer-start">
              Starts
            </label>
            <select id="composer-start" className="input" value={start} onChange={(event) => setStart(event.target.value)}>
              {startChoices.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="composer-duration">
              Length
            </label>
            <select
              id="composer-duration"
              className="input"
              value={durationMin}
              onChange={(event) => setDurationMin(parseInt(event.target.value, 10))}
            >
              {durationChoices.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes} min
                </option>
              ))}
            </select>
          </div>
        </div>

        <footer className="composer__foot">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={!canSubmit}>
            <CampIcon.Check />
            {isEdit ? "Save event" : "Add event"}
          </button>
        </footer>
      </form>
    </div>
  );
}
