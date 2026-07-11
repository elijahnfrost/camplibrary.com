"use client";

// ============================================================
// Camp Library — Run List controls & shared meta
//
// The presentational sub-components and shared metadata for "The Run List"
// (ActivityRunList): the inline Editable cell, summary Pill, embed player,
// materials checklist, the ledger / age / group pickers, and the details +
// materials editors — plus the icon maps, block palettes, and rail / stamp
// helpers they share with the shell. Extracted verbatim from ActivityRunList.tsx
// (structural cleanup, no behavior change).
// ============================================================
import { useMemo, useRef, useState } from "react";
import type { Activity } from "@/lib/types";
import { coverage, type ResolvedRef } from "@/lib/materials/materials";
import { catalogNameFor, type Material } from "@/lib/materials/materialCatalog";
import type { StockState } from "@/lib/materials/kitStock";
import { mintMaterialRow, renameMaterialRow, type MaterialFormRow } from "@/lib/activity/activityForm";
import { CampIcon } from "../ui/icons";
import { StockDot } from "../materials/StockDot";
import { Editable } from "./RunSheetControls";


// The activity's materials as a 3-state stock checklist (the same "kit" the
// library coverage lens reads). Attaches under a step as a materials detail.
// Each chip RESTS as status and leads with the bloom dot (StockDot — the ONE
// stock control app-wide): tapping the dot blooms the explicit Have/Low/Out
// choices in place; the chip itself is not a control. No cycling, no menu
// layer. A row whose own item is out but a substitute is on hand reads
// "↔ via <name>". The header is a compact coverage pill (Ready / "N missing");
// nothing shows when stock is UNSET (the lens is inert, so the checklist reads
// as a plain list).
//
// This list is ALWAYS the canonical kit. The per-placement materialSubs era
// (Swap for today…, then Skip today) was cut entirely — neither pulled its
// weight against the surface it cost, and real substitution coverage already
// lives in the catalog's `substitutes`. A calendar event's stored materialSubs
// (legacy field, see lib/calendar/types.ts) is simply ignored here.
export function MaterialChecklist({
  needs,
  stock,
  catalog,
  onSetStockState,
}: {
  needs: ResolvedRef[];
  stock: Record<string, StockState>;
  catalog?: Material[];
  onSetStockState: (id: string, state: StockState) => void;
}) {
  const cov = useMemo(
    () => coverage({ materialRefs: needs.map((n) => ({ id: n.id })) } as Activity, stock, catalog),
    [needs, stock, catalog]
  );
  const unset = cov.state === "unset";
  const viaById = useMemo(() => {
    const map = new Map<string, string>();
    cov.substituted.forEach((s) => map.set(s.id, s.viaId));
    return map;
  }, [cov.substituted]);

  const pill =
    unset || cov.state === "ready"
      ? unset
        ? null
        : "Ready"
      : cov.missing.length + " missing";

  return (
    <div className="matkit">
      {pill && (
        <div className="matkit__bar">
          <span
            className={
              "matkit__pill" +
              (cov.state === "ready"
                ? " matkit__pill--ready" + (cov.lowCount ? " matkit__pill--low" : "")
                : cov.state === "almost"
                  ? " matkit__pill--almost"
                  : " matkit__pill--cant")
            }
          >
            {pill}
          </span>
        </div>
      )}
      <div className="matkit__list">
        {needs.map((n) => {
          const viaId = viaById.get(n.id);
          const own = stock[n.id];
          const state: StockState | "via" = viaId ? "via" : own ?? "out";
          const viaName = viaId ? catalogNameFor(catalog, viaId) : "";
          const rowClass = unset
            ? ""
            : state === "have" || state === "via"
              ? " is-have"
              : state === "low"
                ? " is-low"
                : " is-out";
          return (
            <div key={n.id} className="matkit__rowline">
              {/* The chip rests as STATUS — it is not a button. The bloom dot
                  (StockDot) is the one stock control; its resting face mirrors
                  the chip's effective state (via / implied-out / unset all
                  included), while the bloom highlights the item's OWN recorded
                  state. */}
              <span className={"matkit__item" + rowClass}>
                <StockDot
                  name={n.label}
                  display={unset ? own : state}
                  current={own}
                  onSet={(s) => onSetStockState(n.id, s)}
                />
                <span className="matkit__name">{n.label}</span>
                {!unset && state === "via" && (
                  <span className="matkit__via">
                    <CampIcon.Repeat />
                    via {viaName}
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}


// The Materials block, in EDIT mode — a PROPER editable list of the kit items,
// bound to the form's `materialRefs` rows (was a comma-joined string; the comma
// is no longer a delimiter, so a label like "Flour, ~2 cups" is one row). Each
// row is honest about what it does: a drag grip + an inline editable name + an
// optional subdued qty/note + move up/down + remove, in the run-sheet sub-step
// vocabulary. Reorder is local to this list (it never touches the run-doc drag
// model), via HTML5 drag on the row OR the up/down buttons (touch/keyboard
// parity). An "Add item" row at the foot grows the list. Clearing a row's name
// removes it, the same "empty = gone" feel as a step.
//
// Row identity: a row minted THIS session re-slugs its id when renamed (no
// stored references yet); a row that came from storage keeps its FROZEN id and a
// rename only changes the display label (the mirror the empty catalog reads
// back). renameMaterialRow (lib/activityForm) encodes that rule.
export function MaterialsEditor({
  rows,
  onChange,
}: {
  rows: MaterialFormRow[];
  onChange: (rows: MaterialFormRow[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<{ index: number; pos: "before" | "after" } | null>(null);
  const dragIndexRef = useRef<number | null>(null);

  const commitDraft = () => {
    const row = mintMaterialRow(draft);
    if (!row) return;
    onChange([...rows, row]);
    setDraft("");
  };
  const removeAt = (index: number) => onChange(rows.filter((_, i) => i !== index));
  const renameAt = (index: number, text: string) => {
    // Emptying a row removes it (mirrors clearing a step's text).
    const renamed = renameMaterialRow(rows[index], text);
    if (!renamed) return removeAt(index);
    onChange(rows.map((row, i) => (i === index ? renamed : row)));
  };
  const setNoteAt = (index: number, text: string) => {
    const note = text.trim();
    onChange(rows.map((row, i) => (i === index ? (note ? { ...row, note } : { ...row, note: undefined }) : row)));
  };
  const moveBy = (index: number, dir: -1 | 1) => {
    const swap = index + dir;
    if (swap < 0 || swap >= rows.length) return;
    const next = [...rows];
    [next[index], next[swap]] = [next[swap], next[index]];
    onChange(next);
  };

  // ---- HTML5 row drag (self-contained to this list) ----
  const onRowDrop = (toIndex: number, pos: "before" | "after") => {
    const from = dragIndexRef.current;
    dragIndexRef.current = null;
    setDragIndex(null);
    setOverIndex(null);
    if (from == null) return;
    let dest = pos === "after" ? toIndex + 1 : toIndex;
    if (from < dest) dest -= 1; // account for the removed source slot
    if (dest === from) return;
    const next = [...rows];
    const [moved] = next.splice(from, 1);
    next.splice(Math.max(0, Math.min(next.length, dest)), 0, moved);
    onChange(next);
  };

  return (
    <div className="rlmat">
      {rows.length > 0 && (
        <ul className="rlmat__list">
          {rows.map((row, i) => {
            const overState =
              overIndex && overIndex.index === i && dragIndex !== i
                ? " is-over-" + overIndex.pos
                : "";
            return (
              <li
                key={row.id + "@" + i}
                className={"rlmat__item" + (dragIndex === i ? " is-dragging" : "") + overState}
                draggable
                onDragStart={(e) => {
                  // Don't hijack drags that start on the inline text/buttons.
                  if ((e.target as HTMLElement).closest("button, .rl-ed, input")) {
                    e.preventDefault();
                    return;
                  }
                  dragIndexRef.current = i;
                  setDragIndex(i);
                  e.dataTransfer.effectAllowed = "move";
                  try {
                    e.dataTransfer.setData("text/plain", String(i));
                  } catch {
                    /* some browsers reject setData outside a user gesture */
                  }
                }}
                onDragOver={(e) => {
                  if (dragIndexRef.current == null) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  const rect = e.currentTarget.getBoundingClientRect();
                  const pos = e.clientY < rect.top + rect.height / 2 ? "before" : "after";
                  if (!overIndex || overIndex.index !== i || overIndex.pos !== pos) {
                    setOverIndex({ index: i, pos });
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const rect = e.currentTarget.getBoundingClientRect();
                  const pos = e.clientY < rect.top + rect.height / 2 ? "before" : "after";
                  onRowDrop(i, pos);
                }}
                onDragEnd={() => {
                  dragIndexRef.current = null;
                  setDragIndex(null);
                  setOverIndex(null);
                }}
              >
                <span className="rlmat__grip" title="Drag to reorder" aria-hidden="true">
                  <CampIcon.Grip />
                </span>
                <Editable
                  className="rlmat__name"
                  value={row.label}
                  editable
                  placeholder="Material"
                  ariaLabel={"Material " + (i + 1)}
                  onCommit={(v) => renameAt(i, v)}
                />
                <input
                  className="input rlmat__note"
                  value={row.note ?? ""}
                  placeholder="qty / note"
                  aria-label={"Note for " + row.label}
                  onChange={(e) => setNoteAt(i, e.target.value)}
                />
                <div className="rlmat__tools">
                  <button
                    type="button"
                    className="rl-iconbtn"
                    onClick={() => moveBy(i, -1)}
                    disabled={i <= 0}
                    aria-label="Move material up"
                  >
                    <CampIcon.ChevronUp />
                  </button>
                  <button
                    type="button"
                    className="rl-iconbtn"
                    onClick={() => moveBy(i, 1)}
                    disabled={i >= rows.length - 1}
                    aria-label="Move material down"
                  >
                    <CampIcon.ChevronDown />
                  </button>
                  <button
                    type="button"
                    className="rl-iconbtn"
                    onClick={() => removeAt(i)}
                    aria-label={"Remove " + row.label}
                  >
                    <CampIcon.Trash />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="rlmat__addrow">
        <span className="rlmat__addmark" aria-hidden="true">
          <CampIcon.Plus />
        </span>
        <input
          className="input rlmat__add"
          placeholder={rows.length ? "Add a material…" : "flags, cones, pinnies"}
          value={draft}
          aria-label="Add a material"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitDraft();
            }
          }}
          onBlur={commitDraft}
        />
      </div>
    </div>
  );
}
