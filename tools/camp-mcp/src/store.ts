// The headless data layer for Camp Library.
//
// Every function here is a thin wrapper over the app's OWN server-side
// persistence (lib/server/userData.ts) and pure builders/validators
// (lib/playbooks, lib/runList, lib/themes, lib/camps, lib/userDataDocs), bound
// to a single owner (the admin Clerk user id). Because we reuse the exact same
// upsert + normalize functions the HTTP API calls after auth, every write is
// byte-identical to what the web UI produces — and the live app picks the
// changes up on its next focus/reconnect re-bootstrap. No browser, no Clerk
// token: just the production DATABASE_URL.

import { getSql } from "@/lib/server/db";
import {
  deleteCalendarEvent,
  getUserDocs,
  listCalendarEvents,
  putUserDoc,
  upsertCalendarEvent,
  type StoredCalendarEvent,
} from "@/lib/server/userData";
import { ACTIVITIES, AGE_GROUPS, CATEGORIES } from "@/lib/data";
import type { Activity } from "@/lib/types";
import {
  normalizePlaybook,
  playbookId,
  type ActivityPlaybookData,
  type PlaybookArrow,
  type PlaybookArrowKind,
  type PlaybookColorId,
  type PlaybookMarkerShape,
  type PlaybookZone,
  type PlaybookZoneKind,
} from "@/lib/playbooks";
import { normalizeRunDoc, type RunDoc } from "@/lib/runList";
import { type Camp } from "@/lib/camps";
import { createCampId, DEFAULT_OPEN_MIN, DEFAULT_CLOSE_MIN } from "@/lib/camps";
import { createThemeId, nextPaletteTint, type Theme } from "@/lib/themes";
import {
  isUserDocKey,
  USER_DOC_KEYS,
  type DocValueMap,
  type UserDocKey,
} from "@/lib/userDataDocs";
import { snapDurationMin, snapMinutes, MINUTES_PER_DAY } from "@/lib/calendar/time";
import { getAdminUserId } from "./config";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uid(): string {
  return getAdminUserId();
}

function randomEventId(): string {
  return crypto.randomUUID().toLowerCase();
}

/* ------------------------------------------------------------------ context */

export type ContextSummary = {
  ownerUserId: string;
  categories: { id: string; label: string }[];
  ageGroups: { id: string; label: string }[];
  activities: { id: string; title: string; type: string; ages: string[]; durationMin: number; source: "library" | "custom" }[];
  camps: Camp[];
  themes: Theme[];
  themeAssignments: Record<string, string>;
};

export async function listContext(): Promise<ContextSummary> {
  const docs = await getUserDocs(uid());
  const extra = (docs.extra as Activity[] | undefined) ?? [];
  const activities = [
    ...ACTIVITIES.map((a) => ({ ...a, source: "library" as const })),
    ...extra.map((a) => ({ ...a, source: "custom" as const })),
  ].map((a) => ({
    id: a.id,
    title: a.title,
    type: a.type,
    ages: a.ages,
    durationMin: a.durationMin,
    source: a.source,
  }));
  return {
    ownerUserId: uid(),
    categories: CATEGORIES.map((c) => ({ id: c.id, label: c.label })),
    ageGroups: AGE_GROUPS.map((g) => ({ id: g.id, label: g.label })),
    activities,
    camps: (docs.camps as Camp[] | undefined) ?? [],
    themes: (docs.themes as Theme[] | undefined) ?? [],
    themeAssignments: (docs.themeAssignments as Record<string, string> | undefined) ?? {},
  };
}

/* ------------------------------------------------------------------- events */

export type EventInput = {
  id?: string;
  date: string;
  startMin?: number;
  endMin?: number;
  allDay?: boolean;
  title?: string;
  activityId?: string;
  campId?: string;
};

export async function upsertEvent(input: EventInput): Promise<StoredCalendarEvent> {
  const id = (input.id ?? randomEventId()).toLowerCase();
  if (!UUID_RE.test(id)) {
    throw new Error(`Event id must be a UUID (got "${id}"). Omit it to mint a new one.`);
  }

  const base: Record<string, unknown> = {
    id,
    date: input.date,
    title: (input.title ?? "").slice(0, 200),
    kind: input.activityId ? "activity" : "custom",
    updatedAt: Date.now(),
  };
  if (input.activityId) base.activityId = input.activityId;
  if (input.campId) base.campId = input.campId;

  if (input.allDay) {
    base.allDay = true;
  } else {
    if (typeof input.startMin !== "number" || typeof input.endMin !== "number") {
      throw new Error("Timed events need startMin and endMin (minutes from midnight), or set allDay:true.");
    }
    const startMin = snapMinutes(input.startMin);
    let endMin = snapMinutes(input.endMin);
    if (endMin <= startMin) endMin = startMin + 15;
    if (startMin < 0 || endMin > MINUTES_PER_DAY) {
      throw new Error("Event times must fall within 0–1440 minutes (one day).");
    }
    base.startMin = startMin;
    base.endMin = endMin;
  }

  const result = await upsertCalendarEvent(uid(), base);
  if (!result.ok) {
    throw new Error(`Event rejected as invalid. Check date (YYYY-MM-DD), times, and activityId.`);
  }
  return result.event;
}

