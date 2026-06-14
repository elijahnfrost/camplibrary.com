"use client";

// The Library surface: view switcher, search, Add button, the mobile filter
// bar, and the three browse views. Filter state lives in CampApp because the
// desktop filter rail renders inside the sidenav.

import type { MouseEvent, ReactNode } from "react";
import type { AgeFilter, CatFilter, PlaceFilter } from "@/lib/activityFilters";
import type { MaterialOption } from "@/lib/materials";
import type { Activity, LibraryView } from "@/lib/types";
import { CampIcon } from "./icons";
import { ActiveFilters, Filters } from "./Filters";
import { CatalogView, DeckView, ShelfView } from "./LibraryViews";

export function LibraryTab({
  view,
  onView,
  actions,
  query,
  onQuery,
  items,
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
  onOpen,
  isFav,
  onToggleFav,
  onContextMenu,
  onAdd,
}: {
  view: LibraryView;
  onView: (view: LibraryView) => void;
  query: string;
  onQuery: (query: string) => void;
  items: Activity[];
  cat: CatFilter;
  place: PlaceFilter;
  age: AgeFilter;
  starredOnly: boolean;
  materialOptions: MaterialOption[];
  availableMaterials: string[];
  onCat: (v: CatFilter) => void;
  onPlace: (v: PlaceFilter) => void;
  onAge: (v: AgeFilter) => void;
  onStarredOnly: (v: boolean) => void;
  onToggleMaterial: (id: string) => void;
  onClearMaterials: () => void;
  onOpen: (activity: Activity) => void;
  isFav: (id: string) => boolean;
  onToggleFav: (id: string) => void;
  /** Right-click an activity card/row → context menu (pointer-fine only). */
  onContextMenu?: (activity: Activity, event: MouseEvent) => void;
  onAdd: () => void;
  /** Rendered at the right end of the toolbar (e.g. the auth pill). */
  actions?: ReactNode;
}) {
  return (
    <>
      <div className="toolbar">
        <div className="viewswitch">
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
        cat={cat}
        place={place}
        age={age}
        starredOnly={starredOnly}
        materialOptions={materialOptions}
        availableMaterials={availableMaterials}
        resultCount={items.length}
        onCat={onCat}
        onPlace={onPlace}
        onAge={onAge}
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
                  availableMaterials={availableMaterials}
                  onCat={onCat}
                  onPlace={onPlace}
                  onAge={onAge}
                  onClearMaterials={onClearMaterials}
                />
                <button
                  type="button"
                  className="btn btn--quiet"
                  onClick={() => {
                    onCat("All");
                    onPlace("All");
                    onAge("All");
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
              <ShelfView items={items} onOpen={onOpen} isFav={isFav} onToggleFav={onToggleFav} onContextMenu={onContextMenu} />
            )}
            {view === "deck" && (
              <DeckView items={items} onOpen={onOpen} isFav={isFav} onToggleFav={onToggleFav} onContextMenu={onContextMenu} />
            )}
            {view === "catalog" && (
              <CatalogView items={items} onOpen={onOpen} isFav={isFav} onToggleFav={onToggleFav} onContextMenu={onContextMenu} />
            )}
          </>
        )}
      </div>
    </>
  );
}
