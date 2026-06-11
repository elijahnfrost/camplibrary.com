"use client";

import { Fragment, useState, type ReactNode } from "react";
import type { AgeFilter, CatFilter, PlaceFilter } from "@/lib/activityFilters";
import { AGE_GROUPS, CATEGORIES } from "@/lib/data";
import type { MaterialOption } from "@/lib/materials";
import { CampIcon } from "./icons";
import { Seg } from "./primitives";
export type { AgeFilter, CatFilter, PlaceFilter } from "@/lib/activityFilters";

const PLACES = ["Inside", "Outside"] as const;
type KitSort = "Have" | "Need";

interface FiltersProps {
  variant: "bar" | "rail";
  cat: CatFilter;
  place: PlaceFilter;
  age: AgeFilter;
  /** Omit both starred props to hide the Starred chip (surfaces without favorites). */
  starredOnly?: boolean;
  materialOptions: MaterialOption[];
  availableMaterials: string[];
  onCat: (v: CatFilter) => void;
  onPlace: (v: PlaceFilter) => void;
  onAge: (v: AgeFilter) => void;
  onStarredOnly?: (v: boolean) => void;
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
  defaultOpen = false,
}: {
  options: MaterialOption[];
  selected: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
  defaultOpen?: boolean;
}) {
  const [lead, setLead] = useState<KitSort>("Have");
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [query, setQuery] = useState("");
  if (!options.length) return null;
  const selectedSet = new Set(selected);
  const have = options.filter((option) => selectedSet.has(option.id));
  const need = options.filter((option) => !selectedSet.has(option.id));
  const q = query.trim().toLowerCase();
  const matchesQuery = (option: MaterialOption) => !q || option.label.toLowerCase().includes(q);
  const visibleHave = have.filter(matchesQuery);
  const visibleNeed = need.filter(matchesQuery);
  const ordered = lead === "Have" ? [...visibleHave, ...visibleNeed] : [...visibleNeed, ...visibleHave];
  const selectedCount = have.length;
  const leadCount = lead === "Have" ? visibleHave.length : visibleNeed.length;
  const showControls = options.length >= 2;

  return (
    <details
      className="material-filter"
      open={isOpen}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
    >
      <summary
        className={"material-filter__summary" + (selectedCount ? " is-on" : "")}
        aria-label={"Available kit, have " + have.length + ", need " + need.length}
      >
        <span>Available kit{selectedCount ? " · " + selectedCount : ""}</span>
      </summary>
      <div className="material-filter__panel">
        <div className="matkit material-filter__kit">
          <div className="matkit__bar material-filter__kitbar">
            <span className="matkit__status">
              Have {have.length} · Need {need.length}
            </span>
            {showControls && (
              <Seg
                options={["Have", "Need"] as const}
                value={lead}
                onChange={setLead}
                ariaLabel="Sort available kit by what you have or still need"
              />
            )}
            {selectedCount > 0 && (
              <button type="button" className="material-filter__clear" onClick={onClear}>
                Clear
              </button>
            )}
          </div>
          <label className="material-filter__search">
            <CampIcon.Search />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search kit"
              aria-label="Search available kit"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} aria-label="Clear kit search">
                <CampIcon.Close />
              </button>
            )}
          </label>
          <div className="matkit__list material-filter__list" role="group" aria-label="Available kit">
            {ordered.length ? (
              ordered.map((option, i) => {
                const has = selectedSet.has(option.id);
                const divide = showControls && i === leadCount && i > 0 && i < ordered.length;
                const count = option.count + (option.count === 1 ? " activity" : " activities");
                return (
                  <Fragment key={option.id}>
                    {divide && <span className="matkit__div" role="separator" aria-hidden="true" />}
                    <button
                      type="button"
                      className={"matkit__item material-filter__item" + (has ? " is-have" : "")}
                      onClick={() => onToggle(option.id)}
                      aria-pressed={has}
                      aria-label={(has ? "Have" : "Still need") + ": " + option.label + ", used by " + count}
                      title={count}
                    >
                      <span className="matkit__check" aria-hidden="true">
                        {has && <CampIcon.Check />}
                      </span>
                      <span className="matkit__name">{option.label}</span>
                      <span className="material-filter__count">{option.count}</span>
                    </button>
                  </Fragment>
                );
              })
            ) : (
              <div className="material-filter__empty">No kit items match.</div>
            )}
          </div>
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
  starredOnly,
  materialOptions,
  availableMaterials,
  onCat,
  onPlace,
  onAge,
  onStarredOnly,
  onToggleMaterial,
  onClearMaterials,
}: FiltersProps) {
  const anyOn =
    cat !== "All" || place !== "All" || age !== "All" || Boolean(starredOnly) || availableMaterials.length > 0;

  const starredChip = onStarredOnly ? (
    <Chip on={Boolean(starredOnly)} onClick={() => onStarredOnly(!starredOnly)}>
      <CampIcon.Bookmark />
      Starred
    </Chip>
  ) : null;
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
                onStarredOnly?.(false);
                onClearMaterials();
              }}
            >
              Clear
            </button>
          )}
        </div>
        {starredChip && <Group label="Saved">{starredChip}</Group>}
        <Group label="Type">{typeChips}</Group>
        <Group label="Where">{placeChips}</Group>
        <Group label="Ages">{ageChips}</Group>
        <Group label="Available kit">
          <MaterialPicker
            options={materialOptions}
            selected={availableMaterials}
            onToggle={onToggleMaterial}
            onClear={onClearMaterials}
            defaultOpen
          />
        </Group>
      </div>
    );
  }

  // mobile horizontal bar
  return (
    <>
      <div className="filterbar">
        {starredChip && (
          <>
            <span className="filterbar__cluster" role="group" aria-label="Saved">
              {starredChip}
            </span>
            <span className="filterbar__div" aria-hidden="true" />
          </>
        )}
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
