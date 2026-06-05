"use client";

import type { Activity } from "@/lib/types";
import { ActivityCell } from "./ActivityCell";
import { CampIcon } from "./icons";

export function SavedView({
  items,
  onOpen,
  onToggleFav,
}: {
  items: Activity[];
  onOpen: (a: Activity) => void;
  onToggleFav: (id: string) => void;
}) {
  const saved = items;
  if (!saved.length) {
    return (
      <div className="empty">
        <div className="empty__mark">
          <CampIcon.Bookmark />
        </div>
        <div className="empty__title">Nothing saved yet</div>
        <div className="empty__sub">
          Tap Save on any activity to keep it here - your go-to shortlist for a rainy day.
        </div>
      </div>
    );
  }
  return (
    <div className="catalog fadein" style={{ paddingTop: 14 }}>
      <span className="label">{saved.length} saved</span>
      {[...saved]
        .sort((a, b) => a.title.localeCompare(b.title))
        .map((a) => (
          <ActivityCell
            key={a.id}
            tone="none"
            activity={a}
            saved
            onOpen={onOpen}
            onToggleSaved={onToggleFav}
          />
        ))}
      <div style={{ height: 10 }} />
    </div>
  );
}
