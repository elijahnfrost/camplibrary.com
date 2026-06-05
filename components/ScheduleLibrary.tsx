"use client";

import { useMemo, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { Activity, DayTemplate } from "@/lib/types";
import { activityMeta } from "@/lib/data";
import type { MaterialOption } from "@/lib/materials";
import { CampIcon } from "./icons";
import { Filters, type AgeFilter, type CatFilter, type PlaceFilter } from "./Filters";
import { SaveButton } from "./primitives";

export function ScheduleLibrary({
  isOpen,
  activities,
  query,
  onQueryChange,
  cat,
  place,
  age,
  materialOptions,
  availableMaterials,
  onCat,
  onPlace,
  onAge,
  onToggleMaterial,
  onClearMaterials,
  plans,
  dayName,
  onToggle,
  onOpenActivity,
  onQuickAdd,
  onStartDrag,
  onSavePlan,
  onRequestApply,
  onDeletePlan,
  isFav,
  onToggleFav,
}: {
  isOpen: boolean;
  activities: Activity[];
  query: string;
  onQueryChange: (value: string) => void;
  cat: CatFilter;
  place: PlaceFilter;
  age: AgeFilter;
  materialOptions: MaterialOption[];
  availableMaterials: string[];
  onCat: (value: CatFilter) => void;
  onPlace: (value: PlaceFilter) => void;
  onAge: (value: AgeFilter) => void;
  onToggleMaterial: (id: string) => void;
  onClearMaterials: () => void;
  plans: DayTemplate[];
  dayName: string;
  onToggle: () => void;
  onOpenActivity: (activity: Activity) => void;
  onQuickAdd: (activityId: string) => void;
  onStartDrag: (event: ReactPointerEvent, activity: Activity) => void;
  onSavePlan: (name: string) => void;
  onRequestApply: (planId: string) => void;
  onDeletePlan: (planId: string) => void;
  isFav: (id: string) => boolean;
  onToggleFav: (id: string) => void;
}) {
  const [planName, setPlanName] = useState("");

  const templateSummaries = useMemo(
    () =>
      new Map(
        plans.map((plan) => {
          const activities = plan.blocks.filter(
            (block) => block.kind === "activity" && block.activityId && block.fill !== "open"
          ).length;
          const open = plan.blocks.filter(
            (block) => (block.fill === "open" || block.fill === "conditional") && !block.activityId
          ).length;
          const breaks = plan.blocks.filter((block) => block.kind === "label").length;
          const parts = [];
          if (activities) parts.push(activities + " set");
          if (open) parts.push(open + " open");
          if (breaks) parts.push(breaks + (breaks === 1 ? " break" : " breaks"));
          return [plan.id, parts.join(" - ") || "empty"];
        })
      ),
    [plans]
  );

  function submitPlan(event: FormEvent) {
    event.preventDefault();
    onSavePlan(planName || dayName + " template");
    setPlanName("");
  }

  return (
    <aside className={"schedule-library" + (isOpen ? " is-open" : "")} aria-label="Activity library">
      <button type="button" className="schedule-library__toggle" onClick={onToggle} aria-expanded={isOpen}>
        <span>Activity library</span>
        <strong>{activities.length} matches</strong>
        <CampIcon.ChevronUp />
      </button>

      <div className="schedule-library__content">
        <label className="schedule-search">
          <CampIcon.Search />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Find an activity..."
            aria-label="Search activities"
          />
        </label>

        <Filters
          variant="bar"
          cat={cat}
          place={place}
          age={age}
          materialOptions={materialOptions}
          availableMaterials={availableMaterials}
          onCat={onCat}
          onPlace={onPlace}
          onAge={onAge}
          onToggleMaterial={onToggleMaterial}
          onClearMaterials={onClearMaterials}
        />

        <p className="schedule-library__hint">Drag onto the calendar, or tap + to drop it at the next open time.</p>

        <div className="schedule-activity-list" aria-label="Activities">
          {activities.length ? (
            activities.map((activity) => (
              <div className="schedule-activity" key={activity.id}>
                <span
                  className="schedule-activity__grip"
                  aria-hidden="true"
                  onPointerDown={(event) => onStartDrag(event, activity)}
                  title="Drag onto the calendar"
                >
                  <CampIcon.Grip />
                </span>
                <button type="button" className="schedule-activity__main" onClick={() => onOpenActivity(activity)}>
                  <span className="schedule-activity__title">{activity.title}</span>
                  <span className="schedule-activity__meta">{activityMeta(activity)}</span>
                </button>
                <SaveButton on={isFav(activity.id)} onToggle={() => onToggleFav(activity.id)} />
                <button
                  type="button"
                  className="schedule-activity__add"
                  onClick={() => onQuickAdd(activity.id)}
                  aria-label={"Add " + activity.title + " to " + dayName}
                >
                  <CampIcon.Plus />
                </button>
              </div>
            ))
          ) : (
            <div className="schedule-library__empty">No activities match these filters.</div>
          )}
        </div>

        <section className="saved-plans" aria-label="Day templates">
          <div className="saved-plans__head">Day templates</div>
          <form className="saved-plans__save" onSubmit={submitPlan}>
            <input
              value={planName}
              onChange={(event) => setPlanName(event.target.value)}
              placeholder={"Save " + dayName + " as..."}
              aria-label="Template name"
            />
            <button type="submit" className="btn btn--quiet">
              <CampIcon.Bookmark />
              Save day
            </button>
          </form>
          <div className="template-list">
            {plans.length ? (
              plans.map((plan) => (
                <div className="template-card" key={plan.id}>
                  <div className="template-card__body">
                    <span className="template-card__name">{plan.name}</span>
                    <span className="template-card__meta">{templateSummaries.get(plan.id)}</span>
                  </div>
                  <button
                    type="button"
                    className="btn btn--quiet template-card__apply"
                    onClick={() => onRequestApply(plan.id)}
                  >
                    Apply...
                  </button>
                  <button
                    type="button"
                    className="plan-chip__delete"
                    onClick={() => onDeletePlan(plan.id)}
                    aria-label={"Delete " + plan.name}
                  >
                    <CampIcon.Trash />
                  </button>
                </div>
              ))
            ) : (
              <span className="saved-plans__none">Build a day, then Save day to reuse it across the week.</span>
            )}
          </div>
        </section>
      </div>
    </aside>
  );
}
