"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type {
  Activity,
  ApplyMode,
  BlockFill,
  CategoryId,
  ConditionalRule,
  DaySchedule,
  DayTemplate,
  ScheduleBlock,
} from "@/lib/types";
import { CATEGORIES, categoryTint, code, DAYS, durLabel, ENERGY } from "@/lib/data";
import {
  blockEndMin,
  blockStartMin,
  campMinutes,
  clampStart,
  DAY_END_MIN,
  DAY_START_MIN,
  DEFAULT_DURATION_MIN,
  DURATION_OPTIONS,
  formatRange,
  hourMarks,
  MIN_DURATION_MIN,
  minutesToCamp,
  nextFreeStart,
  snapMinutes,
  startOptions,
  TOTAL_MIN,
} from "@/lib/scheduleTime";
import { CampIcon } from "./icons";
import { Filters, type AgeFilter, type CatFilter, type PlaceFilter } from "./Filters";
import { SaveButton } from "./primitives";
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

const CAT_LABEL: Record<CategoryId, string> = {
  Game: "Game",
  Craft: "Craft",
  Song: "Song",
  Water: "Water activity",
  Quiet: "Quiet activity",
};

function activityMeta(activity: Activity): string {
  return code(activity) + " · " + durLabel(activity) + " · " + ENERGY[activity.energy];
}

function pct(min: number): number {
  return ((min - DAY_START_MIN) / TOTAL_MIN) * 100;
}

// ---- Overlap layout: assign side-by-side columns to events that share time ----

type Laid = {
  startMin: number;
  endMin: number;
  block: ScheduleBlock | null;
  ghost?: boolean;
  dragging?: boolean;
  col: number;
  cols: number;
};

function layoutEvents(items: Omit<Laid, "col" | "cols">[]): Laid[] {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const out: Laid[] = [];
  let group: Laid[] = [];
  let groupEnd = -Infinity;

  const flush = () => {
    const colEnds: number[] = [];
    for (const item of group) {
      let placed = false;
      for (let c = 0; c < colEnds.length; c++) {
        if (colEnds[c] <= item.startMin) {
          item.col = c;
          colEnds[c] = item.endMin;
          placed = true;
          break;
        }
      }
      if (!placed) {
        item.col = colEnds.length;
        colEnds.push(item.endMin);
      }
    }
    group.forEach((item) => (item.cols = colEnds.length));
    out.push(...group);
    group = [];
  };

  for (const raw of sorted) {
    const item: Laid = { ...raw, col: 0, cols: 1 };
    if (group.length && item.startMin >= groupEnd) {
      flush();
      groupEnd = -Infinity;
    }
    group.push(item);
    groupEnd = Math.max(groupEnd, item.endMin);
  }
  if (group.length) flush();
  return out;
}

// ============================================================
// Add / edit event composer
// ============================================================

