"use client";

import type { CSSProperties, MouseEvent } from "react";
import type { Activity } from "@/lib/types";
import type { Theme } from "@/lib/themes";
import { ageLabel, durLabel, effectiveActivityColor, ENERGY } from "@/lib/data";
import { SaveButton, ThemeBadge } from "./primitives";
import { useAgeUnit } from "./ageUnit";

export function ActivityCell({
  activity,
  saved = false,
  onOpen,
  onToggleSaved,
  onContextMenu,
  theme = null,
}: {
  activity: Activity;
  saved?: boolean;
  onOpen: (activity: Activity) => void;
  onToggleSaved: (id: string) => void;
  onContextMenu?: (activity: Activity, event: MouseEvent) => void;
  theme?: Theme | null;
}) {
  const ageUnit = useAgeUnit();
  return (
    <div
      className="cat-row"
      style={{ "--cal-tint": effectiveActivityColor(activity) } as CSSProperties}
      onContextMenu={onContextMenu ? (e) => onContextMenu(activity, e) : undefined}
    >
      <button
        type="button"
        className="cat-row__open stretch"
        aria-label={activity.title}
        onClick={() => onOpen(activity)}
      >
        <span className="cat-main">
          <span className="cat-title">{activity.title}</span>
          <span className="cat-row__meta">
            {activity.type} · {activity.place} · {durLabel(activity)} · {ageLabel(activity, ageUnit)} ·{" "}
            {ENERGY[activity.energy]}
          </span>
          {theme && <ThemeBadge theme={theme} className="cat-row__theme" />}
        </span>
      </button>
      <SaveButton on={saved} onToggle={() => onToggleSaved(activity.id)} />
    </div>
  );
}
