"use client";

// Camp Library — the Materials tab.
//
// A light top-level surface for reviewing what the camp has on hand. It reads
// ONE vocabulary — the union of the catalog's named entries and the materials
// derived from every activity's kit — and shows it in two presentations off the
// same list:
//
//  · SETUP mode, shown while the stock map is UNSET ({}): a zero-state banner
//    over the same usage-sorted list, plus bulk shortcuts to mark a lot at
//    once. It's PURELY presentation — the first stock write (any tap) flips the
//    tab to normal mode naturally, because the map is no longer empty.
//  · NORMAL mode: a pinned "Restock" section (the low/out rows, one tap back to
//    have), then the full searchable list. Each row shows an explicit Have/
//    Low/Out control (all three states visible at once — no tap-to-cycle) and
//    carries an overflow menu (rename / consumable / archive) and a "Used by N
//    activities →" jump into the pre-filtered Library.
//
// Every mutation flows through useActivityLibrary's staff-gated setters, so an
// anonymous/read-only visitor's taps are inert (the gate returns false).

import { useMemo, useState } from "react";
import type { Activity } from "@/lib/types";
import { coverage, materialOptionsForActivities } from "@/lib/materials";
import { catalogNameFor, type Material } from "@/lib/materialCatalog";
import { isStocked, type StockState } from "@/lib/kitStock";
import { normalizeSearchText } from "@/lib/activityFilters";
import { CampIcon } from "./icons";
import { ContextMenu } from "./floating/ContextMenu";
import { MiniSeg } from "./primitives";

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
// counts 0). Sorted by usage desc, then name, so the busiest kit leads.
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

// The explicit 3-way control every row shows — Have / Low / Out, all visible
// at once (replaces the old tap-to-cycle button, which hid the other two
// states until you tapped through them). A row with no state yet renders
// with none selected; MiniSeg's active index is just -1, no bespoke case
// needed. Kept local (not the sidebar's KitFilter instance) since options are
// per-row identical but the value differs per row.
const STOCK_OPTIONS: { id: StockState; label: string; ariaLabel: string }[] = [
  { id: "have", label: "Have", ariaLabel: "Have" },
  { id: "low", label: "Low", ariaLabel: "Low" },
  { id: "out", label: "Out", ariaLabel: "Out" },
];

function matchesQuery(name: string, q: string): boolean {
  return !q || normalizeSearchText(name).includes(q);
}

