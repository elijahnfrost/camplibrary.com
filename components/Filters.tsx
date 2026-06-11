"use client";

import { Fragment, useState, type CSSProperties, type ReactNode } from "react";
import type { AgeFilter, CatFilter, PlaceFilter } from "@/lib/activityFilters";
import { AGE_GROUPS, CATEGORIES, categoryTint } from "@/lib/data";
import type { MaterialOption } from "@/lib/materials";
import { CampIcon } from "./icons";
import { Modal } from "./Modal";
import { Seg } from "./primitives";
export type { AgeFilter, CatFilter, PlaceFilter } from "@/lib/activityFilters";

const PLACES = ["Inside", "Outside"] as const;
type KitSort = "Have" | "Need";

/** The shared color hook: a selected chip carries its dimension's tint via
 *  --chip-on (the .chip.is-on recipe darkens it for AA). Type chips teach the
 *  category color; Where/Ages have no tint and fall back to the accent. */
function tintStyle(tint?: string): CSSProperties | undefined {
  return tint ? ({ "--chip-on": tint } as CSSProperties) : undefined;
}

// ---- Active-filter summary (shared by the rail, the mobile trigger, and the
// library empty state) — every active filter is a removable chip, so narrowing
// never means starting over. -----------------------------------------------

interface ActiveFilterProps {
  cat: CatFilter;
  place: PlaceFilter;
  age: AgeFilter;
  starredOnly?: boolean;
  availableMaterials: string[];
  onCat: (v: CatFilter) => void;
  onPlace: (v: PlaceFilter) => void;
  onAge: (v: AgeFilter) => void;
  onStarredOnly?: (v: boolean) => void;
  onClearMaterials: () => void;
}

type ActiveChip = { key: string; label: string; tint?: string; onRemove: () => void };

function activeFilterChips(p: ActiveFilterProps): ActiveChip[] {
  const chips: ActiveChip[] = [];
  if (p.cat !== "All") {
    chips.push({
      key: "cat",
      label: CATEGORIES.find((c) => c.id === p.cat)?.label ?? p.cat,
      tint: categoryTint(p.cat),
      onRemove: () => p.onCat("All"),
    });
  }
  if (p.place !== "All") chips.push({ key: "place", label: p.place, onRemove: () => p.onPlace("All") });
  if (p.age !== "All") {
    chips.push({
      key: "age",
      label: AGE_GROUPS.find((g) => g.id === p.age)?.short ?? p.age,
      onRemove: () => p.onAge("All"),
    });
  }
  if (p.availableMaterials.length > 0) {
    chips.push({ key: "kit", label: "Kit · " + p.availableMaterials.length, onRemove: p.onClearMaterials });
  }
  if (p.starredOnly && p.onStarredOnly) {
    chips.push({ key: "starred", label: "Starred", onRemove: () => p.onStarredOnly?.(false) });
  }
  return chips;
}

export function ActiveFilters({ className, ...props }: ActiveFilterProps & { className?: string }) {
  const chips = activeFilterChips(props);
  if (!chips.length) return null;
  return (
    <div className={"activefilters" + (className ? " " + className : "")}>
      {chips.map((chip) => (
        <button
          type="button"
          key={chip.key}
          className="chip is-on activefilters__chip"
          style={tintStyle(chip.tint)}
          onClick={chip.onRemove}
          aria-label={"Remove filter " + chip.label}
        >
          {chip.label}
          <CampIcon.Close />
        </button>
      ))}
    </div>
  );
}

// ---- Dimension groups (data-driven; adding a dimension later is appending one
// descriptor, not new markup). Single-select = a radio chip-group with an
// explicit, quiet "All" that clears the dimension. ---------------------------

type DimOption = { id: string; label: string; tint?: string };
type Dimension = { id: string; label: string; value: string; options: DimOption[]; onChange: (v: string) => void };

function buildDimensions(p: {
  cat: CatFilter;
  place: PlaceFilter;
  age: AgeFilter;
  onCat: (v: CatFilter) => void;
  onPlace: (v: PlaceFilter) => void;
  onAge: (v: AgeFilter) => void;
}): Dimension[] {
  return [
    {
      id: "cat",
      label: "Type",
      value: p.cat,
      onChange: (v) => p.onCat(v as CatFilter),
      options: [
        { id: "All", label: "All" },
        ...CATEGORIES.map((c) => ({ id: c.id, label: c.label, tint: categoryTint(c.id) })),
      ],
    },
    {
      id: "place",
      label: "Where",
      value: p.place,
      onChange: (v) => p.onPlace(v as PlaceFilter),
      options: [{ id: "All", label: "All" }, ...PLACES.map((pl) => ({ id: pl, label: pl }))],
    },
    {
      id: "age",
      label: "Ages",
      value: p.age,
      onChange: (v) => p.onAge(v as AgeFilter),
      options: [{ id: "All", label: "All" }, ...AGE_GROUPS.map((g) => ({ id: g.id, label: g.short }))],
    },
  ];
}

