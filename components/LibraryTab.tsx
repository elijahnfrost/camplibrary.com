"use client";

// The Library surface: view switcher, search, Add button, the mobile filter
// bar, and the three browse views. Filter state lives in CampApp because the
// desktop filter rail renders inside the sidenav.

import type { CSSProperties, MouseEvent, ReactNode } from "react";
import type { AgeFilter, CatFilter, LibrarySort, PlaceFilter, ThemeFilter } from "@/lib/activityFilters";
import type { AgeUnit } from "@/lib/data";
import type { MaterialOption } from "@/lib/materials";
import type { Theme } from "@/lib/themes";
import type { Activity, LibraryView } from "@/lib/types";
import { CampIcon } from "./icons";
import { ActiveFilters, Filters } from "./Filters";
import { CatalogView, DeckView, ShelfView } from "./LibraryViews";
import { LoadingVeil } from "./primitives";

export function LibraryTab({
  view,
  onView,
  actions,
  query,
  onQuery,
  sort,
  onSort,
  items,
  cat,
  place,
  age,
  theme,
  themes,
  themeOf,
  starredOnly,
  materialOptions,
  availableMaterials,
  ageUnit,
  onAgeUnit,
  onCat,
  onPlace,
  onAge,
  onTheme,
  onManageThemes,
  onStarredOnly,
  onToggleMaterial,
  onClearMaterials,
  onOpen,
  isFav,
  onToggleFav,
  onContextMenu,
  onAdd,
  hasLoaded = true,
}: {
  view: LibraryView;
  onView: (view: LibraryView) => void;
  query: string;
  onQuery: (query: string) => void;
  sort: LibrarySort;
  onSort: (sort: LibrarySort) => void;
  items: Activity[];
  cat: CatFilter;
  place: PlaceFilter;
  age: AgeFilter;
  ageUnit: AgeUnit;
  onAgeUnit: (v: AgeUnit) => void;
  theme: ThemeFilter;
  themes: Theme[];
  themeOf: (id: string) => Theme | null;
  starredOnly: boolean;
  materialOptions: MaterialOption[];
  availableMaterials: string[];
  onCat: (v: CatFilter) => void;
  onPlace: (v: PlaceFilter) => void;
  onAge: (v: AgeFilter) => void;
  onTheme: (v: ThemeFilter) => void;
  onManageThemes: () => void;
  onStarredOnly: (v: boolean) => void;
  onToggleMaterial: (id: string) => void;
  onClearMaterials: () => void;
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
  return (
    <>
      <div className="toolbar">
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
        <div className="toolbar__search">
          <CampIcon.Search />
          <input
            className="toolbar__search-input"
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
              className="toolbar__search-clear"
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
      </div>
      <Filters
        variant="bar"
        sort={sort}
        onSort={onSort}
        cat={cat}
        place={place}
        age={age}
        ageUnit={ageUnit}
        onAgeUnit={onAgeUnit}
        theme={theme}
        themes={themes}
        starredOnly={starredOnly}
        materialOptions={materialOptions}
        availableMaterials={availableMaterials}
        resultCount={items.length}
        onCat={onCat}
        onPlace={onPlace}
        onAge={onAge}
        onTheme={onTheme}
        onManageThemes={onManageThemes}
        onStarredOnly={onStarredOnly}
        onToggleMaterial={onToggleMaterial}
        onClearMaterials={onClearMaterials}
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
                  cat={cat}
                  place={place}
                  age={age}
                  ageUnit={ageUnit}
                  theme={theme}
                  themes={themes}
                  availableMaterials={availableMaterials}
                  onCat={onCat}
                  onPlace={onPlace}
                  onAge={onAge}
                  onTheme={onTheme}
                  onClearMaterials={onClearMaterials}
                />
                <button
                  type="button"
                  className="btn btn--quiet"
                  onClick={() => {
                    onCat("All");
                    onPlace("All");
                    onAge("All");
                    onTheme("All");
                    onStarredOnly(false);
                    onClearMaterials();
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
  );
}
