"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Activity,
  ApplyMode,
  BlockFill,
  CategoryId,
  ConditionalRule,
  DaySchedule,
  DayTemplate,
  LibraryView,
  Schedule,
  ScheduleBlock,
  ScheduleBlockKind,
  TabId,
} from "@/lib/types";
import { ACTIVITIES, CATEGORIES, DAY_BLOCK_TEMPLATE, DAYS, DEFAULT_SCHEDULE } from "@/lib/data";
import {
  campMinutes,
  clampZoomIndex,
  DAY_START_MIN,
  DEFAULT_ZOOM,
  MIN_DURATION_MIN,
  minutesToCamp,
  nextFreeStart,
  normalizeTimeString,
} from "@/lib/scheduleTime";
import { matchesActivityFilters } from "@/lib/activityFilters";
import { hasRequiredMaterials, materialOptionsForActivities } from "@/lib/materials";
import { type StorageValidator, useLocalStorage } from "@/lib/store";
import { CampIcon } from "./icons";
import { HomeView } from "./HomeView";
import { CatalogView, DeckView, ShelfView } from "./LibraryViews";
import { CalendarView } from "./CalendarView";
import { ScheduleOverview } from "./ScheduleOverview";
import { type EventDraft } from "./EventComposer";
import { SavedView } from "./SavedView";
import { AddView } from "./AddView";
import { DetailSheet } from "./DetailSheet";
import { Filters, type AgeFilter, type CatFilter, type PlaceFilter } from "./Filters";
import { AuthButton, useAuthLabel, usePreviewAuth } from "./AuthControls";
import { AdminInviteCodes } from "./AdminInviteCodes";

const TABS: { id: Exclude<TabId, "admin">; label: string; icon: (typeof CampIcon)[keyof typeof CampIcon] }[] = [
  { id: "home", label: "Home", icon: CampIcon.Home },
  { id: "library", label: "Library", icon: CampIcon.Library },
  { id: "schedule", label: "Run Sheet", icon: CampIcon.List },
  { id: "calendar", label: "Planner", icon: CampIcon.Calendar },
  { id: "saved", label: "Saved", icon: CampIcon.Bookmark },
  { id: "add", label: "Add", icon: CampIcon.Plus },
];
const ADMIN_TAB: { id: TabId; label: string; icon: (typeof CampIcon)[keyof typeof CampIcon] } = {
  id: "admin",
  label: "Admin",
  icon: CampIcon.Tool,
};

