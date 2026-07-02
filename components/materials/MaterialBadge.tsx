"use client";

// The runnable badge — one component, three placements (library cards, calendar
// event chips, the Materials view back-ref rows), identical semantics. Icon +
// text so it never relies on color alone. Ready = you can run it (✓, or ↔ when a
// substitution is in play); Almost / Can't carry the missing count.

import type { CoverageResult } from "@/lib/materialCatalog";
import { runnableState } from "@/lib/materialCatalog";
import { CampIcon } from "../icons";

export function MaterialBadge({
  cover,
  size = "md",
  showReady = true,
}: {
  cover: CoverageResult;
  size?: "sm" | "md";
  /** Hide the (often noisy) Ready badge unless something is being substituted. */
  showReady?: boolean;
}) {
  const state = runnableState(cover);
  const subs = cover.satisfiedBySubstitute.length;

  if (state === "ready") {
    if (!showReady && subs === 0) return null;
    const viaSub = subs > 0;
    return (
      <span
        className={"matbadge matbadge--ready" + (viaSub ? " matbadge--sub" : "") + " matbadge--" + size}
        title={viaSub ? subs + (subs === 1 ? " substitution" : " substitutions") + " in use" : "You have everything"}
      >
        {viaSub ? <CampIcon.Repeat /> : <CampIcon.Check />}
        <span className="matbadge__txt">{viaSub ? "Ready · sub" : "Ready"}</span>
      </span>
    );
  }

  const n = cover.missing.length;
  const label = state === "almost" ? "−" + n : "Can't · −" + n;
  return (
    <span
      className={"matbadge matbadge--" + state + " matbadge--" + size}
      title={"Missing " + cover.missingLabels.join(", ")}
    >
      <CampIcon.Flag />
      <span className="matbadge__txt">{label}</span>
    </span>
  );
}