export async function listEvents(range?: { from?: string; to?: string }): Promise<StoredCalendarEvent[]> {
  return listCalendarEvents(uid(), range);
}

export async function deleteEvent(id: string): Promise<boolean> {
  return deleteCalendarEvent(uid(), id);
}

export type DayBlockInput = { title?: string; durationMin: number; activityId?: string };

export async function createDaySchedule(input: {
  date: string;
  dayStartMin?: number;
  campId?: string;
  blocks: DayBlockInput[];
}): Promise<StoredCalendarEvent[]> {
  let cursor = snapMinutes(input.dayStartMin ?? 9 * 60);
  const created: StoredCalendarEvent[] = [];
  for (const block of input.blocks) {
    const duration = snapDurationMin(block.durationMin);
    const startMin = cursor;
    const endMin = Math.min(MINUTES_PER_DAY, startMin + duration);
    if (startMin >= MINUTES_PER_DAY) break;
    created.push(
      await upsertEvent({
        date: input.date,
        startMin,
        endMin,
        title: block.title,
        activityId: block.activityId,
        campId: input.campId,
      }),
    );
    cursor = endMin;
  }
  return created;
}

/* ----------------------------------------------------------------- diagrams */

export type ZoneInput = {
  kind: PlaybookZoneKind;
  x: number;
  y: number;
  w: number;
  h: number;
  color?: PlaybookColorId;
  label?: string;
};
export type MarkerInput = {
  x: number;
  y: number;
  color: PlaybookColorId;
  shape: PlaybookMarkerShape;
  label?: string;
};
export type ArrowInput = {
  from: [number, number];
  to: [number, number];
  team?: PlaybookArrowKind;
  color?: PlaybookColorId;
};
export type FrameInput = {
  name?: string;
  caption?: string;
  alt?: string;
  markers?: MarkerInput[];
  zones?: ZoneInput[];
  arrows?: ArrowInput[];
};
export type DiagramInput = {
  activityId: string;
  title?: string;
  summary?: string;
  surface?: { split?: boolean; grid?: boolean };
  frames: FrameInput[];
};

export async function setDiagram(input: DiagramInput): Promise<ActivityPlaybookData> {
  const draft: ActivityPlaybookData = {
    id: playbookId("playbook"),
    activityId: input.activityId,
    title: input.title ?? "Activity diagram",
    summary: input.summary ?? "",
    surface: input.surface ?? { split: false },
    frames: input.frames.map((f, i) => ({
      id: playbookId("frame"),
      name: f.name ?? `Stage ${i + 1}`,
      caption: f.caption ?? "",
      alt: f.alt,
      flags: [],
      players: [],
      zones: (f.zones ?? []).map<PlaybookZone>((z) => ({
        id: playbookId("z"),
        kind: z.kind,
        x: z.x,
        y: z.y,
        w: z.w,
        h: z.h,
        ...(z.color ? { color: z.color } : {}),
        ...(z.label ? { label: z.label } : {}),
      })),
      arrows: (f.arrows ?? []).map<PlaybookArrow>((a) => ({
        id: playbookId("a"),
        from: a.from,
        to: a.to,
        ...(a.team ? { team: a.team } : {}),
        ...(a.color ? { color: a.color } : {}),
      })),
      markers: (f.markers ?? []).map((m) => ({
        id: playbookId("m"),
        x: m.x,
        y: m.y,
        color: m.color,
        shape: m.shape,
        ...(m.label ? { label: m.label } : {}),
      })),
    })),
  };

  const normalized = normalizePlaybook(draft);
  if (!normalized) {
    throw new Error("Diagram needs at least one frame and a valid structure.");
  }

  const docs = await getUserDocs(uid());
  const current = (docs.playbookOverrides as DocValueMap["playbookOverrides"] | undefined) ?? {};
  await putUserDoc(uid(), "playbookOverrides", { ...current, [input.activityId]: normalized });
  return normalized;
}

/* ---------------------------------------------------------------- run lists */

export async function setRunList(input: { activityId: string; blocks: unknown[] }): Promise<RunDoc> {
  const doc = normalizeRunDoc({ blocks: input.blocks });
  if (!doc) {
    throw new Error("Run list must be { blocks: RunBlock[] } with valid block types.");
  }
  const docs = await getUserDocs(uid());
  const current = (docs.runLists as DocValueMap["runLists"] | undefined) ?? {};
  await putUserDoc(uid(), "runLists", { ...current, [input.activityId]: doc });
  return doc;
}

