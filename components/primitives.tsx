"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { ENERGY, ratingColor } from "@/lib/data";
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

export function StarButton({
  on,
  onToggle,
  stop = true,
}: {
  on: boolean;
  onToggle: () => void;
  stop?: boolean;
}) {
  return (
    <button
      type="button"
      className={"star" + (on ? " is-on" : "")}
      aria-label={on ? "Remove from saved" : "Save"}
      aria-pressed={on}
      onClick={(e) => {
        if (stop) e.stopPropagation();
        onToggle();
      }}
    >
      <CampIcon.Bookmark />
    </button>
  );
}

export function Seg<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          className={value === o ? "is-on" : ""}
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
