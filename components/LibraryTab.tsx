"use client";

// The Library surface: the collection seg (Activities | Materials), view
// switcher, search, Add button, the mobile filter bar, and the three browse
// views. Filter state lives in CampApp because the desktop filter rail renders
// inside the sidenav. The Materials collection mounts the existing MaterialsTab
// content in place of the browse views (Materials was formerly its own tab).

import type { CSSProperties, MouseEvent, ReactNode } from "react";
import type { AgeFilter, CatFilter, KitLens, LibrarySort, PlaceFilter, ThemeFilter } from "@/lib/activityFilters";
import { ALL_CATEGORY_IDS, type AgeUnit } from "@/lib/data";
import type { Theme } from "@/lib/themes";
import type { Material } from "@/lib/materialCatalog";
import type { StockState } from "@/lib/kitStock";
import type { Activity, LibraryCollection, LibraryView } from "@/lib/types";
import { CampIcon } from "./icons";
import { ActiveFilters, Filters, type MinutesBounds, type MinutesRange } from "./Filters";
import { CatalogView, DeckView, ShelfView } from "./LibraryViews";
import { MaterialsTab } from "./MaterialsTab";
import { LoadingVeil } from "./primitives";

// The MaterialsTab prop bundle, threaded through unchanged from CampApp. Kept as
// one object so the Library toolbar stays readable and the Materials collection
// is a clean drop-in of the existing component.
export interface MaterialsCollectionProps {
  activities: Activity[];
  catalog: Material[];
  kitStock: Record<string, StockState>;
  onSetStockState: (id: string, state: StockState) => void;
  onRename: (id: string, name: string) => void;
  onSetConsumable: (id: string, name: string, consumable: boolean) => void;
  onSetArchived: (id: string, name: string, archived: boolean) => void;
  onBrowseMaterial: (id: string, name: string) => void;
  canEdit: boolean;
}

