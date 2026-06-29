"use client";

import type { Activity } from "@/lib/types";
import type { Theme } from "@/lib/themes";
import {
  ageLabel,
  CATEGORIES,
  durLabel,
  ENERGY,
  monogram,
  ratingColor,
} from "@/lib/data";
import type { CSSProperties, MouseEvent } from "react";
import { ActivityCell } from "./ActivityCell";
import { CampIcon } from "./icons";
import { useAgeUnit } from "./ageUnit";
import { EmptyResults, SaveButton, ThemeBadge } from "./primitives";

interface ViewProps {
  items: Activity[];
  onOpen: (a: Activity) => void;
  isFav: (id: string) => boolean;
  onToggleFav: (id: string) => void;
  onContextMenu?: (a: Activity, event: MouseEvent) => void;
  /** Resolve an activity's theme tag (null = untagged). */
  themeOf?: (id: string) => Theme | null;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// Book covers tint by approval rating (low = clay → high = green) so the shelf ranks by color.
const spineWidth = (a: Activity) => 30 + (hash(a.id + "w") % 5) * 4; // 30–46
const spinePadTop = (a: Activity) => 10 + (hash(a.id + "h") % 5) * 9; // extra cover space above the title
const SPINE_MARKS = 6; // count of hand-drawn spine motifs (see .spine__mark in globals.css)

// ---------- Shelf view ----------
export function ShelfView({ items, onOpen, isFav, onContextMenu }: ViewProps) {
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
            {g.list.map((a) => {
              const saved = isFav(a.id);
              // saved spines get one of six hand-drawn motifs (data-mark), all in
              // the single honey-gold; reserve head & foot room so it clears the title
              const mark = hash(a.id + "spine") % SPINE_MARKS;
              return (
                <button
                  type="button"
                  className="spine"
                  key={a.id}
                  style={
                    {
                      width: spineWidth(a),
                      paddingTop: saved ? Math.max(spinePadTop(a), 30) : spinePadTop(a),
                      paddingBottom: saved ? 28 : undefined,
                      background: ratingColor(a.rating),
                    } as CSSProperties
                  }
                  title={a.title}
                  aria-label={a.title}
                  onClick={() => onOpen(a)}
                  onContextMenu={onContextMenu ? (e) => onContextMenu(a, e) : undefined}
                >
                  {saved && <span className="spine__mark" data-mark={mark} aria-hidden="true" />}
                  <span className="spine__title">{a.title}</span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
      <div style={{ height: 16 }} />
    </div>
  );
}

// ---------- Deck view ----------
export function DeckView({ items, onOpen, isFav, onToggleFav, onContextMenu, themeOf }: ViewProps) {
  const ageUnit = useAgeUnit();
  if (!items.length) return <EmptyResults />;
  return (
    <div className="deck fadein">
      {items.map((a) => {
        const theme = themeOf?.(a.id) ?? null;
        return (
        <div
          className="deck-card"
          key={a.id}
          onContextMenu={onContextMenu ? (e) => onContextMenu(a, e) : undefined}
        >
          {/* Plain content layer; the stretched button below overlays it as the
              single primary action, and the star rides above as a sibling. */}
          <div className="plate" style={{ background: ratingColor(a.rating) }} aria-hidden="true">
            <div className="plate__grid" />
            <span className="plate__cat">{a.type}</span>
            <span className="plate__mono">{monogram(a.title)}</span>
          </div>
          <div className="deck-card__body">
            <div className="deck-card__title">{a.title}</div>
            <div className="deck-card__meta">
              <span className="deck-card__metaline">
                <span className="deck-card__metaitem">
                  <CampIcon.Clock className="deck-card__metaic" />
                  {durLabel(a)}
                </span>
                <span className="deck-card__metaitem">
                  <CampIcon.Pin className="deck-card__metaic" />
                  {a.place}
                </span>
              </span>
              <span className="deck-card__metaline">
                <span className="deck-card__metaitem">
                  <CampIcon.Users className="deck-card__metaic" />
                  {ageLabel(a, ageUnit)}
                </span>
                <span className="deck-card__metaitem">
                  <CampIcon.Bolt className="deck-card__metaic" />
                  {ENERGY[a.energy]}
                </span>
              </span>
            </div>
            {theme && <ThemeBadge theme={theme} className="deck-card__theme" />}
          </div>
          <button
            type="button"
            className="deck-card__open stretch"
            aria-label={a.title}
            onClick={() => onOpen(a)}
          />
          <span className="plate__star">
            <SaveButton
              on={isFav(a.id)}
              onToggle={() => onToggleFav(a.id)}
              variant="ribbon"
            />
          </span>
        </div>
        );
      })}
    </div>
  );
}

// ---------- Catalog view ----------
// Ordering is owned by the library-wide sort control (see LibraryTab); items
// arrive already sorted, so the view just renders them.
export function CatalogView({ items, onOpen, isFav, onToggleFav, onContextMenu, themeOf }: ViewProps) {
  if (!items.length) return <EmptyResults />;
  return (
    <div className="catalog fadein">
      {items.map((a) => (
        <ActivityCell
          key={a.id}
          activity={a}
          saved={isFav(a.id)}
          onOpen={onOpen}
          onToggleSaved={onToggleFav}
          onContextMenu={onContextMenu}
          theme={themeOf?.(a.id) ?? null}
        />
      ))}
      <div style={{ height: 10 }} />
    </div>
  );
}
