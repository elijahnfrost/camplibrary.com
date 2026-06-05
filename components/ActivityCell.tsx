"use client";

import type { CSSProperties } from "react";
import type { Activity } from "@/lib/types";
import { code, durLabel, ENERGY, ratingColor } from "@/lib/data";
import { SaveButton } from "./primitives";

export type ActivityCellTone = "rating" | "none";

type ActivityCellProps = {
  activity: Activity;
  tone?: ActivityCellTone;
  saved?: boolean;
  onOpen: (activity: Activity) => void;
  onToggleSaved: (id: string) => void;
};

function codeStyle(activity: Activity, tone: ActivityCellTone): CSSProperties | undefined {
  if (tone !== "rating") return undefined;
  return { background: ratingColor(activity.rating) };
}

export function ActivityCell({
  activity,
  tone = "none",
  saved = false,
  onOpen,
  onToggleSaved,
}: ActivityCellProps) {
  return (
    <div className="cat-row">
      <button
        type="button"
        className="cat-row__open stretch"
        aria-label={activity.title}
        onClick={() => onOpen(activity)}
      >
        <span className="cat-code" style={codeStyle(activity, tone)}>
          {code(activity)}
        </span>
        <span className="cat-main">
          <span className="cat-title">{activity.title}</span>
          <span className="cat-stamps">
            <span className="stamp">{activity.type}</span>
            <span className="stamp">{activity.place}</span>
            <span className="stamp">{durLabel(activity)}</span>
            <span className="stamp">{ENERGY[activity.energy]}</span>
          </span>
        </span>
      </button>
      <SaveButton on={saved} onToggle={() => onToggleSaved(activity.id)} />
    </div>
  );
}
