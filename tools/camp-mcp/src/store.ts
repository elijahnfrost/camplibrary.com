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
import { mergeActivityCatalog, upsertActivityRecord } from "@/lib/activityCatalog";
import { normalizeHexColor } from "@/lib/color";
import { ACTIVITIES, AGE_GROUPS, CATEGORIES, effectiveActivityColor } from "@/lib/data";
import type { Activity, AgeGroupId, CategoryId, Place } from "@/lib/types";
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
import { clampOpenClose, createCampId, DEFAULT_OPEN_MIN, DEFAULT_CLOSE_MIN, MAX_CAMP_NAME } from "@/lib/camps";
import { createThemeId, MAX_THEME_LABEL, nextPaletteTint, type Theme } from "@/lib/themes";
import {
  isUserDocKey,
  USER_DOC_KEYS,
  type DocValueMap,
  type UserDocKey,
} from "@/lib/userDataDocs";
import { DEFAULT_DURATION_MIN, snapDurationMin, snapMinutes, MINUTES_PER_DAY } from "@/lib/calendar/time";
import {
  buildSeriesEvents,
  eventsInSeries,
  normalizeRecurrence,
  planSeriesDelete,
  planSeriesEdit,
  planSeriesSkip,
  recurrenceDates,
  summarizeRecurrence,
  type SeriesScope,
  type SeriesTemplate,
} from "@/lib/calendar/recurrence";
import { normalizeCalendarEvent, type CalendarEvent, type DateKey } from "@/lib/calendar/types";
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

async function getActivityCatalog(): Promise<Activity[]> {
  const docs = await getUserDocs(uid());
  return mergeActivityCatalog(
    ACTIVITIES,
    (docs.extra as Activity[] | undefined) ?? [],
    (docs.deletedActivityIds as string[] | undefined) ?? [],
  );
}

