import { useCallback, useMemo, useState } from "react";
import { ALL_CATEGORY_IDS } from "@/lib/content/data";
import type { AgeFilter, CatFilter, KitLens, PlaceFilter, ThemeFilter } from "@/lib/activity/activityFilters";
import type { useActivityLibrary } from "./useActivityLibrary";

// Library filters. State lives here because the desktop filter rail
// renders inside the sidenav, outside LibraryTab.
//
// Extracted from CampApp: the whole library filter-bar state (categories, place,
// age, theme, starred, kit lens, material narrowing, text query, and the
// duration-range slider derived from the library's own spread). State lives above
// LibraryTab because the desktop filter rail renders in the sidenav; this hook
// keeps it cohesive. Takes the activity library (for the duration bounds) and
// returns the values + setters the rail, the filtered memo, and the reset jumps
// read. MINUTES_STEP stays internal (only the bounds math uses it).
export function useLibraryFilters(lib: ReturnType<typeof useActivityLibrary>) {
  const [cats, setCats] = useState<CatFilter>(ALL_CATEGORY_IDS);
  const [place, setPlace] = useState<PlaceFilter>("All");
  const [age, setAge] = useState<AgeFilter>("All");
  const [theme, setTheme] = useState<ThemeFilter>("All");
  const [starredOnly, setStarredOnly] = useState(false);
  // The kit availability lens (All / Ready / +Almost). Inert while the stock map
  // is unset — the Filters row surfaces a hint pointing at the Materials tab.
  const [kitLens, setKitLens] = useState<KitLens>("all");
  // Browse-by-material: set from the Materials tab's "Used by N →" jump. A single
  // material id the Library narrows to, shown as a dismissible chip. Re-homes the
  // browse value the retired uses-ANY kit picker used to carry.
  const [materialId, setMaterialId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // Duration filter. The slider spans the actual range of lengths in the
  // library (snapped out to a 5-minute grid), so the handles never sit past
  // the shortest/longest activity. `minutesRange` is null until the user
  // narrows it — the effective value then falls back to the full span, and the
  // filter only counts as active once it's tighter than that span.
  const MINUTES_STEP = 5;
  const minutesBounds = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const a of lib.all) {
      const d = a.durationMin;
      // 0-min entries are reminders (no-time nudges), not timed blocks — they'd
      // peg the slider floor to 0, so they sit out of the duration spread.
      if (typeof d === "number" && Number.isFinite(d) && d > 0) {
        if (d < lo) lo = d;
        if (d > hi) hi = d;
      }
    }
    if (lo === Infinity) return { min: 0, max: 0 };
    return {
      min: Math.floor(lo / MINUTES_STEP) * MINUTES_STEP,
      max: Math.ceil(hi / MINUTES_STEP) * MINUTES_STEP,
    };
  }, [lib.all]);
  const [minutesRange, setMinutesRange] = useState<[number, number] | null>(null);
  const minutesValue = useMemo<[number, number]>(() => {
    if (!minutesRange) return [minutesBounds.min, minutesBounds.max];
    return [
      Math.max(minutesBounds.min, Math.min(minutesRange[0], minutesBounds.max)),
      Math.min(minutesBounds.max, Math.max(minutesRange[1], minutesBounds.min)),
    ];
  }, [minutesRange, minutesBounds]);
  const minutesActive = minutesValue[0] > minutesBounds.min || minutesValue[1] < minutesBounds.max;
  // Collapse a full-span selection back to null so it reads as "no filter".
  const handleMinutes = useCallback(
    (v: [number, number]) =>
      setMinutesRange(v[0] <= minutesBounds.min && v[1] >= minutesBounds.max ? null : v),
    [minutesBounds]
  );

  return {
    cats,
    setCats,
    place,
    setPlace,
    age,
    setAge,
    theme,
    setTheme,
    starredOnly,
    setStarredOnly,
    kitLens,
    setKitLens,
    materialId,
    setMaterialId,
    query,
    setQuery,
    minutesBounds,
    setMinutesRange,
    minutesValue,
    minutesActive,
    handleMinutes,
  };
}
