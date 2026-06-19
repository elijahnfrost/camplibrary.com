"use client";

// Activity-domain state and mutations, extracted from the CampApp shell.
// Reads/writes go through the cloud store's synced docs; every mutation is
// gated by requireStaff. The shell keeps navigation, auth, and overlays.

import { useCallback, useMemo } from "react";
import type { CloudUserData } from "@/lib/cloudStore";
import { ACTIVITIES } from "@/lib/data";
import { hasRequiredMaterials, materialOptionsForActivities } from "@/lib/materials";
import { type ActivityPlaybookData } from "@/lib/playbooks";
import { rekeyRunDoc, type RunDoc } from "@/lib/runList";
import {
  resolvePlaybook as resolvePlaybookFor,
  resolveRunDoc as resolveRunDocFor,
} from "@/lib/runListResolve";
import { createThemeId, MAX_THEME_LABEL, nextPaletteTint, type Theme } from "@/lib/themes";
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
  const { themes, themeAssignments } = docs;

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
      const nowSaved = !favSet.has(id);
      setDoc("favs", (p) => (p.indexOf(id) !== -1 ? p.filter((x) => x !== id) : [id, ...p.filter((x) => x !== id)]));
      // Announce like the other library mutations do, so the save toggle isn't
      // silent to assistive tech (the icon-only star has no text change).
      const title = byId[id]?.title ?? "activity";
      announce(nowSaved ? "Saved " + title : "Removed " + title + " from saved");
    },
    [announce, byId, favSet, requireStaff, setDoc]
  );

  const setRating = useCallback(
    (id: string, value: number) => {
      if (!requireStaff("rate activities")) return;
      setDoc("ratings", (p) => ({ ...p, [id]: value }));
    },
    [requireStaff, setDoc]
  );

  // ---- Themes: a user-definable tag axis. The vocabulary lives in the
  // `themes` doc; the per-activity assignment in `themeAssignments` (mirroring
  // the ratings map, so it works for built-in AND custom activities and rides
  // the existing delete/duplicate cleanup). ----
  const themeById = useMemo(() => {
    const map: Record<string, Theme> = {};
    themes.forEach((theme) => (map[theme.id] = theme));
    return map;
  }, [themes]);

  // Resolve an activity's theme, degrading to null for unassigned activities or
  // assignments whose theme was since deleted.
  const themeOf = useCallback(
    (activityId: string): Theme | null => themeById[themeAssignments[activityId]] ?? null,
    [themeById, themeAssignments]
  );

  const assignTheme = useCallback(
    (activityId: string, themeId: string | null) => {
      setDoc("themeAssignments", (prev) => {
        if (!themeId) {
          if (prev[activityId] == null) return prev;
          const next = { ...prev };
          delete next[activityId];
          return next;
        }
        if (prev[activityId] === themeId) return prev;
        return { ...prev, [activityId]: themeId };
      });
    },
    [setDoc]
  );

  const createTheme = useCallback(
    (label: string): Theme | null => {
      const trimmed = label.trim().slice(0, MAX_THEME_LABEL);
      if (!trimmed) return null;
      const theme: Theme = { id: createThemeId(), label: trimmed, tint: nextPaletteTint(themes.length) };
      setDoc("themes", (prev) => [...prev, theme]);
      return theme;
    },
    [setDoc, themes.length]
  );

  const renameTheme = useCallback(
    (id: string, label: string) => {
      const trimmed = label.trim().slice(0, MAX_THEME_LABEL);
      if (!trimmed) return;
      setDoc("themes", (prev) => prev.map((theme) => (theme.id === id ? { ...theme, label: trimmed } : theme)));
    },
    [setDoc]
  );

  // Deleting a theme drops it from the vocabulary AND purges every assignment
  // that referenced it, so no activity is left pointing at a dead id.
  const deleteTheme = useCallback(
    (id: string) => {
      setDoc("themes", (prev) => prev.filter((theme) => theme.id !== id));
      setDoc("themeAssignments", (prev) => {
        let changed = false;
        const next: Record<string, string> = {};
        for (const [activityId, themeId] of Object.entries(prev)) {
          if (themeId === id) {
            changed = true;
            continue;
          }
          next[activityId] = themeId;
        }
        return changed ? next : prev;
      });
    },
    [setDoc]
  );

  const isCustomActivity = useCallback((id: string) => extra.some((e) => e.id === id), [extra]);

  // A custom book carries its own diagram; built-in books fall back to an
  // editable override, then the seed registry. (Logic lives in lib/runListResolve
  // so the server-rendered public run-sheet page resolves identically.)
  const resolvePlaybook = useCallback(
    (activity: Activity): ActivityPlaybookData | null => resolvePlaybookFor(activity, playbookOverrides),
    [playbookOverrides]
  );

  // The Run List doc: a saved override if one exists, else derived from the
  // activity — its steps/notes/safety plus a materials block and (when the
  // activity has one) the field diagram seeded in as a diagram block.
  const resolveRunDoc = useCallback(
    (activity: Activity): RunDoc => resolveRunDocFor(activity, runListOverrides, playbookOverrides),
    [runListOverrides, playbookOverrides]
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
      // Carry the source's theme onto the copy (the source may be a built-in,
      // so this reads from the assignment map, not the activity object).
      setDoc("themeAssignments", (p) => (p[activity.id] ? { ...p, [newId]: p[activity.id] } : p));
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
      setDoc("themeAssignments", (p) => {
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
    themes,
    themeAssignments,
    themeById,
    themeOf,
    assignTheme,
    createTheme,
    renameTheme,
    deleteTheme,
  };
}

export type ActivityLibrary = ReturnType<typeof useActivityLibrary>;
