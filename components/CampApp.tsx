"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  Activity,
  ApplyMode,
  BlockFill,
  ClipboardPin,
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
import { clipboardRunKey, currentActivityForSchedule, localDayIndex } from "@/lib/currentActivity";
import {
  PLAYBOOKS_BY_ACTIVITY_ID,
  normalizePlaybook,
  type ActivityPlaybookData,
} from "@/lib/playbooks";
import { buildRunDoc, ensureSectionHeadings, normalizeRunDoc, promoteMaterialsBlocks, type RunDoc } from "@/lib/runList";
import {
  blockEndMin,
  blockStartMin,
  campMinutes,
  clampZoomIndex,
  DAY_END_MIN,
  DEFAULT_ZOOM,
  MIN_DURATION_MIN,
  minutesToCamp,
  nextFreeStart,
  normalizeTimeString,
  TOTAL_MIN,
} from "@/lib/scheduleTime";
import { matchesActivityFilters } from "@/lib/activityFilters";
import { normalizeActivities } from "@/lib/activityValidation";
import { hasRequiredMaterials, materialOptionsForActivities } from "@/lib/materials";
import { hasPlannedActivity, normalizeScheduleActivityRefs } from "@/lib/scheduleValidation";
import { type StorageValidator, useLocalStorage } from "@/lib/store";
import { migrateLegacyStorageKeys, scopedStorageKey } from "@/lib/storageScope";
import { CampIcon } from "./icons";
import { HomeView } from "./HomeView";
import { CatalogView, DeckView, ShelfView } from "./LibraryViews";
import { CalendarView } from "./CalendarView";
import { ScheduleOverview } from "./ScheduleOverview";
import { ClipboardView, type ClipboardRun, type ClipboardState } from "./ClipboardView";
import { type EventDraft } from "./EventComposer";
import { SavedView } from "./SavedView";
import { AddView } from "./AddView";
import { DetailSheet } from "./DetailSheet";
import { PrintViews, type PrintIntent } from "./PrintViews";
import { Filters, type AgeFilter, type CatFilter, type PlaceFilter } from "./Filters";
import { AuthButton, useAuthLabel, usePreviewAuth } from "./AuthControls";
import { AdminInviteCodes } from "./AdminInviteCodes";

