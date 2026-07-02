"use client";

// One canonical material, rendered as the single line where BOTH lists meet:
//   • the left check is the ON-HAND toggle ("what I have"),
//   • the body shows the name, its substitution class, and any stand-ins,
//   • "Required by N" expands the activities that need it ("what's required"),
//     each with a runnable dot — so the cross-reference is right here in one row.
// Expanding also reveals the staff edit affordances (set the class, add a stand-in).

import { useState } from "react";
import type { Activity } from "@/lib/types";
import type { CatalogIndex, CoverageResult, Material, MaterialCategory } from "@/lib/materialCatalog";
import { CampIcon } from "../icons";
import { MenuPicker } from "../primitives";
import { MaterialBadge } from "./MaterialBadge";

export function MaterialRow({
  material,
  index,
  onHand,
  onToggleOnHand,
  requiredBy,
  coverageOf,
  onOpenActivity,
  canEdit = false,
  categories,
  allMaterials,
  onSetCategory,
  onAddSubstitute,
  onRemoveSubstitute,
}: {
  material: Material;
  index: CatalogIndex;
  onHand: boolean;
  onToggleOnHand: (id: string) => void;
  requiredBy: Activity[];
  coverageOf: (a: Activity) => CoverageResult;
  onOpenActivity?: (a: Activity) => void;
  canEdit?: boolean;
  categories: MaterialCategory[];
  allMaterials: Material[];
  onSetCategory?: (id: string, category: string | null) => void;
  onAddSubstitute?: (id: string, subId: string) => void;
  onRemoveSubstitute?: (id: string, subId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const categoryLabel = material.category ? index.categoryById.get(material.category)?.label : null;
  const subs = material.substitutes ?? [];
  const usedCount = requiredBy.length;

  const categoryOptions = [{ id: "none", label: "No class" }, ...categories.map((c) => ({ id: c.id, label: c.label }))];
  const subAddOptions = allMaterials
    .filter((m) => m.id !== material.id && !subs.includes(m.id))
    .map((m) => ({ id: m.id, label: m.name }));

  return (
    <div className={"matrow" + (onHand ? " is-have" : "") + (open ? " is-open" : "")}>
      <div className="matrow__head">
        <button
          type="button"
          className="matrow__check"
          aria-pressed={onHand}
          aria-label={(onHand ? "On hand" : "Not on hand") + ": " + material.name}
          onClick={() => onToggleOnHand(material.id)}
        >
          <span className="matkit__check" aria-hidden="true">{onHand && <CampIcon.Check />}</span>
        </button>
        <button
          type="button"
          className="matrow__body"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="matrow__name">{material.name}</span>
          {categoryLabel && <span className="matrow__cat">{categoryLabel}</span>}
          {subs.length > 0 && (
            <span className="matrow__subs" title={subs.length + " stand-ins"}>
              <CampIcon.Repeat />
              {subs.length}
            </span>
          )}
          <span className={"matrow__back" + (usedCount ? "" : " is-unused")}>
            {usedCount ? "Required by " + usedCount : "Unused"}
          </span>
          <span className="matrow__chev" aria-hidden="true"><CampIcon.ChevronDown /></span>
        </button>
      </div>

      {open && (
        <div className="matrow__panel">
          {canEdit && (
            <div className="matrow__edit">
              <div className="ledger__row">
                <span className="ledger__label"><CampIcon.Tag className="ledger__ic" />Substitution class</span>
                <MenuPicker
                  value={material.category ?? "none"}
                  onChange={(v) => onSetCategory?.(material.id, v === "none" ? null : v)}
                  options={categoryOptions}
                  ariaLabel={"Substitution class for " + material.name}
                />
              </div>
              <div className="ledger__row matrow__subedit">
                <span className="ledger__label"><CampIcon.Repeat className="ledger__ic" />Also satisfied by</span>
                <MenuPicker
                  value="add"
                  onChange={(v) => v !== "add" && onAddSubstitute?.(material.id, v)}
                  options={[{ id: "add", label: subAddOptions.length ? "Add stand-in…" : "Nothing to add" }, ...subAddOptions]}
                  ariaLabel={"Add a stand-in for " + material.name}
                />
              </div>
              {subs.length > 0 && (
                <div className="matrow__subchips">
                  {subs.map((id) => (
                    <button
                      type="button"
                      key={id}
                      className="chip is-on matrow__subchip"
                      onClick={() => onRemoveSubstitute?.(material.id, id)}
                      aria-label={"Remove stand-in " + (index.byId.get(id)?.name ?? id)}
                    >
                      {index.byId.get(id)?.name ?? id}
                      <CampIcon.Close />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="matrow__refs">
            <div className="matrow__refshead">{usedCount ? "Required by these activities" : "Not required by any activity yet"}</div>
            {requiredBy.map((a) => (
              <button
                type="button"
                key={a.id}
                className="matrow__ref"
                onClick={() => onOpenActivity?.(a)}
              >
                <span className="matrow__refname">{a.title}</span>
                <MaterialBadge cover={coverageOf(a)} size="sm" showReady />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
