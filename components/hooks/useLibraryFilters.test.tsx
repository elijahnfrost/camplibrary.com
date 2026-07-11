// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useLibraryFilters } from "./useLibraryFilters";
import { ALL_CATEGORY_IDS } from "@/lib/content/data";
import type { Activity } from "@/lib/types";

afterEach(cleanup);

// The hook reads only `lib.all` (for the duration bounds), so a minimal stand-in
// suffices — the rest of the activity-library surface is irrelevant here.
type LibArg = Parameters<typeof useLibraryFilters>[0];
const lib = (durations: (number | undefined)[]): LibArg =>
  ({ all: durations.map((durationMin) => ({ durationMin })) as unknown as Activity[] }) as unknown as LibArg;

describe("useLibraryFilters", () => {
  it("starts wide open (no active filter)", () => {
    const { result } = renderHook(() => useLibraryFilters(lib([30, 45])));
    expect(result.current.cats).toEqual(ALL_CATEGORY_IDS);
    expect(result.current.place).toBe("All");
    expect(result.current.age).toBe("All");
    expect(result.current.theme).toBe("All");
    expect(result.current.starredOnly).toBe(false);
    expect(result.current.kitLens).toBe("all");
    expect(result.current.materialId).toBeNull();
    expect(result.current.query).toBe("");
    expect(result.current.minutesActive).toBe(false);
  });

  it("derives the duration bounds from the library, snapped to a 5-min grid, ignoring 0-min reminders", () => {
    const { result } = renderHook(() => useLibraryFilters(lib([22, 47, 0, undefined])));
    // floor(22/5)*5 = 20, ceil(47/5)*5 = 50; the 0-min and missing entries sit out.
    expect(result.current.minutesBounds).toEqual({ min: 20, max: 50 });
    // With no narrowing yet, the value spans the whole range.
    expect(result.current.minutesValue).toEqual([20, 50]);
  });

  it("falls back to a 0..0 span when the library has no timed activities", () => {
    const { result } = renderHook(() => useLibraryFilters(lib([0, undefined])));
    expect(result.current.minutesBounds).toEqual({ min: 0, max: 0 });
    expect(result.current.minutesActive).toBe(false);
  });

  it("marks the duration filter active only once it's tighter than the full span", () => {
    const { result } = renderHook(() => useLibraryFilters(lib([20, 60])));
    act(() => result.current.handleMinutes([30, 45]));
    expect(result.current.minutesValue).toEqual([30, 45]);
    expect(result.current.minutesActive).toBe(true);
  });

  it("collapses a full-span selection back to 'no filter' (handleMinutes → null)", () => {
    const { result } = renderHook(() => useLibraryFilters(lib([20, 60])));
    act(() => result.current.handleMinutes([30, 45])); // narrow
    expect(result.current.minutesActive).toBe(true);
    act(() => result.current.handleMinutes([20, 60])); // widen back to the bounds
    expect(result.current.minutesActive).toBe(false);
    expect(result.current.minutesValue).toEqual([20, 60]);
  });

  it("clamps an out-of-bounds narrowed range to the library's span", () => {
    const { result } = renderHook(() => useLibraryFilters(lib([20, 60])));
    act(() => result.current.setMinutesRange([5, 999]));
    expect(result.current.minutesValue).toEqual([20, 60]);
  });

  it("updates a filter through its setter", () => {
    const { result } = renderHook(() => useLibraryFilters(lib([30])));
    act(() => result.current.setStarredOnly(true));
    expect(result.current.starredOnly).toBe(true);
    act(() => result.current.setMaterialId("felt"));
    expect(result.current.materialId).toBe("felt");
  });
});