const TABS: { id: Exclude<TabId, "admin">; label: string; icon: (typeof CampIcon)[keyof typeof CampIcon] }[] = [
  { id: "home", label: "Home", icon: CampIcon.Home },
  { id: "library", label: "Library", icon: CampIcon.Library },
  { id: "clipboard", label: "Clipboard", icon: CampIcon.Clipboard },
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

function capEventEnd(start: string, end: string): string {
  const startMin = campMinutes(start);
  const endMin = campMinutes(end);
  if (startMin < DAY_END_MIN && endMin > DAY_END_MIN) return minutesToCamp(DAY_END_MIN);
  return end.trim();
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
    end: capEventEnd(start, end),
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
  Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string" && Boolean(item)))]
    : fallback;

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

const activitiesStorage: StorageValidator<Activity[]> = (value, fallback) =>
  normalizeActivities(value, fallback);

// Per-activity playbook overrides — lets any diagram (including built-in ones)
// be edited and persisted without mutating the seed data.
const playbookOverridesStorage: StorageValidator<Record<string, ActivityPlaybookData>> = (
  value,
  fallback
) => {
  if (!isRecord(value)) return fallback;
  const out: Record<string, ActivityPlaybookData> = {};
  for (const [key, raw] of Object.entries(value)) {
    const normalized = normalizePlaybook(raw);
    if (normalized) out[key] = normalized;
  }
  return out;
};

// Per-activity Run List overrides — hand-edited instruction documents that
// supersede the doc derived from the activity's flat steps/notes/safety. Same
// pattern as playbook overrides; built-in and custom books both persist here.
const runListOverridesStorage: StorageValidator<Record<string, RunDoc>> = (value, fallback) => {
  if (!isRecord(value)) return fallback;
  const out: Record<string, RunDoc> = {};
  for (const [key, raw] of Object.entries(value)) {
    const normalized = normalizeRunDoc(raw);
    if (normalized) out[key] = normalized;
  }
  return out;
};

const scheduleStorage: StorageValidator<Schedule> = (value, fallback) => {
  if (!isRecord(value)) return fallback;
  const out: Schedule = {};
  for (const [key, raw] of Object.entries(value)) {
    const day = Number(key);
    if (Number.isInteger(day) && day >= 0 && day < STORED_DAY_COUNT) {
      out[day] = normalizeDaySchedule(raw, day);
    }
  }
  DAYS.forEach((_, day) => {
    if (!(day in out)) out[day] = defaultBlocksForDay(day);
  });
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

const clipboardPinStorage: StorageValidator<ClipboardPin | null> = (value, fallback) => {
  if (value == null) return null;
  if (!isRecord(value)) return fallback;
  if (typeof value.activityId !== "string" || !value.activityId) return fallback;
  const pin: ClipboardPin = {
    activityId: value.activityId,
    pinnedAt:
      typeof value.pinnedAt === "number" && Number.isFinite(value.pinnedAt) ? value.pinnedAt : Date.now(),
  };
  if (typeof value.dayIndex === "number" && Number.isInteger(value.dayIndex) && value.dayIndex >= 0 && value.dayIndex < STORED_DAY_COUNT) {
    pin.dayIndex = value.dayIndex;
  }
  if (typeof value.blockId === "string" && value.blockId) {
    pin.blockId = value.blockId;
  }
  return pin;
};

const stringArrayMapStorage: StorageValidator<Record<string, string[]>> = (value, fallback) => {
  if (!isRecord(value)) return fallback;
  const out: Record<string, string[]> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!Array.isArray(raw)) continue;
    const items = raw.filter((item): item is string => typeof item === "string" && Boolean(item));
    if (items.length) out[key] = [...new Set(items)];
  }
  return out;
};

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
  const auth = usePreviewAuth();
  const authLabel = useAuthLabel(auth.session);
  const signedInUserId = auth.session.status === "authenticated" ? auth.session.user?.id ?? null : null;
  const isSignedIn = signedInUserId != null;
  const storageScope = signedInUserId ? "user:" + signedInUserId : "anon";

  useLayoutEffect(() => {
    try {
      migrateLegacyStorageKeys(window.localStorage, storageScope);
    } catch {
      /* private mode / quota — scoped storage starts fresh */
    }
  }, [storageScope]);

  const [view, setView] = useLocalStorage<LibraryView>(scopedStorageKey(storageScope, "view"), "deck", viewStorage);
  const [cat, setCat] = useState<CatFilter>("All");
  const [place, setPlace] = useState<PlaceFilter>("All");
  const [age, setAge] = useState<AgeFilter>("All");
  const [query, setQuery] = useState("");
  const [availableMaterials, setAvailableMaterials] = useLocalStorage<string[]>(
    scopedStorageKey(storageScope, "availableMaterials"),
    [],
    stringArrayStorage
  );
  const [clipboardPin, setClipboardPin] = useLocalStorage<ClipboardPin | null>(
    scopedStorageKey(storageScope, "clipboardPin"),
    null,
    clipboardPinStorage
  );
  const [clipboardMaterials, setClipboardMaterials] = useLocalStorage<Record<string, string[]>>(
    scopedStorageKey(storageScope, "clipboardReadyMaterials"),
    {},
    stringArrayMapStorage
  );
  const [now, setNow] = useState<Date | null>(null);

  // One search field, never stale: clear it whenever the tab changes so the
  // library count and the schedule activity tray aren't silently pre-filtered.
  useEffect(() => {
    setQuery("");
  }, [tab]);

  const needsClock = tab === "home" || tab === "clipboard";
  useEffect(() => {
    if (!needsClock) {
      setNow(null);
      return;
    }
    const tick = () => setNow(new Date());
    tick();
    const timer = window.setInterval(tick, 30 * 1000);
    return () => window.clearInterval(timer);
  }, [needsClock]);

  const [favs, setFavs] = useLocalStorage<string[]>(scopedStorageKey(storageScope, "favs"), [], stringArrayStorage);
  const [extra, setExtra] = useLocalStorage<Activity[]>(scopedStorageKey(storageScope, "extra"), [], activitiesStorage);
  const [playbookOverrides, setPlaybookOverrides] = useLocalStorage<Record<string, ActivityPlaybookData>>(
    scopedStorageKey(storageScope, "playbooks"),
    {},
    playbookOverridesStorage
  );
  // Key bumped to .v2 when the doc model moved diagram/materials into the Run
  // List. Older saved docs with child materials are promoted at render time.
  const [runListOverrides, setRunListOverrides] = useLocalStorage<Record<string, RunDoc>>(
    scopedStorageKey(storageScope, "runLists.v2"),
    {},
    runListOverridesStorage
  );
  const [schedule, setSchedule] = useLocalStorage<Schedule>(
    scopedStorageKey(storageScope, "schedule"),
    DEFAULT_SCHEDULE,
    scheduleStorage
  );
  const [schedulePlans, setSchedulePlans] = useLocalStorage<DayTemplate[]>(
    scopedStorageKey(storageScope, "schedulePlans"),
    [],
    savedPlansStorage
  );
  const [dayIndex, setDayIndex] = useState(2);
  const [zoomIdx, setZoomIdx] = useLocalStorage<number>(
    scopedStorageKey(storageScope, "planZoom"),
    DEFAULT_ZOOM,
    zoomStorage
  );
  const activityDeepLinkOpenedRef = useRef(false);

  const [detail, setDetail] = useState<Activity | null>(null);
  const [detailScheduleContext, setDetailScheduleContext] = useState<{ dayIndex: number; blockId: string } | null>(
    null
  );
  const [detailMode, setDetailMode] = useState<"library" | "runSheet">("library");
  const [editing, setEditing] = useState<Activity | null>(null);
  const [printIntent, setPrintIntent] = useState<PrintIntent | null>(null);
  const [liveMsg, setLiveMsg] = useState("");
  const [undoSnapshot, setUndoSnapshot] = useState<Schedule | null>(null);
  const [applyToast, setApplyToast] = useState<string | null>(null);
  const [ratings, setRatings] = useLocalStorage<Record<string, number>>(
    scopedStorageKey(storageScope, "ratings"),
    {},
    ratingsStorage
  );
  const isAdmin = auth.session.status === "authenticated" && auth.session.user.role === "admin";
  const navTabs = useMemo(() => (isAdmin || tab === "admin" ? [...TABS, ADMIN_TAB] : TABS), [isAdmin, tab]);
  const openAuthForCurrentTab = useCallback(() => {
    auth.openAuth();
  }, [auth]);
  const requireStaff = useCallback(
    (action: string) => {
      if (isSignedIn) return true;
      setLiveMsg("Sign in as staff to " + action + ".");
      auth.openAuth();
      return false;
    },
    [auth, isSignedIn]
  );

  useEffect(() => {
    const today = localDayIndex(new Date());
    if (today != null) setDayIndex(today);
  }, []);

  // Safety snapshot + seed migration. If the browser still has the old
  // one-day demo schedule, upgrade it to the full Monday-Friday draft; leave
  // counselor-edited schedules alone.
  useEffect(() => {
    try {
      const versionKey = "camp:" + scopedStorageKey(storageScope, "scheduleVersion");
      const scheduleKey = "camp:" + scopedStorageKey(storageScope, "schedule");
      const plansKey = "camp:" + scopedStorageKey(storageScope, "schedulePlans");
      if (window.localStorage.getItem(versionKey) === SCHEDULE_SEED_VERSION) return;
      const prevSchedule = window.localStorage.getItem(scheduleKey);
      const prevPlans = window.localStorage.getItem(plansKey);
      if (prevSchedule != null && window.localStorage.getItem(scheduleKey + ".bak") == null) {
        window.localStorage.setItem(scheduleKey + ".bak", prevSchedule);
      }
      if (prevPlans != null && window.localStorage.getItem(plansKey + ".bak") == null) {
        window.localStorage.setItem(plansKey + ".bak", prevPlans);
      }
      if (isLegacyOneDaySeed(prevSchedule)) {
        window.localStorage.setItem(scheduleKey, JSON.stringify(DEFAULT_SCHEDULE));
        setSchedule(DEFAULT_SCHEDULE);
      }
      window.localStorage.setItem(versionKey, SCHEDULE_SEED_VERSION);
    } catch {
      /* private mode / quota — non-fatal */
    }
    // The migration intentionally runs once after localStorage hydration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageScope]);

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
      if (!requireStaff("update available kit")) return;
      setAvailableMaterials((previous) =>
        previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]
      );
    },
    [requireStaff, setAvailableMaterials]
  );
  const clearAvailableMaterials = useCallback(() => {
    if (!requireStaff("update available kit")) return;
    setAvailableMaterials([]);
  }, [requireStaff, setAvailableMaterials]);

  const byId = useMemo(() => {
    const m: Record<string, Activity> = {};
    all.forEach((a) => (m[a.id] = a));
    return m;
  }, [all]);
  const validActivityIds = useMemo(() => new Set(Object.keys(byId)), [byId]);

  useEffect(() => {
    if (activityDeepLinkOpenedRef.current) return;
    const activityId = new URLSearchParams(window.location.search).get("activity");
    if (!activityId || !byId[activityId]) return;
    activityDeepLinkOpenedRef.current = true;
    setTab("library");
    setDetailMode("library");
    setDetailScheduleContext(null);
    setDetail(byId[activityId]);
  }, [byId]);

  const favSet = useMemo(() => new Set(favs), [favs]);
  const isFav = useCallback((id: string) => favSet.has(id), [favSet]);
  const toggleFav = useCallback(
    (id: string) => {
      if (!requireStaff("save activities")) return;
      setFavs((p) => (p.indexOf(id) !== -1 ? p.filter((x) => x !== id) : [id, ...p.filter((x) => x !== id)]));
    },
    [requireStaff, setFavs]
  );
  const setRating = (id: string, val: number) => {
    if (!requireStaff("rate activities")) return;
    setRatings((p) => ({ ...p, [id]: val }));
  };

  const filtered = useMemo(() => {
    return all.filter((a) =>
      matchesActivityFilters(a, { cat, place, age, query, availableMaterialTags: activeAvailableMaterials })
    );
  }, [all, cat, place, age, query, activeAvailableMaterials]);

  const weekBlocks = useMemo(() => {
    const days: Record<number, DaySchedule> = {};
    DAYS.forEach((_, index) => {
      days[index] = normalizeDaySchedule(schedule[index], index);
    });
    return normalizeScheduleActivityRefs(days, validActivityIds);
  }, [schedule, validActivityIds]);
  const dayBlocks = useMemo(() => weekBlocks[dayIndex] || [], [dayIndex, weekBlocks]);
  const plannedCount = dayBlocks.filter((block) => block.kind === "activity" && block.activityId && byId[block.activityId]).length;
  const labelCount = dayBlocks.filter((block) => block.kind === "label").length;
  const openCount = dayBlocks.filter(
    (block) => (block.fill === "open" || block.fill === "conditional") && !block.activityId
  ).length;
  const weekPlannedCount = useMemo(
    () =>
      Object.values(weekBlocks).reduce(
        (sum, day) => sum + day.filter((block) => block.kind === "activity" && block.activityId && byId[block.activityId]).length,
        0
      ),
    [byId, weekBlocks]
  );
  const currentActivityResult = useMemo(
    () => (now ? currentActivityForSchedule(weekBlocks, now) : { status: "loading" as const }),
    [now, weekBlocks]
  );
  const pinnedBlock = useMemo(() => {
    if (!clipboardPin || clipboardPin.dayIndex == null || !clipboardPin.blockId) return null;
    return weekBlocks[clipboardPin.dayIndex]?.find((block) => block.id === clipboardPin.blockId) || null;
  }, [clipboardPin, weekBlocks]);
  const staleSchedulePin = Boolean(
    clipboardPin?.blockId &&
      clipboardPin.dayIndex != null &&
      (!pinnedBlock || pinnedBlock.kind !== "activity" || pinnedBlock.activityId !== clipboardPin.activityId)
  );
  useEffect(() => {
    if (staleSchedulePin) setClipboardPin(null);
  }, [setClipboardPin, staleSchedulePin]);
  const clipboardState = useMemo<ClipboardState>(() => {
    if (clipboardPin) {
      if (staleSchedulePin) return { kind: "empty", empty: { status: "loading" } };
      const activity = byId[clipboardPin.activityId];
      if (!activity) {
        return {
          kind: "empty",
          empty: {
            status: "missing-activity",
            activityId: clipboardPin.activityId,
            pinned: true,
            dayIndex: clipboardPin.dayIndex,
            block: pinnedBlock || undefined,
          },
        };
      }
      return {
        kind: "run",
        run: {
          source: "pinned",
          activity,
          dayIndex: clipboardPin.dayIndex,
          block: pinnedBlock || undefined,
        },
      };
    }

    if (currentActivityResult.status !== "activity") {
      return { kind: "empty", empty: currentActivityResult };
    }

    const activity = byId[currentActivityResult.activityId];
    if (!activity) {
      return {
        kind: "empty",
        empty: {
          status: "missing-activity",
          activityId: currentActivityResult.activityId,
          pinned: false,
          dayIndex: currentActivityResult.dayIndex,
          minutes: currentActivityResult.minutes,
          block: currentActivityResult.block,
        },
      };
    }
    return {
      kind: "run",
      run: {
        source: "auto",
        activity,
        dayIndex: currentActivityResult.dayIndex,
        block: currentActivityResult.block,
      },
    };
  }, [byId, clipboardPin, currentActivityResult, pinnedBlock, staleSchedulePin]);
  const activeClipboardRun = clipboardState.kind === "run" ? clipboardState.run : null;
  const activeClipboardKey = activeClipboardRun
    ? clipboardRunKey(activeClipboardRun.dayIndex, activeClipboardRun.block?.id, activeClipboardRun.activity.id)
    : "";
  const activeClipboardMaterials = activeClipboardKey ? clipboardMaterials[activeClipboardKey] || [] : [];

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
    if (!requireStaff("change the schedule")) return;
    setSchedule((p) => ({ ...p, [targetDayIndex]: ordered ? orderBlocks(blocks) : blocks }));
  }

  function clearClipboardBlockState(targetDayIndex: number, blockId: string) {
    const prefix = "day-" + targetDayIndex + ":" + blockId + ":";
    setClipboardMaterials((previous) => {
      let changed = false;
      const next: Record<string, string[]> = {};
      for (const [key, value] of Object.entries(previous)) {
        if (key.startsWith(prefix)) {
          changed = true;
        } else {
          next[key] = value;
        }
      }
      return changed ? next : previous;
    });
    setClipboardPin((pin) => (pin?.dayIndex === targetDayIndex && pin.blockId === blockId ? null : pin));
  }

  function addEventToDay(targetDayIndex: number, draft: EventDraft) {
    if (!requireStaff("change the schedule")) return;
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
    if (!requireStaff("change the schedule")) return;
    const targetBlocks = normalizeDaySchedule(schedule[targetDayIndex], targetDayIndex);
    const previousBlock = targetBlocks.find((block) => block.id === blockId);
    let changedActivity = false;
    const nextBlocks = targetBlocks.map((block) => {
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
      merged.end = capEventEnd(merged.start, merged.end);
      changedActivity = block.activityId !== merged.activityId;
      return merged;
    });
    saveBlocksForDay(targetDayIndex, nextBlocks);
    if (previousBlock && changedActivity) clearClipboardBlockState(targetDayIndex, previousBlock.id);
  }

  function removeEvent(targetDayIndex: number, blockId: string) {
    if (!requireStaff("change the schedule")) return;
    const targetBlocks = normalizeDaySchedule(schedule[targetDayIndex], targetDayIndex);
    const previousBlock = targetBlocks.find((block) => block.id === blockId);
    saveBlocksForDay(
      targetDayIndex,
      targetBlocks.filter((block) => block.id !== blockId),
      false
    );
    if (previousBlock) clearClipboardBlockState(targetDayIndex, previousBlock.id);
  }

  function quickAddActivity(targetDayIndex: number, activityId: string) {
    if (!requireStaff("change the schedule")) return;
    const activity = byId[activityId];
    if (!activity) return;
    const targetBlocks = normalizeDaySchedule(schedule[targetDayIndex], targetDayIndex);
    const duration = Math.min(TOTAL_MIN, Math.max(MIN_DURATION_MIN, activity.durationMin));
    const start = nextFreeStart(targetBlocks, duration);
    if (start == null) {
      setLiveMsg("No open time for " + activity.title + " on " + DAYS[targetDayIndex]);
      return;
    }
    const end = Math.min(DAY_END_MIN, start + duration);
    const overlaps = targetBlocks.some((block) => start < blockEndMin(block) && end > blockStartMin(block));
    if (overlaps || end - start < duration) {
      setLiveMsg("No open time for " + activity.title + " on " + DAYS[targetDayIndex]);
      return;
    }
    addEventToDay(targetDayIndex, {
      kind: "activity",
      activityId,
      label: activity.title,
      start: minutesToCamp(start),
      end: minutesToCamp(end),
    });
    setLiveMsg(activity.title + " added to " + DAYS[targetDayIndex]);
  }

  function saveCurrentDayPlan(name: string) {
    if (!requireStaff("save day templates")) return;
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
    if (!requireStaff("change the schedule")) return;
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
          dayBlocksNext = hasPlannedActivity(existing, validActivityIds) ? existing : stamped;
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
    if (!requireStaff("change the schedule")) return;
    if (!undoSnapshot) return;
    setSchedule(undoSnapshot);
    setUndoSnapshot(null);
    setApplyToast(null);
  }

  function deleteDayPlan(planId: string) {
    if (!requireStaff("delete day templates")) return;
    const plan = schedulePlans.find((item) => item.id === planId);
    if (plan && !window.confirm("Delete template “" + plan.name + "”?")) return;
    setSchedulePlans((plans) => plans.filter((plan) => plan.id !== planId));
  }

  function selectDay(index: number) {
    setDayIndex(Math.max(0, Math.min(DAYS.length - 1, index)));
  }

  function pinRun(run: ClipboardRun) {
    if (!requireStaff("pin clipboard runs")) return;
    setClipboardPin({
      activityId: run.activity.id,
      dayIndex: run.dayIndex,
      blockId: run.block?.id,
      pinnedAt: Date.now(),
    });
    setLiveMsg("Pinned " + run.activity.title);
  }

  function pinScheduleBlock(targetDayIndex: number, block: ScheduleBlock) {
    if (!requireStaff("pin clipboard runs")) return;
    if (block.kind !== "activity" || !block.activityId || !byId[block.activityId]) return;
    setClipboardPin({
      activityId: block.activityId,
      dayIndex: targetDayIndex,
      blockId: block.id,
      pinnedAt: Date.now(),
    });
    setLiveMsg("Pinned " + byId[block.activityId].title);
  }

  function unpinClipboard() {
    if (!requireStaff("pin clipboard runs")) return;
    setClipboardPin(null);
    setLiveMsg("Clipboard unpinned");
  }

  function toggleClipboardMaterial(id: string) {
    if (!requireStaff("update clipboard materials")) return;
    if (!activeClipboardKey) return;
    setClipboardMaterials((previous) => {
      const current = previous[activeClipboardKey] || [];
      const nextItems = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
      return { ...previous, [activeClipboardKey]: nextItems };
    });
  }

  function clearClipboardMaterials() {
    if (!requireStaff("update clipboard materials")) return;
    if (!activeClipboardKey) return;
    setClipboardMaterials((previous) => {
      const next = { ...previous };
      delete next[activeClipboardKey];
      return next;
    });
  }

  useEffect(() => {
    if (!printIntent) return;

    const clearPrintIntent = () => setPrintIntent(null);
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => window.print());
    });

    window.addEventListener("afterprint", clearPrintIntent, { once: true });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
      window.removeEventListener("afterprint", clearPrintIntent);
    };
  }, [printIntent]);

  function requestPrint(intent: PrintIntent) {
    setPrintIntent(intent);
    if (intent.type === "activity-book") {
      const activity = byId[intent.activityId];
      setLiveMsg("Preparing " + (activity?.title || "activity") + " for print");
    } else {
      const kind = intent.type === "run-sheet" ? "run sheet" : "planner";
      setLiveMsg("Preparing " + DAYS[intent.dayIndex] + " " + kind + " for print");
    }
  }

  function openClipboardPlanner(targetDayIndex?: number) {
    if (targetDayIndex != null) selectDay(targetDayIndex);
    setTab("calendar");
  }

  function openDetail(a: Activity) {
    setDetailMode("library");
    setDetailScheduleContext(null);
    setDetail(a);
  }

  function openScheduleBlock(day: number, block: ScheduleBlock) {
    if (block.kind !== "activity" || !block.activityId || !byId[block.activityId]) return;
    selectDay(day);
    setDetailMode("runSheet");
    setDetailScheduleContext({ dayIndex: day, blockId: block.id });
    setDetail(byId[block.activityId]);
  }

  const isCustomActivity = useCallback((id: string) => extra.some((e) => e.id === id), [extra]);

  // A custom book carries its own diagram; built-in books fall back to an
  // editable override, then the seed registry.
  const resolvePlaybook = useCallback(
    (activity: Activity): ActivityPlaybookData | null =>
      activity.playbook ?? playbookOverrides[activity.id] ?? PLAYBOOKS_BY_ACTIVITY_ID[activity.id] ?? null,
    [playbookOverrides]
  );

  // The Run List doc: a saved override if one exists, else derived from the
  // activity — its steps/notes/safety plus a materials block and (when the
  // activity has one) the field diagram seeded in as a diagram block.
  const resolveRunDoc = useCallback(
    (activity: Activity): RunDoc => {
      const hasOverride = Object.prototype.hasOwnProperty.call(runListOverrides, activity.id);
      const doc = hasOverride
        ? promoteMaterialsBlocks(runListOverrides[activity.id])
        : buildRunDoc(activity, resolvePlaybook(activity));
      if (hasOverride && doc.blocks.length === 0) return doc;
      return ensureSectionHeadings(activity, doc);
    },
    [runListOverrides, resolvePlaybook]
  );

  const saveRunDoc = useCallback(
    (activityId: string, doc: RunDoc) => {
      if (!requireStaff("edit run lists")) return;
      setRunListOverrides((p) => ({ ...p, [activityId]: doc }));
    },
    [requireStaff, setRunListOverrides]
  );

  function editActivity(a: Activity) {
    if (!requireStaff("edit activities")) return;
    setEditing(a);
    setDetail(null);
    setDetailScheduleContext(null);
    setTab("add");
  }

  function deleteActivity(a: Activity) {
    if (!requireStaff("delete activities")) return;
    if (!window.confirm("Delete “" + a.title + "” and remove it from every schedule?")) return;
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
    setClipboardPin((pin) => (pin?.activityId === a.id ? null : pin));
    setRunListOverrides((p) => {
      if (p[a.id] == null) return p;
      const next = { ...p };
      delete next[a.id];
      return next;
    });
    setPlaybookOverrides((p) => {
      if (p[a.id] == null) return p;
      const next = { ...p };
      delete next[a.id];
      return next;
    });
    setDetail(null);
    setDetailScheduleContext(null);
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
    clipboard: {
      kicker:
        clipboardState.kind === "run"
          ? (clipboardState.run.source === "pinned" ? "Pinned" : "Live now") + " · " + clipboardState.run.activity.type
          : "Current activity",
      title: "Clipboard",
      summary:
        clipboardState.kind === "run"
          ? clipboardState.run.activity.title
          : "Setup, materials, and run notes for the activity at hand.",
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
      kicker: savedActivities.length + " saved",
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
  const topbarPrint =
    tab === "schedule"
      ? ({
          label: "Print " + DAYS[dayIndex] + " Run Sheet",
          title: "Print this run sheet",
          intent: { type: "run-sheet", dayIndex } as PrintIntent,
        })
      : tab === "calendar"
        ? ({
            label: "Print " + DAYS[dayIndex] + " Planner",
            title: "Print this planner",
            intent: { type: "planner", dayIndex } as PrintIntent,
          })
        : null;
  const detailActivity = detail ? byId[detail.id] || detail : null;
  const detailScheduleBlock =
    detailScheduleContext == null
      ? null
      : normalizeDaySchedule(schedule[detailScheduleContext.dayIndex], detailScheduleContext.dayIndex).find(
          (block) => block.id === detailScheduleContext.blockId
        ) || null;
  const detailIsPinned =
    Boolean(detailActivity && clipboardPin?.activityId === detailActivity.id) &&
    (detailScheduleBlock == null || clipboardPin?.blockId === detailScheduleBlock.id);
  const detailPinAction =
    detailMode === "runSheet" && detailScheduleContext && detailScheduleBlock
      ? {
          isPinned: detailIsPinned,
          onToggle: () => {
            if (detailIsPinned) {
              unpinClipboard();
            } else {
              pinScheduleBlock(detailScheduleContext.dayIndex, detailScheduleBlock);
            }
          },
        }
      : undefined;

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
            <span>{all.length} in the library · {savedActivities.length} saved</span>
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
              {topbarPrint && (
                <button
                  type="button"
                  className="icon-btn print-btn"
                  onClick={() => requestPrint(topbarPrint.intent)}
                  aria-label={topbarPrint.label}
                  title={topbarPrint.title}
                  data-export-action={topbarPrint.intent.type}
                >
                  <CampIcon.Print />
                </button>
              )}
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
                savedCount={savedActivities.length}
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
            {tab === "clipboard" && (
              <ClipboardView
                state={clipboardState}
                readyMaterialIds={activeClipboardMaterials}
                onToggleMaterial={toggleClipboardMaterial}
                onClearMaterials={clearClipboardMaterials}
                onPin={() => {
                  if (activeClipboardRun) pinRun(activeClipboardRun);
                }}
                onUnpin={unpinClipboard}
                onOpenActivity={openDetail}
                onOpenPlanner={openClipboardPlanner}
                runDoc={activeClipboardRun ? resolveRunDoc(activeClipboardRun.activity) : null}
              />
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
                focus={null}
              />
            )}
            {tab === "saved" && (
              <SavedView
                items={savedActivities}
                onOpen={openDetail}
                onToggleFav={toggleFav}
              />
            )}
            {tab === "add" && (
              <AddView
                initial={editing}
                initialRunDoc={editing ? resolveRunDoc(editing) : null}
                onCancelEdit={() => {
                  setEditing(null);
                  setTab("library");
                }}
                onSubmit={(a, runDoc) => {
                  if (!requireStaff(editing ? "edit activities" : "add activities")) return;
                  if (editing) {
                    setExtra((p) => p.map((x) => (x.id === a.id ? a : x)));
                    if (runDoc) setRunListOverrides((p) => ({ ...p, [a.id]: runDoc }));
                    setRatings((p) => {
                      if (a.rating > 0) return { ...p, [a.id]: a.rating };
                      if (p[a.id] == null) return p;
                      const next = { ...p };
                      delete next[a.id];
                      return next;
                    });
                    setEditing(null);
                    setLiveMsg("Updated " + a.title);
                  } else {
                    setExtra((p) => [a, ...p]);
                    if (runDoc) setRunListOverrides((p) => ({ ...p, [a.id]: runDoc }));
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
              aria-label={t.label}
              title={t.label}
            >
              <t.icon />
              <span>{t.label}</span>
            </button>
          ))}
        </nav>

        <div className="sr-only" role="status" aria-live="polite">
          {liveMsg}
        </div>

        {detailActivity && (
          <DetailSheet
            activity={detailActivity}
            isFav={isFav}
            onToggleFav={toggleFav}
            onClose={() => {
              setDetail(null);
              setDetailScheduleContext(null);
            }}
            onSetRating={setRating}
            isCustom={isCustomActivity(detailActivity.id)}
            onEdit={editActivity}
            onDelete={deleteActivity}
            onPrint={(activity) => requestPrint({ type: "activity-book", activityId: activity.id })}
            showOwnerActions={detailMode !== "runSheet"}
            availableMaterials={activeAvailableMaterials}
            onToggleMaterial={toggleAvailableMaterial}
            runDoc={resolveRunDoc(detailActivity)}
            onSaveRunDoc={saveRunDoc}
            pinAction={detailPinAction}
            backLabel={navTabs.find((t) => t.id === tab)?.label ?? "Library"}
          />
        )}
        <PrintViews
          intent={printIntent}
          byId={byId}
          weekBlocks={weekBlocks}
          resolveRunDoc={resolveRunDoc}
        />
      </div>
    </div>
  );
}
