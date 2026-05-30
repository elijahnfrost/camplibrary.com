"use client";

import { useState } from "react";
import type { Activity } from "@/lib/types";
import {
  ageLabel,
  CATEGORIES,
  code,
  durLabel,
  ENERGY,
  monogram,
  ratingColor,
} from "@/lib/data";
import { CampIcon } from "./icons";
import { clickable, EmptyResults, StarButton } from "./primitives";

interface ViewProps {
  items: Activity[];
  onOpen: (a: Activity) => void;
  isFav: (id: string) => boolean;
  onToggleFav: (id: string) => void;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// Book covers tint by approval rating (low = clay → high = green) so the shelf ranks by color.
const spineWidth = (a: Activity) => 30 + (hash(a.id + "w") % 5) * 4; // 30–46
const spinePadTop = (a: Activity) => 10 + (hash(a.id + "h") % 5) * 9; // extra cover space above the title

// ---------- Shelf view ----------
export function ShelfView({ items, onOpen, isFav }: ViewProps) {
  const groups = CATEGORIES.map((c) => ({
    cat: c,
    list: items.filter((a) => a.type === c.id),
  })).filter((g) => g.list.length);

  if (!groups.length) return <EmptyResults />;

  return (
    <div className="fadein shelfwrap">
      {groups.map((g) => (
        <section className="shelf" key={g.cat.id}>
          <div className="shelf__head">
            <span className="shelf__label">{g.cat.label}</span>
            <span className="shelf__count">
              {g.list.length} {g.list.length === 1 ? "title" : "titles"}
            </span>
          </div>
          <div className="rail">
            {g.list.map((a) => (
              <div
                className="spine"
                key={a.id}
                style={{
                  width: spineWidth(a),
                  paddingTop: spinePadTop(a),
                  background: ratingColor(a.rating),
                }}
                title={a.title}
                aria-label={a.title}
                {...clickable(() => onOpen(a))}
              >
                {isFav(a.id) && (
                  <span className="spine__fav">
                    <CampIcon.Bookmark />
                  </span>
                )}
                <span className="spine__title">{a.title}</span>
              </div>
            ))}
          </div>
        </section>
      ))}
      <div style={{ height: 16 }} />
    </div>
  );
}

// ---------- Deck view ----------
export function DeckView({ items, onOpen, isFav, onToggleFav }: ViewProps) {
  if (!items.length) return <EmptyResults />;
  return (
    <div className="deck fadein">
      {items.map((a) => (
        <div className="deck-card" key={a.id} aria-label={a.title} {...clickable(() => onOpen(a))}>
          <div className="plate" style={{ background: ratingColor(a.rating) }}>
            <div className="plate__grid" />
            <span className="plate__cat">{a.type}</span>
            <span className="plate__star">
              <StarButton on={isFav(a.id)} onToggle={() => onToggleFav(a.id)} />
            </span>
            <span className="plate__mono">{monogram(a.title)}</span>
          </div>
          <div className="deck-card__body">
            <div className="deck-card__title">{a.title}</div>
            <div className="deck-card__meta">
              {durLabel(a)} · {a.place}
              <br />
              {ageLabel(a)} · {ENERGY[a.energy]}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------- Catalog view ----------
export function CatalogView({ items, onOpen, isFav, onToggleFav }: ViewProps) {
  const [sort, setSort] = useState<"az" | "rating">("az");
  if (!items.length) return <EmptyResults />;
  const sorted = [...items].sort((a, b) =>
    sort === "rating"
      ? b.rating - a.rating || a.title.localeCompare(b.title)
      : a.title.localeCompare(b.title)
  );
  return (
    <div className="catalog fadein">
      <div className="catalog__head">
        <span className="label">{sorted.length} entries</span>
        <button
          type="button"
          className="sortbtn"
          onClick={() => setSort((s) => (s === "az" ? "rating" : "az"))}
        >
          {sort === "az" ? "A–Z" : "Top rated"}
        </button>
      </div>
      {sorted.map((a) => (
        <div className="cat-row" key={a.id} aria-label={a.title} {...clickable(() => onOpen(a))}>
          <div className="cat-code" style={{ background: ratingColor(a.rating) }}>
            {code(a)}
          </div>
          <div className="cat-main">
            <div className="cat-title">{a.title}</div>
            <div className="cat-stamps">
              <span className="stamp">{a.type}</span>
              <span className="stamp">{a.place}</span>
              <span className="stamp">{durLabel(a)}</span>
              <span className="stamp">{ENERGY[a.energy]}</span>
            </div>
          </div>
          <StarButton on={isFav(a.id)} onToggle={() => onToggleFav(a.id)} />
        </div>
      ))}
      <div style={{ height: 10 }} />
    </div>
  );
}
