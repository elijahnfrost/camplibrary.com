"use client";

// Multiple-camps state, kept deliberately lean. A camp is a switchable
// container for calendar events; the Library catalog stays shared. The camps
// list starts EMPTY and the calendar shows every event with no camp UI, so a
// user who only runs one camp sees nothing new. Once a camp exists, events are
// filtered to the active camp (plus unscoped/ambient events), and freshly
// created events inherit the active camp. Nothing here touches the DB schema —
// campId rides in the event payload and the camps list is a synced user-doc.

import { useCallback, useEffect, useMemo } from "react";
import type { CloudUserData } from "@/lib/cloudStore";
import type { CalendarEvent } from "@/lib/calendar/types";
import {
  createCampId,
  DEFAULT_CLOSE_MIN,
  DEFAULT_OPEN_MIN,
  MAX_CAMP_NAME,
  withCampClose,
  withCampOpen,
  type Camp,
} from "@/lib/camps";
import { useLocalStorage } from "@/lib/store";
import { requestConfirm } from "./ConfirmDialog";

const activeCampStorage = (value: unknown, fallback: string | null): string | null =>
  typeof value === "string" || value === null ? (value as string | null) : fallback;

export function useCamps({
  cloud,
  announce,
}: {
  cloud: CloudUserData;
  announce: (message: string) => void;
}) {
  const { docs, setDoc, events, upsertEvent, upsertEvents, commitEvents } = cloud;
  const camps = docs.camps;

  const campIds = useMemo(() => new Set(camps.map((c) => c.id)), [camps]);

  const [storedActiveCampId, setStoredActiveCampId] = useLocalStorage<string | null>(
    "activeCamp",
    null,
    activeCampStorage
  );

  // The resolved active camp: none when there are no camps; otherwise the
  // stored choice if it still exists, else the oldest camp. This keeps a
  // deleted/stale id (incl. one removed on another device) from stranding the
  // calendar on an empty, nonexistent camp.
  const activeCampId = useMemo(() => {
    if (camps.length === 0) return null;
    if (storedActiveCampId && campIds.has(storedActiveCampId)) return storedActiveCampId;
    return camps[0].id;
  }, [camps, campIds, storedActiveCampId]);

  // Keep the persisted value aligned with what we actually resolved to.
  useEffect(() => {
    if (storedActiveCampId !== activeCampId) setStoredActiveCampId(activeCampId);
  }, [activeCampId, storedActiveCampId, setStoredActiveCampId]);

  const activeCamp = useMemo(
    () => camps.find((c) => c.id === activeCampId) ?? null,
    [camps, activeCampId]
  );

  const switchCamp = useCallback(
    (id: string) => {
      const target = camps.find((c) => c.id === id);
      if (!target) return;
      setStoredActiveCampId(id);
      announce("Showing " + target.name);
    },
    [camps, setStoredActiveCampId, announce]
  );

  const createCamp = useCallback(
    async (name: string): Promise<Camp | null> => {
      const trimmed = name.trim().slice(0, MAX_CAMP_NAME);
      if (!trimmed) return null;
      const camp: Camp = {
        id: createCampId(),
        name: trimmed,
        createdAt: Date.now(),
        openMin: DEFAULT_OPEN_MIN,
        closeMin: DEFAULT_CLOSE_MIN,
      };
      const isFirst = camps.length === 0;
      setDoc("camps", (prev) => [...prev, camp]);
      setStoredActiveCampId(camp.id);
      // First camp only: offer to bring the existing (unscoped) schedule into
      // it, so a returning user's calendar becomes their first camp rather than
      // appearing empty. A one-time, explicitly-confirmed adoption. This confirm
      // stacks on top of the camps ListManagerModal (a leaf dialog) — fine, the
      // dialog stack in useDialogFocus resolves Escape ordering.
      if (isFirst) {
        const unscoped = Object.values(events).filter((e) => !e.campId);
        if (unscoped.length) {
          const ok = await requestConfirm({
            title:
              "Move your " +
              unscoped.length +
              " existing event" +
              (unscoped.length === 1 ? "" : "s") +
              " into “" +
              trimmed +
              "”?",
          });
          if (ok) {
            for (const event of unscoped) upsertEvent({ ...event, campId: camp.id });
          }
        }
      }
      announce("Created " + trimmed);
      return camp;
    },
    [camps.length, events, setDoc, setStoredActiveCampId, upsertEvent, announce]
  );

  const renameCamp = useCallback(
    (id: string, name: string) => {
      const trimmed = name.trim().slice(0, MAX_CAMP_NAME);
      if (!trimmed) return;
      setDoc("camps", (prev) => prev.map((c) => (c.id === id ? { ...c, name: trimmed } : c)));
    },
    [setDoc]
  );

  // Adjust one camp's viewing hours. Open/close cross-clamp (moving open past
  // close pushes close out, and vice versa) via the camp helpers; the calendar
  // window follows the active camp's hours, so this repaints the grid.
  const adjustCampHours = useCallback(
    (id: string, field: "open" | "close", value: number) => {
      setDoc("camps", (prev) =>
        prev.map((c) =>
          c.id === id ? (field === "open" ? withCampOpen(c, value) : withCampClose(c, value)) : c
        )
      );
    },
    [setDoc]
  );

  // Deleting a camp just drops it from the list — its events keep their (now
  // dangling) campId and fall back to "unscoped", so they stay on the calendar
  // and there is no per-event rewrite storm against the API.
  const deleteCamp = useCallback(
    (id: string) => {
      setDoc("camps", (prev) => prev.filter((c) => c.id !== id));
    },
    [setDoc]
  );

  // Show events belonging to the active camp PLUS unscoped/ambient events (no
  // campId, or a campId whose camp was deleted). With no camps, show everything
  // — today's exact behavior.
  const filterEvents = useCallback(
    (all: Record<string, CalendarEvent>): Record<string, CalendarEvent> => {
      if (camps.length === 0) return all;
      const out: Record<string, CalendarEvent> = {};
      for (const [id, event] of Object.entries(all)) {
        const resolved = event.campId && campIds.has(event.campId) ? event.campId : null;
        if (resolved === activeCampId || resolved === null) out[id] = event;
      }
      return out;
    },
    [camps.length, campIds, activeCampId]
  );

  // A drop-in replacement for cloud.upsertEvent that stamps the active camp onto
  // brand-new events only — existing events (moves/edits) keep their own camp.
  const stampingUpsertEvent = useCallback(
    (event: CalendarEvent) => {
      if (activeCampId && !event.campId && !events[event.id]) {
        upsertEvent({ ...event, campId: activeCampId });
      } else {
        upsertEvent(event);
      }
    },
    [activeCampId, events, upsertEvent]
  );

  // The batch counterpart (a recurring series is created/edited as one batch):
  // same rule, stamping the active camp onto each brand-new, unscoped occurrence
  // while leaving existing events on their own camp.
  const stampingUpsertEvents = useCallback(
    (incoming: CalendarEvent[]) => {
      if (!activeCampId) {
        upsertEvents(incoming);
        return;
      }
      upsertEvents(
        incoming.map((event) =>
          !event.campId && !events[event.id] ? { ...event, campId: activeCampId } : event
        )
      );
    },
    [activeCampId, events, upsertEvents]
  );

  // The atomic upsert+delete counterpart (a scoped series edit regenerates some
  // occurrences and removes others in one step). Stamps the active camp onto
  // brand-new, unscoped upserts — same rule as the others — then commits as a
  // single undo step.
  const stampingCommitEvents = useCallback(
    (upserts: CalendarEvent[], removes: string[]) => {
      const stamped =
        activeCampId
          ? upserts.map((event) =>
              !event.campId && !events[event.id] ? { ...event, campId: activeCampId } : event
            )
          : upserts;
      commitEvents(stamped, removes);
    },
    [activeCampId, events, commitEvents]
  );

  return {
    camps,
    activeCampId,
    activeCamp,
    switchCamp,
    createCamp,
    renameCamp,
    deleteCamp,
    adjustCampHours,
    filterEvents,
    upsertEvent: stampingUpsertEvent,
    upsertEvents: stampingUpsertEvents,
    commitEvents: stampingCommitEvents,
  };
}

export type CampKit = ReturnType<typeof useCamps>;
