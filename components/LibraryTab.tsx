"use client";

// The Library surface: view switcher, search, Add button, the mobile filter
// bar, and the three browse views. Filter state lives in CampApp because the
// desktop filter rail renders inside the sidenav.

import type { AgeFilter, CatFilter, PlaceFilter } from "@/lib/activityFilters";
import type { MaterialOption } from "@/lib/materials";
import type { Activity, LibraryView } from "@/lib/types";
import { CampIcon } from "./icons";
import { Filters } from "./Filters";
import { CatalogView, DeckView, ShelfView } from "./LibraryViews";

export function LibraryTab({
  view,
  onView,
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
  onAdd: () => void;
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
          />
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
      </div>
      <Filters
        variant="bar"
        cat={cat}
        place={place}
        age={age}
        starredOnly={starredOnly}
        materialOptions={materialOptions}
        availableMaterials={availableMaterials}
        onCat={onCat}
        onPlace={onPlace}
        onAge={onAge}
        onStarredOnly={onStarredOnly}
        onToggleMaterial={onToggleMaterial}
        onClearMaterials={onClearMaterials}
      />
      <div className="app__scroll">
        {view === "shelf" && <ShelfView items={items} onOpen={onOpen} isFav={isFav} onToggleFav={onToggleFav} />}
        {view === "deck" && <DeckView items={items} onOpen={onOpen} isFav={isFav} onToggleFav={onToggleFav} />}
        {view === "catalog" && (
          <CatalogView items={items} onOpen={onOpen} isFav={isFav} onToggleFav={onToggleFav} />
        )}
      </div>
    </>
  );
}