function EventComposer({
  dayName,
  allActivities,
  initial,
  onSubmit,
  onClose,
}: {
  dayName: string;
  allActivities: Activity[];
  initial: {
    blockId?: string;
    tab: "library" | "custom" | "open";
    activityId?: string;
    label: string;
    start: string;
    durationMin: number;
    category?: CategoryId;
    rule?: ConditionalRule;
  };
  onSubmit: (draft: EventDraft, blockId?: string) => void;
  onClose: () => void;
}) {
  const initialByDay =
    initial.rule && initial.rule.mode === "byWeekday" ? initial.rule.map : {};
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

  const categoryActivities = useMemo(
    () => allActivities.filter((a) => a.type === category),
    [allActivities, category]
  );

  const isEdit = Boolean(initial.blockId);
  const dialogRef = useDialogFocus<HTMLDivElement>(onClose);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allActivities.filter((a) => {
      if (catFilter !== "All" && a.type !== catFilter) return false;
      if (!q) return true;
      return (a.title + " " + a.type + " " + a.blurb).toLowerCase().includes(q);
    });
  }, [allActivities, search, catFilter]);

  const durationChoices = useMemo(() => {
    const set = new Set<number>(DURATION_OPTIONS);
    set.add(durationMin);
    return [...set].sort((a, b) => a - b);
  }, [durationMin]);

  function chooseActivity(activity: Activity) {
    setActivityId(activity.id);
    setDurationMin(Math.max(MIN_DURATION_MIN, activity.durationMin));
  }

  const canSubmit =
    tab === "library" ? Boolean(activityId) : tab === "open" ? true : label.trim().length > 0;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    const startMinutes = campMinutes(start);
    const endMinutes = Math.min(DAY_END_MIN, startMinutes + durationMin);
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
          if (id) map[Number(day)] = id;
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
        { kind: "label", label: label.trim(), start: start24, end: end24, fill: "fixed" },
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
                placeholder="Search activities…"
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
            <div className="composer__list" role="listbox" aria-label="Activities">
              {matches.length ? (
                matches.map((activity) => (
                  <button
                    type="button"
                    key={activity.id}
                    role="option"
                    aria-selected={activityId === activity.id}
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
                  onClick={() => setCategory(c.id)}
                  style={
                    category === c.id
                      ? ({ "--chip-on": categoryTint(c.id) } as CSSProperties)
                      : undefined
                  }
                >
                  {c.label}
                </button>
              ))}
            </div>

            <label className="composer__vary">
              <input
                type="checkbox"
                checked={varyByDay}
                onChange={(e) => setVaryByDay(e.target.checked)}
              />
              <span>Vary by weekday</span>
              <small>auto-fill a specific activity on chosen days</small>
            </label>

            {varyByDay && (
              <div className="vary-grid" role="group" aria-label="Activity by weekday">
                {DAYS.map((day, i) => (
                  <div className="vary-row" key={day}>
                    <span className="vary-row__day">{day.slice(0, 3)}</span>
                    <select
                      className="input"
                      value={byDay[i] ?? ""}
                      onChange={(e) =>
                        setByDay((prev) => {
                          const next = { ...prev };
                          if (e.target.value) next[i] = e.target.value;
                          else delete next[i];
                          return next;
                        })
                      }
                      aria-label={day + " activity"}
                    >
                      <option value="">Leave open</option>
                      {categoryActivities.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.title}
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
              placeholder="Lunch, free swim, rest hour…"
              autoFocus
            />
          </div>
        )}

        <div className="composer__times">
          <div className="field">
            <label className="field__label" htmlFor="composer-start">
              Starts
            </label>
            <select
              id="composer-start"
              className="input"
              value={start}
              onChange={(event) => setStart(event.target.value)}
            >
              {startOptions().map((option) => (
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

// ============================================================
// Apply-a-template sheet (replaces window.confirm)
// ============================================================

const APPLY_MODES: { id: ApplyMode; label: string; hint: string }[] = [
  { id: "replace", label: "Replace each day", hint: "Clear the day, then stamp the template." },
  { id: "fill", label: "Only empty days", hint: "Skip days that already have activities." },
  { id: "merge", label: "Add to existing", hint: "Keep what's there; add blocks that don't clash." },
];

function ApplySheet({
  template,
  dayIndex,
  weekBlocks,
  onConfirm,
  onClose,
}: {
  template: DayTemplate;
  dayIndex: number;
  weekBlocks: Record<number, DaySchedule>;
  onConfirm: (targetDays: number[], mode: ApplyMode) => void;
  onClose: () => void;
}) {
  const [days, setDays] = useState<number[]>(() => DAYS.map((_, i) => i));
  const [mode, setMode] = useState<ApplyMode>("replace");
  const dialogRef = useDialogFocus<HTMLDivElement>(onClose);

  const toggleDay = (i: number) =>
    setDays((d) => (d.includes(i) ? d.filter((x) => x !== i) : [...d, i].sort((a, b) => a - b)));

  const withPlans = days.filter((i) =>
    (weekBlocks[i] || []).some((b) => b.kind === "activity" && b.activityId)
  ).length;
  const openInTpl = template.blocks.filter(
    (b) => (b.fill === "open" || b.fill === "conditional") && !b.activityId
  ).length;
  const blockCount = template.blocks.length;
  const canConfirm = days.length > 0;

  return (
    <div
      ref={dialogRef}
      className="composer-scrim"
      role="dialog"
      aria-modal="true"
      aria-label={"Apply " + template.name}
      tabIndex={-1}
    >
      <div className="composer-backdrop" onClick={onClose} />
      <form
        className="composer fadein"
        onSubmit={(e) => {
          e.preventDefault();
          if (canConfirm) onConfirm(days, mode);
        }}
      >
        <header className="composer__head">
          <div>
            <span className="composer__kicker">Apply template</span>
            <h2 className="composer__title">{template.name}</h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <CampIcon.Close />
          </button>
        </header>

        <div className="field">
          <span className="field__label">Apply to</span>
          <div className="apply-days" role="group" aria-label="Target days">
            {DAYS.map((day, i) => (
              <button
                key={day}
                type="button"
                className={"apply-day" + (days.includes(i) ? " is-on" : "")}
                aria-pressed={days.includes(i)}
                onClick={() => toggleDay(i)}
              >
                {day.slice(0, 3)}
              </button>
            ))}
          </div>
          <div className="apply-presets">
            <button type="button" onClick={() => setDays(DAYS.map((_, i) => i))}>
              All week
            </button>
            <button type="button" onClick={() => setDays([dayIndex])}>
              This day only
            </button>
          </div>
        </div>

        <div className="field">
          <span className="field__label">If a day already has a plan</span>
          <div className="apply-modes" role="radiogroup" aria-label="Conflict handling">
            {APPLY_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={mode === m.id}
                className={"apply-mode" + (mode === m.id ? " is-on" : "")}
                onClick={() => setMode(m.id)}
              >
                <strong>{m.label}</strong>
                <small>{m.hint}</small>
              </button>
            ))}
          </div>
        </div>

        <p className="apply-preview">
          Stamps {blockCount} {blockCount === 1 ? "block" : "blocks"} onto {days.length}{" "}
          {days.length === 1 ? "day" : "days"}
          {openInTpl ? " · leaves " + openInTpl + " open to fill" : ""}
          {withPlans ? " · " + withPlans + " already " + (withPlans === 1 ? "has" : "have") + " a plan" : ""}.
        </p>

        <footer className="composer__foot">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={!canConfirm}>
            <CampIcon.Check />
            Apply to {days.length} {days.length === 1 ? "day" : "days"}
          </button>
        </footer>
      </form>
    </div>
  );
}

// ============================================================
// Activity library (desktop side panel / mobile tray)
// ============================================================

function ScheduleLibrary({
  isOpen,
  activities,
  query,
  onQueryChange,
  cat,
  place,
  age,
  onCat,
  onPlace,
  onAge,
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
  onCat: (value: CatFilter) => void;
  onPlace: (value: PlaceFilter) => void;
  onAge: (value: AgeFilter) => void;
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

  function submitPlan(event: FormEvent) {
    event.preventDefault();
    onSavePlan(planName || dayName + " template");
    setPlanName("");
  }

  function templateSummary(plan: DayTemplate): string {
    const activities = plan.blocks.filter((b) => b.kind === "activity" && b.activityId && b.fill !== "open").length;
    const open = plan.blocks.filter((b) => (b.fill === "open" || b.fill === "conditional") && !b.activityId).length;
    const breaks = plan.blocks.filter((b) => b.kind === "label").length;
    const parts = [];
    if (activities) parts.push(activities + " set");
    if (open) parts.push(open + " open");
    if (breaks) parts.push(breaks + (breaks === 1 ? " break" : " breaks"));
    return parts.join(" · ") || "empty";
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
            placeholder="Find an activity…"
            aria-label="Search activities"
          />
        </label>

        <Filters variant="bar" cat={cat} place={place} age={age} onCat={onCat} onPlace={onPlace} onAge={onAge} />

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
              placeholder={"Save " + dayName + " as…"}
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
                    <span className="template-card__meta">{templateSummary(plan)}</span>
                  </div>
                  <button
                    type="button"
                    className="btn btn--quiet template-card__apply"
                    onClick={() => onRequestApply(plan.id)}
                  >
                    Apply…
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
              <span className="saved-plans__none">
                Build a day, then “Save day” to reuse it across the week.
              </span>
            )}
          </div>
        </section>
      </div>
    </aside>
  );
}

// ============================================================
// Drag state
// ============================================================

type DragState =
  | {
      type: "move";
      blockId: string;
      grabOffsetMin: number;
      durationMin: number;
      startMin: number;
      endMin: number;
      moved: boolean;
    }
  | { type: "resize"; blockId: string; startMin: number; endMin: number }
  | {
      type: "create";
      activity: Activity;
      durationMin: number;
      startMin: number;
      endMin: number;
      clientX: number;
      clientY: number;
      over: boolean;
    };

// ============================================================
// Schedule view
// ============================================================

export function ScheduleView({
  dayIndex,
  onDayChange,
  blocks,
  weekBlocks,
  activities,
  allActivities,
  query,
  onQueryChange,
  cat,
  place,
  age,
  onCat,
  onPlace,
  onAge,
  plans,
  openCount,
  onAddEvent,
  onUpdateEvent,
  onRemoveEvent,
  onQuickAdd,
  onSavePlan,
  onApplyTemplate,
  onDeletePlan,
  applyToast,
  onUndoApply,
  onDismissToast,
  onOpenActivity,
  isFav,
  onToggleFav,
  byId,
}: {
  dayIndex: number;
  onDayChange: (d: number) => void;
  blocks: DaySchedule;
  weekBlocks: Record<number, DaySchedule>;
  activities: Activity[];
  allActivities: Activity[];
  query: string;
  onQueryChange: (value: string) => void;
  cat: CatFilter;
  place: PlaceFilter;
  age: AgeFilter;
  onCat: (value: CatFilter) => void;
  onPlace: (value: PlaceFilter) => void;
  onAge: (value: AgeFilter) => void;
  plans: DayTemplate[];
  openCount: number;
  onAddEvent: (draft: EventDraft) => void;
  onUpdateEvent: (blockId: string, patch: Partial<ScheduleBlock>) => void;
  onRemoveEvent: (blockId: string) => void;
  onQuickAdd: (activityId: string) => void;
  onSavePlan: (name: string) => void;
  onApplyTemplate: (templateId: string, targetDays: number[], mode: ApplyMode) => void;
  onDeletePlan: (planId: string) => void;
  applyToast: string | null;
  onUndoApply: () => void;
  onDismissToast: () => void;
  onOpenActivity: (activity: Activity) => void;
  isFav: (id: string) => boolean;
  onToggleFav: (id: string) => void;
  byId: Record<string, Activity>;
}) {
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [applyTemplateId, setApplyTemplateId] = useState<string | null>(null);
  const [composer, setComposer] = useState<{
    blockId?: string;
    tab: "library" | "custom" | "open";
    activityId?: string;
    label: string;
    start: string;
    durationMin: number;
    category?: CategoryId;
    rule?: ConditionalRule;
  } | null>(null);

  const gridRef = useRef<HTMLDivElement | null>(null);
  const calScrollRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [drag, setDragInternal] = useState<DragState | null>(null);
  const suppressClickRef = useRef(false);
  const lastPointerRef = useRef({ x: 0, y: 0 });
  const autoScrollRaf = useRef<number | null>(null);

  // Keep the latest props/handlers reachable from the window listeners without re-binding.
  const handlersRef = useRef({ onAddEvent, onUpdateEvent, onOpenActivity, blocks, byId });
  handlersRef.current = { onAddEvent, onUpdateEvent, onOpenActivity, blocks, byId };

  function setDrag(next: DragState | null) {
    dragRef.current = next;
    setDragInternal(next);
  }

  const filled = blocks.length;

  // The bounded camp-day window (8:00–17:00) fits without the old 24h-grid
  // scroll-anchoring hack, so the calendar simply starts at the top of the day.

  function clientYToMin(clientY: number): number {
    const el = gridRef.current;
    if (!el) return DAY_START_MIN;
    const rect = el.getBoundingClientRect();
    const ratio = (clientY - rect.top) / rect.height;
    return DAY_START_MIN + ratio * TOTAL_MIN;
  }

  function isOverGrid(x: number, y: number): boolean {
    const el = gridRef.current;
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function handleEventClick(blockId: string) {
    const block = handlersRef.current.blocks.find((b) => b.id === blockId);
    if (!block) return;
    openEditComposer(block);
  }

  function suppressNextGridClick() {
    suppressClickRef.current = true;
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  }

  // Global pointer listeners drive every drag (move / resize / create from library).
  useEffect(() => {
    const EDGE = 52; // px from a calendar edge that triggers auto-scroll while dragging

    // Recompute the live drag preview from a pointer position — shared by pointermove
    // and the auto-scroll loop so dragging near an edge keeps updating as it scrolls.
    function computeAt(clientX: number, clientY: number) {
      const current = dragRef.current;
      if (!current) return;
      if (current.type === "move") {
        const raw = clientYToMin(clientY) - current.grabOffsetMin;
        const startMin = clampStart(snapMinutes(raw), current.durationMin);
        setDrag({
          ...current,
          startMin,
          endMin: startMin + current.durationMin,
          moved: current.moved || startMin !== current.startMin,
        });
      } else if (current.type === "resize") {
        const raw = clientYToMin(clientY);
        const endMin = Math.min(
          DAY_END_MIN,
          Math.max(current.startMin + MIN_DURATION_MIN, snapMinutes(raw))
        );
        setDrag({ ...current, endMin });
      } else {
        const over = isOverGrid(clientX, clientY);
        const startMin = clampStart(snapMinutes(clientYToMin(clientY)), current.durationMin);
        setDrag({
          ...current,
          clientX,
          clientY,
          over,
          startMin,
          endMin: startMin + current.durationMin,
        });
      }
    }

    function stopAutoScroll() {
      if (autoScrollRaf.current != null) {
        window.cancelAnimationFrame(autoScrollRaf.current);
        autoScrollRaf.current = null;
      }
    }

    // While a drag is held near the top/bottom of the (scrollable) calendar, scroll
    // it so off-screen times are reachable on a phone — the key touch fix.
    function autoScrollStep() {
      const sc = calScrollRef.current;
      if (!sc || !dragRef.current) {
        stopAutoScroll();
        return;
      }
      const rect = sc.getBoundingClientRect();
      const { x, y } = lastPointerRef.current;
      let dir = 0;
      if (y < rect.top + EDGE) dir = -1;
      else if (y > rect.bottom - EDGE) dir = 1;
      if (dir === 0) {
        stopAutoScroll();
        return;
      }
      const before = sc.scrollTop;
      const max = sc.scrollHeight - sc.clientHeight;
      sc.scrollTop = Math.max(0, Math.min(max, sc.scrollTop + dir * 12));
      if (sc.scrollTop !== before) computeAt(x, y);
      autoScrollRaf.current = window.requestAnimationFrame(autoScrollStep);
    }

    function maybeAutoScroll() {
      const sc = calScrollRef.current;
      if (!sc || !dragRef.current) return;
      const rect = sc.getBoundingClientRect();
      const y = lastPointerRef.current.y;
      const nearEdge = y < rect.top + EDGE || y > rect.bottom - EDGE;
      if (nearEdge && autoScrollRaf.current == null) {
        autoScrollRaf.current = window.requestAnimationFrame(autoScrollStep);
      } else if (!nearEdge) {
        stopAutoScroll();
      }
    }

    function onMove(event: PointerEvent) {
      const current = dragRef.current;
      if (!current) return;
      event.preventDefault();
      lastPointerRef.current = { x: event.clientX, y: event.clientY };
      computeAt(event.clientX, event.clientY);
      maybeAutoScroll();
    }

    function onUp() {
      const current = dragRef.current;
      if (!current) return;
      const handlers = handlersRef.current;

      if (current.type === "move") {
        if (current.moved) {
          suppressNextGridClick();
          handlers.onUpdateEvent(current.blockId, {
            start: minutesToCamp(current.startMin),
            end: minutesToCamp(current.endMin),
          });
        } else {
          handleEventClick(current.blockId);
        }
      } else if (current.type === "resize") {
        suppressNextGridClick();
        handlers.onUpdateEvent(current.blockId, { end: minutesToCamp(current.endMin) });
      } else if (current.over) {
        suppressNextGridClick();
        handlers.onAddEvent({
          kind: "activity",
          activityId: current.activity.id,
          label: current.activity.title,
          start: minutesToCamp(current.startMin),
          end: minutesToCamp(current.endMin),
        });
      }
      stopAutoScroll();
      setDrag(null);
    }

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      stopAutoScroll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startMove(event: ReactPointerEvent, block: ScheduleBlock) {
    if (event.button != null && event.button !== 0) return;
    const startMin = blockStartMin(block);
    const endMin = blockEndMin(block);
    setDrag({
      type: "move",
      blockId: block.id,
      grabOffsetMin: clientYToMin(event.clientY) - startMin,
      durationMin: endMin - startMin,
      startMin,
      endMin,
      moved: false,
    });
  }

  function startResize(event: ReactPointerEvent, block: ScheduleBlock) {
    event.stopPropagation();
    setDrag({
      type: "resize",
      blockId: block.id,
      startMin: blockStartMin(block),
      endMin: blockEndMin(block),
    });
  }

  function startLibraryDrag(event: ReactPointerEvent, activity: Activity) {
    event.preventDefault();
    const durationMin = Math.max(MIN_DURATION_MIN, activity.durationMin);
    setDrag({
      type: "create",
      activity,
      durationMin,
      startMin: DAY_START_MIN,
      endMin: DAY_START_MIN + durationMin,
      clientX: event.clientX,
      clientY: event.clientY,
      over: false,
    });
  }

  function openAddComposer(startMin?: number) {
    const start = startMin == null ? nextFreeStart(blocks, DEFAULT_DURATION_MIN) : startMin;
    setComposer({
      tab: "library",
      label: "",
      start: minutesToCamp(clampStart(snapMinutes(start), DEFAULT_DURATION_MIN)),
      durationMin: DEFAULT_DURATION_MIN,
    });
  }

  function openEditComposer(block: ScheduleBlock) {
    const startMin = blockStartMin(block);
    const durationMin = blockEndMin(block) - startMin;
    // A plain open slot opens on Library (pre-filtered) so the dominant action is
    // "choose the activity that fills it"; a conditional slot opens on Open slot so
    // its per-weekday rule is editable.
    const tab: "library" | "custom" | "open" =
      block.kind === "label" ? "custom" : block.fill === "conditional" ? "open" : "library";
    setComposer({
      blockId: block.id,
      tab,
      activityId: block.activityId,
      label: block.label,
      start: minutesToCamp(startMin),
      durationMin,
      category: block.category,
      rule: block.rule,
    });
  }

  function handleGridClick(event: React.MouseEvent) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (event.target !== event.currentTarget) return;
    openAddComposer(clientYToMin(event.clientY));
  }

  function submitComposer(draft: EventDraft, blockId?: string) {
    if (blockId) {
      onUpdateEvent(blockId, {
        kind: draft.kind,
        label: draft.label,
        start: draft.start,
        end: draft.end,
        activityId: draft.kind === "activity" ? draft.activityId : undefined,
        fill: draft.fill ?? "fixed",
        category: draft.category,
        rule: draft.rule,
      });
    } else {
      onAddEvent(draft);
    }
    setComposer(null);
  }

  // Build positioned events, applying any live drag preview.
  const positioned = useMemo(() => {
    const items: Omit<Laid, "col" | "cols">[] = blocks.map((block) => {
      if (drag && (drag.type === "move" || drag.type === "resize") && drag.blockId === block.id) {
        return { block, startMin: drag.startMin, endMin: drag.endMin, dragging: true };
      }
      return { block, startMin: blockStartMin(block), endMin: blockEndMin(block) };
    });
    if (drag && drag.type === "create" && drag.over) {
      items.push({ block: null, startMin: drag.startMin, endMin: drag.endMin, ghost: true, dragging: true });
    }
    return layoutEvents(items);
  }, [blocks, drag]);

  const marks = hourMarks();

  return (
    <div className="planner planner--calendar fadein">
      <div className="cal-head">
        <div className="cal-head__copy">
          <span className="cal-head__kicker">Build the day</span>
          <h2 className="cal-head__title">{DAYS[dayIndex]}</h2>
          <span className="cal-head__sub">
            {filled} {filled === 1 ? "event" : "events"} planned
          </span>
        </div>
        <div className="cal-head__tools">
          <div className="daynav">
            <button
              type="button"
              className="icon-btn"
              onClick={() => onDayChange(-1)}
              aria-label="Previous day"
              disabled={dayIndex === 0}
            >
              <CampIcon.ChevronLeft />
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={() => onDayChange(1)}
              aria-label="Next day"
              disabled={dayIndex === DAYS.length - 1}
            >
              <CampIcon.ChevronRight />
            </button>
          </div>
          <button type="button" className="btn btn--primary cal-add-btn" onClick={() => openAddComposer()}>
            <CampIcon.Plus />
            Add event
          </button>
        </div>
      </div>

      <div className="day-carousel cal-days" aria-label="Week days">
        {DAYS.map((day, index) => {
          const planned = (weekBlocks[index] || []).filter(
            (block) => block.kind === "activity" && block.activityId
          ).length;
          return (
            <button
              type="button"
              key={day}
              className={"day-chip" + (index === dayIndex ? " is-active" : "")}
              onClick={() => onDayChange(index - dayIndex)}
              aria-current={index === dayIndex ? "date" : undefined}
            >
              <span>{day.slice(0, 3)}</span>
              <strong>{index + 1}</strong>
              <small>{planned || "–"}</small>
            </button>
          );
        })}
      </div>

      <div className="schedule-workbench">
        <section className="cal" ref={calScrollRef} aria-label={DAYS[dayIndex] + " calendar"}>
          <div className="cal-axis" aria-hidden="true">
            {marks.map((mark) => (
              <span key={mark.min} className="cal-axis__mark" style={{ top: pct(mark.min) + "%" }}>
                {mark.label}
              </span>
            ))}
          </div>

          <div className="cal-grid" ref={gridRef} onClick={handleGridClick}>
            {marks.map((mark) => (
              <span
                key={mark.min}
                className={"cal-line" + (mark.min === DAY_END_MIN ? " cal-line--last" : "")}
                style={{ top: pct(mark.min) + "%" }}
              />
            ))}
            {marks.slice(0, -1).map((mark) => (
              <span key={"half-" + mark.min} className="cal-line cal-line--half" style={{ top: pct(mark.min + 30) + "%" }} />
            ))}

            {positioned.map((item) => {
              const style: CSSProperties = {
                top: pct(item.startMin) + "%",
                height: "calc(" + ((item.endMin - item.startMin) / TOTAL_MIN) * 100 + "% - 4px)",
                left: "calc(" + (item.col / item.cols) * 100 + "% + 3px)",
                width: "calc(" + 100 / item.cols + "% - 6px)",
              };

              if (item.ghost) {
                return (
                  <div key="ghost" className="cal-event cal-event--ghost" style={style}>
                    <span className="cal-event__time">{formatRange(item.startMin, item.endMin)}</span>
                    <span className="cal-event__title">{drag && drag.type === "create" ? drag.activity.title : ""}</span>
                  </div>
                );
              }

              const block = item.block as ScheduleBlock;
              const activity = block.activityId ? byId[block.activityId] : null;
              const isLabel = block.kind === "label";
              const isOpen = (block.fill === "open" || block.fill === "conditional") && !activity;
              const isCustom = isLabel;
              const duration = item.endMin - item.startMin;
              const short = duration <= 20;
              const compact = duration <= 40;
              const tint = activity
                ? categoryTint(activity.type)
                : isOpen && block.category
                  ? categoryTint(block.category)
                  : undefined;
              const title = activity
                ? activity.title
                : isOpen
                  ? "Choose a " + (block.category ? CAT_LABEL[block.category] : "activity")
                  : block.label;
              const eventStyle: CSSProperties = tint
                ? { ...style, ["--cat" as string]: tint }
                : style;

              return (
                <div
                  key={block.id}
                  className={
                    "cal-event" +
                    (isOpen
                      ? " cal-event--open"
                      : isCustom
                        ? " cal-event--custom"
                        : " cal-event--activity") +
                    (item.dragging ? " is-dragging" : "") +
                    (short ? " cal-event--short" : compact ? " cal-event--compact" : "")
                  }
                  style={eventStyle}
                  role="button"
                  tabIndex={0}
                  aria-label={
                    (isOpen ? "Fill " : "Edit ") + title + " from " + formatRange(item.startMin, item.endMin)
                  }
                  onPointerDown={(event) => startMove(event, block)}
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      handleEventClick(block.id);
                    }
                  }}
                >
                  <div className="cal-event__body">
                    <span className="cal-event__time">{formatRange(item.startMin, item.endMin)}</span>
                    <span className="cal-event__title">{title}</span>
                    {activity && <span className="cal-event__meta">{activityMeta(activity)}</span>}
                    {isOpen && <span className="cal-event__meta">tap to choose</span>}
                  </div>
                  <button
                    type="button"
                    className="cal-event__remove"
                    aria-label={"Remove " + title}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      onRemoveEvent(block.id);
                    }}
                  >
                    <CampIcon.Close />
                  </button>
                  <span
                    className="cal-event__resize"
                    aria-hidden="true"
                    onPointerDown={(event) => startResize(event, block)}
                  />
                </div>
              );
            })}

            {!positioned.length && (
              <div className="cal-empty">
                <CampIcon.Calendar />
                <p>Nothing planned yet.</p>
                <span>Tap a time, drag an activity in, or use “Add event.”</span>
              </div>
            )}
            {openCount > 0 && (
              <span className="cal-openflag" aria-hidden="true">
                {openCount} to fill
              </span>
            )}
          </div>
        </section>

        <ScheduleLibrary
          isOpen={libraryOpen}
          activities={activities}
          query={query}
          onQueryChange={onQueryChange}
          cat={cat}
          place={place}
          age={age}
          onCat={onCat}
          onPlace={onPlace}
          onAge={onAge}
          plans={plans}
          dayName={DAYS[dayIndex]}
          onToggle={() => setLibraryOpen((open) => !open)}
          onOpenActivity={onOpenActivity}
          onQuickAdd={onQuickAdd}
          onStartDrag={startLibraryDrag}
          onSavePlan={onSavePlan}
          onRequestApply={(planId) => setApplyTemplateId(planId)}
          onDeletePlan={onDeletePlan}
          isFav={isFav}
          onToggleFav={onToggleFav}
        />
      </div>

      {drag && drag.type === "create" && (
        <div
          className="cal-drag-ghost"
          style={{ left: drag.clientX, top: drag.clientY }}
          aria-hidden="true"
        >
          {drag.activity.title}
        </div>
      )}

      {composer && (
        <EventComposer
          dayName={DAYS[dayIndex]}
          allActivities={allActivities}
          initial={composer}
          onSubmit={submitComposer}
          onClose={() => setComposer(null)}
        />
      )}

      {applyTemplateId &&
        (() => {
          const tpl = plans.find((p) => p.id === applyTemplateId);
          if (!tpl) return null;
          return (
            <ApplySheet
              template={tpl}
              dayIndex={dayIndex}
              weekBlocks={weekBlocks}
              onConfirm={(targetDays, mode) => {
                onApplyTemplate(tpl.id, targetDays, mode);
                setApplyTemplateId(null);
              }}
              onClose={() => setApplyTemplateId(null)}
            />
          );
        })()}

      {applyToast && (
        <div className="apply-toast" role="status">
          <span>{applyToast}</span>
          <button type="button" onClick={onUndoApply}>
            Undo
          </button>
          <button
            type="button"
            className="apply-toast__close"
            onClick={onDismissToast}
            aria-label="Dismiss"
          >
            <CampIcon.Close />
          </button>
        </div>
      )}
    </div>
  );
}
