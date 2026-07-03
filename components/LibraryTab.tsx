"use client";

// The Library surface: ONE toolbar contract (collection seg + search + Add)
// shared by both collections, the Shelf/Deck/Catalog view switch (Activities
// only), the mobile filter bar, and the three browse views. Filter state lives
// in CampApp because the desktop filter rail renders inside the sidenav. The
// Materials collection mounts the existing MaterialsTab content below the same
// toolbar (Materials was formerly its own tab, then a toolbar-swapping
// collection — now the toolbar itself never changes shape between the two).

import type { MouseEvent, ReactNode } from "react";
import type { AgeFilter, CatFilter, KitLens, LibrarySort, PlaceFilter, ThemeFilter } from "@/lib/activityFilters";
import { ALL_CATEGORY_IDS, type AgeUnit } from "@/lib/data";
import type { Theme } from "@/lib/themes";
import type { Material } from "@/lib/materialCatalog";
import type { MaterialSort, MaterialStockFilter, StockState } from "@/lib/kitStock";
import type { Activity, LibraryCollection, LibraryView } from "@/lib/types";
import { CampIcon } from "./icons";
import { ActiveFilters, Filters, type MinutesBounds, type MinutesRange } from "./Filters";
import { CatalogView, DeckView, ShelfView } from "./LibraryViews";
import { MaterialsTab } from "./MaterialsTab";
import { LoadingVeil, MiniSeg } from "./primitives";

// The MaterialsTab prop bundle, threaded through unchanged from CampApp. Kept as
// one object so the Library toolbar stays readable and the Materials collection
// is a clean drop-in of the existing component.
export interface MaterialsCollectionProps {
  activities: Activity[];
  catalog: Material[];
  kitStock: Record<string, StockState>;
  onSetStockState: (id: string, state: StockState) => void;
  onAddMaterial: (name: string) => string | null;
  onRename: (id: string, name: string) => void;
  onSetConsumable: (id: string, name: string, consumable: boolean) => void;
  onSetArchived: (id: string, name: string, archived: boolean) => void;
  onBrowseMaterial: (id: string, name: string) => void;
  canEdit: boolean;
  /** The shared toolbar search field's value, lifted to CampApp. */
  query: string;
  onQuery: (query: string) => void;
  stockFilter: MaterialStockFilter;
  onStockFilter: (v: MaterialStockFilter) => void;
  restockOnly: boolean;
  onRestockOnly: (v: boolean) => void;
  sort: MaterialSort;
  announce: (message: string) => void;
  /** Bumped by the toolbar's Add button. */
  pendingAdd: number;
  onPendingAddHandled: () => void;
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
  /** The ONE toolbar search field's value — routes to the active collection's
   *  own filter state (CampApp threads it to either the Activities `query` or
   *  the Materials bundle's `query`, whichever is showing). */
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
  /** The toolbar's Add button — creates an activity (Activities) or opens a
   *  fresh row in rename mode (Materials, see MaterialsCollectionProps). */
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
      {/* ONE toolbar contract for both collections: the collection seg, the
          Activities-only Shelf/Deck/Catalog switch, the shared search field,
          and the shared Add button always render in the same positions —
          Materials no longer swaps out the whole header (library-3). */}
      <div className="toolbar">
        {/* Collection seg — the far-left dimension: Activities (the catalog) vs
            Materials (the kit inventory, formerly its own tab). Built on the
            shared MiniSeg (radiogroup/radio, same as every other single-choice
            pill in the app — library-6/library-7), just wearing the toolbar's
            larger `.viewswitch` shell instead of the compact `.miniseg` one. */}
        <MiniSeg
          ariaLabel="Library collection"
          variant="toolbar"
          className="collseg"
          value={collection}
          onChange={onCollection}
          options={[
            { id: "activities" as LibraryCollection, label: "Activities", icon: CampIcon.Library },
            { id: "materials" as LibraryCollection, label: "Materials", icon: CampIcon.Crate },
          ]}
        />
        {/* The browse-view switch is Activities-only (kept per J1 — all three
            views stay; only the toggle's implementation gets cleaner). */}
        {!isMaterials && (
          <MiniSeg
            ariaLabel="Library view"
            variant="toolbar"
            value={view}
            onChange={onView}
            options={[
              { id: "shelf" as LibraryView, label: "Shelf", icon: CampIcon.Shelf },
              { id: "deck" as LibraryView, label: "Deck", icon: CampIcon.Deck },
              { id: "catalog" as LibraryView, label: "Catalog", icon: CampIcon.List },
            ]}
          />
        )}
        <div className="searchfield toolbar__search">
          <CampIcon.Search />
          <input
            className="searchfield__input"
            placeholder={isMaterials ? "Search materials" : "Search titles, steps, materials..."}
            value={isMaterials ? materials.query : query}
            onChange={(e) => (isMaterials ? materials.onQuery(e.target.value) : onQuery(e.target.value))}
            aria-label={isMaterials ? "Search materials" : "Search the library"}
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
          {(isMaterials ? materials.query : query) && (
            <button
              type="button"
              className="searchfield__clear"
              onClick={() => (isMaterials ? materials.onQuery("") : onQuery(""))}
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
          title={isMaterials ? "Add a new material" : "Catalog a new activity"}
        >
          <CampIcon.Plus />
          <span>Add</span>
        </button>
        {actions && <div className="toolbar__auth">{actions}</div>}
      </div>
      {isMaterials ? (
        // The Materials collection: the existing MaterialsTab content below
        // the shared toolbar. It still owns its own setup flow and row list.
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
