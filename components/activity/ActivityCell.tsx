"use client";

import type { CSSProperties, MouseEvent } from "react";
import type { Activity } from "@/lib/types";
import type { Theme } from "@/lib/content/themes";
import { ageLabel, durLabel, effectiveActivityColor, ENERGY } from "@/lib/content/data";
import { CampIcon } from "../ui/icons";
import { SaveButton, ThemeBadge } from "../ui/primitives";
import { useAgeUnit } from "../ui/ageUnit";

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
            <span className="cat-row__metaitem">
              <CampIcon.Tag className="cat-row__metaic" />
              {activity.type}
            </span>
            <span className="cat-row__metaitem">
              <CampIcon.Pin className="cat-row__metaic" />
              {activity.place}
            </span>
            <span className="cat-row__metaitem">
              <CampIcon.Clock className="cat-row__metaic" />
              {durLabel(activity)}
            </span>
            <span className="cat-row__metaitem">
              <CampIcon.Users className="cat-row__metaic" />
              {ageLabel(activity, ageUnit)}
            </span>
            <span className="cat-row__metaitem">
              <CampIcon.Bolt className="cat-row__metaic" />
              {ENERGY[activity.energy]}
            </span>
          </span>
          {theme && <ThemeBadge theme={theme} className="cat-row__theme" />}
        </span>
      </button>
      <SaveButton on={saved} onToggle={() => onToggleSaved(activity.id)} />
    </div>
  );
}
