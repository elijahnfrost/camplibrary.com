"use client";

import type { ReactNode } from "react";
import type { AgeGroupId, CategoryId } from "@/lib/types";
import { AGE_GROUPS, CATEGORIES } from "@/lib/data";

export type CatFilter = "All" | CategoryId;
export type PlaceFilter = "All" | "Inside" | "Outside";
export type AgeFilter = "All" | AgeGroupId;

const PLACES = ["Inside", "Outside"] as const;

interface FiltersProps {
  variant: "bar" | "rail";
  cat: CatFilter;
  place: PlaceFilter;
  age: AgeFilter;
  onCat: (v: CatFilter) => void;
  onPlace: (v: PlaceFilter) => void;
  onAge: (v: AgeFilter) => void;
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className={"chip" + (on ? " is-on" : "")} onClick={onClick} aria-pressed={on}>
      {children}
    </button>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="sidefilters__group">
      <span className="sidefilters__label">{label}</span>
      <div className="sidefilters__chips">{children}</div>
    </div>
  );
}

export function Filters({ variant, cat, place, age, onCat, onPlace, onAge }: FiltersProps) {
  const anyOn = cat !== "All" || place !== "All" || age !== "All";

  const typeChips = (
    <>
      <Chip on={cat === "All"} onClick={() => onCat("All")}>
        All
      </Chip>
      {CATEGORIES.map((c) => (
        <Chip key={c.id} on={cat === c.id} onClick={() => onCat(cat === c.id ? "All" : c.id)}>
          {c.label}
        </Chip>
      ))}
    </>
  );
  const placeChips = PLACES.map((p) => (
    <Chip key={p} on={place === p} onClick={() => onPlace(place === p ? "All" : p)}>
      {p}
    </Chip>
  ));
  const ageChips = AGE_GROUPS.map((g) => (
    <Chip key={g.id} on={age === g.id} onClick={() => onAge(age === g.id ? "All" : g.id)}>
      {g.short}
    </Chip>
  ));

  if (variant === "rail") {
    return (
      <div className="sidefilters">
        <div className="sidefilters__head">
          <span className="sidefilters__title">Filter</span>
          {anyOn && (
            <button
              type="button"
              className="sidefilters__clear"
              onClick={() => {
                onCat("All");
                onPlace("All");
                onAge("All");
              }}
            >
              Clear
            </button>
          )}
        </div>
        <Group label="Type">{typeChips}</Group>
        <Group label="Where">{placeChips}</Group>
        <Group label="Ages">{ageChips}</Group>
      </div>
    );
  }

  // mobile horizontal bar
  return (
    <div className="filterbar">
      {typeChips}
      <span className="filterbar__div" />
      {placeChips}
      <span className="filterbar__div" />
      {ageChips}
    </div>
  );
}