export function MaterialsTab({
  activities,
  catalog,
  kitStock,
  onSetStockState,
  onRename,
  onSetConsumable,
  onSetArchived,
  onBrowseMaterial,
  canEdit,
}: {
  activities: Activity[];
  catalog: Material[];
  /** The effective 3-state stock map (material id → have/low/out). Empty ({}) is
   *  the UNSET signal that puts the tab in Setup mode. */
  kitStock: Record<string, StockState>;
  onSetStockState: (id: string, state: StockState) => void;
  onRename: (id: string, name: string) => void;
  onSetConsumable: (id: string, name: string, consumable: boolean) => void;
  onSetArchived: (id: string, name: string, archived: boolean) => void;
  /** Jump to the Library pre-filtered to activities using this material id. */
  onBrowseMaterial: (id: string, name: string) => void;
  /** False for anonymous/read-only visitors — the taps are inert either way (the
   *  staff gate blocks the write), but we present read-only affordances. */
  canEdit: boolean;
}) {
  const [query, setQuery] = useState("");
  // The row whose overflow menu is open, anchored at the ⋯ button's point.
  const [menu, setMenu] = useState<{ row: MaterialRow; point: { x: number; y: number } } | null>(null);
  // Inline rename: the id being renamed + its live draft text.
  const [renaming, setRenaming] = useState<{ id: string; draft: string } | null>(null);

  const rows = useMemo(() => buildRows(activities, catalog, kitStock), [activities, catalog, kitStock]);

  // UNSET ({}) → Setup presentation. The first stock write makes the map
  // non-empty, so this flips to normal mode on the very next render.
  const isSetup = Object.keys(kitStock).length === 0;

  const q = normalizeSearchText(query.trim());
  const visible = useMemo(() => rows.filter((r) => matchesQuery(r.name, q)), [rows, q]);

  // Coverage-based readiness across ALL activities — the honest "N ready" count
  // the progress line reports (mirrors the library's Can-run lens).
  const readyCount = useMemo(
    () => activities.filter((a) => coverage(a, kitStock, catalog).state === "ready").length,
    [activities, kitStock, catalog]
  );
  const markedCount = useMemo(() => rows.filter((r) => r.state !== undefined).length, [rows]);

  // Restock (normal mode): the low/out rows, pinned on top for a one-tap return
  // to Have. Search-filtered like the main list so it stays in step.
  const restock = useMemo(
    () => visible.filter((r) => r.state === "low" || r.state === "out"),
    [visible]
  );

  const openMenu = (row: MaterialRow, event: React.MouseEvent) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ row, point: { x: rect.left, y: rect.bottom } });
  };

  const beginRename = (row: MaterialRow) => setRenaming({ id: row.id, draft: row.name });
  const commitRename = () => {
    if (!renaming) return;
    const trimmed = renaming.draft.trim();
    if (trimmed) onRename(renaming.id, trimmed);
    setRenaming(null);
  };

  // Mark every currently-visible UNSET row as Have — the setup fast path. Only
  // touches rows that have no state yet, so it never overwrites a deliberate Low/
  // Out the user already set.
  const markVisibleHave = () => {
    for (const row of visible) {
      if (row.state === undefined) onSetStockState(row.id, "have");
    }
  };

  // Opt-in head start: mark the top ~40 by usage as Have. Data-driven — surfaced
  // as a button, never applied by default.
  const seedMostUsed = () => {
    for (const row of rows.slice(0, MOST_USED_SEED_COUNT)) {
      onSetStockState(row.id, "have");
    }
  };

  const renderRow = (row: MaterialRow) => {
    const isRenaming = renaming?.id === row.id;
    const stateClass = row.state ? " is-" + row.state : " is-unset";
    return (
      <li key={row.id} className={"matrow" + stateClass}>
        <span className="matrow__dot" aria-hidden="true">
          {isStocked(row.state) && <CampIcon.Check />}
        </span>
        <span className="matrow__body">
          {isRenaming ? (
            <input
              className="matrow__rename"
              value={renaming.draft}
              autoFocus
              aria-label={"Rename " + row.name}
              onChange={(e) => setRenaming({ id: row.id, draft: e.target.value })}
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
        {/* Explicit 3-state control — Have/Low/Out all shown at once, so the
            other states are never hidden behind repeated taps. Unset renders
            with nothing selected (MiniSeg's active index is just -1). A
            read-only visitor still sees the current state; taps are inert
            (mirrors every other staff-gated control here). */}
        <MiniSeg
          ariaLabel={"Stock for " + row.name}
          value={(row.state ?? "") as StockState}
          onChange={(v) => canEdit && onSetStockState(row.id, v)}
          options={STOCK_OPTIONS}
        />
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
    <div className="app__scroll">
      <div className="materials-tab">
        <header className="materials-tab__head">
          <div className="materials-tab__heading">
            <h1 className="materials-tab__title">Materials</h1>
            <p className="materials-tab__scope">
              {markedCount} of {rows.length} marked · {readyCount}{" "}
              {readyCount === 1 ? "activity" : "activities"} ready
            </p>
          </div>
        </header>

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
                {canEdit && rows.length > 0 && (
                  <button type="button" className="btn btn--primary" onClick={seedMostUsed}>
                    Start from your most-used kit
                  </button>
                )}
                {canEdit && visible.length > 0 && (
                  <button type="button" className="btn btn--ghost" onClick={markVisibleHave}>
                    Mark visible as Have
                  </button>
                )}
                {canEdit && (
                  <button
                    type="button"
                    className="btn btn--quiet"
                    onClick={() => {
                      // "Skip — mark as you go" just marks the busiest row Have,
                      // which flips the tab into normal mode; every later tap then
                      // writes normally. (There's no "unset presentation" toggle to
                      // hold — the map's emptiness IS the mode.)
                      if (rows[0]) onSetStockState(rows[0].id, "have");
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

        <label className="materials-tab__search">
          <CampIcon.Search />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search materials"
            aria-label="Search materials"
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear materials search">
              <CampIcon.Close />
            </button>
          )}
        </label>

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
          {visible.length > 0 ? (
            <ul className="matlist">{visible.map(renderRow)}</ul>
          ) : (
            <p className="materials-empty">
              {query ? "No materials match “" + query + "”." : "No materials yet. Add kit to an activity and it shows up here."}
            </p>
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
              onSelect: () => onSetArchived(menu.row.id, menu.row.name, true),
            },
          ]}
        />
      )}
    </div>
  );
}
