"use client";

// Activity-domain state and mutations, extracted from the CampApp shell.
// Reads/writes go through the cloud store's synced docs; every mutation is
// gated by requireStaff. The shell keeps navigation, auth, and overlays.

import { useCallback, useMemo } from "react";
import type { CloudUserData } from "@/lib/cloudStore";
import {
  mergeActivityCatalog,
  removeActivityRecord,
  seedActivityIds,
  upsertActivityRecord,
} from "@/lib/activityCatalog";
import { ACTIVITIES } from "@/lib/data";
import { materialOptionsForActivities, resolveRefs } from "@/lib/materials";
import { mintCatalogEntries } from "@/lib/materialCatalog";
import { effectiveKitStock, foldStockWrite, type StockState } from "@/lib/kitStock";
import { type ActivityPlaybookData } from "@/lib/playbooks";
import { rekeyRunDoc, type RunDoc } from "@/lib/runList";
import {
  resolvePlaybook as resolvePlaybookFor,
  resolveRunDoc as resolveRunDocFor,
} from "@/lib/runListResolve";
import { createThemeId, MAX_THEME_LABEL, nextPaletteTint, type Theme } from "@/lib/themes";
import { addLocation, removeLocation, renameLocation as renameInVocab } from "@/lib/locations";
import { normalizeHexColor } from "@/lib/color";
import type { CalendarEvent } from "@/lib/calendar/types";
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
  const { docs, setDoc, events, commitEvents } = cloud;
  const { favs, extra, ratings, runLists: runListOverrides, playbookOverrides, view, deletedActivityIds } = docs;
  const availableMaterials = docs.availableMaterials;
  const materialCatalog = docs.materialCatalog;
  const rawKitStock = docs.kitStock;
  const { themes, themeAssignments, locations, locationColors } = docs;

  const setView = useCallback((next: LibraryView) => setDoc("view", next), [setDoc]);

  // Catalog minting on save: when a saved activity's material refs carry ids the
  // catalog doesn't name yet, append `{id, name}` entries so the vocabulary fills
  // lazily as staff author kit (chunk A left this loop open). Labels come from the
  // activity's own aligned materialRefs/materialTags pairing (the exact typed
  // text — see activityForm's label-preservation scheme), falling back to
  // resolveRefs' three-tier labels. Called from inside the already staff-gated
  // add/update paths, so no extra gate is needed. A no-op (skips the doc write)
  // when every ref id is already known.
  const mintCatalogFor = useCallback(
    (activity: Activity) => {
      const refs = Array.isArray(activity.materialRefs) ? activity.materialRefs : null;
      const tags = Array.isArray(activity.materialTags) ? activity.materialTags : null;
      // Prefer the 1:1 refs↔tags pairing our own save writes (materialTags[i] is
      // the pure typed label for materialRefs[i]); else derive labels via the
      // three-tier resolver so a legacy-shaped activity still mints reasonably.
      const named =
        refs && tags && refs.length === tags.length
          ? refs.map((ref, i) => ({ id: ref.id, label: tags[i] }))
          : resolveRefs(activity).map((ref) => ({ id: ref.id, label: ref.label }));
      if (!named.length) return;
      setDoc("materialCatalog", (previous) => mintCatalogEntries(previous, named));
    },
    [setDoc]
  );

  // The catalog: seed + custom activities, with the user's ratings applied.
  const all = useMemo(() => {
    const base = mergeActivityCatalog(ACTIVITIES, extra, deletedActivityIds);
    return base.map((a) => (ratings[a.id] != null ? { ...a, rating: ratings[a.id] } : a));
  }, [deletedActivityIds, extra, ratings]);

  const seedIds = useMemo(() => seedActivityIds(ACTIVITIES), []);

  const byId = useMemo(() => {
    const m: Record<string, Activity> = {};
    all.forEach((a) => (m[a.id] = a));
    return m;
  }, [all]);

  const materialOptions = useMemo(() => materialOptionsForActivities(all, materialCatalog), [all, materialCatalog]);
  const activeAvailableMaterials = useMemo(() => {
    const optionIds = new Set(materialOptions.map((option) => option.id));
    return availableMaterials.filter((id) => optionIds.has(id));
  }, [availableMaterials, materialOptions]);

  // The 3-state stock the coverage lens + run-sheet reads: the kitStock doc with
  // the legacy availableMaterials boolean set folded in as "have" under any real
  // entry (kitStock wins per key). Empty ({}) is the UNSET state — a fresh
  // account keeps the lens inert.
  const kitStock = useMemo(
    () => effectiveKitStock(rawKitStock, availableMaterials),
    [rawKitStock, availableMaterials]
  );

  // Set ONE material to a stock state, migrating the legacy set add-only on first
  // touch (foldStockWrite never downgrades an existing kitStock state). All kit
  // mutations flow through here so the write is always the merged map. Gated by
  // requireStaff; a no-op for public/anonymous (the gate returns false).
  const setStockState = useCallback(
    (id: string, state: StockState) => {
      if (!requireStaff("update kit stock")) return;
      setDoc("kitStock", (previous) => foldStockWrite(previous, availableMaterials, id, state));
    },
    [availableMaterials, requireStaff, setDoc]
  );

  // ---- Materials catalog edits (the Materials tab's row overflow). Ids are
  // FROZEN forever (stock keys + refs reference them), so a rename edits `name`
  // only and delete is soft (`archived: true`). A rename of a derived-only row
  // (no catalog entry yet) MINTS one under the row's frozen id so the new name
  // sticks. All gated by requireStaff; inert for anonymous/read-only. ----

  // Rename a catalog material — edits `name`, never the id. Mints an entry under
  // `id` when none exists yet (first rename of a derived-only row). A blank name
  // is ignored so a material never loses its label.
  const renameMaterial = useCallback(
    (id: string, name: string) => {
      if (!requireStaff("rename materials")) return;
      const trimmed = name.trim();
      if (!id || !trimmed) return;
      setDoc("materialCatalog", (previous) => {
        if (previous.some((entry) => entry.id === id)) {
          return previous.map((entry) => (entry.id === id ? { ...entry, name: trimmed } : entry));
        }
        // Derived-only row: mint a fresh entry carrying the new name (id frozen).
        return [...previous, { id, name: trimmed }];
      });
    },
    [requireStaff, setDoc]
  );

  // Toggle the consumable flag — mints an entry (carrying the display name so the
  // catalog stays honest) when the row is derived-only. The flag rides verbatim.
  const setMaterialConsumable = useCallback(
    (id: string, name: string, consumable: boolean) => {
      if (!requireStaff("edit materials")) return;
      if (!id) return;
      setDoc("materialCatalog", (previous) => {
        if (previous.some((entry) => entry.id === id)) {
          return previous.map((entry) => {
            if (entry.id !== id) return entry;
            const next = { ...entry };
            if (consumable) next.consumable = true;
            else delete next.consumable;
            return next;
          });
        }
        if (!consumable) return previous; // nothing to record for a fresh false
        const label = name.trim() || id;
        return [...previous, { id, name: label, consumable: true }];
      });
    },
    [requireStaff, setDoc]
  );

  // Soft-archive a material — hides it from the Materials list while its name
  // keeps resolving (the id is referenced forever). Mints the entry first when
  // the row is derived-only so the archived flag has somewhere to live.
  const setMaterialArchived = useCallback(
    (id: string, name: string, archived: boolean) => {
      if (!requireStaff("archive materials")) return;
      if (!id) return;
      setDoc("materialCatalog", (previous) => {
        if (previous.some((entry) => entry.id === id)) {
          return previous.map((entry) => {
            if (entry.id !== id) return entry;
            const next = { ...entry };
            if (archived) next.archived = true;
            else delete next.archived;
            return next;
          });
        }
        if (!archived) return previous;
        const label = name.trim() || id;
        return [...previous, { id, name: label, archived: true }];
      });
    },
    [requireStaff, setDoc]
  );

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

  // ---- Locations: the user-editable place vocabulary (Gym, Pool, Classroom…).
  // The list lives in the `locations` doc; each calendar event stores the place
  // LABEL directly (no id), so rename rewrites the label across every event that
  // carries it, and delete just stops OFFERING a place (events keep their own
  // label, which still rides along in the picker). ----
  const createLocation = useCallback(
    (label: string): string | null => {
      const result = addLocation(locations, label);
      if (!result) return null;
      setDoc("locations", () => result.next);
      announce("Added the " + result.label + " location");
      return result.label;
    },
    [announce, locations, setDoc]
  );

  const renameLocation = useCallback(
    (from: string, to: string) => {
      const result = renameInVocab(locations, from, to);
      if (!result) return;
      setDoc("locations", () => result.next);
      // Carry any color override onto the new label (the override is keyed by
      // label, like everything else in the location model). On a merge-rename
      // the surviving place keeps its own color, matching the vocab merge.
      setDoc("locationColors", (prev) => {
        if (prev[from] == null) return prev;
        const next = { ...prev };
        const color = next[from];
        delete next[from];
        if (next[result.label] == null) next[result.label] = color;
        return next;
      });
      // Keep events in step: rewrite the old label to the new one wherever it's
      // stored, de-duplicating in case an event already carried the new label.
      // One commit so it's a single undo step alongside the vocabulary change.
      const touched: CalendarEvent[] = [];
      for (const event of Object.values(events)) {
        if (!event.locations || !event.locations.includes(from)) continue;
        const seen = new Set<string>();
        const nextPlaces: string[] = [];
        for (const place of event.locations) {
          const label = place === from ? result.label : place;
          const key = label.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          nextPlaces.push(label);
        }
        touched.push({ ...event, locations: nextPlaces });
      }
      if (touched.length) commitEvents(touched, []);
      announce("Renamed the location to " + result.label);
    },
    [announce, commitEvents, events, locations, setDoc]
  );

  // Removing a place drops it from the vocabulary only. Events that used it keep
  // their stored label (the picker carries any saved value along as a removable
  // row), so deleting a place never silently edits the schedule.
  const deleteLocation = useCallback(
    (label: string) => {
      const next = removeLocation(locations, label);
      if (!next) return;
      setDoc("locations", () => next);
      // Drop any color override for the removed place so no dead key lingers
      // (mirrors theme deletion purging its assignments).
      setDoc("locationColors", (prev) => {
        if (prev[label] == null) return prev;
        const out = { ...prev };
        delete out[label];
        return out;
      });
      announce("Removed the " + label + " location");
    },
    [announce, locations, setDoc]
  );

  // Set (or clear, with undefined) the color override for a place. Keyed by the
  // place LABEL — the same key the vocabulary, events, and the .ics feed use. A
  // non-hex value is ignored so the synced doc only ever holds clean hex.
  const setLocationColor = useCallback(
    (label: string, color: string | undefined) => {
      setDoc("locationColors", (prev) => {
        if (color === undefined) {
          if (prev[label] == null) return prev;
          const next = { ...prev };
          delete next[label];
          return next;
        }
        const hex = normalizeHexColor(color);
        if (!hex || prev[label] === hex) return prev;
        return { ...prev, [label]: hex };
      });
    },
    [setDoc]
  );

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
      setDoc("extra", (p) => upsertActivityRecord(p, activity));
      setDoc("deletedActivityIds", (p) => p.filter((id) => id !== activity.id));
      if (runDoc) setDoc("runLists", (p) => ({ ...p, [activity.id]: runDoc }));
      mintCatalogFor(activity);
      announce("Added " + activity.title + " to the library");
      return true;
    },
    [announce, mintCatalogFor, requireStaff, setDoc]
  );

  const updateActivity = useCallback(
    (activity: Activity, runDoc?: RunDoc) => {
      if (!requireStaff("edit activities")) return false;
      // Built-ins are promoted into the synced `extra` list with the same id.
      // The merged catalog then lets that user-owned record shadow the seed.
      setDoc("extra", (p) => upsertActivityRecord(p, activity));
      setDoc("deletedActivityIds", (p) => p.filter((id) => id !== activity.id));
      if (runDoc) setDoc("runLists", (p) => ({ ...p, [activity.id]: runDoc }));
      setDoc("ratings", (p) => {
        if (activity.rating > 0) return { ...p, [activity.id]: activity.rating };
        if (p[activity.id] == null) return p;
        const next = { ...p };
        delete next[activity.id];
        return next;
      });
      mintCatalogFor(activity);
      announce("Updated " + activity.title);
      return true;
    },
    [announce, mintCatalogFor, requireStaff, setDoc]
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

  // Calendar events referencing a deleted activity self-heal on READ
  // (lib/calendar/adapter) for display, but the stored rows keep the dangling
  // activityId — so the server-rendered .ics run-sheet links 404 and Print can
  // diverge. Persist the heal here: rewrite every referencing event to a plain
  // custom event (denormalized title kept) in one batch so the DB, the .ics
  // feed, and Print all converge on reality.
  const deleteActivity = useCallback(
    (activity: Activity): boolean => {
      if (!requireStaff("delete activities")) return false;
      if (!window.confirm("Delete “" + activity.title + "”? Calendar events using it become plain events.")) {
        return false;
      }
      const orphaned = Object.values(events).filter((event) => event.activityId === activity.id);
      if (orphaned.length) {
        commitEvents(
          orphaned.map((event) => {
            const healed: CalendarEvent = {
              ...event,
              kind: "custom",
              title: event.title || activity.title,
            };
            delete healed.activityId;
            return healed;
          }),
          []
        );
      }
      setDoc("extra", (p) => removeActivityRecord(p, activity.id));
      if (seedIds.has(activity.id)) {
        setDoc("deletedActivityIds", (p) => (p.includes(activity.id) ? p : [activity.id, ...p]));
      } else {
        setDoc("deletedActivityIds", (p) => p.filter((id) => id !== activity.id));
      }
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
    [announce, commitEvents, events, requireStaff, seedIds, setDoc]
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
    materialCatalog,
    kitStock,
    setStockState,
    renameMaterial,
    setMaterialConsumable,
    setMaterialArchived,
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
    locations,
    locationColors,
    createLocation,
    renameLocation,
    deleteLocation,
    setLocationColor,
  };
}

export type ActivityLibrary = ReturnType<typeof useActivityLibrary>;
