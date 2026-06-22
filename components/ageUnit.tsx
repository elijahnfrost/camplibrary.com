"use client";

// The library-wide Grades⇄Ages caption unit, shared with the many read-only
// display sites (cells, deck/shelf rows, home) via context so the preference
// doesn't have to thread through every parent. The toggle controls (the filter
// and the activity editor) take the value + setter as explicit props from
// CampApp, where the preference is persisted; everyone else just reads it.

import { createContext, useContext } from "react";
import type { AgeUnit } from "@/lib/data";

const AgeUnitContext = createContext<AgeUnit>("grades");

export const AgeUnitProvider = AgeUnitContext.Provider;

export function useAgeUnit(): AgeUnit {
  return useContext(AgeUnitContext);
}
