"use client";

// The Materials surface — the single place the two lists live and cross-reference.
// Same shape as the Print tab: a portaled sidebar RAIL of lenses + a main BOARD.
// The board is the canonical catalog grouped by substitution class; each row is a
// MaterialRow (on-hand toggle + "required by" back-references + inline stand-ins).
// The rail shows the on-hand lens, search, and a live coverage read-out — the
// payoff of reconciling the kit against everything the library requires.

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { Activity } from "@/lib/types";
import {
  backReferences,
  indexCatalog,
  materialCoverage,
  refsForActivity,
  runnableState,
  type CoverageResult,
  type Material,
  type MaterialCatalog,
} from "@/lib/materialCatalog";
import { normalizeSearchText } from "@/lib/activityFilters";
import { CampIcon } from "../icons";
import { MiniSeg, ToggleSwitch } from "../primitives";
import { MaterialRow } from "./MaterialRow";

type OnHandLens = "all" | "have" | "missing";

export function MaterialsTab({
  catalog,
  activities,
  onHand,
  onToggleOnHand,
  canEdit = false,
  onSetCategory,
  onAddSubstitute,
  onRemoveSubstitute,
  onAddMaterial,
  onOpenActivity,
  railSlot,
}: {
  catalog: MaterialCatalog;
  activities: Activity[];
  onHand: string[];
  onToggleOnHand: (id: string) => void;
  canEdit?: boolean;
  onSetCategory?: (id: string, category: string | null) => void;
  onAddSubstitute?: (id: string, subId: string) => void;
  onRemoveSubstitute?: (id: string, subId: string) => void;
  onAddMaterial?: (name: string) => void;
  onOpenActivity?: (a: Activity) => void;
  /** Production: the rail portals into the sidebar. Draft: null → inline column. */
  railSlot?: HTMLElement | null;
}) {
  const [lens, setLens] = useState<OnHandLens>("all");
  const [grouped, setGrouped] = useState(true);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState("");

  const index = useMemo(() => indexCatalog(catalog), [catalog]);
  const onHandSet = useMemo(() => new Set(onHand), [onHand]);
  const backRefs = useMemo(() => backReferences(activities, index), [activities, index]);

  // Coverage for every activity (memo keyed on the on-hand set + catalog).
  const coverageById = useMemo(() => {
    const out = new Map<string, CoverageResult>();
    for (const a of activities) out.set(a.id, materialCoverage(refsForActivity(a), onHandSet, index));
    return out;
  }, [activities, onHandSet, index]);
  const coverageOf = (a: Activity) => coverageById.get(a.id) ?? materialCoverage(refsForActivity(a), onHandSet, index);

  const stats = useMemo(() => {
    let ready = 0, almost = 0, blocked = 0;
    for (const a of activities) {
      const s = runnableState(coverageById.get(a.id)!);
      if (s === "ready") ready += 1;
      else if (s === "almost") almost += 1;
      else blocked += 1;
    }
    return { ready, almost, blocked };
  }, [activities, coverageById]);

  const onHandCount = useMemo(
    () => catalog.materials.filter((m) => onHandSet.has(m.id)).length,
    [catalog.materials, onHandSet]
  );

  // Board: filter by search + on-hand lens, then group by class.
  const q = normalizeSearchText(query.trim());
  const matchesRow = (m: Material) => {
    if (q && !normalizeSearchText(m.name + " " + (m.aliases ?? []).join(" ")).includes(q)) return false;
    if (lens === "have" && !onHandSet.has(m.id)) return false;
    if (lens === "missing" && onHandSet.has(m.id)) return false;
    return true;
  };

  const groups = useMemo(() => {
    const visible = catalog.materials.filter(matchesRow);
    if (!grouped) return [{ id: "all", label: "All materials", items: visible }];
    const out: { id: string; label: string; items: Material[] }[] = [];
    for (const cat of catalog.categories) {
      const items = visible.filter((m) => m.category === cat.id);
      if (items.length) out.push({ id: cat.id, label: cat.label, items });
    }
    const uncategorized = visible.filter((m) => !m.category || !index.categoryById.has(m.category));
    if (uncategorized.length) out.push({ id: "_other", label: "Other materials", items: uncategorized });
    return out;
  }, [catalog.materials, catalog.categories, grouped, q, lens, onHandSet, index]); // eslint-disable-line react-hooks/exhaustive-deps

  const visibleCount = groups.reduce((n, g) => n + g.items.length, 0);

  const rail = (
    <div className="matrail">
      <div className="prail__group prail__group--collapsible" data-open>
        <div className="prail__grouphead"><span className="prail__grouptitle">Show</span></div>
        <div className="prail__grouppanel">
          <div className="ledger">
            <label className="matrail__search">
              <CampIcon.Search />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search materials"
                aria-label="Search materials"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
              {query && (
                <button type="button" onClick={() => setQuery("")} aria-label="Clear search">
                  <CampIcon.Close />
                </button>
              )}
            </label>
            <div className="ledger__row">
              <span className="ledger__label"><CampIcon.Box className="ledger__ic" />On hand</span>
              <MiniSeg
                ariaLabel="Filter materials by on-hand state"
                value={lens}
                onChange={setLens}
                options={[
                  { id: "all" as OnHandLens, label: "All" },
                  { id: "have" as OnHandLens, label: "Have" },
                  { id: "missing" as OnHandLens, label: "Missing" },
                ]}
              />
            </div>
            <div className="ledger__row">
              <span className="ledger__label"><CampIcon.List className="ledger__ic" />Group by class</span>
              <ToggleSwitch on={grouped} onChange={setGrouped} ariaLabel="Group materials by substitution class" />
            </div>
          </div>
        </div>
      </div>

      <div className="prail__group prail__group--collapsible">
        <div className="prail__grouphead"><span className="prail__grouptitle">Coverage</span></div>
        <div className="prail__grouppanel">
          <div className="ledger">
            <div className="ledger__row"><span className="ledger__label">On hand</span><span className="matrail__stat">{onHandCount} / {catalog.materials.length}</span></div>
            <div className="ledger__row"><span className="ledger__label"><span className="matdot matdot--ready" />Ready</span><span className="matrail__stat">{stats.ready}</span></div>
            <div className="ledger__row"><span className="ledger__label"><span className="matdot matdot--almost" />Almost</span><span className="matrail__stat">{stats.almost}</span></div>
            <div className="ledger__row"><span className="ledger__label"><span className="matdot matdot--blocked" />Can't run</span><span className="matrail__stat">{stats.blocked}</span></div>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="mattab">
      <header className="mathead">
        <div className="mathead__heading">
          <h1 className="mathead__title">Materials</h1>
          <p className="mathead__scope">
            {onHandCount} on hand · {catalog.materials.length} materials · {stats.ready} of {activities.length} ready
          </p>
        </div>
        {canEdit && onAddMaterial && (
          <div className="mathead__actions">
            <form
              className="mathead__add"
              onSubmit={(e) => {
                e.preventDefault();
                const name = adding.trim();
                if (name) { onAddMaterial(name); setAdding(""); }
              }}
            >
              <input
                value={adding}
                onChange={(e) => setAdding(e.target.value)}
                placeholder="Add a material…"
                aria-label="Add a material"
              />
              <button type="submit" className="btn btn--primary mathead__addbtn" aria-label="Add material">
                <CampIcon.Plus />
              </button>
            </form>
          </div>
        )}
      </header>

      <div className="matboard">
        {visibleCount === 0 ? (
          <div className="matboard__empty">No materials match.</div>
        ) : (
          groups.map((group) => (
            <section className="matgroup" key={group.id}>
              <div className="matgroup__head">
                <span className="matgroup__title">{group.label}</span>
                <span className="matgroup__count">
                  {group.items.filter((m) => onHandSet.has(m.id)).length} / {group.items.length} on hand
                </span>
              </div>
              <div className="matgroup__list">
                {group.items.map((material) => (
                  <MaterialRow
                    key={material.id}
                    material={material}
                    index={index}
                    onHand={onHandSet.has(material.id)}
                    onToggleOnHand={onToggleOnHand}
                    requiredBy={backRefs.get(material.id) ?? []}
                    coverageOf={coverageOf}
                    onOpenActivity={onOpenActivity}
                    canEdit={canEdit}
                    categories={catalog.categories}
                    allMaterials={catalog.materials}
                    onSetCategory={onSetCategory}
                    onAddSubstitute={onAddSubstitute}
                    onRemoveSubstitute={onRemoveSubstitute}
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </div>

      {railSlot ? createPortal(rail, railSlot) : <div className="mattab__rail">{rail}</div>}
    </div>
  );
}
