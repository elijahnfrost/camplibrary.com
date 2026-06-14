"use client";

// Activity-domain state and mutations, extracted from the CampApp shell.
// Reads/writes go through the cloud store's synced docs; every mutation is
// gated by requireStaff. The shell keeps navigation, auth, and overlays.

import { useCallback, useMemo } from "react";
import type { CloudUserData } from "@/lib/cloudStore";
import { ACTIVITIES } from "@/lib/data";
import { hasRequiredMaterials, materialOptionsForActivities } from "@/lib/materials";
import { PLAYBOOKS_BY_ACTIVITY_ID, type ActivityPlaybookData } from "@/lib/playbooks";
import {
  buildRunDoc,
  ensureSectionHeadings,
  promoteMaterialsBlocks,
  rekeyRunDoc,
  type RunDoc,
} from "@/lib/runList";
import type { Activity, LibraryView } from "@/lib/types";

export function useActivityLibrary({
  cloud,
  requireStaff,
  announce,
}: {
  cloud: CloudUserData;
  requireStaff: (action: string) => boolean;
  announce: (message: string) => void;
}) {
  const { docs, setDoc } = cloud;
  const { favs, extra, ratings, runLists: runListOverrides, playbookOverrides, view } = docs;
  const availableMaterials = docs.availableMaterials;

  const setView = useCallback((next: LibraryView) => setDoc("view", next), [setDoc]);

  // The catalog: seed + custom activities, with the user's ratings applied.
  const all = useMemo(() => {
    const base = [...extra, ...ACTIVITIES];
    return base.map((a) => (ratings[a.id] != null ? { ...a, rating: ratings[a.id] } : a));
  }, [extra, ratings]);

  const byId = useMemo(() => {
    const m: Record<string, Activity> = {};
    all.forEach((a) => (m[a.id] = a));
    return m;
  }, [all]);

  const materialOptions = useMemo(() => materialOptionsForActivities(all), [all]);
  const activeAvailableMaterials = useMemo(() => {
    const optionIds = new Set(materialOptions.map((option) => option.id));
    return availableMaterials.filter((id) => optionIds.has(id));
  }, [availableMaterials, materialOptions]);

  const toggleAvailableMaterial = useCallback(
    (id: string) => {
      if (!requireStaff("update available kit")) return;
      setDoc("availableMaterials", (previous) =>
        previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]
      );
    },
    [requireStaff, setDoc]
  );
  const clearAvailableMaterials = useCallback(() => {
    if (!requireStaff("update available kit")) return;
    setDoc("availableMaterials", []);
  }, [requireStaff, setDoc]);

  const favSet = useMemo(() => new Set(favs), [favs]);
  const isFav = useCallback((id: string) => favSet.has(id), [favSet]);
  const toggleFav = useCallback(
    (id: string) => {
      if (!requireStaff("save activities")) return;
      setDoc("favs", (p) => (p.indexOf(id) !== -1 ? p.filter((x) => x !== id) : [id, ...p.filter((x) => x !== id)]));
    },
    [requireStaff, setDoc]
  );

  const setRating = useCallback(
    (id: string, value: number) => {
      if (!requireStaff("rate activities")) return;
      setDoc("ratings", (p) => ({ ...p, [id]: value }));
    },
    [requireStaff, setDoc]
  );

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
      setDoc("runLists", (p) => ({ ...p, [activityId]: doc }));
    },
    [requireStaff, setDoc]
  );

  const addActivity = useCallback(
    (activity: Activity, runDoc?: RunDoc) => {
      if (!requireStaff("add activities")) return false;
      setDoc("extra", (p) => [activity, ...p]);
      if (runDoc) setDoc("runLists", (p) => ({ ...p, [activity.id]: runDoc }));
      announce("Added " + activity.title + " to the library");
      return true;
    },
    [announce, requireStaff, setDoc]
  );

  const updateActivity = useCallback(
    (activity: Activity, runDoc?: RunDoc) => {
      if (!requireStaff("edit activities")) return false;
      setDoc("extra", (p) => p.map((x) => (x.id === activity.id ? activity : x)));
      if (runDoc) setDoc("runLists", (p) => ({ ...p, [activity.id]: runDoc }));
      setDoc("ratings", (p) => {
        if (activity.rating > 0) return { ...p, [activity.id]: activity.rating };
        if (p[activity.id] == null) return p;
        const next = { ...p };
        delete next[activity.id];
        return next;
      });
      announce("Updated " + activity.title);
      return true;
    },
    [announce, requireStaff, setDoc]
  );

  // Duplicate any activity (built-in or custom) into a fresh custom copy. The
  // run doc is resolved, then re-keyed onto the new id so the two activities
  // never share block identity (rekeyRunDoc handles the derived -details ids).
  const duplicateActivity = useCallback(
    (activity: Activity): Activity | null => {
      if (!requireStaff("add activities")) return null;
      const slug = activity.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const newId = (slug || "activity") + "-copy-" + Date.now().toString(36);
      const copy: Activity = { ...activity, id: newId, title: activity.title + " (copy)" };
      const sourceDoc = resolveRunDoc(activity);
      const copiedDoc = rekeyRunDoc(sourceDoc, activity.id, newId);
      setDoc("extra", (p) => [copy, ...p]);
      setDoc("runLists", (p) => ({ ...p, [newId]: copiedDoc }));
      if (copy.rating > 0) setDoc("ratings", (p) => ({ ...p, [newId]: copy.rating }));
      announce("Duplicated " + activity.title);
      return copy;
    },
    [announce, requireStaff, resolveRunDoc, setDoc]
  );

  // Calendar events referencing a deleted activity self-heal on read
  // (lib/calendar/adapter), so no calendar scrub is needed here.
  const deleteActivity = useCallback(
    (activity: Activity): boolean => {
      if (!requireStaff("delete activities")) return false;
      if (!window.confirm("Delete “" + activity.title + "”? Calendar events using it become plain events.")) {
        return false;
      }
      setDoc("extra", (p) => p.filter((x) => x.id !== activity.id));
      setDoc("favs", (p) => p.filter((id) => id !== activity.id));
      setDoc("ratings", (p) => {
        if (p[activity.id] == null) return p;
        const next = { ...p };
        delete next[activity.id];
        return next;
      });
      setDoc("runLists", (p) => {
        if (p[activity.id] == null) return p;
        const next = { ...p };
        delete next[activity.id];
        return next;
      });
      setDoc("playbookOverrides", (p) => {
        if (p[activity.id] == null) return p;
        const next = { ...p };
        delete next[activity.id];
        return next;
      });
      announce("Deleted " + activity.title);
      return true;
    },
    [announce, requireStaff, setDoc]
  );

  return {
    view,
    setView,
    all,
    byId,
    favs,
    favSet,
    isFav,
    toggleFav,
    setRating,
    materialOptions,
    activeAvailableMaterials,
    toggleAvailableMaterial,
    clearAvailableMaterials,
    isCustomActivity,
    resolvePlaybook,
    resolveRunDoc,
    saveRunDoc,
    addActivity,
    updateActivity,
    duplicateActivity,
    deleteActivity,
  };
}

export type ActivityLibrary = ReturnType<typeof useActivityLibrary>;
