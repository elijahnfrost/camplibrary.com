"use client";

import { useMemo, useState } from "react";
import type {
  Activity,
  DaySchedule,
  LibraryView,
  SavedDayPlan,
  Schedule,
  ScheduleBlock,
  ScheduleBlockKind,
  TabId,
} from "@/lib/types";
import { ACTIVITIES, DAY_BLOCK_TEMPLATE, DAYS, DEFAULT_SCHEDULE } from "@/lib/data";
import {
  campMinutes,
  MIN_DURATION_MIN,
  minutesToCamp,
  nextFreeStart,
} from "@/lib/scheduleTime";
import { matchesActivityFilters } from "@/lib/activityFilters";
import { useLocalStorage } from "@/lib/store";
import { CampIcon } from "./icons";
import { HomeView } from "./HomeView";
import { CatalogView, DeckView, ShelfView } from "./LibraryViews";
import { ScheduleView, type EventDraft } from "./ScheduleView";
import { SavedView } from "./SavedView";
import { AddView } from "./AddView";
import { DetailSheet } from "./DetailSheet";
import { Filters, type AgeFilter, type CatFilter, type PlaceFilter } from "./Filters";

const TABS: { id: TabId; label: string; icon: (typeof CampIcon)[keyof typeof CampIcon] }[] = [
  { id: "home", label: "Home", icon: CampIcon.Home },
  { id: "library", label: "Library", icon: CampIcon.Library },
  { id: "schedule", label: "Schedule", icon: CampIcon.Calendar },
  { id: "saved", label: "Saved", icon: CampIcon.Bookmark },
  { id: "add", label: "Add", icon: CampIcon.Plus },
];

