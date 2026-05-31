"use client";

import type { Activity } from "@/lib/types";
import { code, durLabel, ENERGY } from "@/lib/data";
import { CampIcon } from "./icons";
import { SaveButton } from "./primitives";

export function SavedView({
  items,
  onOpen,
  isFav,
  onToggleFav,
}: {
  items: Activity[];
  onOpen: (a: Activity) => void;
  isFav: (id: string) => boolean;
  onToggleFav: (id: string) => void;
}) {
  const saved = items.filter((a) => isFav(a.id));
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
      {saved
        .sort((a, b) => a.title.localeCompare(b.title))
        .map((a) => (
          <div className="cat-row" key={a.id}>
            <button type="button" className="cat-row__open stretch" aria-label={a.title} onClick={() => onOpen(a)}>
              <span className="cat-code">{code(a)}</span>
              <span className="cat-main">
                <span className="cat-title">{a.title}</span>
                <span className="cat-stamps">
                  <span className="stamp">{a.type}</span>
                  <span className="stamp">{a.place}</span>
                  <span className="stamp">{durLabel(a)}</span>
                  <span className="stamp">{ENERGY[a.energy]}</span>
                </span>
              </span>
            </button>
            <SaveButton on={true} onToggle={() => onToggleFav(a.id)} />
          </div>
        ))}
      <div style={{ height: 10 }} />
    </div>
  );
}
