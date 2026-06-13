"use client";

import type { CSSProperties } from "react";
import type { Activity } from "@/lib/types";
import { ageLabel, categoryTint, durLabel, ENERGY } from "@/lib/data";
import { SaveButton } from "./primitives";

export function ActivityCell({
  activity,
  saved = false,
  onOpen,
  onToggleSaved,
}: {
  activity: Activity;
  saved?: boolean;
  onOpen: (activity: Activity) => void;
  onToggleSaved: (id: string) => void;
}) {
  return (
    <div className="cat-row" style={{ "--cal-tint": categoryTint(activity.type) } as CSSProperties}>
      <button
        type="button"
        className="cat-row__open stretch"
        aria-label={activity.title}
        onClick={() => onOpen(activity)}
      >
        <span className="cat-main">
          <span className="cat-title">{activity.title}</span>
          <span className="cat-row__meta">
            {activity.type} · {activity.place} · {durLabel(activity)} · {ageLabel(activity)} ·{" "}
            {ENERGY[activity.energy]}
          </span>
        </span>
      </button>
      <SaveButton on={saved} onToggle={() => onToggleSaved(activity.id)} />
    </div>
  );
}
