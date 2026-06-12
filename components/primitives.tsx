"use client";

import type { ReactNode } from "react";
import { ENERGY, ratingColor, RATING_WORD } from "@/lib/data";
import { CampIcon } from "./icons";

export function EnergyMeter({ level }: { level: number }) {
  return (
    <span className="meter" aria-label={ENERGY[level] + " energy"}>
      {[1, 2, 3].map((n) => (
        <i key={n} className={n <= level ? "on" : ""} />
      ))}
    </span>
  );
}

export function ApprovalDots({ rating }: { rating: number }) {
  const c = ratingColor(rating);
  return (
    <span className="meter" aria-label={"Approval " + rating + " of 5"}>
      {[1, 2, 3, 4, 5].map((n) => (
        <i
          key={n}
          className={n <= rating ? "on" : ""}
          style={n <= rating ? { background: c, borderColor: c } : undefined}
        />
      ))}
    </span>
  );
}

// Compact approval rating — five dots that fill with the warm rating colour,
// plus the rating word. Short enough to sit inline in the viewer header.
// Tap a filled dot again to clear.
export function RatingDots({
  value,
  onChange,
  label = "Approval rating",
}: {
  value: number;
  onChange: (value: number) => void;
  label?: string;
}) {
  const color = value ? ratingColor(value) : "var(--ink-faint)";
  return (
    <div className="ratingdots" role="group" aria-label={label}>
      <span className="ratingdots__dots">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            className={"ratingdots__dot" + (value >= n ? " is-on" : "")}
            aria-label={"Set approval " + n + " of 5"}
            aria-pressed={value === n}
            style={value >= n ? { background: color, borderColor: color } : undefined}
            onClick={() => onChange(n === value ? 0 : n)}
          />
        ))}
      </span>
      <span className="ratingdots__word" style={{ color }}>
        {RATING_WORD[value || 0]}
      </span>
    </div>
  );
}

// A bookmark drawn tall, so it reads as a ribbon hanging down from a top edge.
export function RibbonMark() {
  return (
    <svg className="ribbon-svg" viewBox="0 0 24 40" aria-hidden="true">
      <path d="M3 1H21V35L12 27L3 35Z" />
    </svg>
  );
}

// One save control, one cozy honey-gold treatment everywhere. Two form factors:
// an inline `chip` for list rows, and a `ribbon` that hangs over a card/hero
// top edge. Saved colour comes from --star-gold/--star-ink (no per-item hues).
export function SaveButton({
  on,
  onToggle,
  stop = true,
  variant = "chip",
}: {
  on: boolean;
  onToggle: () => void;
  stop?: boolean;
  variant?: "chip" | "ribbon";
}) {
  return (
    <button
      type="button"
      className={"star star--" + variant + (on ? " is-on" : "")}
      aria-label={on ? "Remove from saved" : "Save"}
      aria-pressed={on}
      onClick={(e) => {
        if (stop) e.stopPropagation();
        onToggle();
      }}
    >
      {variant === "ribbon" ? <RibbonMark /> : <CampIcon.Bookmark />}
    </button>
  );
}

export function Seg<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="seg" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o}
          type="button"
          className={value === o ? "is-on" : ""}
          aria-pressed={value === o}
          onClick={() => onChange(o)}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

export function Fact({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="facts__cell">
      <span className="facts__k">{k}</span>
      <span className="facts__v">{children}</span>
    </div>
  );
}

export function Block({
  num,
  name,
  children,
}: {
  num: string;
  name: string;
  children: ReactNode;
}) {
  return (
    <div className="block">
      <div className="block__label">
        <span className="block__num">{num}</span>
        <span className="block__name">{name}</span>
      </div>
      {children}
    </div>
  );
}

export function EmptyResults() {
  return (
    <div className="empty">
      <div className="empty__mark">
        <CampIcon.Search />
      </div>
      <div className="empty__title">Nothing on this shelf</div>
      <div className="empty__sub">
        No activities match these filters. Loosen a tag or clear the search.
      </div>
    </div>
  );
}