export async function listContext(): Promise<ContextSummary> {
  const docs = await getUserDocs(uid());
  const extraIds = new Set(((docs.extra as Activity[] | undefined) ?? []).map((activity) => activity.id));
  const activities = mergeActivityCatalog(
    ACTIVITIES,
    (docs.extra as Activity[] | undefined) ?? [],
    (docs.deletedActivityIds as string[] | undefined) ?? [],
  ).map((a) => ({
    id: a.id,
    title: a.title,
    type: a.type,
    ages: a.ages,
    durationMin: a.durationMin,
    source: extraIds.has(a.id) ? "custom" as const : "library" as const,
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

/* ------------------------------------------------------------- library search */

export type ActivitySearchInput = {
  query?: string;
  type?: CategoryId;
  place?: Place;
  age?: AgeGroupId;
  hasColorOverride?: boolean;
  limit?: number;
};

export type ActivitySearchHit = {
  id: string;
  title: string;
  type: CategoryId;
  source: "library" | "custom";
  color: string;
  hasColorOverride: boolean;
  ages: AgeGroupId[];
  durationMin: number;
  place: Place;
  altNames?: string[];
  blurb: string;
  themeId?: string;
  score: number;
};

function searchTokens(query: string): string[] {
  return query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

// Score one activity against the query tokens. Each token must appear SOMEWHERE
// (AND semantics); the per-token weight rewards where it landed so a title hit
// outranks a buried materials hit. Returns 0 when any token is missing.
function scoreActivity(activity: Activity, tokens: string[]): number {
  const title = activity.title.toLowerCase();
  const titleNorm = normalizedName(activity.title);
  const altNorm = (activity.altNames ?? []).map(normalizedName);
  const blurb = (activity.blurb ?? "").toLowerCase();
  const materials = (activity.materials ?? []).join(" ").toLowerCase();
  const type = activity.type.toLowerCase();

  let total = 0;
  for (const token of tokens) {
    let best = 0;
    if (titleNorm === token) best = 100;
    else if (title.startsWith(token)) best = 70;
    else if (title.includes(token)) best = 45;
    if (best < 40 && altNorm.some((n) => n.includes(token))) best = Math.max(best, 38);
    if (best < 30 && type === token) best = Math.max(best, 30);
    if (best < 12 && blurb.includes(token)) best = Math.max(best, 12);
    if (best < 8 && materials.includes(token)) best = Math.max(best, 8);
    if (best === 0) return 0; // every token must match somewhere
    total += best;
  }
  return total;
}

// Fuzzy search across the WHOLE merged catalog (library + custom) so the agent
// can resolve "that octopus tag game" to a real activity id before placing it.
// Searches title, alt-names, type, blurb, and materials; optional facet filters
// (type/place/age/hasColorOverride) narrow the field. With no query it just
// lists the (filtered) catalog by title. Returns ids ready for upsert_event /
// set_activity_color / set_run_list.
export async function searchActivities(input: ActivitySearchInput): Promise<ActivitySearchHit[]> {
  const docs = await getUserDocs(uid());
  const extraIds = new Set(((docs.extra as Activity[] | undefined) ?? []).map((a) => a.id));
  const themeAssignments = (docs.themeAssignments as Record<string, string> | undefined) ?? {};
  const catalog = mergeActivityCatalog(
    ACTIVITIES,
    (docs.extra as Activity[] | undefined) ?? [],
    (docs.deletedActivityIds as string[] | undefined) ?? [],
  );

  const tokens = input.query ? searchTokens(input.query) : [];
  const limit = Math.max(1, Math.min(100, input.limit ?? 20));

  const hits: ActivitySearchHit[] = [];
  for (const activity of catalog) {
    if (input.type && activity.type !== input.type) continue;
    if (input.place && activity.place !== input.place) continue;
    if (input.age && !activity.ages.includes(input.age)) continue;
    const hasColorOverride = Boolean(normalizeHexColor(activity.color));
    if (input.hasColorOverride != null && hasColorOverride !== input.hasColorOverride) continue;

    const score = tokens.length ? scoreActivity(activity, tokens) : 1;
    if (score <= 0) continue;

    hits.push({
      id: activity.id,
      title: activity.title,
      type: activity.type,
      source: extraIds.has(activity.id) ? "custom" : "library",
      color: effectiveActivityColor(activity),
      hasColorOverride,
      ages: activity.ages,
      durationMin: activity.durationMin,
      place: activity.place,
      ...(activity.altNames?.length ? { altNames: activity.altNames } : {}),
      blurb: (activity.blurb ?? "").slice(0, 160),
      ...(themeAssignments[activity.id] ? { themeId: themeAssignments[activity.id] } : {}),
      score,
    });
  }

  hits.sort((a, b) => (b.score - a.score) || a.title.localeCompare(b.title));
  return hits.slice(0, limit);
}

/* ------------------------------------------------------------------- events */

export type EventInput = {
  id?: string;
  date?: string;
  startMin?: number;
  endMin?: number;
  allDay?: boolean;
  kind?: "activity" | "custom";
  title?: string;
  activityId?: string | null;
  activityTitle?: string | null;
  campId?: string | null;
  color?: string | null;
  location?: string | null;
};

function normalizedName(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function activityByName(activities: Activity[], value: string | undefined | null): Activity | null {
  const name = typeof value === "string" ? normalizedName(value) : "";
  if (!name) return null;
  return (
    activities.find((activity) => {
      if (normalizedName(activity.title) === name) return true;
      return (activity.altNames ?? []).some((altName) => normalizedName(altName) === name);
    }) ?? null
  );
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function findExistingEvent(id: string): Promise<StoredCalendarEvent | null> {
  const lower = id.toLowerCase();
  return (await listCalendarEvents(uid())).find((event) => event.id.toLowerCase() === lower) ?? null;
}

function resolveActivity(input: EventInput, existing: StoredCalendarEvent | null, activities: Activity[]): Activity | null {
  const byId = new Map(activities.map((activity) => [activity.id, activity]));

  if (input.kind === "custom" || input.activityId === null || input.activityTitle === null) return null;

  if (typeof input.activityId === "string" && input.activityId.trim()) {
    const activity = byId.get(input.activityId.trim());
    if (!activity) throw new Error(`Unknown activityId "${input.activityId}". Call list_context first.`);
    return activity;
  }

  if (typeof input.activityTitle === "string") {
    const activity = activityByName(activities, input.activityTitle);
    if (!activity) throw new Error(`Unknown activityTitle "${input.activityTitle}". Call list_context first.`);
    return activity;
  }

  const titleMatch = activityByName(activities, input.title);
  if (titleMatch) return titleMatch;

  const existingActivityId = typeof existing?.activityId === "string" ? existing.activityId : "";
  return existingActivityId ? byId.get(existingActivityId) ?? null : null;
}

export async function upsertEvent(input: EventInput): Promise<StoredCalendarEvent> {
  const id = (input.id ?? randomEventId()).toLowerCase();
  if (!UUID_RE.test(id)) {
    throw new Error(`Event id must be a UUID (got "${id}"). Omit it to mint a new one.`);
  }
  const existing = input.id ? await findExistingEvent(id) : null;
  const activities = await getActivityCatalog();
  const activity = resolveActivity(input, existing, activities);
  const date = input.date ?? existing?.date;
  if (!date) throw new Error("Event date is required for new events.");

  const base: Record<string, unknown> = {
    id,
    date,
    title: (activity?.title ?? input.title ?? existing?.title ?? "").slice(0, 200),
    kind: activity ? "activity" : "custom",
    updatedAt: Date.now(),
  };
  if (activity) base.activityId = activity.id;
  const campId = input.campId === null ? undefined : stringField(input.campId) ?? stringField(existing?.campId);
  if (campId) base.campId = campId;
  const color = input.color === null ? undefined : normalizeHexColor(input.color) ?? normalizeHexColor(existing?.color);
  if (color) base.color = color;
  const location = input.location === null ? undefined : stringField(input.location) ?? stringField(existing?.location);
  if (location) base.location = location.slice(0, 80);
  if (typeof existing?.seriesId === "string" && existing.seriesId) base.seriesId = existing.seriesId;
  if (
    typeof existing?.recurrence === "object" &&
    existing.recurrence !== null &&
    !Array.isArray(existing.recurrence)
  ) {
    base.recurrence = existing.recurrence;
  }

  const existingAllDay =
    existing?.allDay === true || existing?.startMin == null || existing?.endMin == null;
  const hasTimeInput = input.startMin != null || input.endMin != null;
  const allDay = input.allDay === true || (!hasTimeInput && input.allDay !== false && existingAllDay);
  if (allDay) {
    base.allDay = true;
  } else {
    const existingStart = existingAllDay ? undefined : numberField(existing?.startMin);
    const existingEnd = existingAllDay ? undefined : numberField(existing?.endMin);
    const existingDuration =
      existingStart != null && existingEnd != null ? Math.max(15, existingEnd - existingStart) : DEFAULT_DURATION_MIN;
    const rawStart = input.startMin ?? existingStart;
    const rawEnd =
      input.endMin ??
      (rawStart != null && input.startMin != null ? rawStart + existingDuration : existingEnd);
    if (typeof rawStart !== "number" || typeof rawEnd !== "number") {
      throw new Error("Timed events need startMin and endMin (minutes from midnight), or set allDay:true.");
    }
    const startMin = snapMinutes(rawStart);
    let endMin = snapMinutes(rawEnd);
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

// Set or clear the per-event color OVERRIDE on a batch of events (the calendar's
// "recolor" action, fanned out). Pick the targets by explicit `ids`, or by
// `activityId` (every placement of that activity), optionally narrowed to a
// date range. `color: null` clears the override so the event falls back to the
// activity/category tint. Other fields are untouched.
export async function recolorEvents(input: {
  ids?: string[];
  activityId?: string;
  from?: string;
  to?: string;
  color: string | null;
}): Promise<{ ok: true; recolored: number; ids: string[] }> {
  const color = input.color === null ? null : normalizeHexColor(input.color);
  if (input.color !== null && !color) {
    throw new Error(`color must be a hex like #2f6f4e or #abc (got "${input.color}"), or null to clear.`);
  }

  const idSet = input.ids?.length ? new Set(input.ids.map((id) => id.toLowerCase())) : null;
  const range = idSet ? undefined : { from: input.from, to: input.to };
  const rows = await listCalendarEvents(uid(), range);

  let targets = rows;
  if (idSet) targets = rows.filter((row) => idSet.has(row.id.toLowerCase()));
  else if (input.activityId) targets = rows.filter((row) => row.activityId === input.activityId);
  else throw new Error("Provide ids[] or an activityId to choose which events to recolor.");

  const changed: string[] = [];
  for (const row of targets) {
    const payload: Record<string, unknown> = { ...row, updatedAt: Date.now() };
    if (color) payload.color = color;
    else delete payload.color;
    const result = await upsertCalendarEvent(uid(), payload);
    if (result.ok) changed.push(row.id);
  }
  return { ok: true, recolored: changed.length, ids: changed };
}

// Duplicate one event into a standalone copy (the calendar's "Duplicate"
// action). The copy gets a fresh id and is detached from any series (seriesId +
// recurrence dropped), mirroring the app. By default it lands on the same
// date/time; pass `date` and/or `startMin` to drop it elsewhere (endMin follows
// the original's duration unless given).
export async function duplicateEvent(input: {
  id: string;
  date?: string;
  startMin?: number;
  endMin?: number;
}): Promise<StoredCalendarEvent> {
  const existing = await findExistingEvent(input.id);
  if (!existing) throw new Error(`No event with id ${input.id}.`);

  const payload: Record<string, unknown> = { ...existing, id: randomEventId(), updatedAt: Date.now() };
  delete payload.seriesId;
  delete payload.recurrence;
  if (input.date) payload.date = input.date;

  const allDay = existing.allDay === true || existing.startMin == null || existing.endMin == null;
  if (!allDay && (input.startMin != null || input.endMin != null)) {
    const duration =
      typeof existing.startMin === "number" && typeof existing.endMin === "number"
        ? Math.max(15, existing.endMin - existing.startMin)
        : DEFAULT_DURATION_MIN;
    const startMin = snapMinutes(input.startMin ?? (existing.startMin as number));
    let endMin = snapMinutes(input.endMin ?? startMin + duration);
    if (endMin <= startMin) endMin = startMin + 15;
    payload.startMin = startMin;
    payload.endMin = endMin;
  }

  const result = await upsertCalendarEvent(uid(), payload);
  if (!result.ok) throw new Error("Duplicate rejected as invalid. Check date and times.");
  return result.event;
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

/* ---------------------------------------------------------- recurring series */
//
// A "series" is a set of real calendar rows that share one `seriesId` and each
// carry the same `recurrence` rule (the materialized-occurrence model — see
// lib/calendar/recurrence). These wrappers reuse the app's OWN pure planners
// (buildSeriesEvents / planSeriesEdit / planSeriesDelete / planSeriesSkip) so
// every write is byte-identical to what the calendar UI produces, then persist
// the plan through the same upsert/delete path as one-off events.

// Load every event for the owner as a clean CalendarEvent map — the working set
// the scoped planners reason over (they expect the in-app event shape, including
// the seriesId/recurrence that ride in each row's JSONB payload).
async function loadEventMap(): Promise<Record<string, CalendarEvent>> {
  const stored = await listCalendarEvents(uid());
  const out: Record<string, CalendarEvent> = {};
  for (const row of stored) {
    const event = normalizeCalendarEvent(row);
    if (event) out[event.id] = event;
  }
  return out;
}

// The fields a series shares (everything except per-occurrence id + date),
// snapped to the 15-minute grid exactly like upsertEvent / the editor's draft.
function buildSeriesTemplate(input: {
  startMin?: number;
  endMin?: number;
  allDay?: boolean;
  title?: string;
  activityId?: string;
  campId?: string;
  color?: string;
}): SeriesTemplate {
  const allDay = input.allDay === true;
  let startMin = 0;
  let endMin = 0;
  if (!allDay) {
    if (typeof input.startMin !== "number" || typeof input.endMin !== "number") {
      throw new Error("Timed series need startMin and endMin (minutes from midnight), or set allDay:true.");
    }
    startMin = snapMinutes(input.startMin);
    endMin = snapMinutes(input.endMin);
    if (endMin <= startMin) endMin = startMin + 15;
    if (startMin < 0 || endMin > MINUTES_PER_DAY) {
      throw new Error("Event times must fall within 0–1440 minutes (one day).");
    }
  }
  const template: SeriesTemplate = {
    startMin,
    endMin,
    allDay,
    kind: input.activityId ? "activity" : "custom",
    title: (input.title ?? "").slice(0, 200) || "Untitled",
  };
  if (input.activityId) template.activityId = input.activityId;
  if (input.campId) template.campId = input.campId;
  if (input.color) {
    const color = normalizeHexColor(input.color);
    if (color) template.color = color;
  }
  return template;
}

// Apply a {upserts, removes} plan the way the app's commitEvents does: write the
// new occurrences first, then delete only the ids NOT being rewritten — so a
// regenerated series keeps its reused anchor id instead of deleting it.
async function applyPlan(upserts: CalendarEvent[], removes: string[]): Promise<void> {
  const upsertedIds = new Set(upserts.map((event) => event.id));
  for (const event of upserts) {
    const result = await upsertCalendarEvent(uid(), { ...event, updatedAt: Date.now() });
    if (!result.ok) {
      throw new Error(`Series occurrence rejected as invalid (date ${event.date}). Check times and activityId.`);
    }
  }
  for (const id of removes) {
    if (upsertedIds.has(id)) continue;
    await deleteCalendarEvent(uid(), id);
  }
}

export type SeriesSummary = {
  ok: true;
  seriesId: string;
  rule: string;
  dates: DateKey[];
  count: number;
  created?: number;
  removed?: number;
};

export type RecurrenceInput = {
  freq: "daily" | "weekly" | "monthly" | "yearly";
  interval?: number;
  weekdays?: number[];
  monthDay?: number;
  nthWeekday?: { week: number; weekday: number };
  until: string;
  exdates?: string[];
};

export type CreateSeriesInput = {
  date: string;
  startMin?: number;
  endMin?: number;
  allDay?: boolean;
  title?: string;
  activityId?: string;
  campId?: string;
  color?: string;
  recurrence: RecurrenceInput;
};

// Materialize a brand-new repeating event into one real row per occurrence date.
export async function createSeries(input: CreateSeriesInput): Promise<SeriesSummary> {
  const rule = normalizeRecurrence(input.recurrence);
  if (!rule) {
    throw new Error(
      "Invalid recurrence rule. Needs freq (daily/weekly/monthly/yearly) and until (YYYY-MM-DD); weekly takes weekdays[] (0=Sun..6=Sat), monthly/yearly takes monthDay (1-31) or nthWeekday {week:1..4|-1, weekday:0..6}.",
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    throw new Error(`Start date must be YYYY-MM-DD (got "${input.date}").`);
  }
  const template = buildSeriesTemplate(input);
  const seriesId = randomEventId();
  const anchorId = randomEventId();
  const dates = recurrenceDates(input.date, rule);
  const occurrences = buildSeriesEvents(template, dates, seriesId, rule, randomEventId, input.date, anchorId);
  await applyPlan(occurrences, []);
  return { ok: true, seriesId, rule: summarizeRecurrence(rule), dates, count: occurrences.length, created: occurrences.length };
}

export type EditSeriesInput = {
  id: string;
  scope: SeriesScope;
  date?: string;
  startMin?: number;
  endMin?: number;
  allDay?: boolean;
  title?: string;
  activityId?: string;
  campId?: string;
  color?: string;
  recurrence?: RecurrenceInput;
  stopRepeating?: boolean;
};

// Scoped edit of an existing series (this / following / all), mirroring the
// app's SeriesScopeDialog. Unspecified template fields inherit the target
// occurrence's current values, so an agent can change just the title or time.
// The rule defaults to the series' existing rule unless a new `recurrence` is
// given, or `stopRepeating` collapses the chosen scope to a single event.
export async function editSeries(input: EditSeriesInput): Promise<SeriesSummary> {
  const all = await loadEventMap();
  const target = all[input.id.toLowerCase()] ?? all[input.id];
  if (!target) throw new Error(`No event with id ${input.id}.`);
  if (!target.seriesId) throw new Error(`Event ${input.id} is not part of a repeating series. Use upsert_event to edit a one-off.`);

  const before = eventsInSeries(all, target.seriesId);
  const template = buildSeriesTemplate({
    startMin: input.startMin ?? target.startMin,
    endMin: input.endMin ?? target.endMin,
    allDay: input.allDay ?? target.allDay ?? false,
    title: input.title ?? target.title,
    activityId: input.activityId ?? target.activityId,
    campId: input.campId ?? target.campId,
    color: input.color ?? target.color,
  });

  const rule = input.stopRepeating
    ? undefined
    : input.recurrence
      ? normalizeRecurrence(input.recurrence) ?? undefined
      : target.recurrence;
  if (!input.stopRepeating && input.recurrence && !rule) {
    throw new Error("Invalid recurrence rule. Needs freq and until (YYYY-MM-DD).");
  }

  const draftDate = input.date ?? target.date;
  const plan = planSeriesEdit(before, target, template, draftDate, rule, input.scope, randomEventId);
  await applyPlan(plan.upserts, plan.removes);

  const after = eventsInSeries(await loadEventMap(), target.seriesId);
  return {
    ok: true,
    seriesId: target.seriesId,
    rule: rule ? summarizeRecurrence(rule) : "no longer repeats",
    dates: after.map((event) => event.date),
    count: after.length,
    created: plan.upserts.length,
    removed: plan.removes.filter((id) => !plan.upserts.some((event) => event.id === id)).length,
  };
}

// Scoped delete of a repeating event (this / following / all), mirroring the
// app: scope "this" SKIPS the single occurrence (removes it AND records its date
// as an exdate on the survivors so a later regeneration won't resurrect it);
// "following" / "all" remove that slice of the series outright.
export async function deleteSeries(input: { id: string; scope: SeriesScope }): Promise<{ ok: true; seriesId: string; removed: number; skipped?: string }> {
  const all = await loadEventMap();
  const target = all[input.id.toLowerCase()] ?? all[input.id];
  if (!target) throw new Error(`No event with id ${input.id}.`);
  if (!target.seriesId) throw new Error(`Event ${input.id} is not part of a repeating series. Use delete_event for a one-off.`);

  const series = eventsInSeries(all, target.seriesId);
  if (input.scope === "this") {
    const plan = planSeriesSkip(series, target);
    await applyPlan(plan.upserts, plan.removes);
    return { ok: true, seriesId: target.seriesId, removed: 1, skipped: target.date };
  }
  const ids = planSeriesDelete(series, target, input.scope);
  await applyPlan([], ids);
  return { ok: true, seriesId: target.seriesId, removed: ids.length };
}

// Hard-delete an arbitrary set of events by id (idempotent). The general
// "delete several events at once" verb, independent of any series.
export async function deleteEvents(ids: string[]): Promise<{ ok: true; deleted: number; ids: string[] }> {
  const deleted: string[] = [];
  for (const id of ids) {
    if (await deleteCalendarEvent(uid(), id)) deleted.push(id);
  }
  return { ok: true, deleted: deleted.length, ids: deleted };
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
    name: name.slice(0, MAX_CAMP_NAME),
    createdAt: Date.now(),
    openMin: DEFAULT_OPEN_MIN,
    closeMin: DEFAULT_CLOSE_MIN,
  };
  await putUserDoc(uid(), "camps", [...camps, camp]);
  return camp;
}

// Rename a camp and/or move its viewing hours (drop-off → pickup), mirroring the
// calendar's "Manage camps…" editor. Hours are clamped onto the 15-minute grid
// inside the selectable range, open kept strictly before close. Returns the
// updated camp.
export async function editCamp(input: {
  id: string;
  name?: string;
  openMin?: number;
  closeMin?: number;
}): Promise<Camp> {
  const docs = await getUserDocs(uid());
  const camps = (docs.camps as Camp[] | undefined) ?? [];
  const current = camps.find((c) => c.id === input.id);
  if (!current) throw new Error(`Unknown campId "${input.id}". Call list_context first.`);

  const name = input.name != null ? input.name.trim().slice(0, MAX_CAMP_NAME) : current.name;
  if (!name) throw new Error("Camp name cannot be empty.");
  const { openMin, closeMin } = clampOpenClose(input.openMin ?? current.openMin, input.closeMin ?? current.closeMin);
  const updated: Camp = { ...current, name, openMin, closeMin };

  await putUserDoc(uid(), "camps", camps.map((c) => (c.id === input.id ? updated : c)));
  return updated;
}

// Delete a camp, mirroring the app: the camp just drops off the list. Its events
// keep their (now dangling) campId and fall back to "unscoped", so they stay on
// the calendar — no per-event rewrite storm. Idempotent.
export async function deleteCamp(id: string): Promise<{ ok: true; id: string; existed: boolean }> {
  const docs = await getUserDocs(uid());
  const camps = (docs.camps as Camp[] | undefined) ?? [];
  const existed = camps.some((c) => c.id === id);
  if (existed) await putUserDoc(uid(), "camps", camps.filter((c) => c.id !== id));
  return { ok: true, id, existed };
}

export async function addTheme(label: string): Promise<Theme> {
  const docs = await getUserDocs(uid());
  const themes = (docs.themes as Theme[] | undefined) ?? [];
  const theme: Theme = { id: createThemeId(), label: label.slice(0, MAX_THEME_LABEL), tint: nextPaletteTint(themes.length) };
  await putUserDoc(uid(), "themes", [...themes, theme]);
  return theme;
}

// Rename a theme tag. Tint is fixed (palette-assigned at creation). Returns the
// updated theme.
export async function editTheme(id: string, label: string): Promise<Theme> {
  const docs = await getUserDocs(uid());
  const themes = (docs.themes as Theme[] | undefined) ?? [];
  const current = themes.find((t) => t.id === id);
  if (!current) throw new Error(`Unknown themeId "${id}". Call list_context first.`);
  const trimmed = label.trim().slice(0, MAX_THEME_LABEL);
  if (!trimmed) throw new Error("Theme label cannot be empty.");
  const updated: Theme = { ...current, label: trimmed };
  await putUserDoc(uid(), "themes", themes.map((t) => (t.id === id ? updated : t)));
  return updated;
}

// Delete a theme AND purge every assignment that referenced it (so no activity
// is left pointing at a dead id), mirroring the app. Idempotent.
export async function deleteTheme(id: string): Promise<{ ok: true; id: string; existed: boolean; unassigned: number }> {
  const docs = await getUserDocs(uid());
  const themes = (docs.themes as Theme[] | undefined) ?? [];
  const existed = themes.some((t) => t.id === id);
  if (existed) await putUserDoc(uid(), "themes", themes.filter((t) => t.id !== id));

  const map = (docs.themeAssignments as Record<string, string> | undefined) ?? {};
  const next: Record<string, string> = {};
  let unassigned = 0;
  for (const [activityId, themeId] of Object.entries(map)) {
    if (themeId === id) unassigned += 1;
    else next[activityId] = themeId;
  }
  if (unassigned) await putUserDoc(uid(), "themeAssignments", next);
  return { ok: true, id, existed, unassigned };
}

export async function assignTheme(activityId: string, themeId: string): Promise<void> {
  const docs = await getUserDocs(uid());
  const map = (docs.themeAssignments as Record<string, string> | undefined) ?? {};
  await putUserDoc(uid(), "themeAssignments", { ...map, [activityId]: themeId });
}

// Remove an activity's theme tag (leaves the theme itself intact). Idempotent.
export async function unassignTheme(activityId: string): Promise<void> {
  const docs = await getUserDocs(uid());
  const map = (docs.themeAssignments as Record<string, string> | undefined) ?? {};
  if (map[activityId] == null) return;
  const next = { ...map };
  delete next[activityId];
  await putUserDoc(uid(), "themeAssignments", next);
}

export async function setRating(activityId: string, rating: number): Promise<void> {
  const docs = await getUserDocs(uid());
  const map = (docs.ratings as Record<string, number> | undefined) ?? {};
  await putUserDoc(uid(), "ratings", { ...map, [activityId]: Math.max(0, Math.min(5, Math.round(rating))) });
}

export async function addCustomActivity(partial: Partial<Activity> & { title: string }): Promise<Activity | null> {
  const docs = await getUserDocs(uid());
  const extra = (docs.extra as Activity[] | undefined) ?? [];
  const deletedActivityIds = (docs.deletedActivityIds as string[] | undefined) ?? [];
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
    ...(normalizeHexColor(partial.color) ? { color: normalizeHexColor(partial.color) } : {}),
  };
  await putUserDoc(uid(), "extra", upsertActivityRecord(extra, activity));
  if (deletedActivityIds.includes(activity.id)) {
    await putUserDoc(uid(), "deletedActivityIds", deletedActivityIds.filter((id) => id !== activity.id));
  }
  // putUserDoc normalizes via normalizeActivities; confirm it survived.
  const after = await getUserDocs(uid());
  const saved = ((after.extra as Activity[] | undefined) ?? []).find((a) => a.id === activity.id);
  return saved ?? null;
}

// Set or clear a library activity's DEFAULT color (the tint it shows in the
// catalog, and the seed when placed on the calendar). Works on built-in books
// too: like the app's own editor, the full record is promoted into the synced
// `extra` list with the same id so it shadows the seed (no backfill, reversible
// by clearing). `color: null` removes the override so it falls back to its
// category tint. Returns the saved activity.
export async function setActivityColor(activityId: string, color: string | null): Promise<Activity> {
  const normalized = color === null ? null : normalizeHexColor(color);
  if (color !== null && !normalized) {
    throw new Error(`color must be a hex like #2f6f4e or #abc (got "${color}"), or null to reset to the category tint.`);
  }

  const catalog = await getActivityCatalog();
  const current = catalog.find((a) => a.id === activityId);
  if (!current) throw new Error(`Unknown activityId "${activityId}". Call search_activities or list_context first.`);

  const next: Activity = { ...current };
  if (normalized) next.color = normalized;
  else delete next.color;

  const docs = await getUserDocs(uid());
  const extra = (docs.extra as Activity[] | undefined) ?? [];
  const deletedActivityIds = (docs.deletedActivityIds as string[] | undefined) ?? [];
  await putUserDoc(uid(), "extra", upsertActivityRecord(extra, next));
  if (deletedActivityIds.includes(activityId)) {
    await putUserDoc(uid(), "deletedActivityIds", deletedActivityIds.filter((id) => id !== activityId));
  }

  const after = await getUserDocs(uid());
  const saved = ((after.extra as Activity[] | undefined) ?? []).find((a) => a.id === activityId);
  if (!saved) throw new Error("Activity color edit failed validation.");
  return saved;
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
