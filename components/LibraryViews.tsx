"use client";

import type { Activity } from "@/lib/types";
import type { Theme } from "@/lib/themes";
import {
  ageLabel,
  durLabel,
  ENERGY,
  monogram,
  ratingColor,
} from "@/lib/data";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { ActivityCell } from "./ActivityCell";
import { CampIcon } from "./icons";
import { useAgeUnit } from "./ageUnit";
import { EmptyResults, SaveButton, ThemeBadge } from "./primitives";
import { BW, RADIUS, SCALE, SHELF_LINE, planShelf, titleFontPx, wrapShelf, type Placed } from "./shelfLayout";

// Measure synchronously before paint on the client; fall back on the server so
// the isomorphic render never warns about useLayoutEffect.
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

interface ViewProps {
  items: Activity[];
  onOpen: (a: Activity) => void;
  isFav: (id: string) => boolean;
  onToggleFav: (id: string) => void;
  onContextMenu?: (a: Activity, event: MouseEvent) => void;
  /** Resolve an activity's theme tag (null = untagged). */
  themeOf?: (id: string) => Theme | null;
}

// Books rest one stroke INTO the shelf line so their bottom border merges with it.
const BASELINE = SHELF_LINE - BW;

// ---------- Shelf view ----------
// An overfilled bookcase: packed books, the odd one leaning to physically rest on
// a neighbour or a flat stack, a few books piled flat, and the occasional book
// perched on a base. The whole library flows left→right and OVERFLOWS onto the
// shelf below — no per-type headers, no horizontal scroll. Geometry + physics live
// in ./shelfLayout (pure: size → role → coordinates → wrap into rows that fit the
// measured width). Here we just paint each resolved book as an interactive,
// rating-coloured book; saved books get a gilt binding.
export function ShelfView({ items, onOpen, isFav, onContextMenu }: ViewProps) {
  const railsRef = useRef<HTMLDivElement | null>(null);
  const [shelfWidth, setShelfWidth] = useState(0);

  // The available shelf width is whatever the rails column is; books wrap to fit.
  useIsoLayoutEffect(() => {
    const el = railsRef.current;
    if (!el) return;
    const measure = () => setShelfWidth(el.clientWidth);
    measure();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  if (!items.length) return <EmptyResults />;

  const rows = shelfWidth > 0 ? wrapShelf(planShelf(items), shelfWidth) : [];

  const renderBook = (p: Placed) => {
    const a = p.book;
    const saved = isFav(a.id);
    const laid = p.type === "laid";
    const style: CSSProperties = {
      left: p.x,
      bottom: BASELINE + p.y,
      width: p.w,
      height: p.h,
      background: ratingColor(a.rating),
      borderRadius: RADIUS,
      // title inset, scaled with the books (see SCALE in shelfLayout)
      padding: laid ? `0 ${Math.round(7 * SCALE)}px` : `${Math.round(9 * SCALE)}px 0`,
    };
    if (p.type === "lean") {
      style.transformOrigin = p.dir === "right" ? "100% 100%" : "0% 100%";
      style.transform = `rotate(${p.dir === "right" ? p.deg : -p.deg}deg)`;
    }
    return (
      <button
        type="button"
        key={(laid ? "laid-" : "") + a.id}
        className={
          "shelfbook" +
          (p.type === "lean" ? " shelfbook--lean" : laid ? " shelfbook--laid" : "") +
          (saved ? " shelfbook--saved" : "")
        }
        style={style}
        title={a.title}
        aria-label={a.title}
        onClick={() => onOpen(a)}
        onContextMenu={onContextMenu ? (e) => onContextMenu(a, e) : undefined}
      >
        <span
          className={"shelfbook__title" + (laid ? " shelfbook__title--laid" : "")}
          style={{ fontSize: laid ? 11.5 * SCALE : titleFontPx(a) }}
        >
          {a.title}
        </span>
        {saved && (
          <span
            className="shelfbook__gilt"
            aria-hidden="true"
            style={laid ? { left: 0, top: 0, bottom: 0, width: 3 } : { left: 0, right: 0, bottom: 0, height: 3 }}
          />
        )}
      </button>
    );
  };

  return (
    <div className="fadein shelfwrap">
      <div
        className="shelf-rows"
        ref={railsRef}
        style={{ "--bw": `${BW}px`, "--shelf-line": `${SHELF_LINE}px` } as CSSProperties}
      >
        {rows.map((row, ri) => (
          <section className="shelf" key={ri}>
            {/* Full-width plank; books sit left-aligned on it and the shelf ends
                with whatever empty run a real bookcase row would. */}
            <div className="shelf-rail" style={{ height: row.height }}>
              <div className="shelf-floor" aria-hidden="true" />
              {row.placed.map(renderBook)}
            </div>
          </section>
        ))}
      </div>
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
