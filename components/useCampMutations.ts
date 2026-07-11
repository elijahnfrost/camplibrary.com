import { useCallback } from "react";
import { clampOverrideWindow, type Camp, type CampSnapMin, type Weekday } from "@/lib/content/camps";
import type { CampDocument } from "@/lib/content/campDocuments";
import { createGuideId, type GuideBand } from "@/lib/calendar/guides";
import type { DateKey } from "@/lib/calendar/types";
import type { useCloudUserData } from "@/lib/cloud/cloudStore";

// ---- Per-camp day-structure mutators (weekday hours / dated exceptions / snap)
// and the guides doc. All write straight through cloud.setDoc — the
// camps mutators in useCamps.ts stay lean; these day-structure edits (a rarely
// touched authoring surface) live with the manager UI that drives them. Every
// window is forced through clampOverrideWindow so a payload can't escape bounds.
// The downloadable documents doc (Print tab). Gated like every other managed
// vocabulary; the writer is a plain updater so the manager can append uploads,
// rename, or delete in one synced write.
//
// Extracted from CampApp: a cohesive bag of camp day-structure + documents
// mutators, every one a straight-through staff-gated cloud.setDoc write closing
// over only `cloud` and `requireStaff`. Returned as handles the app wires to the
// camp manager / settings UI.
export function useCampMutations({
  cloud,
  requireStaff,
}: {
  cloud: ReturnType<typeof useCloudUserData>;
  requireStaff: (action: string) => boolean;
}) {
  const changeDocuments = useCallback(
    (updater: (prev: CampDocument[]) => CampDocument[]) => {
      if (!requireStaff("manage documents")) return;
      cloud.setDoc("documents", updater);
    },
    [cloud, requireStaff]
  );
  const setCampWeekdayHours = useCallback(
    (id: string, weekday: Weekday, value: "default" | "closed" | { openMin: number; closeMin: number }) => {
      if (!requireStaff("manage camps")) return;
      cloud.setDoc("camps", (prev) =>
        prev.map((c) => {
          if (c.id !== id) return c;
          const weekdayHours = { ...(c.weekdayHours ?? {}) };
          if (value === "default") delete weekdayHours[weekday];
          else if (value === "closed") weekdayHours[weekday] = null;
          else weekdayHours[weekday] = clampOverrideWindow(value.openMin, value.closeMin);
          const next: Camp = { ...c };
          if (Object.keys(weekdayHours).length) next.weekdayHours = weekdayHours;
          else delete next.weekdayHours;
          return next;
        })
      );
    },
    [cloud, requireStaff]
  );
  const setCampDateHours = useCallback(
    (id: string, date: DateKey, value: "closed" | { openMin: number; closeMin: number } | null) => {
      if (!requireStaff("manage camps")) return;
      cloud.setDoc("camps", (prev) =>
        prev.map((c) => {
          if (c.id !== id) return c;
          const dateHours = { ...(c.dateHours ?? {}) };
          if (value === null) delete dateHours[date];
          else if (value === "closed") dateHours[date] = null;
          else dateHours[date] = clampOverrideWindow(value.openMin, value.closeMin);
          const next: Camp = { ...c };
          if (Object.keys(dateHours).length) next.dateHours = dateHours;
          else delete next.dateHours;
          return next;
        })
      );
    },
    [cloud, requireStaff]
  );
  const setCampSnap = useCallback(
    (id: string, snapMin: CampSnapMin) => {
      if (!requireStaff("manage camps")) return;
      cloud.setDoc("camps", (prev) => prev.map((c) => (c.id === id ? { ...c, snapMin } : c)));
    },
    [cloud, requireStaff]
  );

  // Per-camp guidance-band mutators. Guidance bands are PER-CAMP now — each camp
  // shapes its day differently. A camp that hasn't set its own inherits the
  // legacy shared `guides` doc as a display baseline; the first edit here FORKS
  // that baseline into the camp (c.guides ?? cloud.docs.guides), after which the
  // camp's bands diverge freely and never touch the shared doc again.
  const addCampGuide = useCallback(
    (campId: string) => {
      if (!requireStaff("manage camps")) return;
      const band: GuideBand = {
        id: createGuideId(),
        label: "New band",
        startMin: 9 * 60,
        endMin: 10 * 60,
        weekdays: [1, 2, 3, 4, 5],
      };
      cloud.setDoc("camps", (prev) =>
        prev.map((c) => (c.id === campId ? { ...c, guides: [...(c.guides ?? cloud.docs.guides), band] } : c))
      );
    },
    [cloud, requireStaff]
  );
  const updateCampGuide = useCallback(
    (campId: string, id: string, patch: Partial<GuideBand>) => {
      if (!requireStaff("manage camps")) return;
      cloud.setDoc("camps", (prev) =>
        prev.map((c) =>
          c.id === campId
            ? { ...c, guides: (c.guides ?? cloud.docs.guides).map((b) => (b.id === id ? { ...b, ...patch } : b)) }
            : c
        )
      );
    },
    [cloud, requireStaff]
  );
  const deleteCampGuide = useCallback(
    (campId: string, id: string) => {
      if (!requireStaff("manage camps")) return;
      cloud.setDoc("camps", (prev) =>
        prev.map((c) =>
          c.id === campId ? { ...c, guides: (c.guides ?? cloud.docs.guides).filter((b) => b.id !== id) } : c
        )
      );
    },
    [cloud, requireStaff]
  );

  return {
    changeDocuments,
    setCampWeekdayHours,
    setCampDateHours,
    setCampSnap,
    addCampGuide,
    updateCampGuide,
    deleteCampGuide,
  };
}