/* --------------------------------------------------------------- docs / misc */

export async function getDocs(): Promise<Partial<DocValueMap>> {
  return getUserDocs(uid()) as Promise<Partial<DocValueMap>>;
}

export async function setUserDoc<K extends UserDocKey>(key: K, value: DocValueMap[K]): Promise<void> {
  if (!isUserDocKey(key)) {
    throw new Error(`Unknown doc key "${key}". Valid keys: ${USER_DOC_KEYS.join(", ")}.`);
  }
  await putUserDoc(uid(), key, value);
}

export async function addCamp(name: string): Promise<Camp> {
  const docs = await getUserDocs(uid());
  const camps = (docs.camps as Camp[] | undefined) ?? [];
  const camp: Camp = {
    id: createCampId(),
    name: name.slice(0, 60),
    createdAt: Date.now(),
    openMin: DEFAULT_OPEN_MIN,
    closeMin: DEFAULT_CLOSE_MIN,
  };
  await putUserDoc(uid(), "camps", [...camps, camp]);
  return camp;
}

export async function addTheme(label: string): Promise<Theme> {
  const docs = await getUserDocs(uid());
  const themes = (docs.themes as Theme[] | undefined) ?? [];
  const theme: Theme = { id: createThemeId(), label: label.slice(0, 40), tint: nextPaletteTint(themes.length) };
  await putUserDoc(uid(), "themes", [...themes, theme]);
  return theme;
}

export async function assignTheme(activityId: string, themeId: string): Promise<void> {
  const docs = await getUserDocs(uid());
  const map = (docs.themeAssignments as Record<string, string> | undefined) ?? {};
  await putUserDoc(uid(), "themeAssignments", { ...map, [activityId]: themeId });
}

export async function setRating(activityId: string, rating: number): Promise<void> {
  const docs = await getUserDocs(uid());
  const map = (docs.ratings as Record<string, number> | undefined) ?? {};
  await putUserDoc(uid(), "ratings", { ...map, [activityId]: Math.max(0, Math.min(5, Math.round(rating))) });
}

export async function addCustomActivity(partial: Partial<Activity> & { title: string }): Promise<Activity | null> {
  const docs = await getUserDocs(uid());
  const extra = (docs.extra as Activity[] | undefined) ?? [];
  const activity: Activity = {
    id: partial.id ?? "x-" + crypto.randomUUID(),
    title: partial.title,
    ...(partial.altNames?.length ? { altNames: partial.altNames } : {}),
    type: partial.type ?? "Game",
    place: partial.place ?? "Both",
    ageMin: partial.ageMin ?? 6,
    ageMax: partial.ageMax ?? 12,
    durationMin: partial.durationMin ?? 30,
    groupMin: partial.groupMin ?? null,
    groupMax: partial.groupMax ?? null,
    energy: partial.energy ?? 0,
    prep: partial.prep ?? "Low",
    blurb: partial.blurb ?? "",
    materials: partial.materials ?? [],
    steps: partial.steps ?? [],
    notes: partial.notes ?? "",
    safety: partial.safety ?? "",
    ages: partial.ages ?? ["g13", "g46"],
    rating: partial.rating ?? 0,
  };
  await putUserDoc(uid(), "extra", [...extra, activity]);
  // putUserDoc normalizes via normalizeActivities; confirm it survived.
  const after = await getUserDocs(uid());
  const saved = ((after.extra as Activity[] | undefined) ?? []).find((a) => a.id === activity.id);
  return saved ?? null;
}

/* ------------------------------------------------------------- introspection */

export async function whoami(): Promise<{ clerkUserId: string; events: number; docs: number }[]> {
  const sql = getSql();
  const out = new Map<string, { clerkUserId: string; events: number; docs: number }>();
  const bump = (id: string, field: "events" | "docs", n: number) => {
    const row = out.get(id) ?? { clerkUserId: id, events: 0, docs: 0 };
    row[field] = n;
    out.set(id, row);
  };
  try {
    const ev = await sql<{ clerk_user_id: string; n: number }[]>`
      SELECT clerk_user_id, count(*)::int AS n FROM calendar_events GROUP BY 1`;
    for (const r of ev) bump(r.clerk_user_id, "events", r.n);
  } catch {
    /* table may not exist yet */
  }
  try {
    const dc = await sql<{ clerk_user_id: string; n: number }[]>`
      SELECT clerk_user_id, count(*)::int AS n FROM user_documents GROUP BY 1`;
    for (const r of dc) bump(r.clerk_user_id, "docs", r.n);
  } catch {
    /* table may not exist yet */
  }
  return [...out.values()].sort((a, b) => b.events + b.docs - (a.events + a.docs));
}
