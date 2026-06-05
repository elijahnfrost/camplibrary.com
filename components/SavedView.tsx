"use client";

import type { Activity } from "@/lib/types";
import { ageLabel, durLabel, ENERGY, monogram, ratingColor } from "@/lib/data";
import { CampIcon } from "./icons";
import { SaveButton } from "./primitives";

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
    <div className="saved-view fadein">
      <span className="label">{saved.length} saved</span>
      <div className="saved-grid">
        {[...saved]
          .sort((a, b) => a.title.localeCompare(b.title))
          .map((a) => (
            <div className="saved-card" key={a.id}>
              <button type="button" className="saved-card__open stretch" onClick={() => onOpen(a)} aria-label={a.title}>
                <span className="saved-card__mark" style={{ background: ratingColor(a.rating) }} aria-hidden="true">
                  {monogram(a.title)}
                </span>
                <span className="saved-card__body">
                  <span className="saved-card__type">{a.type}</span>
                  <span className="saved-card__title">{a.title}</span>
                  <span className="cat-stamps">
                    <span className="stamp">{a.place}</span>
                    <span className="stamp">{ageLabel(a)}</span>
                    <span className="stamp">{durLabel(a)}</span>
                    <span className="stamp">{ENERGY[a.energy]}</span>
                  </span>
                </span>
              </button>
              <SaveButton on onToggle={() => onToggleFav(a.id)} />
            </div>
          ))}
      </div>
    </div>
  );
}
