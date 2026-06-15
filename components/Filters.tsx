"use client";

import { Fragment, useState, type CSSProperties } from "react";
import type { AgeFilter, CatFilter, PlaceFilter, ThemeFilter } from "@/lib/activityFilters";
import { AGE_GROUPS, CATEGORIES, categoryTint } from "@/lib/data";
import type { MaterialOption } from "@/lib/materials";
import type { Theme } from "@/lib/themes";
import { CampIcon } from "./icons";
import { Modal } from "./Modal";
import { MiniSeg, SidebarSection, ThemePicker, ToggleSwitch, TypePicker } from "./primitives";
export type { AgeFilter, CatFilter, PlaceFilter, ThemeFilter } from "@/lib/activityFilters";

/** The shared color hook: the removable active-filter chip carries its
 *  dimension's tint via --chip-on (the .chip.is-on recipe darkens it for AA).
 *  Type chips teach the category color; Where/Ages fall back to the accent. */
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
  /** Omit theme props to hide the theme chip (surfaces without themes). */
  theme?: ThemeFilter;
  themes?: Theme[];
  starredOnly?: boolean;
  availableMaterials: string[];
  onCat: (v: CatFilter) => void;
  onPlace: (v: PlaceFilter) => void;
  onAge: (v: AgeFilter) => void;
  onTheme?: (v: ThemeFilter) => void;
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
  if (p.theme && p.theme !== "All" && p.onTheme) {
    const match = p.themes?.find((t) => t.id === p.theme);
    chips.push({
      key: "theme",
      label: match?.label ?? "Theme",
      tint: match?.tint,
      onRemove: () => p.onTheme?.("All"),
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

interface FiltersProps {
  variant: "bar" | "rail";
  cat: CatFilter;
  place: PlaceFilter;
  age: AgeFilter;
  theme: ThemeFilter;
  themes: Theme[];
  /** Omit both starred props to hide the Starred control (surfaces without favorites). */
  starredOnly?: boolean;
  materialOptions: MaterialOption[];
  availableMaterials: string[];
  /** Result count for the mobile sheet's "Show N" button (bar variant only). */
  resultCount?: number;
  onCat: (v: CatFilter) => void;
  onPlace: (v: PlaceFilter) => void;
  onAge: (v: AgeFilter) => void;
  onTheme: (v: ThemeFilter) => void;
  /** Opens the Themes manager (create/rename/delete) — the menu's footer. */
  onManageThemes?: () => void;
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
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [query, setQuery] = useState("");
  if (!options.length) return null;
  const selectedSet = new Set(selected);
  const q = query.trim().toLowerCase();
  const matchesQuery = (option: MaterialOption) => !q || option.label.toLowerCase().includes(q);
  // Picked kit floats to the top so "what am I filtering by" is always in view.
  const visibleSelected = options.filter((option) => selectedSet.has(option.id)).filter(matchesQuery);
  const visibleRest = options.filter((option) => !selectedSet.has(option.id)).filter(matchesQuery);
  const ordered = [...visibleSelected, ...visibleRest];
  const selectedCount = selected.length;

  return (
    <details
      className="material-filter"
      open={isOpen}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
    >
      {/* On the rail this summary IS the kit's ledger row — label left, the
          picked count + chevron as the right-hand control. In the sheet's
          always-open KitGroup it's hidden (the group label does the naming). */}
      <summary
        className={"material-filter__summary ledger__row" + (selectedCount ? " is-set" : "")}
        aria-label={"Available kit, " + selectedCount + " of " + options.length + " selected"}
      >
        <span className="ledger__label">Available kit</span>
        <span className="material-filter__state">
          {selectedCount ? selectedCount + " picked" : "Any"}
          <CampIcon.ChevronDown />
        </span>
      </summary>
      <div className="material-filter__panel">
        <div className="matkit material-filter__kit">
          {selectedCount > 0 && (
            <div className="matkit__bar material-filter__kitbar">
              <span className="matkit__status">{selectedCount} selected</span>
              <button type="button" className="material-filter__clear" onClick={onClear}>
                Clear
              </button>
            </div>
          )}
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
                const divide = i === visibleSelected.length && i > 0 && i < ordered.length;
                const count = option.count + (option.count === 1 ? " activity" : " activities");
                return (
                  <Fragment key={option.id}>
                    {divide && <span className="matkit__div" role="separator" aria-hidden="true" />}
                    <button
                      type="button"
                      className={"matkit__item material-filter__item" + (has ? " is-have" : "")}
                      onClick={() => onToggle(option.id)}
                      aria-pressed={has}
                      aria-label={(has ? "Selected" : "Not selected") + ": " + option.label + ", used by " + count}
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

// THE filter body, shared by the desktop rail AND the mobile sheet so both
// surfaces read as the same form: every dimension is one ledger line — a
// small-caps label on the left, a compact control on the right. Type opens an
// inline menu, Where/Ages are mini segmented pills, Starred is a true switch,
// and the kit row shows its picked count and expands in place.
function LedgerFilters({
  cat,
  place,
  age,
  theme,
  themes,
  starredOnly,
  materialOptions,
  availableMaterials,
  onCat,
  onPlace,
  onAge,
  onTheme,
  onManageThemes,
  onStarredOnly,
  onToggleMaterial,
  onClearMaterials,
}: Omit<FiltersProps, "variant" | "resultCount">) {
  return (
    <div className="ledger">
      <TypePicker value={cat} onChange={onCat} label="Type" ariaLabel="Filter by type" />
      {/* Always shown so themes are discoverable — the menu footer creates the
          first one when none exist yet. */}
      <ThemePicker
        value={theme}
        onChange={onTheme}
        themes={themes}
        label="Theme"
        ariaLabel="Filter by theme"
        onManage={onManageThemes}
      />
      <div className="ledger__row">
        <span className="ledger__label">Where</span>
        <MiniSeg
          ariaLabel="Filter by place"
          value={place}
          onChange={onPlace}
          options={[
            { id: "All" as PlaceFilter, label: "All" },
            { id: "Inside" as PlaceFilter, label: "In", ariaLabel: "Inside" },
            { id: "Outside" as PlaceFilter, label: "Out", ariaLabel: "Outside" },
          ]}
        />
      </div>
      <div className="ledger__row">
        <span className="ledger__label">Ages</span>
        <MiniSeg
          ariaLabel="Filter by age group"
          value={age}
          onChange={onAge}
          options={[
            { id: "All" as AgeFilter, label: "All" },
            ...AGE_GROUPS.map((g) => ({
              id: g.id as AgeFilter,
              label: g.short.replace("Gr ", "").replace("PreK", "PK"),
              ariaLabel: g.label,
            })),
          ]}
        />
      </div>
      {onStarredOnly && (
        <div className="ledger__row">
          <span className="ledger__label">Starred only</span>
          <ToggleSwitch
            on={Boolean(starredOnly)}
            onChange={onStarredOnly}
            ariaLabel="Show starred activities only"
          />
        </div>
      )}
      <MaterialPicker
        options={materialOptions}
        selected={availableMaterials}
        onToggle={onToggleMaterial}
        onClear={onClearMaterials}
      />
    </div>
  );
}

export function Filters({
  variant,
  cat,
  place,
  age,
  theme,
  themes,
  starredOnly,
  materialOptions,
  availableMaterials,
  resultCount,
  onCat,
  onPlace,
  onAge,
  onTheme,
  onManageThemes,
  onStarredOnly,
  onToggleMaterial,
  onClearMaterials,
}: FiltersProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const activeProps: ActiveFilterProps = {
    cat,
    place,
    age,
    theme,
    themes,
    starredOnly,
    availableMaterials,
    onCat,
    onPlace,
    onAge,
    onTheme,
    onStarredOnly,
    onClearMaterials,
  };
  const activeCount =
    (cat !== "All" ? 1 : 0) +
    (theme !== "All" ? 1 : 0) +
    (place !== "All" ? 1 : 0) +
    (age !== "All" ? 1 : 0) +
    (starredOnly ? 1 : 0) +
    (availableMaterials.length > 0 ? 1 : 0);
  const anyOn = activeCount > 0;
  const clearAll = () => {
    onCat("All");
    onPlace("All");
    onAge("All");
    onTheme("All");
    onStarredOnly?.(false);
    onClearMaterials();
  };

  const ledger = (
    <LedgerFilters
      cat={cat}
      place={place}
      age={age}
      theme={theme}
      themes={themes}
      starredOnly={starredOnly}
      materialOptions={materialOptions}
      availableMaterials={availableMaterials}
      onCat={onCat}
      onPlace={onPlace}
      onAge={onAge}
      onTheme={onTheme}
      onManageThemes={onManageThemes}
      onStarredOnly={onStarredOnly}
      onToggleMaterial={onToggleMaterial}
      onClearMaterials={onClearMaterials}
    />
  );

  if (variant === "rail") {
    return (
      <SidebarSection
        title="Filter"
        bodyClassName="sidefilters"
        action={
          anyOn ? (
            <button type="button" className="sidesection__action" onClick={clearAll}>
              Clear all
            </button>
          ) : undefined
        }
      >
        {ledger}
      </SidebarSection>
    );
  }

  // mobile: a single Filters entry + an always-visible removable active-chip row;
  // the sheet holds the same switch ledger as the desktop rail.
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
              <button type="button" className="sidesection__action" onClick={clearAll}>
                Clear all
              </button>
            )}
          </div>
          <div className="overlay__body filtersheet">
            {ledger}
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