function cloneBlocks(blocks: DaySchedule): DaySchedule {
  return blocks.map((block) => ({ ...block }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const CATEGORY_IDS = new Set<string>(CATEGORIES.map((c) => c.id));
const STORED_DAY_COUNT = Math.max(DAYS.length, 7);
function isCategoryId(value: unknown): value is CategoryId {
  return typeof value === "string" && CATEGORY_IDS.has(value);
}

function parseRule(value: unknown): ConditionalRule | undefined {
  if (!isRecord(value)) return undefined;
  if (value.mode === "rotate" && Array.isArray(value.pool)) {
    const pool = value.pool.filter((id): id is string => typeof id === "string" && Boolean(id));
    return pool.length ? { mode: "rotate", pool } : undefined;
  }
  if (value.mode === "byWeekday" && isRecord(value.map)) {
    const map: Partial<Record<number, string>> = {};
    for (const [key, raw] of Object.entries(value.map)) {
      const day = Number(key);
      if (Number.isInteger(day) && day >= 0 && day < STORED_DAY_COUNT && typeof raw === "string" && raw) {
        map[day] = raw;
      }
    }
    return Object.keys(map).length ? { mode: "byWeekday", map } : undefined;
  }
  if (value.mode === "byCategory" && isCategoryId(value.category)) {
    return { mode: "byCategory", category: value.category };
  }
  return undefined;
}

function normalizeBlock(value: unknown, index: number): ScheduleBlock | null {
  if (!isRecord(value)) return null;
  const kind: ScheduleBlockKind = value.kind === "label" ? "label" : "activity";
  const fill: BlockFill =
    value.fill === "open" ? "open" : value.fill === "conditional" ? "conditional" : "fixed";
  const label =
    typeof value.label === "string" && value.label.trim()
      ? value.label.trim()
      : kind === "label"
        ? "Schedule note"
        : "Activity block";
  // Canonicalize stored/legacy times to zero-padded 24h on read (one-way upgrade).
  const start =
    typeof value.start === "string" && value.start.trim() ? normalizeTimeString(value.start) : "";
  const end =
    typeof value.end === "string" && value.end.trim() ? normalizeTimeString(value.end) : "";
  const block: ScheduleBlock = {
    id: typeof value.id === "string" && value.id ? value.id : "block-" + index,
    start,
    end,
    kind,
    label,
  };
  // A filled (fixed) activity carries its activityId; open slots intentionally don't.
  if (kind === "activity" && fill === "fixed" && typeof value.activityId === "string" && value.activityId) {
    block.activityId = value.activityId;
  }
  if (fill !== "fixed") block.fill = fill;
  if ((fill === "open" || fill === "conditional") && isCategoryId(value.category)) {
    block.category = value.category;
  }
  if (fill === "conditional") {
    const rule = parseRule(value.rule);
    if (rule) block.rule = rule;
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

let blockSeq = 0;
function freshId(prefix: string): string {
  blockSeq += 1;
  return prefix + "-" + Date.now().toString(36) + "-" + blockSeq.toString(36);
}

function createScheduleBlock({
  kind,
  start,
  end,
  label,
  activityId,
  fill = "fixed",
  category,
  rule,
}: {
  kind: ScheduleBlockKind;
  start: string;
  end: string;
  label: string;
  activityId?: string;
  fill?: BlockFill;
  category?: CategoryId;
  rule?: ConditionalRule;
}): ScheduleBlock {
  const fallback = kind === "label" ? "Schedule note" : "Activity block";
  const block: ScheduleBlock = {
    id: freshId("custom-" + kind),
    start: start.trim(),
    end: end.trim(),
    kind,
    label: label.trim() || fallback,
  };
  if (fill === "fixed" && activityId) block.activityId = activityId;
  if (fill !== "fixed") block.fill = fill;
  if ((fill === "open" || fill === "conditional") && category) block.category = category;
  if (fill === "conditional" && rule) block.rule = rule;
  return block;
}

const stringArrayStorage: StorageValidator<string[]> = (value, fallback) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : fallback;

const ratingsStorage: StorageValidator<Record<string, number>> = (value, fallback) => {
  if (!isRecord(value)) return fallback;
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "number" && Number.isFinite(raw)) {
      out[key] = Math.max(0, Math.min(5, Math.round(raw)));
    }
  }
  return out;
};

function isActivity(value: unknown): value is Activity {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.type === "string" &&
    typeof value.place === "string" &&
    typeof value.durationMin === "number" &&
    Number.isFinite(value.durationMin) &&
    Array.isArray(value.materials) &&
    Array.isArray(value.steps) &&
    Array.isArray(value.ages)
  );
}

const activitiesStorage: StorageValidator<Activity[]> = (value, fallback) =>
  Array.isArray(value) ? value.filter(isActivity) : fallback;

const scheduleStorage: StorageValidator<Schedule> = (value, fallback) => {
  if (!isRecord(value)) return fallback;
  const out: Schedule = {};
  for (const [key, raw] of Object.entries(value)) {
    const day = Number(key);
    if (Number.isInteger(day) && day >= 0 && day < STORED_DAY_COUNT) {
      out[day] = normalizeDaySchedule(raw, day);
    }
  }
  return out;
};

const savedPlansStorage: StorageValidator<DayTemplate[]> = (value, fallback) => {
  if (!Array.isArray(value)) return fallback;
  return value.filter(isRecord).map((plan, index) => {
    const createdAt =
      typeof plan.createdAt === "number" && Number.isFinite(plan.createdAt) ? plan.createdAt : 0;
    return {
      id: typeof plan.id === "string" && plan.id ? plan.id : "tpl-" + index,
      name: typeof plan.name === "string" && plan.name.trim() ? plan.name.trim() : "Saved template",
      blocks: normalizeDaySchedule(plan.blocks, 0),
      createdAt,
      updatedAt:
        typeof plan.updatedAt === "number" && Number.isFinite(plan.updatedAt) ? plan.updatedAt : createdAt,
      origin: plan.origin === "scratch" ? "scratch" : "day",
    };
  });
};

const viewStorage: StorageValidator<LibraryView> = (value, fallback) =>
  value === "shelf" || value === "deck" || value === "catalog" ? value : fallback;

const zoomStorage: StorageValidator<number> = (value, fallback) =>
  typeof value === "number" && Number.isFinite(value) ? clampZoomIndex(value) : fallback;

const SCHEDULE_SEED_VERSION = "3";

function isLegacyOneDaySeed(raw: string | null): boolean {
  if (raw == null) return true;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return false;
    const populatedDays = Object.entries(parsed).filter(([, value]) => Array.isArray(value) && value.length > 0);
    if (populatedDays.length !== 1 || populatedDays[0][0] !== "2") return false;
    const blocks = populatedDays[0][1] as unknown[];
    const expected = [
      ["s1", "09:00", "09:30", "boom-chicka-boom"],
      ["s2", "09:45", "10:45", "gaga-ball"],
      ["s3", "11:00", "11:45", "tie-dye"],
      ["lunch", "12:00", "13:15", ""],
      ["s4", "13:30", "13:45", "sponge-relay"],
      ["s5", "15:00", "15:30", "capture-flag"],
    ];
    return (
      blocks.length === expected.length &&
      blocks.every((value, index) => {
        if (!isRecord(value)) return false;
        const [id, start, end, activityId] = expected[index];
        return (
          value.id === id &&
          value.start === start &&
          value.end === end &&
          (activityId ? value.activityId === activityId : value.kind === "label")
        );
      })
    );
  } catch {
    return false;
  }
}

export function CampApp({ initialTab = "home" }: { initialTab?: TabId } = {}) {
  const [tab, setTab] = useState<TabId>(initialTab);
  const [view, setView] = useLocalStorage<LibraryView>("view", "deck", viewStorage);
  const [cat, setCat] = useState<CatFilter>("All");
  const [place, setPlace] = useState<PlaceFilter>("All");
  const [age, setAge] = useState<AgeFilter>("All");
  const [query, setQuery] = useState("");
  const [availableMaterials, setAvailableMaterials] = useLocalStorage<string[]>(
    "availableMaterials",
    [],
    stringArrayStorage
  );

  // One search field, never stale: clear it whenever the tab changes so the
  // library count and the schedule activity tray aren't silently pre-filtered.
  useEffect(() => {
    setQuery("");
  }, [tab]);

  const [favs, setFavs] = useLocalStorage<string[]>("favs", [], stringArrayStorage);
  const [extra, setExtra] = useLocalStorage<Activity[]>("extra", [], activitiesStorage);
  const [schedule, setSchedule] = useLocalStorage<Schedule>("schedule", DEFAULT_SCHEDULE, scheduleStorage);
  const [schedulePlans, setSchedulePlans] = useLocalStorage<DayTemplate[]>("schedulePlans", [], savedPlansStorage);
  const [dayIndex, setDayIndex] = useState(2);
  const [zoomIdx, setZoomIdx] = useLocalStorage<number>("planZoom", DEFAULT_ZOOM, zoomStorage);
  const focusNonceRef = useRef(0);
  const [calFocus, setCalFocus] = useState<{ min: number; nonce: number } | null>(null);

  const [detail, setDetail] = useState<Activity | null>(null);
  const [detailMode, setDetailMode] = useState<"library" | "runSheet">("library");
  const [editing, setEditing] = useState<Activity | null>(null);
  const [liveMsg, setLiveMsg] = useState("");
  const [undoSnapshot, setUndoSnapshot] = useState<Schedule | null>(null);
  const [applyToast, setApplyToast] = useState<string | null>(null);
  const [ratings, setRatings] = useLocalStorage<Record<string, number>>("ratings", {}, ratingsStorage);
  const auth = usePreviewAuth();
  const authLabel = useAuthLabel(auth.session);
  const isAdmin = auth.session.status === "authenticated" && auth.session.user.role === "admin";
  const navTabs = useMemo(() => (isAdmin || tab === "admin" ? [...TABS, ADMIN_TAB] : TABS), [isAdmin, tab]);
  const openAuthForCurrentTab = useCallback(() => {
    auth.openAuth();
  }, [auth]);

  // Safety snapshot + seed migration. If the browser still has the old
  // one-day demo schedule, upgrade it to the full Monday-Friday draft; leave
  // counselor-edited schedules alone.
  useEffect(() => {
    try {
      if (window.localStorage.getItem("camp:scheduleVersion") === SCHEDULE_SEED_VERSION) return;
      const prevSchedule = window.localStorage.getItem("camp:schedule");
      const prevPlans = window.localStorage.getItem("camp:schedulePlans");
      if (prevSchedule != null && window.localStorage.getItem("camp:schedule.bak") == null) {
        window.localStorage.setItem("camp:schedule.bak", prevSchedule);
      }
      if (prevPlans != null && window.localStorage.getItem("camp:schedulePlans.bak") == null) {
        window.localStorage.setItem("camp:schedulePlans.bak", prevPlans);
      }
      if (isLegacyOneDaySeed(prevSchedule)) {
        window.localStorage.setItem("camp:schedule", JSON.stringify(DEFAULT_SCHEDULE));
        setSchedule(DEFAULT_SCHEDULE);
      }
      window.localStorage.setItem("camp:scheduleVersion", SCHEDULE_SEED_VERSION);
    } catch {
      /* private mode / quota — non-fatal */
    }
    // The migration intentionally runs once after localStorage hydration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const all = useMemo(() => {
    const base = [...extra, ...ACTIVITIES];
    return base.map((a) => (ratings[a.id] != null ? { ...a, rating: ratings[a.id] } : a));
  }, [extra, ratings]);

  const materialOptions = useMemo(() => materialOptionsForActivities(all), [all]);
  const activeAvailableMaterials = useMemo(() => {
    const optionIds = new Set(materialOptions.map((option) => option.id));
    return availableMaterials.filter((id) => optionIds.has(id));
  }, [availableMaterials, materialOptions]);
  const toggleAvailableMaterial = useCallback(
    (id: string) => {
      setAvailableMaterials((previous) =>
        previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]
      );
    },
    [setAvailableMaterials]
  );
  const clearAvailableMaterials = useCallback(() => setAvailableMaterials([]), [setAvailableMaterials]);

  const byId = useMemo(() => {
    const m: Record<string, Activity> = {};
    all.forEach((a) => (m[a.id] = a));
    return m;
  }, [all]);

  const favSet = useMemo(() => new Set(favs), [favs]);
  const isFav = useCallback((id: string) => favSet.has(id), [favSet]);
  const requireEditAccess = useCallback(() => true, []);
  const toggleFav = useCallback(
    (id: string) => {
      if (!requireEditAccess()) return;
      setFavs((p) => (p.indexOf(id) !== -1 ? p.filter((x) => x !== id) : [id, ...p]));
    },
    [requireEditAccess, setFavs]
  );
  const setRating = (id: string, val: number) => {
    if (!requireEditAccess()) return;
    setRatings((p) => ({ ...p, [id]: val }));
  };

  const filtered = useMemo(() => {
    return all.filter((a) =>
      matchesActivityFilters(a, { cat, place, age, query, availableMaterialTags: activeAvailableMaterials })
    );
  }, [all, cat, place, age, query, activeAvailableMaterials]);

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
  const openCount = dayBlocks.filter(
    (block) => (block.fill === "open" || block.fill === "conditional") && !block.activityId
  ).length;
  const weekPlannedCount = useMemo(
    () =>
      Object.values(weekBlocks).reduce(
        (sum, day) => sum + day.filter((block) => block.kind === "activity" && block.activityId).length,
        0
      ),
    [weekBlocks]
  );

  // Real data for the home dashboard (no more hardcoded picks).
  const todayPlanned = useMemo(
    () =>
      dayBlocks
        .filter((b) => b.kind === "activity" && b.activityId && byId[b.activityId])
        .map((b) => ({ activity: byId[b.activityId as string], start: b.start })),
    [dayBlocks, byId]
  );
  const savedActivities = useMemo(() => all.filter((a) => favSet.has(a.id)), [all, favSet]);
  const recentActivities = useMemo(
    () => extra.map((e) => byId[e.id]).filter((a): a is Activity => Boolean(a)),
    [extra, byId]
  );

  function saveBlocksForDay(targetDayIndex: number, blocks: DaySchedule, ordered = true) {
    setSchedule((p) => ({ ...p, [targetDayIndex]: ordered ? orderBlocks(blocks) : blocks }));
  }

  function addEventToDay(targetDayIndex: number, draft: EventDraft) {
    if (!requireEditAccess()) return;
    const targetBlocks = normalizeDaySchedule(schedule[targetDayIndex], targetDayIndex);
    const block = createScheduleBlock({
      kind: draft.kind,
      start: draft.start,
      end: draft.end,
      label: draft.label,
      activityId: draft.kind === "activity" ? draft.activityId : undefined,
      fill: draft.fill ?? "fixed",
      category: draft.category,
      rule: draft.rule,
    });
    saveBlocksForDay(targetDayIndex, [...targetBlocks, block]);
  }

  function updateEvent(targetDayIndex: number, blockId: string, patch: Partial<ScheduleBlock>) {
    if (!requireEditAccess()) return;
    const targetBlocks = normalizeDaySchedule(schedule[targetDayIndex], targetDayIndex);
    saveBlocksForDay(
      targetDayIndex,
      targetBlocks.map((block) => {
        if (block.id !== blockId) return block;
        const merged: ScheduleBlock = { ...block, ...patch };
        const fill: BlockFill = merged.kind === "label" ? "fixed" : merged.fill ?? "fixed";
        // Keep the block internally consistent with its fill mode.
        if (merged.kind === "label" || fill === "fixed") {
          delete merged.fill;
          delete merged.category;
          delete merged.rule;
        }
        if (fill === "open" || fill === "conditional") {
          // An unfilled/typed slot holds no concrete activity.
          delete merged.activityId;
          if (fill === "open") delete merged.rule;
        }
        return merged;
      })
    );
  }

  function removeEvent(targetDayIndex: number, blockId: string) {
    if (!requireEditAccess()) return;
    const targetBlocks = normalizeDaySchedule(schedule[targetDayIndex], targetDayIndex);
    saveBlocksForDay(
      targetDayIndex,
      targetBlocks.filter((block) => block.id !== blockId),
      false
    );
  }

  function quickAddActivity(targetDayIndex: number, activityId: string) {
    if (!requireEditAccess()) return;
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
    setLiveMsg(activity.title + " added to " + DAYS[targetDayIndex]);
  }

  function saveCurrentDayPlan(name: string) {
    if (!requireEditAccess()) return;
    const trimmed = name.trim();
    const now = Date.now();
    setSchedulePlans((plans) => [
      {
        id: "tpl-" + now.toString(36),
        name: trimmed || DAYS[dayIndex] + " template",
        blocks: cloneBlocks(dayBlocks),
        createdAt: now,
        updatedAt: now,
        origin: "day",
      },
      ...plans,
    ]);
    setLiveMsg("Saved template " + (trimmed || DAYS[dayIndex] + " template"));
  }

  // Best activity of a category for a conditional "byCategory" slot:
  // prefer saved, then highest rating.
  function bestActivityOfCategory(category: CategoryId): string | undefined {
    const pool = all.filter(
      (a) => a.type === category && hasRequiredMaterials(a, activeAvailableMaterials)
    );
    if (!pool.length) return undefined;
    const ranked = [...pool].sort((a, b) => {
      const favDiff = (favSet.has(b.id) ? 1 : 0) - (favSet.has(a.id) ? 1 : 0);
      return favDiff || b.rating - a.rating;
    });
    return ranked[0].id;
  }

  // Turn one template block into a concrete block for a specific day.
  function resolveBlock(block: ScheduleBlock, targetDayIndex: number, occurrenceIndex: number): ScheduleBlock {
    const fill: BlockFill = block.fill ?? "fixed";
    if (fill !== "conditional") {
      return createScheduleBlock({
        kind: block.kind,
        start: block.start,
        end: block.end,
        label: block.label,
        activityId: block.activityId,
        fill,
        category: block.category,
      });
    }
    const rule = block.rule;
    let resolvedId: string | undefined;
    if (rule?.mode === "byWeekday") resolvedId = rule.map[targetDayIndex];
    else if (rule?.mode === "rotate") resolvedId = rule.pool[occurrenceIndex % rule.pool.length];
    else if (rule?.mode === "byCategory") resolvedId = bestActivityOfCategory(rule.category);
    const resolved = resolvedId ? byId[resolvedId] : undefined;
    if (resolved) {
      return createScheduleBlock({
        kind: "activity",
        start: block.start,
        end: block.end,
        label: resolved.title,
        activityId: resolved.id,
        fill: "fixed",
      });
    }
    // Unresolved → leave a typed open slot to fill by hand.
    const category = block.category ?? (rule?.mode === "byCategory" ? rule.category : undefined);
    return createScheduleBlock({
      kind: "activity",
      start: block.start,
      end: block.end,
      label: block.label,
      fill: "open",
      category,
    });
  }

  function applyTemplate(templateId: string, targetDays: number[], mode: ApplyMode) {
    if (!requireEditAccess()) return;
    const tpl = schedulePlans.find((t) => t.id === templateId);
    if (!tpl || !targetDays.length) return;
    setUndoSnapshot(schedule);
    setSchedule((prev) => {
      const next: Schedule = { ...prev };
      targetDays.forEach((dayIdx, occ) => {
        const existing = normalizeDaySchedule(prev[dayIdx], dayIdx);
        const stamped = tpl.blocks.map((b) => resolveBlock(b, dayIdx, occ));
        let dayBlocksNext: DaySchedule;
        if (mode === "replace") {
          dayBlocksNext = stamped;
        } else if (mode === "fill") {
          const hasActivities = existing.some((b) => b.kind === "activity" && b.activityId);
          dayBlocksNext = hasActivities ? existing : stamped;
        } else {
          const merged = [...existing];
          stamped.forEach((s) => {
            const sStart = campMinutes(s.start);
            const sEnd = campMinutes(s.end);
            const overlaps = existing.some((e) => campMinutes(e.start) < sEnd && campMinutes(e.end) > sStart);
            if (!overlaps) merged.push(s);
          });
          dayBlocksNext = merged;
        }
        next[dayIdx] = orderBlocks(dayBlocksNext);
      });
      return next;
    });
    const days = targetDays.map((d) => DAYS[d].slice(0, 3)).join(", ");
    setApplyToast("Applied “" + tpl.name + "” to " + days);
    setLiveMsg("Applied " + tpl.name + " to " + days);
  }

  function undoApply() {
    if (!undoSnapshot) return;
    setSchedule(undoSnapshot);
    setUndoSnapshot(null);
    setApplyToast(null);
  }

  function deleteDayPlan(planId: string) {
    if (!requireEditAccess()) return;
    setSchedulePlans((plans) => plans.filter((plan) => plan.id !== planId));
  }

  function selectDay(index: number) {
    setDayIndex(Math.max(0, Math.min(DAYS.length - 1, index)));
  }

  // Drill from the overview into the single-day workspace, optionally scrolling
  // the calendar to a specific time.
  function openDayInCalendar(day: number, atMin?: number) {
    selectDay(day);
    setTab("calendar");
    focusNonceRef.current += 1;
    setCalFocus({ min: atMin ?? DAY_START_MIN, nonce: focusNonceRef.current });
  }

  function printCurrentView() {
    window.print();
  }

  function openDetail(a: Activity) {
    setDetailMode("library");
    setDetail(a);
  }

  function openScheduleBlock(day: number, block: ScheduleBlock) {
    if (block.kind !== "activity" || !block.activityId || !byId[block.activityId]) return;
    selectDay(day);
    setDetailMode("runSheet");
    setDetail(byId[block.activityId]);
  }

  const isCustomActivity = useCallback((id: string) => extra.some((e) => e.id === id), [extra]);

  function editActivity(a: Activity) {
    if (!requireEditAccess()) return;
    setEditing(a);
    setDetail(null);
    setTab("add");
  }

  function deleteActivity(a: Activity) {
    if (!requireEditAccess()) return;
    // Remove the custom entry and clean up every reference so nothing is orphaned.
    setExtra((p) => p.filter((x) => x.id !== a.id));
    setFavs((p) => p.filter((id) => id !== a.id));
    setRatings((p) => {
      if (p[a.id] == null) return p;
      const next = { ...p };
      delete next[a.id];
      return next;
    });
    setSchedule((p) => {
      const next: Schedule = {};
      for (const [key, blocks] of Object.entries(p)) {
        next[Number(key)] = blocks.filter((b) => b.activityId !== a.id);
      }
      return next;
    });
    setDetail(null);
    setLiveMsg("Deleted " + a.title);
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
      kicker: DAYS[dayIndex] + " · camp week",
      title: "Run Sheet",
      summary:
        weekPlannedCount + (weekPlannedCount === 1 ? " activity" : " activities") + " ready to run",
    },
    calendar: {
      kicker: "Build " + DAYS[dayIndex],
      title: "Planner",
      summary:
        plannedCount +
        " planned" +
        (openCount ? " · " + openCount + " to fill" : "") +
        " · " +
        labelCount +
        (labelCount === 1 ? " break" : " breaks"),
    },
    saved: {
      kicker: favs.length + " saved",
      title: "Saved",
      summary: "A shortlist for quick substitutions and rainy-day planning.",
    },
    add: {
      kicker: "Catalog something",
      title: "New Activity",
      summary: "Add a tested activity, quiet filler, song, craft, or camp game.",
    },
    admin: {
      kicker: "Administrator",
      title: "Staff access",
      summary: "Generate and review staff invite keys.",
    },
  };
  const page = pageByTab[tab];

  return (
    <div className="stage">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
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
            {navTabs.filter((t) => t.id !== "home").map((t) => (
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
              materialOptions={materialOptions}
              availableMaterials={activeAvailableMaterials}
              onCat={setCat}
              onPlace={setPlace}
              onAge={setAge}
              onToggleMaterial={toggleAvailableMaterial}
              onClearMaterials={clearAvailableMaterials}
            />
          )}
          <div className="sidenav__foot">
            <span>{all.length} in the library · {favs.length} saved</span>
            <span>{authLabel}</span>
          </div>
        </nav>

        <main className="app__main" id="main">
          {tab !== "home" && (
          <div
            className={
              "topbar" +
              (tab === "calendar" ? " topbar--planner" : "")
            }
            data-export-scope={tab}
            data-export-format="print-bw"
            data-export-title={page.title}
          >
            <div className="topbar__brand">
              <span className="topbar__kicker">{page.kicker}</span>
              <h1 className="topbar__title">{page.title}</h1>
              <span className="topbar__summary">{page.summary}</span>
            </div>
            <div className="topbar__actions">
              <AuthButton session={auth.session} onOpen={openAuthForCurrentTab} onSignOut={auth.signOut} />
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
            </div>
          </div>
          )}

          {tab === "library" && (
            <>
              <div className="toolbar">
                <div className="viewswitch">
                  <button
                    type="button"
                    className={view === "shelf" ? "is-active" : ""}
                    aria-pressed={view === "shelf"}
                    onClick={() => setView("shelf")}
                  >
                    <CampIcon.Shelf />
                    Shelf
                  </button>
                  <button
                    type="button"
                    className={view === "deck" ? "is-active" : ""}
                    aria-pressed={view === "deck"}
                    onClick={() => setView("deck")}
                  >
                    <CampIcon.Deck />
                    Deck
                  </button>
                  <button
                    type="button"
                    className={view === "catalog" ? "is-active" : ""}
                    aria-pressed={view === "catalog"}
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
              <Filters
                variant="bar"
                cat={cat}
                place={place}
                age={age}
                materialOptions={materialOptions}
                availableMaterials={activeAvailableMaterials}
                onCat={setCat}
                onPlace={setPlace}
                onAge={setAge}
                onToggleMaterial={toggleAvailableMaterial}
                onClearMaterials={clearAvailableMaterials}
              />
            </>
          )}

          <div className="app__scroll">
            {tab === "home" && (
              <HomeView
                dayName={DAYS[dayIndex]}
                today={todayPlanned}
                plannedCount={plannedCount}
                saved={savedActivities}
                recent={recentActivities}
                activityCount={all.length}
                savedCount={favs.length}
                plansCount={schedulePlans.length}
                onOpen={openDetail}
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
              <ScheduleOverview
                dayIndex={dayIndex}
                onSelectDay={selectDay}
                weekBlocks={weekBlocks}
                byId={byId}
                zoomIdx={zoomIdx}
                onOpenBlock={openScheduleBlock}
              />
            )}
            {tab === "calendar" && (
              <CalendarView
                dayIndex={dayIndex}
                onSelectDay={selectDay}
                blocks={dayBlocks}
                weekBlocks={weekBlocks}
                activities={filtered}
                allActivities={all}
                query={query}
                onQueryChange={setQuery}
                cat={cat}
                place={place}
                age={age}
                materialOptions={materialOptions}
                availableMaterials={activeAvailableMaterials}
                onCat={setCat}
                onPlace={setPlace}
                onAge={setAge}
                onToggleMaterial={toggleAvailableMaterial}
                onClearMaterials={clearAvailableMaterials}
                plans={schedulePlans}
                openCount={openCount}
                onAddEvent={(draft) => addEventToDay(dayIndex, draft)}
                onUpdateEvent={(blockId, patch) => updateEvent(dayIndex, blockId, patch)}
                onRemoveEvent={(blockId) => removeEvent(dayIndex, blockId)}
                onQuickAdd={(activityId) => quickAddActivity(dayIndex, activityId)}
                onSavePlan={saveCurrentDayPlan}
                onApplyTemplate={applyTemplate}
                onDeletePlan={deleteDayPlan}
                applyToast={applyToast}
                onUndoApply={undoApply}
                onDismissToast={() => setApplyToast(null)}
                onOpenActivity={openDetail}
                isFav={isFav}
                onToggleFav={toggleFav}
                byId={byId}
                zoomIdx={zoomIdx}
                onZoom={(idx) => setZoomIdx(clampZoomIndex(idx))}
                focus={calFocus}
              />
            )}
            {tab === "saved" && (
              <SavedView
                items={all}
                onOpen={openDetail}
                isFav={isFav}
                onToggleFav={toggleFav}
              />
            )}
            {tab === "add" && (
              <AddView
                initial={editing}
                onCancelEdit={() => {
                  setEditing(null);
                  setTab("library");
                }}
                onSubmit={(a) => {
                  if (editing) {
                    setExtra((p) => p.map((x) => (x.id === a.id ? a : x)));
                    setEditing(null);
                    setLiveMsg("Updated " + a.title);
                  } else {
                    setExtra((p) => [a, ...p]);
                  }
                  setTab("library");
                  setCat("All");
                  setView("catalog");
                }}
              />
            )}
            {tab === "admin" && (
              <div className="admin-tab">
                <AdminInviteCodes />
              </div>
            )}
          </div>
        </main>

        <nav className="tabbar" aria-label="Sections">
          {navTabs.map((t) => (
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

        <div className="sr-only" role="status" aria-live="polite">
          {liveMsg}
        </div>

        {detail && (
          <DetailSheet
            activity={byId[detail.id] || detail}
            isFav={isFav}
            onToggleFav={toggleFav}
            onClose={() => setDetail(null)}
            onSetRating={setRating}
            isCustom={isCustomActivity(detail.id)}
            onEdit={editActivity}
            onDelete={deleteActivity}
            showOwnerActions={detailMode !== "runSheet"}
            availableMaterials={activeAvailableMaterials}
            onToggleMaterial={toggleAvailableMaterial}
          />
        )}
      </div>
    </div>
  );
}