function cloneBlocks(blocks: DaySchedule): DaySchedule {
  return blocks.map((block) => ({ ...block }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeBlock(value: unknown, index: number): ScheduleBlock | null {
  if (!isRecord(value)) return null;
  const kind: ScheduleBlockKind = value.kind === "label" ? "label" : "activity";
  const label =
    typeof value.label === "string" && value.label.trim()
      ? value.label.trim()
      : kind === "label"
        ? "Schedule note"
        : "Activity block";
  const block: ScheduleBlock = {
    id: typeof value.id === "string" && value.id ? value.id : "block-" + index,
    start: typeof value.start === "string" ? value.start : "",
    end: typeof value.end === "string" ? value.end : "",
    kind,
    label,
  };
  if (kind === "activity" && typeof value.activityId === "string" && value.activityId) {
    block.activityId = value.activityId;
  }
  return block;
}

function defaultBlocksForDay(dayIndex: number): DaySchedule {
  return cloneBlocks(DEFAULT_SCHEDULE[dayIndex] || DAY_BLOCK_TEMPLATE);
}

function normalizeDaySchedule(raw: unknown, dayIndex: number): DaySchedule {
  if (Array.isArray(raw)) {
    if (!raw.length) return [];
    const blocks = raw.map(normalizeBlock).filter((block): block is ScheduleBlock => Boolean(block));
    return blocks.length ? blocks : defaultBlocksForDay(dayIndex);
  }

  if (isRecord(raw)) {
    return defaultBlocksForDay(dayIndex).map((block) => {
      const legacyActivityId = raw[block.id];
      return block.kind === "activity" && typeof legacyActivityId === "string"
        ? { ...block, activityId: legacyActivityId }
        : block;
    });
  }

  return defaultBlocksForDay(dayIndex);
}

function orderBlocks(blocks: DaySchedule): DaySchedule {
  return [...blocks].sort((a, b) => campMinutes(a.start) - campMinutes(b.start));
}

function createScheduleBlock({
  kind,
  start,
  end,
  label,
  activityId,
}: {
  kind: ScheduleBlockKind;
  start: string;
  end: string;
  label: string;
  activityId?: string;
}): ScheduleBlock {
  const fallback = kind === "label" ? "Schedule note" : "Activity block";
  return {
    id: "custom-" + kind + "-" + Date.now().toString(36),
    start: start.trim(),
    end: end.trim(),
    kind,
    label: label.trim() || fallback,
    ...(activityId ? { activityId } : {}),
  };
}

export function CampApp() {
  const [tab, setTab] = useState<TabId>("home");
  const [view, setView] = useLocalStorage<LibraryView>("view", "deck");
  const [cat, setCat] = useState<CatFilter>("All");
  const [place, setPlace] = useState<PlaceFilter>("All");
  const [age, setAge] = useState<AgeFilter>("All");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  const [favs, setFavs] = useLocalStorage<string[]>("favs", []);
  const [extra, setExtra] = useLocalStorage<Activity[]>("extra", []);
  const [schedule, setSchedule] = useLocalStorage<Schedule>("schedule", DEFAULT_SCHEDULE);
  const [schedulePlans, setSchedulePlans] = useLocalStorage<SavedDayPlan[]>("schedulePlans", []);
  const [dayIndex, setDayIndex] = useState(2);

  const [detail, setDetail] = useState<Activity | null>(null);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const [ratings, setRatings] = useLocalStorage<Record<string, number>>("ratings", {});

  const all = useMemo(() => {
    const base = [...extra, ...ACTIVITIES];
    return base.map((a) => (ratings[a.id] != null ? { ...a, rating: ratings[a.id] } : a));
  }, [extra, ratings]);

  const byId = useMemo(() => {
    const m: Record<string, Activity> = {};
    all.forEach((a) => (m[a.id] = a));
    return m;
  }, [all]);

  const isFav = (id: string) => favs.indexOf(id) !== -1;
  const toggleFav = (id: string) =>
    setFavs((p) => (p.indexOf(id) !== -1 ? p.filter((x) => x !== id) : [id, ...p]));
  const setRating = (id: string, val: number) => setRatings((p) => ({ ...p, [id]: val }));

  const filtered = useMemo(() => {
    return all.filter((a) => matchesActivityFilters(a, { cat, place, age, query }));
  }, [all, cat, place, age, query]);

  const dayBlocks = useMemo(
    () => normalizeDaySchedule(schedule[dayIndex], dayIndex),
    [dayIndex, schedule]
  );
  const weekBlocks = useMemo(() => {
    const days: Record<number, DaySchedule> = {};
    DAYS.forEach((_, index) => {
      days[index] = normalizeDaySchedule(schedule[index], index);
    });
    return days;
  }, [schedule]);
  const plannedCount = dayBlocks.filter((block) => block.kind === "activity" && block.activityId).length;
  const labelCount = dayBlocks.filter((block) => block.kind === "label").length;

  function saveBlocksForDay(targetDayIndex: number, blocks: DaySchedule, ordered = true) {
    setSchedule((p) => ({ ...p, [targetDayIndex]: ordered ? orderBlocks(blocks) : blocks }));
  }

  function addEventToDay(targetDayIndex: number, draft: EventDraft) {
    const targetBlocks = normalizeDaySchedule(schedule[targetDayIndex], targetDayIndex);
    const block = createScheduleBlock({
      kind: draft.kind,
      start: draft.start,
      end: draft.end,
      label: draft.label,
      activityId: draft.kind === "activity" ? draft.activityId : undefined,
    });
    saveBlocksForDay(targetDayIndex, [...targetBlocks, block]);
  }

  function updateEvent(targetDayIndex: number, blockId: string, patch: Partial<ScheduleBlock>) {
    const targetBlocks = normalizeDaySchedule(schedule[targetDayIndex], targetDayIndex);
    saveBlocksForDay(
      targetDayIndex,
      targetBlocks.map((block) => {
        if (block.id !== blockId) return block;
        const merged: ScheduleBlock = { ...block, ...patch };
        // A custom (label) event never keeps an activity reference.
        if (merged.kind === "label" || ("activityId" in patch && !patch.activityId)) {
          delete merged.activityId;
        }
        return merged;
      })
    );
  }

  function removeEvent(targetDayIndex: number, blockId: string) {
    const targetBlocks = normalizeDaySchedule(schedule[targetDayIndex], targetDayIndex);
    saveBlocksForDay(
      targetDayIndex,
      targetBlocks.filter((block) => block.id !== blockId),
      false
    );
  }

  function quickAddActivity(targetDayIndex: number, activityId: string) {
    const activity = byId[activityId];
    if (!activity) return;
    const targetBlocks = normalizeDaySchedule(schedule[targetDayIndex], targetDayIndex);
    const duration = Math.max(MIN_DURATION_MIN, activity.durationMin);
    const start = nextFreeStart(targetBlocks, duration);
    addEventToDay(targetDayIndex, {
      kind: "activity",
      activityId,
      label: activity.title,
      start: minutesToCamp(start),
      end: minutesToCamp(start + duration),
    });
  }

  function addToSchedule(a: Activity) {
    quickAddActivity(dayIndex, a.id);
    setJustAdded(a.id);
  }

  function saveCurrentDayPlan(name: string) {
    const trimmed = name.trim();
    setSchedulePlans((plans) => [
      {
        id: "plan-" + Date.now().toString(36),
        name: trimmed || DAYS[dayIndex] + " plan",
        blocks: cloneBlocks(dayBlocks),
        createdAt: Date.now(),
      },
      ...plans,
    ]);
  }

  function applyDayPlan(planId: string, targetDayIndex: number) {
    const plan = schedulePlans.find((item) => item.id === planId);
    if (!plan) return;
    const targetBlocks = normalizeDaySchedule(schedule[targetDayIndex], targetDayIndex);
    const hasPlannedActivities = targetBlocks.some((block) => block.kind === "activity" && block.activityId);
    if (
      hasPlannedActivities &&
      !window.confirm("Replace the activities planned for " + DAYS[targetDayIndex] + " with " + plan.name + "?")
    ) {
      return;
    }
    saveBlocksForDay(targetDayIndex, cloneBlocks(plan.blocks));
  }

  function deleteDayPlan(planId: string) {
    setSchedulePlans((plans) => plans.filter((plan) => plan.id !== planId));
  }

  function changeDay(d: number) {
    setDayIndex((i) => Math.max(0, Math.min(DAYS.length - 1, i + d)));
  }

  function printCurrentView() {
    window.print();
  }

  function openDetail(a: Activity) {
    setJustAdded(null);
    setDetail(a);
  }

  const pageByTab: Record<TabId, { kicker: string; title: string; summary: string }> = {
    home: {
      kicker: "Today at a glance",
      title: "Home",
      summary: "Find, save, rate, and schedule camp activities.",
    },
    library: {
      kicker: "Camp Library · " + filtered.length + " activities",
      title: "Library",
      summary: "Browse, filter, rate, and save dependable camp activities.",
    },
    schedule: {
      kicker: "Week 1 planner",
      title: "Schedule",
      summary:
        plannedCount +
        " planned · " +
        labelCount +
        (labelCount === 1 ? " label" : " labels"),
    },
    saved: {
      kicker: favs.length + " starred",
      title: "Saved",
      summary: "A shortlist for quick substitutions and rainy-day planning.",
    },
    add: {
      kicker: "Catalog something",
      title: "New Activity",
      summary: "Add a tested activity, quiet filler, song, craft, or camp game.",
    },
  };
  const page = pageByTab[tab];

  return (
    <div className="stage">
      <div className="app">
        <nav className="sidenav" aria-label="Primary">
          <button
            type="button"
            className={"sidenav__brand" + (tab === "home" ? " is-active" : "")}
            onClick={() => setTab("home")}
            aria-current={tab === "home" ? "page" : undefined}
          >
            <img className="sidenav__logo" src="/logo-mark.svg" alt="" aria-hidden="true" />
            <span className="sidenav__brand-copy">
              <span className="sidenav__kicker">The counselor&rsquo;s kit</span>
              <span className="sidenav__title">
                Camp <em>Library</em>
              </span>
            </span>
          </button>
          <div className="sidenav__nav">
            {TABS.filter((t) => t.id !== "home").map((t) => (
              <button
                key={t.id}
                type="button"
                className={"sidenav__item" + (tab === t.id ? " is-active" : "")}
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? "page" : undefined}
              >
                <t.icon />
                <span>{t.label}</span>
              </button>
            ))}
          </div>
          {tab === "library" && (
            <Filters
              variant="rail"
              cat={cat}
              place={place}
              age={age}
              onCat={setCat}
              onPlace={setPlace}
              onAge={setAge}
            />
          )}
          <div className="sidenav__foot">
            {all.length} in the library · {favs.length} saved
          </div>
        </nav>

        <div className="app__main">
          <div
            className={
              "topbar" +
              (tab === "home" ? " topbar--home" : "") +
              (tab === "schedule" ? " topbar--planner" : "")
            }
            data-export-scope={tab}
            data-export-format="print-bw"
            data-export-title={page.title}
          >
            <div className="topbar__brand">
              <span className="topbar__kicker">{page.kicker}</span>
              <span className="topbar__title">{page.title}</span>
              <span className="topbar__summary">{page.summary}</span>
            </div>
            <div className="topbar__actions">
              {tab !== "home" && (
                <button
                  type="button"
                  className="icon-btn print-btn"
                  onClick={printCurrentView}
                  aria-label={"Print " + page.title}
                  title="Print or export this view"
                  data-export-action="print-current-view"
                >
                  <CampIcon.Print />
                </button>
              )}
              {tab === "library" && (
                <button
                  type="button"
                  className={"icon-btn topbar__search-toggle" + (searchOpen ? " is-on" : "")}
                  onClick={() => {
                    setSearchOpen((s) => !s);
                    if (searchOpen) setQuery("");
                  }}
                  aria-label="Search"
                  aria-pressed={searchOpen}
                >
                  <CampIcon.Search />
                </button>
              )}
            </div>
          </div>

          {tab === "library" && (
            <>
              <div className="toolbar">
                <div className="viewswitch">
                  <button
                    type="button"
                    className={view === "shelf" ? "is-active" : ""}
                    onClick={() => setView("shelf")}
                  >
                    <CampIcon.Shelf />
                    Shelf
                  </button>
                  <button
                    type="button"
                    className={view === "deck" ? "is-active" : ""}
                    onClick={() => setView("deck")}
                  >
                    <CampIcon.Deck />
                    Deck
                  </button>
                  <button
                    type="button"
                    className={view === "catalog" ? "is-active" : ""}
                    onClick={() => setView("catalog")}
                  >
                    <CampIcon.List />
                    Catalog
                  </button>
                </div>
                <div className="toolbar__search">
                  <CampIcon.Search />
                  <input
                    className="toolbar__search-input"
                    placeholder="Search titles, tags, materials..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label="Search the library"
                  />
                </div>
              </div>
              {searchOpen && (
                <div style={{ padding: "12px 18px 0" }} className="searchrow fadein">
                  <input
                    className="input"
                    autoFocus
                    placeholder="Search titles, tags, materials..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
              )}
              <Filters
                variant="bar"
                cat={cat}
                place={place}
                age={age}
                onCat={setCat}
                onPlace={setPlace}
                onAge={setAge}
              />
            </>
          )}

          <div className="app__scroll">
            {tab === "home" && (
              <HomeView
                activityCount={all.length}
                savedCount={favs.length}
                plannedCount={plannedCount}
                onGo={(target) => {
                  setTab(target);
                  if (target === "library") {
                    setCat("All");
                    setView("deck");
                  }
                }}
              />
            )}
            {tab === "library" && view === "shelf" && (
              <ShelfView items={filtered} onOpen={openDetail} isFav={isFav} onToggleFav={toggleFav} />
            )}
            {tab === "library" && view === "deck" && (
              <DeckView items={filtered} onOpen={openDetail} isFav={isFav} onToggleFav={toggleFav} />
            )}
            {tab === "library" && view === "catalog" && (
              <CatalogView items={filtered} onOpen={openDetail} isFav={isFav} onToggleFav={toggleFav} />
            )}
            {tab === "schedule" && (
              <ScheduleView
                dayIndex={dayIndex}
                onDayChange={changeDay}
                blocks={dayBlocks}
                weekBlocks={weekBlocks}
                activities={filtered}
                allActivities={all}
                query={query}
                onQueryChange={setQuery}
                cat={cat}
                place={place}
                age={age}
                onCat={setCat}
                onPlace={setPlace}
                onAge={setAge}
                plans={schedulePlans}
                onAddEvent={(draft) => addEventToDay(dayIndex, draft)}
                onUpdateEvent={(blockId, patch) => updateEvent(dayIndex, blockId, patch)}
                onRemoveEvent={(blockId) => removeEvent(dayIndex, blockId)}
                onQuickAdd={(activityId) => quickAddActivity(dayIndex, activityId)}
                onSavePlan={saveCurrentDayPlan}
                onApplyPlan={(planId) => applyDayPlan(planId, dayIndex)}
                onDeletePlan={deleteDayPlan}
                onOpenActivity={openDetail}
                isFav={isFav}
                onToggleFav={toggleFav}
                byId={byId}
              />
            )}
            {tab === "saved" && (
              <SavedView items={all} onOpen={openDetail} isFav={isFav} onToggleFav={toggleFav} />
            )}
            {tab === "add" && (
              <AddView
                onSubmit={(a) => {
                  setExtra((p) => [a, ...p]);
                  setTab("library");
                  setCat("All");
                  setView("catalog");
                }}
              />
            )}
          </div>
        </div>

        <nav className="tabbar" aria-label="Primary">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={tab === t.id ? "is-active" : ""}
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? "page" : undefined}
            >
              <t.icon /> {t.label}
            </button>
          ))}
        </nav>

        {detail && (
          <DetailSheet
            activity={byId[detail.id] || detail}
            isFav={isFav}
            onToggleFav={toggleFav}
            onClose={() => setDetail(null)}
            onAddToSchedule={addToSchedule}
            added={justAdded === detail.id ? "added" : justAdded === "full" ? "full" : false}
            onSetRating={setRating}
          />
        )}
      </div>
    </div>
  );
}
