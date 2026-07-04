"use client";

// Camp Library — the kit availability editor, mounted as KitModal's body.
//
// A light surface for reviewing what the camp has on hand. It reads ONE
// vocabulary — the union of the catalog's named entries and the materials
// derived from every activity's kit — and shows it in two presentations off the
// same list:
//
//  · SETUP mode, shown while the stock map is UNSET ({}): a zero-state banner
//    over the same usage-sorted list, plus bulk shortcuts to mark a lot at
//    once. It's PURELY presentation — the first stock write (any tap) flips the
//    tab to normal mode naturally, because the map is no longer empty.
//  · NORMAL mode: a pinned "Restock" section (the low/out rows), then the full
//    searchable list. Each row leads with the bloom dot (StockDot — the row
//    rests as status; tapping blooms the explicit Have/Low/Out choices in
//    place) and carries an overflow menu (rename / consumable / archive) and a
//    "Used by N activities →" jump into the pre-filtered Library.
//
// Materials no longer lives behind its own Library collection tab — this is
// now purely KitModal's body (see components/KitModal.tsx), which owns the
// search field, stock/restock/sort controls, and Add button that used to live
// in the Library toolbar and sidebar. Every row/setup/restock behavior below
// is unchanged; only the outer chrome it used to share has moved.
//
// Every mutation flows through useActivityLibrary's staff-gated setters, so an
// anonymous/read-only visitor's taps are inert (the gate returns false).

import { useEffect, useMemo, useRef, useState } from "react";
import type { Activity } from "@/lib/types";
import { coverage, materialOptionsForActivities } from "@/lib/materials";
import { catalogNameFor, type Material } from "@/lib/materialCatalog";
import type { MaterialSort, MaterialStockFilter, StockState } from "@/lib/kitStock";
import { normalizeSearchText } from "@/lib/activityFilters";
import { CampIcon } from "./icons";
import { requestConfirm } from "./ConfirmDialog";
import { ContextMenu } from "./floating/ContextMenu";
import { StockDot } from "./StockDot";

// The top-N most-used materials the opt-in "Start from your most-used kit"
// button marks as Have. Data-driven (never a default), so a fresh account only
// gets a head start when it explicitly asks.
const MOST_USED_SEED_COUNT = 40;

// One row in the unified list: the join-key id, the resolved display name, its
// per-activity usage count, its current stock state, and the catalog flags that
// drive the overflow menu. `derivedOnly` marks a row with no catalog entry yet
// (a rename mints one); `archived` rows are filtered OUT of the list but their
// name still resolves through the catalog.
interface MaterialRow {
  id: string;
  name: string;
  count: number;
  state: StockState | undefined;
  consumable: boolean;
  derivedOnly: boolean;
}

// Build the unified vocabulary: catalog entries (non-archived) UNION the
// activity-derived options, keyed by id. The catalog name always wins; usage
// count comes from the derived options (a catalog-only entry no activity uses
// counts 0). Sorted by usage desc, then name, so the busiest kit leads by
// default (see `sortRows` for the alphabetical alternative).
function buildRows(
  activities: Activity[],
  catalog: Material[],
  stock: Record<string, StockState>
): MaterialRow[] {
  const options = materialOptionsForActivities(activities, catalog);
  const countById = new Map(options.map((o) => [o.id, o.count]));
  const catalogById = new Map(catalog.map((entry) => [entry.id, entry]));

  // Every id we know about: derived ids + every non-archived catalog id.
  const ids = new Set<string>(options.map((o) => o.id));
  for (const entry of catalog) {
    if (!entry.archived) ids.add(entry.id);
  }

  const rows: MaterialRow[] = [];
  for (const id of ids) {
    const entry = catalogById.get(id);
    // An archived catalog entry hides the row even when an activity still uses
    // the id (the name keeps resolving elsewhere via catalogNameFor).
    if (entry?.archived) continue;
    rows.push({
      id,
      name: catalogNameFor(catalog, id),
      count: countById.get(id) ?? 0,
      state: stock[id],
      consumable: entry?.consumable === true,
      derivedOnly: !entry,
    });
  }

  rows.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return rows;
}

function sortRows(rows: MaterialRow[], sort: MaterialSort): MaterialRow[] {
  if (sort === "az") return [...rows].sort((a, b) => a.name.localeCompare(b.name));
  return rows; // buildRows already sorts usage-desc
}

function matchesQuery(name: string, q: string): boolean {
  return !q || normalizeSearchText(name).includes(q);
}

