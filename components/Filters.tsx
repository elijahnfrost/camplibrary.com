"use client";

import { Fragment, useState, type CSSProperties, type ReactNode } from "react";
import type { AgeFilter, CatFilter, KitLens, LibrarySort, PlaceFilter, ThemeFilter } from "@/lib/activityFilters";
import { normalizeSearchText } from "@/lib/activityFilters";
import { AGE_GROUPS, ALL_CATEGORY_IDS, CATEGORIES, bandShort, categoryTint, type AgeUnit } from "@/lib/data";
import type { CategoryId } from "@/lib/types";
import type { MaterialOption } from "@/lib/materials";
import type { Theme } from "@/lib/themes";
import { CampIcon } from "./icons";
import { Modal } from "./Modal";
import { AgePicker, MiniSeg, RangeSlider, ThemePicker, ToggleSwitch } from "./primitives";
export type { AgeFilter, CatFilter, KitLens, PlaceFilter, ThemeFilter } from "@/lib/activityFilters";

/** The inclusive duration window [lo, hi] in minutes the library is filtered to. */
export type MinutesRange = [number, number];
/** The full span the slider can cover — the min/max durationMin in the library. */
export interface MinutesBounds {
  min: number;
  max: number;
}

/** Is the duration window narrower than the full library span? Only then does
 *  it count as an active filter (chip, clear-all, count). */
function minutesNarrowed(value: MinutesRange, bounds: MinutesBounds): boolean {
  return value[0] > bounds.min || value[1] < bounds.max;
}

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
  cats: CatFilter;
  place: PlaceFilter;
  age: AgeFilter;
  /** The age caption unit, so the removed-filter chip reads in the chosen unit. */
  ageUnit?: AgeUnit;
  /** Omit theme props to hide the theme chip (surfaces without themes). */
  theme?: ThemeFilter;
  themes?: Theme[];
  starredOnly?: boolean;
  /** The kit availability lens ("all" = inactive). Its chip reads the lens name
   *  and removing it resets to "all". */
  kitLens: KitLens;
  /** Current duration window + its full span, so the chip reads "15–45 min"
   *  and removing it widens back to the full bounds. */
  minutes: MinutesRange;
  minutesBounds: MinutesBounds;
  /** Browse-by-material narrowing (from the Materials tab's "Used by N →" jump):
   *  the active id + its resolved display name. A dismissible "Material: <name> ×"
   *  chip clears it back to null. Absent = no material narrowing. */
  materialId?: string | null;
  materialLabel?: string | null;
  onCats: (v: CatFilter) => void;
  onPlace: (v: PlaceFilter) => void;
  onAge: (v: AgeFilter) => void;
  onTheme?: (v: ThemeFilter) => void;
  onStarredOnly?: (v: boolean) => void;
  onMinutes: (v: MinutesRange) => void;
  onKitLens: (v: KitLens) => void;
  /** Clears the material filter (the chip's remove). */
  onMaterial?: (v: null) => void;
}

type ActiveChip = { key: string; label: string; tint?: string; onRemove: () => void };

