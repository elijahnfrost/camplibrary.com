"use client";

// Camp Library — the Kit modal: the availability editor as a popup, reached
// from the filter rail's Kit group ("Edit stock…", see Filters) instead of a
// dedicated Materials collection tab. Follows the same overlay--card pattern
// as ListManagerModal (Camps/Themes): a titled bar, a close icon-button, and a
// scrollable body — here the body opens with a compact controls row (search +
// stock lens + sort + Add) before handing off to MaterialsTab, which keeps
// every bit of its row/setup/restock behavior unchanged.
//
// Control-noise budget (this surface is ALREADY full of per-row Have/Low/Out
// segs): ONE seg up top — the stock lens, whose "Restock" option absorbs the
// old separate "Restock only" labelled toggle (restock IS just low∪out) —
// sort is a quiet dropdown (a set-and-forget, not a toggle-often), and Add is
// a plain bordered button, NOT primary: in setup mode the banner's seed
// button is the surface's one green action, and two primaries on one card
// read as a fork.
//
// The modal OWNS the editor's filter state locally — query, the stock lens,
// sort, and the Add button's pendingAdd counter all live here instead of being
// lifted to CampApp, since only this modal ever reads them (the old sidebar
// MaterialsFilters rail and toolbar search-field branch are both retired).

import { useState } from "react";
import type { Activity } from "@/lib/types";
import type { Material } from "@/lib/materials/materialCatalog";
import type { MaterialSort, MaterialStockFilter, StockState } from "@/lib/materials/kitStock";
import { CampIcon } from "../ui/icons";
import { Modal } from "../ui/Modal";
import { MaterialsTab } from "./MaterialsTab";
import { Select } from "../floating/Select";
import { MiniSeg } from "../ui/primitives";

// The stock lens: MaterialsTab's own 4 stock states plus "Restock", which is
// not a fifth stored state — it maps to the tab's restockOnly narrowing
// (low + out together, the "what needs attention" cut).
type StockLens = MaterialStockFilter | "restock";

export function KitModal({
  activities,
  catalog,
  kitStock,
  onSetStockState,
  onAddMaterial,
  onRename,
  onSetConsumable,
  onSetArchived,
  onBrowseMaterial,
  canEdit,
  announce,
  onClose,
}: {
  activities: Activity[];
  catalog: Material[];
  /** The effective 3-state stock map (material id → have/low/out). Empty ({}) is
   *  the UNSET signal that puts MaterialsTab in Setup mode. */
  kitStock: Record<string, StockState>;
  onSetStockState: (id: string, state: StockState) => void;
  /** Mint a brand-new catalog entry with no activity reference yet — returns
   *  the new id, or null if the name was blank or already existed. */
  onAddMaterial: (name: string) => string | null;
  onRename: (id: string, name: string) => void;
  onSetConsumable: (id: string, name: string, consumable: boolean) => void;
  onSetArchived: (id: string, name: string, archived: boolean) => void;
  /** Jump to the Library pre-filtered to activities using this material id —
   *  closes this modal first (see CampApp's browseMaterial). */
  onBrowseMaterial: (id: string, name: string) => void;
  /** False for anonymous/read-only visitors — the taps are inert either way (the
   *  staff gate blocks the write), but we present read-only affordances. */
  canEdit: boolean;
  /** The app's one shared live-region announcer. */
  announce: (message: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [lens, setLens] = useState<StockLens>("all");
  const [sort, setSort] = useState<MaterialSort>("usage");
  // Bumped by the controls row's Add button — tells MaterialsTab to mint a
  // fresh row and open it in rename mode (its existing pendingAdd contract).
  const [pendingAdd, setPendingAdd] = useState(0);

  return (
    <Modal label="Kit availability" onClose={onClose} overlayProps={{ className: "overlay--card overlay--kit" }}>
      <div className="overlay__bar">
        <h2 className="manager__title">Kit availability</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
          <CampIcon.Close />
        </button>
      </div>
      {/* The controls: two intentional rows — find & create (search + Add),
          then lens & order (the ONE stock seg + a sort dropdown) — the
          vocabulary the old sidebar MaterialsFilters rail and toolbar search
          field used to carry, now living beside the list it filters instead
          of split across two other surfaces. */}
      <div className="kitmodal__controls">
        {/* Row 1 — find & create: the search grows, Add rides its right end. */}
        <div className="kitmodal__row">
          <div className="searchfield kitmodal__search">
            <CampIcon.Search />
            <input
              className="searchfield__input"
              placeholder="Search materials"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search materials"
              enterKeyHint="search"
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
                onClick={() => setQuery("")}
                aria-label="Clear search"
              >
                <CampIcon.Close />
              </button>
            )}
          </div>
          {canEdit && (
            <button
              type="button"
              className="btn kitmodal__add"
              onClick={() => setPendingAdd((n) => n + 1)}
              title="Add a new material"
            >
              <CampIcon.Plus />
              <span>Add</span>
            </button>
          )}
        </div>
        {/* Row 2 — lens & order: the one stock seg left, sort dropdown right. */}
        <div className="kitmodal__row kitmodal__row--lens">
          <MiniSeg
            ariaLabel="Filter materials by stock state"
            value={lens}
            onChange={setLens}
            options={[
              { id: "all" as StockLens, label: "All" },
              { id: "have" as StockLens, label: "Have" },
              { id: "low" as StockLens, label: "Low" },
              { id: "out" as StockLens, label: "Out" },
              { id: "restock" as StockLens, label: "Restock", ariaLabel: "Needs restocking (low or out)" },
            ]}
          />
          <Select
            ariaLabel="Sort materials"
            value={sort}
            onChange={setSort}
            options={[
              { value: "usage", label: "Usage" },
              { value: "az", label: "A–Z" },
            ]}
          />
        </div>
      </div>
      <div className="overlay__body kitmodal__body">
        <MaterialsTab
          activities={activities}
          catalog={catalog}
          kitStock={kitStock}
          onSetStockState={onSetStockState}
          onAddMaterial={onAddMaterial}
          onRename={onRename}
          onSetConsumable={onSetConsumable}
          onSetArchived={onSetArchived}
          onBrowseMaterial={onBrowseMaterial}
          canEdit={canEdit}
          query={query}
          onQuery={setQuery}
          stockFilter={lens === "restock" ? "all" : lens}
          onStockFilter={setLens}
          restockOnly={lens === "restock"}
          onRestockOnly={(v) => setLens(v ? "restock" : "all")}
          sort={sort}
          announce={announce}
          pendingAdd={pendingAdd}
          onPendingAddHandled={() => {}}
        />
      </div>
    </Modal>
  );
}