function DimensionGroup({ dim }: { dim: Dimension }) {
  return (
    <div className="filtergroup">
      <span className="filtergroup__label" id={"filterdim-" + dim.id}>
        {dim.label}
      </span>
      <div className="filtergroup__chips" role="radiogroup" aria-labelledby={"filterdim-" + dim.id}>
        {dim.options.map((opt) => {
          const on = dim.value === opt.id;
          const isAll = opt.id === "All";
          return (
            <button
              type="button"
              key={opt.id}
              role="radio"
              aria-checked={on}
              className={"chip" + (on ? " is-on" : "") + (isAll ? " chip--all" : "")}
              style={!isAll ? tintStyle(opt.tint) : undefined}
              onClick={() => {
                if (!on) dim.onChange(opt.id);
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StarredGroup({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="filtergroup">
      <span className="filtergroup__label">Saved</span>
      <div className="filtergroup__chips">
        <button
          type="button"
          className={"chip" + (on ? " is-on" : "")}
          aria-pressed={on}
          onClick={() => onChange(!on)}
        >
          <CampIcon.Bookmark />
          Starred
        </button>
      </div>
    </div>
  );
}

interface FiltersProps {
  variant: "bar" | "rail";
  cat: CatFilter;
  place: PlaceFilter;
  age: AgeFilter;
  /** Omit both starred props to hide the Starred control (surfaces without favorites). */
  starredOnly?: boolean;
  materialOptions: MaterialOption[];
  availableMaterials: string[];
  /** Result count for the mobile sheet's "Show N" button (bar variant only). */
  resultCount?: number;
  onCat: (v: CatFilter) => void;
  onPlace: (v: PlaceFilter) => void;
  onAge: (v: AgeFilter) => void;
  onStarredOnly?: (v: boolean) => void;
  onToggleMaterial: (id: string) => void;
  onClearMaterials: () => void;
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

function KitGroup({
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
  return (
    <div className="filtergroup filtergroup--kit">
      <span className="filtergroup__label">Available kit</span>
      <MaterialPicker options={options} selected={selected} onToggle={onToggle} onClear={onClear} defaultOpen />
    </div>
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
  resultCount,
  onCat,
  onPlace,
  onAge,
  onStarredOnly,
  onToggleMaterial,
  onClearMaterials,
}: FiltersProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const dimensions = buildDimensions({ cat, place, age, onCat, onPlace, onAge });
  const activeProps: ActiveFilterProps = {
    cat,
    place,
    age,
    starredOnly,
    availableMaterials,
    onCat,
    onPlace,
    onAge,
    onStarredOnly,
    onClearMaterials,
  };
  const activeCount =
    (cat !== "All" ? 1 : 0) +
    (place !== "All" ? 1 : 0) +
    (age !== "All" ? 1 : 0) +
    (starredOnly ? 1 : 0) +
    (availableMaterials.length > 0 ? 1 : 0);
  const anyOn = activeCount > 0;
  const clearAll = () => {
    onCat("All");
    onPlace("All");
    onAge("All");
    onStarredOnly?.(false);
    onClearMaterials();
  };

  const groups: ReactNode = (
    <>
      {onStarredOnly && <StarredGroup on={Boolean(starredOnly)} onChange={onStarredOnly} />}
      {dimensions.map((dim) => (
        <DimensionGroup key={dim.id} dim={dim} />
      ))}
      <KitGroup
        options={materialOptions}
        selected={availableMaterials}
        onToggle={onToggleMaterial}
        onClear={onClearMaterials}
      />
    </>
  );

  if (variant === "rail") {
    return (
      <div className="sidefilters">
        <div className="sidefilters__head">
          <span className="sidefilters__title">Filter</span>
          {anyOn && (
            <button type="button" className="sidefilters__clear" onClick={clearAll}>
              Clear all
            </button>
          )}
        </div>
        <ActiveFilters {...activeProps} className="sidefilters__active" />
        {groups}
      </div>
    );
  }

  // mobile: a single Filters entry + an always-visible removable active-chip row;
  // the sheet holds the full set of dimensions.
  return (
    <>
      <div className="filtertrigger">
        <button
          type="button"
          className={"filtertrigger__btn" + (anyOn ? " is-on" : "")}
          onClick={() => setSheetOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
        >
          <CampIcon.Filter />
          <span>Filters</span>
          {activeCount > 0 && <span className="filtertrigger__count">{activeCount}</span>}
        </button>
        <ActiveFilters {...activeProps} className="filtertrigger__active" />
      </div>
      {sheetOpen && (
        <Modal
          label="Filters"
          onClose={() => setSheetOpen(false)}
          overlayProps={{ className: "overlay--card overlay--filters" }}
        >
          <div className="overlay__bar">
            <h2 className="filtersheet__title">Filters</h2>
            {anyOn && (
              <button type="button" className="sidefilters__clear" onClick={clearAll}>
                Clear all
              </button>
            )}
          </div>
          <div className="overlay__body filtersheet">
            {groups}
          </div>
          <button
            type="button"
            className="btn btn--primary filtersheet__done"
            onClick={() => setSheetOpen(false)}
          >
            {typeof resultCount === "number"
              ? "Show " + resultCount + (resultCount === 1 ? " activity" : " activities")
              : "Done"}
          </button>
        </Modal>
      )}
    </>
  );
}