function activeFilterChips(p: ActiveFilterProps): ActiveChip[] {
  const chips: ActiveChip[] = [];
  // The Type filter is a multi-select: a single chip stands in for the whole
  // dimension whenever it's narrowed from "all categories". One category reads as
  // its name + tint; several (or none) read as a count. Removing it restores all.
  if (p.cats.length !== CATEGORIES.length) {
    if (p.cats.length === 1) {
      chips.push({
        key: "cat",
        label: CATEGORIES.find((c) => c.id === p.cats[0])?.label ?? p.cats[0],
        tint: categoryTint(p.cats[0]),
        onRemove: () => p.onCats(ALL_CATEGORY_IDS),
      });
    } else {
      chips.push({
        key: "cat",
        label: p.cats.length === 0 ? "No types" : "Types · " + p.cats.length,
        onRemove: () => p.onCats(ALL_CATEGORY_IDS),
      });
    }
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
    const band = AGE_GROUPS.find((g) => g.id === p.age);
    chips.push({
      key: "age",
      label: band ? bandShort(band, p.ageUnit ?? "grades") : p.age,
      onRemove: () => p.onAge("All"),
    });
  }
  if (minutesNarrowed(p.minutes, p.minutesBounds)) {
    chips.push({
      key: "minutes",
      label: p.minutes[0] + "–" + p.minutes[1] + " min",
      onRemove: () => p.onMinutes([p.minutesBounds.min, p.minutesBounds.max]),
    });
  }
  if (p.kitLens !== "all") {
    chips.push({
      key: "kit",
      label: p.kitLens === "ready" ? "Can run" : "Almost",
      onRemove: () => p.onKitLens("all"),
    });
  }
  if (p.materialId && p.onMaterial) {
    chips.push({
      key: "material",
      label: "Material: " + (p.materialLabel ?? p.materialId),
      onRemove: () => p.onMaterial?.(null),
    });
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
  /** Library-wide ordering (A–Z / Rating) — lives in the same ledger as the
   *  filters so it reads as one sidebar control, not a row floating over the list. */
  sort: LibrarySort;
  onSort: (v: LibrarySort) => void;
  cats: CatFilter;
  place: PlaceFilter;
  age: AgeFilter;
  /** Grades⇄Ages caption unit + its toggle — relabels the age band names. */
  ageUnit: AgeUnit;
  onAgeUnit: (v: AgeUnit) => void;
  theme: ThemeFilter;
  themes: Theme[];
  /** Omit both starred props to hide the Starred control (surfaces without favorites). */
  starredOnly?: boolean;
  /** The kit availability lens (All / Ready / +Almost) — replaces the old
   *  uses-ANY kit picker. */
  kitLens: KitLens;
  /** True when the stock map is UNSET ({}): the lens is inert (passes
   *  everything), so picking Ready/+Almost shows a "mark what you have" hint. */
  kitUnset: boolean;
  /** Duration window [lo, hi] in minutes + the full library span it slides over.
   *  The row is hidden when the span is empty (bounds.max <= bounds.min). */
  minutes: MinutesRange;
  minutesBounds: MinutesBounds;
  /** Browse-by-material narrowing (the Materials-tab jump) + its display name. */
  materialId?: string | null;
  materialLabel?: string | null;
  /** Result count for the mobile sheet's "Show N" button (bar variant only). */
  resultCount?: number;
  onCats: (v: CatFilter) => void;
  onPlace: (v: PlaceFilter) => void;
  onAge: (v: AgeFilter) => void;
  onTheme: (v: ThemeFilter) => void;
  /** Opens the Themes manager (create/rename/delete) — the menu's footer. */
  onManageThemes?: () => void;
  onStarredOnly?: (v: boolean) => void;
  onMinutes: (v: MinutesRange) => void;
  onKitLens: (v: KitLens) => void;
  /** Clears the material filter (the chip's remove + Clear all). */
  onMaterial?: (v: null) => void;
  /** Jumps to the Materials tab (the Kit-lens "Set up your kit →" link). */
  onGoMaterials?: () => void;
}

// The old uses-ANY kit BROWSE filter — RETIRED from the library rail (its "can
// run" job is now the KitFilter lens below). Kept exported (unused here) because
// the Materials tab (a later chunk) will re-home this browse-by-material value.
export function MaterialPicker({
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
  // Accent-/case-insensitive so "mache" finds "papier-mâché" — same normalizer
  // the library search uses.
  const q = normalizeSearchText(query.trim());
  const matchesQuery = (option: MaterialOption) => !q || normalizeSearchText(option.label).includes(q);
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
        <span className="ledger__label"><CampIcon.Box className="ledger__ic" />Available kit</span>
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
          <label className="searchfield material-filter__search">
            <CampIcon.Search />
            <input
              className="searchfield__input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search kit"
              aria-label="Search available kit"
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
            />
            {query && (
              <button
                type="button"
                className="searchfield__clear"
                onClick={() => setQuery("")}
                aria-label="Clear kit search"
              >
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

// The Type filter — a multi-select checklist of categories (the same collapsible
// `<details>` + ledger-summary shape as the kit picker, so the rail reads as one
// family). Every category checked = "All" (the default); a subset shows only
// those shelves; none = show nothing. "All"/"None" flip the whole set at once.
// Selections are normalized back to shelf order so the active-chip + state read
// consistently however they were toggled.
function CategoryPicker({
  value,
  onChange,
}: {
  value: CategoryId[];
  onChange: (value: CategoryId[]) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const selected = new Set(value);
  const allOn = value.length === CATEGORIES.length;
  const noneOn = value.length === 0;
  const stateLabel = allOn ? "All" : noneOn ? "None" : value.length + " of " + CATEGORIES.length;
  const toggle = (id: CategoryId) => {
    const next = selected.has(id) ? value.filter((v) => v !== id) : [...value, id];
    // Keep the stored list in shelf order, deduped.
    onChange(ALL_CATEGORY_IDS.filter((cid) => next.includes(cid)));
  };
  return (
    <details
      className="material-filter cat-filter"
      open={isOpen}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
    >
      <summary
        className={"material-filter__summary ledger__row" + (allOn ? "" : " is-set")}
        aria-label={"Type, " + value.length + " of " + CATEGORIES.length + " categories shown"}
      >
        <span className="ledger__label"><CampIcon.Tag className="ledger__ic" />Type</span>
        <span className="material-filter__state">
          {stateLabel}
          <CampIcon.ChevronDown />
        </span>
      </summary>
      <div className="material-filter__panel">
        <div className="matkit material-filter__kit">
          <div className="matkit__bar material-filter__kitbar">
            <span className="matkit__status">{stateLabel}</span>
            <span className="cat-filter__acts">
              <button
                type="button"
                className="material-filter__clear"
                onClick={() => onChange(ALL_CATEGORY_IDS)}
                disabled={allOn}
              >
                All
              </button>
              <button
                type="button"
                className="material-filter__clear"
                onClick={() => onChange([])}
                disabled={noneOn}
              >
                None
              </button>
            </span>
          </div>
          <div className="matkit__list material-filter__list" role="group" aria-label="Categories">
            {CATEGORIES.map((category) => {
              const has = selected.has(category.id);
              return (
                <button
                  type="button"
                  key={category.id}
                  className={"matkit__item material-filter__item" + (has ? " is-have" : "")}
                  onClick={() => toggle(category.id)}
                  aria-pressed={has}
                  aria-label={(has ? "Showing" : "Hidden") + ": " + category.label}
                >
                  <span className="matkit__check" aria-hidden="true">
                    {has && <CampIcon.Check />}
                  </span>
                  <span
                    className="cat-filter__swatch"
                    style={{ background: categoryTint(category.id) }}
                    aria-hidden="true"
                  />
                  <span className="matkit__name">{category.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </details>
  );
}

// The kit availability lens — one ledger line: a MiniSeg of All / Ready /
// +Almost. "Ready" keeps only activities the camp can fully run right now;
// "+Almost" also keeps the one-item-short ones. When the stock map is UNSET the
// lens is inert (it passes everything), so choosing Ready/+Almost surfaces a
// hint whose "Set up your kit →" link jumps to the Materials tab rather than
// silently doing nothing.
function KitFilter({
  value,
  unset,
  onChange,
  onGoMaterials,
}: {
  value: KitLens;
  unset: boolean;
  onChange: (v: KitLens) => void;
  onGoMaterials?: () => void;
}) {
  return (
    <>
      <div className={"ledger__row" + (value !== "all" ? " is-active" : "")}>
        <span className="ledger__label"><CampIcon.Box className="ledger__ic" />Kit</span>
        <MiniSeg
          ariaLabel="Filter by what you can run"
          value={value}
          onChange={onChange}
          options={[
            { id: "all" as KitLens, label: "All" },
            { id: "ready" as KitLens, label: "Ready", ariaLabel: "Can run now" },
            { id: "almost" as KitLens, label: "+Almost", ariaLabel: "Ready or one item short" },
          ]}
        />
      </div>
      {value !== "all" && unset && (
        <p className="kitlens__hint">
          Mark what you have to use this.{" "}
          {onGoMaterials && (
            <button type="button" className="kitlens__hintlink" onClick={onGoMaterials}>
              Set up your kit →
            </button>
          )}
        </p>
      )}
    </>
  );
}

// The duration window — one ledger line like the others: a small-caps "Minutes"
// label, then a compact dual-handle slider with a quiet readout on the right.
// The readout reads "Any" at full span and "lo–hi" once narrowed. Hidden when
// the library has no duration spread to slide over (every activity one length).
function MinutesFilter({
  value,
  bounds,
  onChange,
}: {
  value: MinutesRange;
  bounds: MinutesBounds;
  onChange: (v: MinutesRange) => void;
}) {
  if (bounds.max <= bounds.min) return null;
  const narrowed = minutesNarrowed(value, bounds);
  // The step matches the library's 15-minute grid where it can, but a 5-minute
  // step keeps the handles reachable for any odd length the catalog carries.
  const step = 5;
  return (
    <div className={"ledger__row minrange" + (narrowed ? " is-active" : "")}>
      <span className="ledger__label"><CampIcon.Clock className="ledger__ic" />Minutes</span>
      <div className="minrange__control">
        <RangeSlider
          min={bounds.min}
          max={bounds.max}
          step={step}
          value={value}
          onChange={onChange}
          ariaLabelMin="Shortest length, minutes"
          ariaLabelMax="Longest length, minutes"
          format={(v) => v + " minutes"}
        />
        <span className="minrange__readout">{narrowed ? value[0] + "–" + value[1] : "Any"}</span>
      </div>
    </div>
  );
}

// A COLLAPSIBLE filter group — the same `<details>`/`<summary>` disclosure the
// Print rail uses (shares the `.prail__group--collapsible` vocabulary): the
// summary IS the group header (small-caps title left, a chevron right that
// rotates open). Lets the filter rail rest short — the everyday axes lead open,
// the finer narrowing and the list controls fold away one tap from reach.
function FilterGroup({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="prail__group prail__group--collapsible" open={defaultOpen}>
      <summary className="prail__grouphead prail__groupsum">
        <span className="prail__grouptitle">{title}</span>
        <span className="prail__morestate" aria-hidden="true">
          <CampIcon.ChevronDown />
        </span>
      </summary>
      <div className="prail__grouppanel">
        <div className="ledger">{children}</div>
      </div>
    </details>
  );
}

// THE filter body, shared by the desktop rail AND the mobile sheet so both
// surfaces read as the same form: every dimension is one ledger line — a
// small-caps label on the left, a compact control on the right. Type opens an
// inline menu, Where/Ages are mini segmented pills, Starred is a true switch,
// and the kit row shows its picked count and expands in place. The rows are
// grouped into two folding sections (the Print-rail pattern): "Activity" — every
// way you narrow the catalog — leads open, while "Sort & display" (list order +
// the age caption) rests closed, so the rail isn't a wall of equal-weight rows.
function LedgerFilters({
  sort,
  onSort,
  cats,
  place,
  age,
  ageUnit,
  onAgeUnit,
  theme,
  themes,
  starredOnly,
  kitLens,
  kitUnset,
  minutes,
  minutesBounds,
  onCats,
  onPlace,
  onAge,
  onTheme,
  onManageThemes,
  onStarredOnly,
  onMinutes,
  onKitLens,
  onGoMaterials,
}: Omit<FiltersProps, "variant" | "resultCount">) {
  return (
    <div className="filtergroups">
      {/* Activity — every way you narrow the catalog, in one open group: the
          everyday axes (type, theme, in/out, who it's for) followed by the finer
          narrowing (length, saved only, kit on hand). Each finer row self-hides
          when it doesn't apply (no duration spread / no favorites / no kit), so
          the group is never padded with dead controls. */}
      <FilterGroup title="Activity" defaultOpen>
        <CategoryPicker value={cats} onChange={onCats} />
        {/* Always shown so themes are discoverable — the menu footer creates the
            first one when none exist yet. */}
        <ThemePicker
          value={theme}
          onChange={onTheme}
          themes={themes}
          label="Theme"
          icon={CampIcon.Sparkles}
          ariaLabel="Filter by theme"
          onManage={onManageThemes}
        />
        <div className="ledger__row">
          <span className="ledger__label"><CampIcon.Sun className="ledger__ic" />Where</span>
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
        <AgePicker value={age} onChange={onAge} unit={ageUnit} label="Ages" icon={CampIcon.Users} ariaLabel="Filter by age group" />
        <MinutesFilter value={minutes} bounds={minutesBounds} onChange={onMinutes} />
        {onStarredOnly && (
          <div className="ledger__row">
            <span className="ledger__label"><CampIcon.Bookmark className="ledger__ic" />Starred only</span>
            <ToggleSwitch
              on={Boolean(starredOnly)}
              onChange={onStarredOnly}
              ariaLabel="Show starred activities only"
            />
          </div>
        )}
        <KitFilter value={kitLens} unset={kitUnset} onChange={onKitLens} onGoMaterials={onGoMaterials} />
      </FilterGroup>

      {/* Sort & display — list presentation, not a filter: the whole-list order
          and how age bands are captioned (Grades⇄Ages). CLOSED by default. */}
      <FilterGroup title="Sort & display">
        {/* Sort orders the whole list; "Rating" sinks unrated activities to the
            bottom (see sortActivities). */}
        <div className="ledger__row">
          <span className="ledger__label"><CampIcon.Sort className="ledger__ic" />Sort</span>
          <MiniSeg
            ariaLabel="Sort the library"
            value={sort}
            onChange={onSort}
            options={[
              { id: "az" as LibrarySort, label: "A–Z" },
              { id: "rating" as LibrarySort, label: "Rating" },
            ]}
          />
        </div>
        <div className="ledger__row">
          <span className="ledger__label"><CampIcon.Users className="ledger__ic" />Show ages as</span>
          <MiniSeg
            ariaLabel="Show ages as"
            value={ageUnit}
            onChange={(v) => onAgeUnit(v as AgeUnit)}
            options={[
              { id: "grades" as AgeUnit, label: "Grades" },
              { id: "ages" as AgeUnit, label: "Ages" },
            ]}
          />
        </div>
      </FilterGroup>
    </div>
  );
}

export function Filters({
  variant,
  sort,
  onSort,
  cats,
  place,
  age,
  ageUnit,
  onAgeUnit,
  theme,
  themes,
  starredOnly,
  kitLens,
  kitUnset,
  minutes,
  minutesBounds,
  materialId,
  materialLabel,
  resultCount,
  onCats,
  onPlace,
  onAge,
  onTheme,
  onManageThemes,
  onStarredOnly,
  onMinutes,
  onKitLens,
  onMaterial,
  onGoMaterials,
}: FiltersProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const minutesOn = minutesNarrowed(minutes, minutesBounds);
  const activeProps: ActiveFilterProps = {
    cats,
    place,
    age,
    ageUnit,
    theme,
    themes,
    starredOnly,
    kitLens,
    minutes,
    minutesBounds,
    materialId,
    materialLabel,
    onCats,
    onPlace,
    onAge,
    onTheme,
    onStarredOnly,
    onMinutes,
    onKitLens,
    onMaterial,
  };
  const activeCount =
    (cats.length !== CATEGORIES.length ? 1 : 0) +
    (theme !== "All" ? 1 : 0) +
    (place !== "All" ? 1 : 0) +
    (age !== "All" ? 1 : 0) +
    (minutesOn ? 1 : 0) +
    (starredOnly ? 1 : 0) +
    (kitLens !== "all" ? 1 : 0) +
    (materialId ? 1 : 0);
  const anyOn = activeCount > 0;
  const clearAll = () => {
    onCats(ALL_CATEGORY_IDS);
    onPlace("All");
    onAge("All");
    onTheme("All");
    onStarredOnly?.(false);
    onMinutes([minutesBounds.min, minutesBounds.max]);
    onKitLens("all");
    onMaterial?.(null);
  };

  const ledger = (
    <LedgerFilters
      sort={sort}
      onSort={onSort}
      cats={cats}
      place={place}
      age={age}
      ageUnit={ageUnit}
      onAgeUnit={onAgeUnit}
      theme={theme}
      themes={themes}
      starredOnly={starredOnly}
      kitLens={kitLens}
      kitUnset={kitUnset}
      minutes={minutes}
      minutesBounds={minutesBounds}
      materialId={materialId}
      materialLabel={materialLabel}
      onCats={onCats}
      onPlace={onPlace}
      onAge={onAge}
      onTheme={onTheme}
      onManageThemes={onManageThemes}
      onStarredOnly={onStarredOnly}
      onMinutes={onMinutes}
      onKitLens={onKitLens}
      onMaterial={onMaterial}
      onGoMaterials={onGoMaterials}
    />
  );

  if (variant === "rail") {
    // No section heading — every dimension is now a self-labelling toggle group,
    // so the "Filter" title was redundant. "Clear all" stands alone, pinned above
    // the scrolling groups and shown only while a filter is active.
    return (
      <div className="sidesection sidefilters-rail">
        {anyOn && (
          <div className="sidefilters__clear">
            <button type="button" className="sidesection__action" onClick={clearAll}>
              Clear all
            </button>
          </div>
        )}
        <div className="sidesection__body sidefilters">{ledger}</div>
      </div>
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