export function MaterialsTab({
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
  query,
  onQuery,
  stockFilter,
  onStockFilter,
  restockOnly,
  onRestockOnly,
  sort,
  announce,
  pendingAdd,
  onPendingAddHandled,
}: {
  activities: Activity[];
  catalog: Material[];
  /** The effective 3-state stock map (material id → have/low/out). Empty ({}) is
   *  the UNSET signal that puts the tab in Setup mode. */
  kitStock: Record<string, StockState>;
  onSetStockState: (id: string, state: StockState) => void;
  /** Mint a brand-new catalog entry with no activity reference yet — returns
   *  the new id, or null if the name was blank or already existed. */
  onAddMaterial: (name: string) => string | null;
  onRename: (id: string, name: string) => void;
  onSetConsumable: (id: string, name: string, consumable: boolean) => void;
  onSetArchived: (id: string, name: string, archived: boolean) => void;
  /** Jump to the Library pre-filtered to activities using this material id. */
  onBrowseMaterial: (id: string, name: string) => void;
  /** False for anonymous/read-only visitors — the taps are inert either way (the
   *  staff gate blocks the write), but we present read-only affordances. */
  canEdit: boolean;
  /** KitModal's own search field value (its controls row owns this locally). */
  query: string;
  /** Clears the search (the empty state's "Clear search" recovery). */
  onQuery: (query: string) => void;
  /** KitModal's Have/Low/Out filter control. */
  stockFilter: MaterialStockFilter;
  /** Clears the stock filter (the empty state's "Clear filters" recovery). */
  onStockFilter: (v: MaterialStockFilter) => void;
  /** KitModal's "Restock only" toggle (low/out rows only). */
  restockOnly: boolean;
  /** Clears the restock-only toggle (the empty state's "Clear filters" recovery). */
  onRestockOnly: (v: boolean) => void;
  /** KitModal's sort control. */
  sort: MaterialSort;
  /** The app's one shared live-region announcer (mirrors the Activities
   *  collection's filtered-count announcements). */
  announce: (message: string) => void;
  /** Bumped by KitModal's Add button — opens a fresh blank row in rename
   *  mode so typing a name mints the entry (the Materials "Add" entry point). */
  pendingAdd?: number;
  onPendingAddHandled?: () => void;
}) {
  // The row whose overflow menu is open, anchored at the ⋯ button's point.
  const [menu, setMenu] = useState<{ row: MaterialRow; point: { x: number; y: number } } | null>(null);
  // Inline rename: the id being renamed + its live draft text. Also doubles as
  // the "Add" flow's inline naming step (see the pendingAdd effect below).
  const [renaming, setRenaming] = useState<{ id: string; draft: string; isNew?: boolean } | null>(null);

  const allRows = useMemo(() => buildRows(activities, catalog, kitStock), [activities, catalog, kitStock]);

  // UNSET ({}) → Setup presentation. The first stock write makes the map
  // non-empty, so this flips to normal mode on the very next render.
  const isSetup = Object.keys(kitStock).length === 0;

  const q = normalizeSearchText(query.trim());
  const rows = useMemo(() => {
    let out = allRows.filter((r) => matchesQuery(r.name, q));
    if (stockFilter !== "all") out = out.filter((r) => r.state === stockFilter);
    if (restockOnly) out = out.filter((r) => r.state === "low" || r.state === "out");
    return sortRows(out, sort);
  }, [allRows, q, stockFilter, restockOnly, sort]);

  // Coverage-based readiness across ALL activities — the honest "N ready" count
  // the progress line reports (mirrors the library's Can-run lens).
  const readyCount = useMemo(
    () => activities.filter((a) => coverage(a, kitStock, catalog).state === "ready").length,
    [activities, kitStock, catalog]
  );
  const markedCount = useMemo(() => allRows.filter((r) => r.state !== undefined).length, [allRows]);

  // Restock (normal mode): the low/out rows, pinned on top for a one-tap return
  // to Have. Search/filter-matched like the main list so it stays in step —
  // but never doubled with the "Restock only" toggle already on (that would
  // just render the same rows twice).
  const restock = useMemo(
    () => (restockOnly ? [] : rows.filter((r) => r.state === "low" || r.state === "out")),
    [rows, restockOnly]
  );

  // Announce the visible-count change to assistive tech, mirroring the
  // Activities collection (CampApp's libraryItems effect) — skips the first
  // render so only a real narrowing/widening speaks.
  const prevCountRef = useRef<number | null>(null);
  useEffect(() => {
    const count = rows.length;
    if (prevCountRef.current !== null && prevCountRef.current !== count) {
      announce(count + (count === 1 ? " material" : " materials"));
    }
    prevCountRef.current = count;
  }, [rows.length, announce]);

  // The toolbar's Add button bumps `pendingAdd` — mint a fresh blank entry and
  // open it straight in rename mode, reusing the exact inline-rename input
  // every row already has (no second "new item" UI to maintain). A blank
  // placeholder name keeps the birth-slug collision-free until the user types
  // a real one and commits.
  const pendingAddRef = useRef(pendingAdd);
  useEffect(() => {
    if (pendingAdd === undefined || pendingAdd === pendingAddRef.current) return;
    pendingAddRef.current = pendingAdd;
    const id = onAddMaterial("New material " + Date.now());
    if (id) setRenaming({ id, draft: "", isNew: true });
    onPendingAddHandled?.();
  }, [pendingAdd, onAddMaterial, onPendingAddHandled]);

  const openMenu = (row: MaterialRow, event: React.MouseEvent) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ row, point: { x: rect.left, y: rect.bottom } });
  };

  const beginRename = (row: MaterialRow) => setRenaming({ id: row.id, draft: row.name });
  const commitRename = () => {
    if (!renaming) return;
    const trimmed = renaming.draft.trim();
    if (trimmed) onRename(renaming.id, trimmed);
    // A freshly-minted row abandoned with no name typed is left carrying its
    // placeholder — harmless (it's just an unused catalog entry) and avoids a
    // separate "cancel = delete" path this surface doesn't otherwise have.
    setRenaming(null);
  };

  // Mark every currently-visible UNSET row as Have — the setup fast path. Only
  // touches rows that have no state yet, so it never overwrites a deliberate Low/
  // Out the user already set.
  const markVisibleHave = () => {
    for (const row of rows) {
      if (row.state === undefined) onSetStockState(row.id, "have");
    }
  };

  // Opt-in head start: mark the top ~40 by usage as Have. Data-driven — surfaced
  // as a button, never applied by default.
  const seedMostUsed = () => {
    for (const row of allRows.slice(0, MOST_USED_SEED_COUNT)) {
      onSetStockState(row.id, "have");
    }
  };

  const renderRow = (row: MaterialRow) => {
    const isRenaming = renaming?.id === row.id;
    const stateClass = row.state ? " is-" + row.state : " is-unset";
    return (
      <li key={row.id} className={"matrow" + stateClass}>
        {/* The bloom dot IS the row's stock control (StockDot): the old status
            dot and the old Have/Low/Out seg collapsed into one thing — the row
            rests as status, tapping the dot blooms the three choices in place.
            A read-only visitor gets the status face with no bloom. */}
        <StockDot
          name={row.name}
          display={row.state}
          current={row.state}
          disabled={!canEdit}
          onSet={(state) => onSetStockState(row.id, state)}
        />
        <span className="matrow__body">
          {isRenaming ? (
            <input
              className="matrow__rename"
              value={renaming.draft}
              autoFocus
              placeholder={renaming.isNew ? "Name this material…" : undefined}
              aria-label={renaming.isNew ? "Name the new material" : "Rename " + row.name}
              onChange={(e) => setRenaming({ ...renaming, draft: e.target.value })}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitRename();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setRenaming(null);
                }
              }}
            />
          ) : (
            <span className="matrow__name">
              {row.name}
              {row.consumable && <span className="matrow__tagconsumable">consumable</span>}
            </span>
          )}
        </span>
        <span
          className="matrow__used"
          role="button"
          tabIndex={row.count > 0 ? 0 : -1}
          aria-disabled={row.count === 0 || undefined}
          onClick={() => row.count > 0 && onBrowseMaterial(row.id, row.name)}
          onKeyDown={(e) => {
            if (row.count > 0 && (e.key === "Enter" || e.key === " ")) {
              e.preventDefault();
              onBrowseMaterial(row.id, row.name);
            }
          }}
          title={row.count > 0 ? "Browse activities using " + row.name : "Not used by any activity yet"}
        >
          {row.count > 0 ? "Used by " + row.count : "Unused"}
          {row.count > 0 && <CampIcon.ChevronRight />}
        </span>
        {canEdit && (
          <button
            type="button"
            className="matrow__more"
            aria-label={"More actions for " + row.name}
            aria-haspopup="menu"
            onClick={(e) => openMenu(row, e)}
          >
            <CampIcon.More />
          </button>
        )}
      </li>
    );
  };

  return (
    <>
      <div className="materials-tab">
        <p className="materials-tab__scope">
          {markedCount} of {allRows.length} marked · {readyCount}{" "}
          {readyCount === 1 ? "activity" : "activities"} ready
        </p>

        {isSetup && (
          <div className="materials-setup">
            <div className="materials-setup__banner">
              <span className="materials-setup__kicker">Set up your kit</span>
              <h2 className="materials-setup__title">Mark what you have — ~2 minutes</h2>
              <p className="materials-setup__copy">
                Set each material to Have, Low, or Out. Once you&rsquo;ve marked a few, the
                library can show what you can run right now.
              </p>
              <div className="materials-setup__actions">
                {canEdit && allRows.length > 0 && (
                  <button type="button" className="btn btn--primary" onClick={seedMostUsed}>
                    Start from your most-used kit
                  </button>
                )}
                {/* Both secondary paths wear the same quiet shade — the seed
                    button above is the banner's ONE primary; the old
                    ghost/quiet mix read as three different-weight actions. */}
                {canEdit && rows.length > 0 && (
                  <button type="button" className="btn btn--quiet" onClick={markVisibleHave}>
                    Mark visible as Have
                  </button>
                )}
                {canEdit && allRows.length > 0 && (
                  <button
                    type="button"
                    className="btn btn--quiet"
                    onClick={() => {
                      // "Skip — mark as you go" just marks the busiest row Have,
                      // which flips the tab into normal mode; every later tap then
                      // writes normally. Guarded by allRows.length so it never
                      // renders as a dead-end button with nothing to mark (a
                      // fresh catalog has no rows yet — see the Add entry point
                      // above instead).
                      if (allRows[0]) onSetStockState(allRows[0].id, "have");
                    }}
                    title="Mark one item to leave setup; keep marking the rest as you go"
                  >
                    Skip — mark as you go
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {!isSetup && restock.length > 0 && (
          <section className="materials-section materials-section--restock">
            <h2 className="materials-section__title">
              <CampIcon.Bolt className="materials-section__ic" />
              Restock
            </h2>
            <ul className="matlist">{restock.map(renderRow)}</ul>
          </section>
        )}

        <section className="materials-section">
          {!isSetup && restock.length > 0 && (
            <h2 className="materials-section__title">All materials</h2>
          )}
          {rows.length > 0 ? (
            <ul className="matlist">{rows.map(renderRow)}</ul>
          ) : (
            // Say WHY it's empty and offer the one-tap way back — the same
            // shape as the Activities collection's empty state (materials-8/11).
            <div className="materials-empty">
              {query ? (
                <>
                  <p className="materials-empty__title">Nothing matches &ldquo;{query}&rdquo;.</p>
                  <button type="button" className="btn btn--quiet" onClick={() => onQuery("")}>
                    Clear search
                  </button>
                </>
              ) : allRows.length === 0 ? (
                <p className="materials-empty__title">
                  No materials yet. Add kit to an activity, or use Add above.
                </p>
              ) : (
                <>
                  <p className="materials-empty__title">No materials match these filters.</p>
                  <button
                    type="button"
                    className="btn btn--quiet"
                    onClick={() => {
                      onStockFilter("all");
                      onRestockOnly(false);
                    }}
                  >
                    Clear filters
                  </button>
                </>
              )}
            </div>
          )}
        </section>
      </div>

      {menu && (
        <ContextMenu
          point={menu.point}
          ariaLabel={menu.row.name}
          onClose={() => setMenu(null)}
          items={[
            {
              label: "Rename",
              icon: <CampIcon.Pencil />,
              onSelect: () => beginRename(menu.row),
            },
            {
              label: menu.row.consumable ? "Not consumable" : "Consumable",
              icon: <CampIcon.Box />,
              onSelect: () => onSetConsumable(menu.row.id, menu.row.name, !menu.row.consumable),
            },
            {
              label: "Archive",
              icon: <CampIcon.Trash />,
              danger: true,
              separatorBefore: true,
              // Archiving hides the material from the list with no undo toast —
              // a non-undoable removal, so it confirms (house rule: undoable
              // actions don't confirm, non-undoable vocabulary removals do).
              onSelect: async () => {
                const ok = await requestConfirm({
                  title: "Archive “" + menu.row.name + "”?",
                  body: "It's hidden from the list until you unarchive it.",
                  confirmLabel: "Archive",
                  danger: true,
                });
                if (ok) onSetArchived(menu.row.id, menu.row.name, true);
              },
            },
          ]}
        />
      )}
    </>
  );
}
