"use client";

import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import { ENERGY, ratingColor, RATING_WORD } from "@/lib/data";
import { CampIcon } from "./icons";

// ---------- keyboard accessibility for div-based buttons ----------
// The design uses styled <div role="button"> elements; on a real site these
// must also respond to Enter/Space. This helper supplies the needed props.
export function clickable(onActivate: () => void) {
  return {
    role: "button" as const,
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onActivate();
      }
    },
  };
}

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

export function RatingPicker({
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
    <div className="rating-picker" role="group" aria-label={label}>
      <div className="rating-picker__status">
        <button
          type="button"
          className={"rating-reset" + (!value ? " is-on" : "")}
          onClick={() => onChange(0)}
          aria-pressed={!value}
        >
          <CampIcon.Reset />
          Not run
        </button>
        <span className="rating-picker__word" style={{ color }}>
          {RATING_WORD[value || 0]}
        </span>
        <span className="rating-picker__num">{value ? value + "/5" : "Unrated"}</span>
      </div>
      <div className="rating-picker__scale">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            className={"rating-dot" + (value >= n ? " is-filled" : "") + (value === n ? " is-on" : "")}
            onClick={() => onChange(n)}
            aria-label={"Set approval " + n + " of 5"}
            aria-pressed={value === n}
            style={value >= n ? ({ "--rating-color": ratingColor(n) } as CSSProperties) : undefined}
          >
            <span>{n}</span>
          </button>
        ))}
      </div>
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

export function StarButton({
  on,
  onToggle,
  stop = true,
  variant = "chip",
  tone,
}: {
  on: boolean;
  onToggle: () => void;
  stop?: boolean;
  variant?: "chip" | "ribbon";
  tone?: { fill: string; edge: string };
}) {
  const style = tone
    ? ({ "--tone-fill": tone.fill, "--tone-edge": tone.edge } as CSSProperties)
    : undefined;
  return (
    <button
      type="button"
      className={"star star--" + variant + (on ? " is-on" : "")}
      aria-label={on ? "Remove from saved" : "Save"}
      aria-pressed={on}
      style={style}
      onClick={(e) => {
        if (stop) e.stopPropagation();
        onToggle();
      }}
      onKeyDown={(e) => {
        if (stop) e.stopPropagation();
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