export function LibraryTab({
  collection,
  onCollection,
  materials,
  view,
  onView,
  actions,
  query,
  onQuery,
  sort,
  onSort,
  items,
  cats,
  place,
  age,
  theme,
  themes,
  themeOf,
  starredOnly,
  kitLens,
  kitUnset,
  minutes,
  minutesBounds,
  materialId,
  materialLabel,
  ageUnit,
  onAgeUnit,
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
  onOpen,
  isFav,
  onToggleFav,
  onContextMenu,
  onAdd,
  hasLoaded = true,
}: {
  /** Which collection is showing — the activity catalog or the kit inventory. */
  collection: LibraryCollection;
  onCollection: (collection: LibraryCollection) => void;
  /** The MaterialsTab prop bundle, mounted when collection === "materials". */
  materials: MaterialsCollectionProps;
  view: LibraryView;
  onView: (view: LibraryView) => void;
  query: string;
  onQuery: (query: string) => void;
  sort: LibrarySort;
  onSort: (sort: LibrarySort) => void;
  items: Activity[];
  cats: CatFilter;
  place: PlaceFilter;
  age: AgeFilter;
  ageUnit: AgeUnit;
  onAgeUnit: (v: AgeUnit) => void;
  theme: ThemeFilter;
  themes: Theme[];
  themeOf: (id: string) => Theme | null;
  starredOnly: boolean;
  kitLens: KitLens;
  kitUnset: boolean;
  minutes: MinutesRange;
  minutesBounds: MinutesBounds;
  materialId?: string | null;
  materialLabel?: string | null;
  onCats: (v: CatFilter) => void;
  onPlace: (v: PlaceFilter) => void;
  onAge: (v: AgeFilter) => void;
  onTheme: (v: ThemeFilter) => void;
  onManageThemes: () => void;
  onStarredOnly: (v: boolean) => void;
  onMinutes: (v: MinutesRange) => void;
  onKitLens: (v: KitLens) => void;
  onMaterial?: (v: null) => void;
  onGoMaterials?: () => void;
  onOpen: (activity: Activity) => void;
  isFav: (id: string) => boolean;
  onToggleFav: (id: string) => void;
  /** Right-click an activity card/row → context menu (pointer-fine only). */
  onContextMenu?: (activity: Activity, event: MouseEvent) => void;
  onAdd: () => void;
  /** First-load readiness from the cloud store. The base catalog (the seed
   *  library) is always present, so the list is rarely "loading" — but the
   *  starred lens reads from synced favorites that arrive after a cold signed-in
   *  bootstrap, so an empty starred view is shown as loading until then. */
  hasLoaded?: boolean;
  /** Rendered at the right end of the toolbar (e.g. the auth pill). */
  actions?: ReactNode;
}) {
  const isMaterials = collection === "materials";
  return (
    <>
      <div className="toolbar">
        {/* Collection seg — the far-left dimension: Activities (the catalog) vs
            Materials (the kit inventory, formerly its own tab). --seg-i drives
            the sliding active pill (see .viewswitch in globals). */}
        <div
          className="collseg viewswitch seg-slide"
          role="group"
          aria-label="Library collection"
          style={{ "--seg-n": 2, "--seg-i": isMaterials ? 1 : 0 } as CSSProperties}
        >
          <button
            type="button"
            className={!isMaterials ? "is-active" : ""}
            aria-pressed={!isMaterials}
            onClick={() => onCollection("activities")}
          >
            <CampIcon.Library />
            Activities
          </button>
          <button
            type="button"
            className={isMaterials ? "is-active" : ""}
            aria-pressed={isMaterials}
            onClick={() => onCollection("materials")}
          >
            <CampIcon.Crate />
            Materials
          </button>
        </div>
        {/* The browse-view switch, search, and Add belong to the Activities
            collection only — Materials mounts its own header + search below. */}
        {!isMaterials && (
          <>
            {/* --seg-i drives the sliding active pill (see .viewswitch in globals). */}
            <div
              className="viewswitch seg-slide"
              style={
                {
                  "--seg-n": 3,
                  "--seg-i": view === "shelf" ? 0 : view === "deck" ? 1 : 2,
                } as CSSProperties
              }
            >
              <button
                type="button"
                className={view === "shelf" ? "is-active" : ""}
                aria-pressed={view === "shelf"}
                onClick={() => onView("shelf")}
              >
                <CampIcon.Shelf />
                Shelf
              </button>
              <button
                type="button"
                className={view === "deck" ? "is-active" : ""}
                aria-pressed={view === "deck"}
                onClick={() => onView("deck")}
              >
                <CampIcon.Deck />
                Deck
              </button>
              <button
                type="button"
                className={view === "catalog" ? "is-active" : ""}
                aria-pressed={view === "catalog"}
                onClick={() => onView("catalog")}
              >
                <CampIcon.List />
                Catalog
              </button>
            </div>
            <div className="searchfield toolbar__search">
              <CampIcon.Search />
              <input
                className="searchfield__input"
                placeholder="Search titles, steps, materials..."
                value={query}
                onChange={(e) => onQuery(e.target.value)}
                aria-label="Search the library"
                enterKeyHint="search"
                // Mobile keyboards otherwise auto-capitalize and autocorrect the
                // field, silently rewriting unusual game/alt-names ("Goggaball",
                // "gaga") into real words before they reach the matcher — the
                // root of "it searched something I didn't type."
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
                }}
              />
              {query && (
                <button
                  type="button"
                  className="searchfield__clear"
                  onClick={() => onQuery("")}
                  aria-label="Clear search"
                >
                  <CampIcon.Close />
                </button>
              )}
            </div>
            <button
              type="button"
              className="btn btn--primary toolbar__add"
              onClick={onAdd}
              title="Catalog a new activity"
            >
              <CampIcon.Plus />
              <span>Add</span>
            </button>
            {actions && <div className="toolbar__auth">{actions}</div>}
          </>
        )}
      </div>
      {isMaterials ? (
        // The Materials collection: the existing MaterialsTab content in place
        // of the mobile filter bar + browse views. It owns its own header,
        // search, and setup flow.
        <MaterialsTab {...materials} />
      ) : (
        <>
      <Filters
        variant="bar"
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
        resultCount={items.length}
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
      <div className="app__scroll">
        {items.length === 0 ? (
          // Say WHY it's empty and offer the one-tap way back.
          <div className="library-empty">
            {query ? (
              <>
                <p className="library-empty__title">Nothing matches &ldquo;{query}&rdquo;.</p>
                <button type="button" className="btn btn--quiet" onClick={() => onQuery("")}>
                  Clear search
                </button>
              </>
            ) : starredOnly && !hasLoaded ? (
              // Stars come from synced favorites that arrive after a cold signed-in
              // bootstrap — show loading, not "no stars yet", until they land.
              <LoadingVeil label="Loading your stars…" />
            ) : starredOnly ? (
              <>
                <p className="library-empty__title">No starred activities yet.</p>
                <p className="library-empty__hint">Tap the bookmark on any activity to star it.</p>
                <button type="button" className="btn btn--quiet" onClick={() => onStarredOnly(false)}>
                  Show all activities
                </button>
              </>
            ) : (
              <>
                <p className="library-empty__title">No activities match these filters.</p>
                {/* Each active filter is removable on its own, so narrowing
                    doesn't mean starting over. */}
                <ActiveFilters
                  className="library-empty__chips"
                  cats={cats}
                  place={place}
                  age={age}
                  ageUnit={ageUnit}
                  theme={theme}
                  themes={themes}
                  kitLens={kitLens}
                  minutes={minutes}
                  minutesBounds={minutesBounds}
                  materialId={materialId}
                  materialLabel={materialLabel}
                  onCats={onCats}
                  onPlace={onPlace}
                  onAge={onAge}
                  onTheme={onTheme}
                  onMinutes={onMinutes}
                  onKitLens={onKitLens}
                  onMaterial={onMaterial}
                />
                <button
                  type="button"
                  className="btn btn--quiet"
                  onClick={() => {
                    onCats(ALL_CATEGORY_IDS);
                    onPlace("All");
                    onAge("All");
                    onTheme("All");
                    onStarredOnly(false);
                    onMinutes([minutesBounds.min, minutesBounds.max]);
                    onKitLens("all");
                    onMaterial?.(null);
                  }}
                >
                  Clear filters
                </button>
              </>
            )}
          </div>
        ) : (
          <>
            {view === "shelf" && (
              <ShelfView items={items} onOpen={onOpen} isFav={isFav} onToggleFav={onToggleFav} onContextMenu={onContextMenu} themeOf={themeOf} />
            )}
            {view === "deck" && (
              <DeckView items={items} onOpen={onOpen} isFav={isFav} onToggleFav={onToggleFav} onContextMenu={onContextMenu} themeOf={themeOf} />
            )}
            {view === "catalog" && (
              <CatalogView items={items} onOpen={onOpen} isFav={isFav} onToggleFav={onToggleFav} onContextMenu={onContextMenu} themeOf={themeOf} />
            )}
          </>
        )}
      </div>
        </>
      )}
    </>
  );
}
