"use client";

import { useMemo, useState } from "react";
import type { Activity, DaySchedule, LibraryView, Schedule, ScheduleBlock, ScheduleBlockKind, TabId } from "@/lib/types";
import { ACTIVITIES, DAY_BLOCK_TEMPLATE, DAYS, DEFAULT_SCHEDULE } from "@/lib/data";
import { matchesActivityFilters } from "@/lib/activityFilters";
import { useLocalStorage } from "@/lib/store";
import { CampIcon } from "./icons";
import { HomeView } from "./HomeView";
import { CatalogView, DeckView, ShelfView } from "./LibraryViews";
import { ScheduleView } from "./ScheduleView";
import { SavedView } from "./SavedView";
import { AddView } from "./AddView";
import { DetailSheet } from "./DetailSheet";
import { ActivityPicker } from "./ActivityPicker";
import { Filters, type AgeFilter, type CatFilter, type PlaceFilter } from "./Filters";

const TABS: { id: TabId; label: string; icon: (typeof CampIcon)[keyof typeof CampIcon] }[] = [
  { id: "home", label: "Home", icon: CampIcon.Home },
  { id: "library", label: "Library", icon: CampIcon.Library },
  { id: "schedule", label: "Schedule", icon: CampIcon.Calendar },
  { id: "saved", label: "Saved", icon: CampIcon.Bookmark },
  { id: "add", label: "Add", icon: CampIcon.Plus },
];

type PickerTarget = {
  dayIndex: number;
  block: ScheduleBlock;
};

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

function campMinutes(time: string): number {
  const match = time.match(/^(\d{1,2})(?::(\d{2}))?/);
  if (!match) return Number.MAX_SAFE_INTEGER;
  let hour = parseInt(match[1], 10);
  const minute = match[2] ? parseInt(match[2], 10) : 0;
  if (hour > 0 && hour < 6) hour += 12;
  return hour * 60 + minute;
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
  const [dayIndex, setDayIndex] = useState(2);

  const [detail, setDetail] = useState<Activity | null>(null);
  const [pickerBlock, setPickerBlock] = useState<PickerTarget | null>(null);
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

  function saveDayBlocks(blocks: DaySchedule, ordered = true) {
    saveBlocksForDay(dayIndex, blocks, ordered);
  }

  function addToSchedule(a: Activity) {
    const emptyIndex = dayBlocks.findIndex((block) => block.kind === "activity" && !block.activityId);
    if (emptyIndex >= 0) {
      const next = dayBlocks.map((block, index) =>
        index === emptyIndex ? { ...block, activityId: a.id, label: block.label || a.title } : block
      );
      saveDayBlocks(next);
    } else {
      saveDayBlocks([
        ...dayBlocks,
        createScheduleBlock({
          kind: "activity",
          start: "",
          end: "",
          label: a.title,
          activityId: a.id,
        }),
      ]);
    }
    setJustAdded(a.id);
  }

  function clearBlockActivity(targetDayIndex: number, blockId: string) {
    const targetBlocks = normalizeDaySchedule(schedule[targetDayIndex], targetDayIndex);
    saveBlocksForDay(
      targetDayIndex,
      targetBlocks.map((block) => {
        if (block.id !== blockId || block.kind !== "activity") return block;
        const { activityId, ...rest } = block;
        return rest;
      })
    );
  }

  function pickForBlock(a: Activity) {
    if (!pickerBlock) return;
    const targetBlocks = normalizeDaySchedule(schedule[pickerBlock.dayIndex], pickerBlock.dayIndex);
    saveBlocksForDay(
      pickerBlock.dayIndex,
      targetBlocks.map((block) =>
        block.id === pickerBlock.block.id
          ? { ...block, kind: "activity", activityId: a.id, label: block.label || a.title }
          : block
      )
    );
    setPickerBlock(null);
  }

  function moveActivityAssignment(fromDayIndex: number, fromBlockId: string, toDayIndex: number, toBlockId: string) {
    const fromBlocks = normalizeDaySchedule(schedule[fromDayIndex], fromDayIndex);
    const toBlocks = fromDayIndex === toDayIndex ? fromBlocks : normalizeDaySchedule(schedule[toDayIndex], toDayIndex);
    const fromBlock = fromBlocks.find((block) => block.id === fromBlockId);
    const toBlock = toBlocks.find((block) => block.id === toBlockId);
    if (!fromBlock?.activityId || !toBlock || toBlock.kind !== "activity") return;

    const movedActivityId = fromBlock.activityId;
    const displacedActivityId = toBlock.activityId;

    const updateSource = (block: ScheduleBlock) => {
      if (block.id !== fromBlockId || block.kind !== "activity") return block;
      if (displacedActivityId) return { ...block, activityId: displacedActivityId };
      const { activityId, ...rest } = block;
      return rest;
    };
    const updateTarget = (block: ScheduleBlock) =>
      block.id === toBlockId && block.kind === "activity" ? { ...block, activityId: movedActivityId } : block;

    if (fromDayIndex === toDayIndex) {
      saveBlocksForDay(fromDayIndex, fromBlocks.map((block) => updateTarget(updateSource(block))));
      return;
    }

    saveBlocksForDay(fromDayIndex, fromBlocks.map(updateSource));
    saveBlocksForDay(toDayIndex, toBlocks.map(updateTarget));
  }

  function replaceDayBlocks(targetDayIndex: number, nextBlocks: DaySchedule) {
    saveBlocksForDay(targetDayIndex, nextBlocks);
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
            className={"topbar" + (tab === "schedule" ? " topbar--planner" : "")}
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
                onOpenBlock={(block, targetDayIndex) => setPickerBlock({ dayIndex: targetDayIndex, block })}
                onClearActivity={clearBlockActivity}
                onMoveActivity={moveActivityAssignment}
                onReplaceDayBlocks={replaceDayBlocks}
                onOpenActivity={openDetail}
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
        {pickerBlock && (
          <ActivityPicker
            items={all}
            onPick={pickForBlock}
            onClose={() => setPickerBlock(null)}
            slotLabel={
              pickerBlock.block.start || pickerBlock.block.end
                ? [pickerBlock.block.start, pickerBlock.block.end].filter(Boolean).join("-")
                : pickerBlock.block.label
            }
          />
        )}
      </div>
    </div>
  );
}
