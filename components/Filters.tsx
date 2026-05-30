"use client";

import type { ReactNode } from "react";
import type { AgeFilter, CatFilter, PlaceFilter } from "@/lib/activityFilters";
import { AGE_GROUPS, CATEGORIES } from "@/lib/data";
import type { MaterialOption } from "@/lib/materials";
export type { AgeFilter, CatFilter, PlaceFilter } from "@/lib/activityFilters";

const PLACES = ["Inside", "Outside"] as const;

interface FiltersProps {
  variant: "bar" | "rail";
  cat: CatFilter;
  place: PlaceFilter;
  age: AgeFilter;
  materialOptions: MaterialOption[];
  availableMaterials: string[];
  onCat: (v: CatFilter) => void;
  onPlace: (v: PlaceFilter) => void;
  onAge: (v: AgeFilter) => void;
  onToggleMaterial: (id: string) => void;
  onClearMaterials: () => void;
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

function MaterialPicker({
  options,
  selected,
  onToggle,
  onClear,
}: {
  options: MaterialOption[];
  selected: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
}) {
  if (!options.length) return null;
  const selectedSet = new Set(selected);
  const selectedCount = options.filter((option) => selectedSet.has(option.id)).length;

  return (
    <details className="material-filter">
      <summary
        className={"material-filter__summary" + (selectedCount ? " is-on" : "")}
        aria-label={"Materials I have access to, " + selectedCount + " selected"}
      >
        <span>Materials{selectedCount ? " · " + selectedCount : ""}</span>
      </summary>
      <div className="material-filter__panel">
        <div className="material-filter__head">
          <span>Materials I have</span>
          {selectedCount > 0 && (
            <button type="button" onClick={onClear}>
              Clear
            </button>
          )}
        </div>
        <div className="material-filter__chips" role="group" aria-label="Available materials">
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              className={"chip material-filter__chip" + (selectedSet.has(option.id) ? " is-on" : "")}
              onClick={() => onToggle(option.id)}
              aria-pressed={selectedSet.has(option.id)}
              title={option.count + (option.count === 1 ? " activity" : " activities")}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </details>
  );
}

export function Filters({
  variant,
  cat,
  place,
  age,
  materialOptions,
  availableMaterials,
  onCat,
  onPlace,
  onAge,
  onToggleMaterial,
  onClearMaterials,
}: FiltersProps) {
  const anyOn = cat !== "All" || place !== "All" || age !== "All" || availableMaterials.length > 0;

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
                onClearMaterials();
              }}
            >
              Clear
            </button>
          )}
        </div>
        <Group label="Type">{typeChips}</Group>
        <Group label="Where">{placeChips}</Group>
        <Group label="Ages">{ageChips}</Group>
        <Group label="Available kit">
          <MaterialPicker
            options={materialOptions}
            selected={availableMaterials}
            onToggle={onToggleMaterial}
            onClear={onClearMaterials}
          />
        </Group>
      </div>
    );
  }

  // mobile horizontal bar
  return (
    <>
      <div className="filterbar">
        <span className="filterbar__cluster" role="group" aria-label="Type">
          {typeChips}
        </span>
        <span className="filterbar__div" aria-hidden="true" />
        <span className="filterbar__cluster" role="group" aria-label="Where">
          {placeChips}
        </span>
        <span className="filterbar__div" aria-hidden="true" />
        <span className="filterbar__cluster" role="group" aria-label="Ages">
          {ageChips}
        </span>
      </div>
      <div className="filterbar__kit">
        <MaterialPicker
          options={materialOptions}
          selected={availableMaterials}
          onToggle={onToggleMaterial}
          onClear={onClearMaterials}
        />
      </div>
    </>
  );
}
