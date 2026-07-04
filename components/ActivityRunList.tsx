"use client";

// ============================================================
// Camp Library — "The Run List" (the activity's instruction document)
//
// One editable stack. Numbered steps are collapsible and own attached detail
// that's intertwined with the flow — a note, a field diagram, the materials
// checklist, a safety call, a variation, a video — so e.g. Step 1 "Split the
// field" can carry the field diagram and a "lots of players?" variation right
// beneath it. Collapsing a step tucks all of that away behind summary pills.
//
// No modes: click any line to edit, drag a block to move it, trash to remove.
// Structural + text edits are pushed up via `onChange`; collapse is
// transient view state.
// ============================================================

import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type FC,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import type { Activity, AgeGroupId } from "@/lib/types";
import { AGE_GROUPS, bandShort, CATEGORIES, categoryTint, type AgeUnit } from "@/lib/data";
import { coverage, materialTagId, resolveRefs, type ResolvedRef } from "@/lib/materials";
import { catalogNameFor, type Material } from "@/lib/materialCatalog";
import { isStocked, nextStockState, type StockState } from "@/lib/kitStock";
import {
  MAX_ACTIVITY_DURATION_MIN,
  mintMaterialRow,
  renameMaterialRow,
  validateForm,
  type FormState,
  type MaterialFormRow,
} from "@/lib/activityForm";
import { CampIcon } from "./icons";
import { ContextMenu } from "./floating/ContextMenu";
import { FloatingLayer } from "./floating/FloatingLayer";
import { MiniSeg, RatingDots } from "./primitives";
import { ColorField } from "./floating/ColorField";
import { ThemeField, type ThemeKit } from "./ThemeField";
import { ActivityPlaybook } from "./ActivityPlaybook";
import {
  RUN_CHILD_META,
  RUN_CHILD_TYPES,
  RUN_COLORS,
  RUN_COLOR_TOKEN,
  RUN_ICONS,
  RUN_TOP_LABEL,
  applyDrop,
  blankDiagramChild,
  blankStepBlock,
  childFromTop,
  cloneRunChild,
  cloneRunDoc,
  defaultRunIcon,
  detailTagsForActivity,
  fieldNoteChild,
  fieldNotesBlock,
  insertBlockAfter,
  insertBlockAt,
  resolveDrop,
  runId,
  runPillLabel,
  sameDragItem,
  topFromChild,
  type DragItem,
  type DropTarget,
  type RunBlock,
  type RunBlockType,
  type RunChild,
  type RunChildType,
  type RunColor,
  type RunDetailTag,
  type RunDoc,
  type RunIcon,
} from "@/lib/runList";
import type { ActivityPlaybookData } from "@/lib/playbooks";
import { parseEmbed, type ParsedEmbed } from "@/lib/embed";
import { DiagramLightbox } from "./DiagramLightbox";
import { DiagramEditModal } from "./DiagramEditModal";

const DETAIL_ANIM_MS = 170;

type IconCmp = FC<{ className?: string }>;

const TYPE_ICON: Record<string, IconCmp> = {
  note: CampIcon.Note,
  safety: CampIcon.Shield,
  video: CampIcon.Video,
  variation: CampIcon.Variation,
  fieldnote: CampIcon.Flag,
  substep: CampIcon.SubStep,
  diagram: CampIcon.Deck,
  materials: CampIcon.Card,
  heading: CampIcon.Heading,
  playbook: CampIcon.BookOpen,
};

// The glyph each pickable RunIcon wears in its node (the icon/colour picker).
const RUN_ICON_CMP: Record<RunIcon, IconCmp> = {
  note: CampIcon.Note,
  safety: CampIcon.Shield,
  tip: CampIcon.Variation,
  bell: CampIcon.Bell,
  star: CampIcon.Star,
  flag: CampIcon.Flag,
};
const RUN_ICON_LABEL: Record<RunIcon, string> = {
  note: "Note",
  safety: "Safety",
  tip: "Tip",
  bell: "Reminder",
  star: "Star",
  flag: "Flag",
};

// Blocks you can append from the "Add a block" palette (top level).
const ADD_BLOCKS: { type: RunBlockType; label: string; icon: IconCmp }[] = [
  { type: "details", label: "Specific details", icon: CampIcon.Card },
  { type: "materials", label: "Materials", icon: CampIcon.Card },
  { type: "step", label: "Step", icon: CampIcon.SubStep },
  { type: "heading", label: "Section", icon: CampIcon.Heading },
  { type: "note", label: "Note", icon: CampIcon.Note },
  { type: "safety", label: "Safety", icon: CampIcon.Shield },
  { type: "variation", label: "Variation", icon: CampIcon.Variation },
  { type: "fieldnote", label: "Field note", icon: CampIcon.Flag },
];
// Field notes live in their own dedicated log block now, so they're not offered
// as a per-step attachment (materials likewise stays a top-level block).
const ATTACH_BLOCKS = RUN_CHILD_TYPES.filter((type) => type !== "materials" && type !== "fieldnote");

// "Jun 23 · 2:05 PM" from a local "YYYY-MM-DDTHH:mm" (or just "Jun 23" from a
// legacy date-only stamp) — parsed by hand so the chip never drifts a day across
// timezones (no Date() reparse of the stored string).
const STAMP_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function formatStamp(at: string | undefined): string {
  if (!at) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(at);
  if (!m) return at;
  const month = STAMP_MONTHS[Number(m[2]) - 1];
  if (!month) return at;
  const date = month + " " + Number(m[3]);
  if (m[4] == null) return date;
  let hour = Number(m[4]);
  const meridiem = hour < 12 ? "AM" : "PM";
  hour = hour % 12 || 12;
  return date + " · " + hour + ":" + m[5] + " " + meridiem;
}

type RailSegment = {
  id: string;
  x: number;
  y1: number;
  y2: number;
};

const topRailKey = (id: string) => "top:" + id;
const childRailKey = (parentId: string, id: string) => "child:" + parentId + ":" + id;

function dropPosition(e: DragEvent<HTMLElement>): "before" | "after" {
  const rect = e.currentTarget.getBoundingClientRect();
  return e.clientY < rect.top + rect.height / 2 ? "before" : "after";
}

// ----------------------------------------------------------------------------
// Inline contentEditable cell. Commits on blur; only rewrites the DOM when the
// value changes from the outside (never mid-keystroke). Escape restores the
// pre-edit value instead of committing; Enter/Backspace hooks let step rows
// split and join like a text document.
// ----------------------------------------------------------------------------
function Editable({
  value,
  onCommit,
  placeholder,
  editable,
  tag = "div",
  className = "",
  ariaLabel,
  ariaLabelledBy,
  focusKey,
  onEnter,
  onBackspaceEmpty,
  onIndent,
  onOutdent,
  commitOnEnter,
}: {
  value: string;
  onCommit: (next: string) => void;
  placeholder?: string;
  editable: boolean;
  tag?: "div" | "span";
  className?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  /** Marks the cell focusable-by-id after structural edits (data-rl-focus). */
  focusKey?: string;
  /** Enter splits at the caret: text before stays, text after moves on. */
  onEnter?: (beforeText: string, afterText: string) => void;
  /** Backspace in an already-empty cell (e.g. remove the empty step). */
  onBackspaceEmpty?: () => void;
  /** Tab: nest this block as a detail under the step above (commits text first). */
  onIndent?: (text: string) => void;
  /** Shift+Tab: lift this detail back to a top-level block (commits text first). */
  onOutdent?: (text: string) => void;
  /** Enter commits and blurs (a field note is "done" on Enter); Shift+Enter
   *  still inserts a newline for a multi-line note. */
  commitOnEnter?: boolean;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const cancelRef = useRef(false);
  useEffect(() => {
    if (ref.current && ref.current.textContent !== value) ref.current.textContent = value || "";
  }, [value]);
  const Tag = tag as "div";
  const label = ariaLabel || placeholder;
  return (
    <Tag
      ref={ref as React.RefObject<HTMLDivElement>}
      className={"rl-ed " + className}
      contentEditable={editable}
      suppressContentEditableWarning
      data-ph={placeholder || ""}
      data-rl-focus={focusKey}
      role={editable ? "textbox" : undefined}
      aria-label={editable && label ? label : undefined}
      aria-labelledby={editable && !label ? ariaLabelledBy : undefined}
      aria-placeholder={editable && placeholder ? placeholder : undefined}
      onBlur={
        editable
          ? (e) => {
              if (cancelRef.current) {
                cancelRef.current = false;
                return;
              }
              onCommit(e.currentTarget.textContent || "");
            }
          : undefined
      }
      onKeyDown={
        editable
          ? (e) => {
              if (e.key === "Tab" && (onIndent || onOutdent)) {
                // Nest / un-nest like an outline. Commit the current text as part
                // of the move (the row remounts at its new depth) so typing isn't
                // lost, and suppress the trailing blur from re-committing stale text.
                e.preventDefault();
                const text = e.currentTarget.textContent || "";
                cancelRef.current = true;
                if (e.shiftKey) onOutdent?.(text);
                else onIndent?.(text);
                return;
              }
              if (e.key === "Enter" && !e.shiftKey && onEnter) {
                e.preventDefault();
                // Split at the caret like a text document: "before|after"
                // keeps "before" here and carries "after" into the new step.
                const el = e.currentTarget as HTMLElement;
                const full = el.textContent || "";
                let before = full;
                let after = "";
                const selection = window.getSelection();
                if (selection && selection.rangeCount && el.contains(selection.anchorNode)) {
                  const range = selection.getRangeAt(0);
                  const pre = range.cloneRange();
                  pre.selectNodeContents(el);
                  pre.setEnd(range.startContainer, range.startOffset);
                  before = pre.toString();
                  after = full.slice(before.length);
                }
                onEnter(before, after);
              } else if (e.key === "Enter" && !e.shiftKey && commitOnEnter) {
                // A field note is finished on Enter. Commit, then blur — and flag
                // the blur handler so the same text isn't committed twice.
                e.preventDefault();
                const el = e.currentTarget as HTMLElement;
                cancelRef.current = true;
                onCommit(el.textContent || "");
                el.blur();
              } else if (e.key === "Escape") {
                // Cancel this edit only — preventDefault tells the dialog
                // stack the key is claimed, so the viewer stays open.
                e.preventDefault();
                e.stopPropagation();
                cancelRef.current = true;
                e.currentTarget.textContent = value || "";
                (e.currentTarget as HTMLElement).blur();
              } else if (
                e.key === "Backspace" &&
                onBackspaceEmpty &&
                !(e.currentTarget.textContent || "").trim()
              ) {
                e.preventDefault();
                onBackspaceEmpty();
              }
            }
          : undefined
      }
    />
  );
}

function Pill({ type, n }: { type: RunChildType; n: number }) {
  const Icon = TYPE_ICON[type];
  return (
    <span className={"rl-pill rl-pill--" + type}>
      <Icon />
      {runPillLabel(type, n)}
    </span>
  );
}

// A media detail rendered safely. Trusted-provider links (YouTube / Vimeo) play
// inline as a sandboxed 16:9 iframe whose src we build from a *validated* video
// id — never the raw user string — so an arbitrary iframe can never be injected.
// Every other link reads as a tappable preview card. `none` renders nothing.
function RunEmbed({ parsed, title }: { parsed: ParsedEmbed; title?: string }) {
  if (parsed.kind === "youtube" || parsed.kind === "vimeo") {
    return (
      <div className="rl-embed rl-embed--player">
        <iframe
          src={parsed.embedUrl}
          title={title || (parsed.kind === "youtube" ? "YouTube video" : "Vimeo video")}
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
          sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"
          allowFullScreen
        />
      </div>
    );
  }
  if (parsed.kind === "link") {
    return (
      <a className="rl-embed rl-embed--card" href={parsed.href} target="_blank" rel="noopener noreferrer">
        <img
          className="rl-embed__icon"
          src={"https://www.google.com/s2/favicons?sz=64&domain=" + encodeURIComponent(parsed.domain)}
          alt=""
          width={32}
          height={32}
          loading="lazy"
        />
        <span className="rl-embed__meta">
          <span className="rl-embed__title">{title || parsed.domain}</span>
          <span className="rl-embed__domain">{parsed.domain}</span>
        </span>
        <span className="rl-embed__go" aria-hidden="true">
          <CampIcon.Link />
        </span>
      </a>
    );
  }
  return null;
}

// The activity's materials as a 3-state stock checklist (the same "kit" the
// library coverage lens reads). Attaches under a step as a materials detail.
// Each row cycles have → low → out → have on tap (staff-gated upstream); a row
// whose own item is out but a substitute is on hand reads "↔ via <name>". The
// header is a compact coverage pill (Ready / "N missing"); nothing shows when
// stock is UNSET (the lens is inert, so the checklist reads as a plain list).
//
// Per-PLACEMENT substitutions: when opened FROM a calendar event (onSetSub given),
// each row grows staff actions — Swap… (replace this material for the day) and
// Skip today. A subbed row reads "<replacement> — instead of <original>" and its
// availability evaluates by the REPLACEMENT's slug (materialTagId(label)); a
// skipped row ("" in subs) is dropped from the coverage math. A revert × restores
// the canonical item. Library-opened sheets pass no subs, so the list is canonical.
function MaterialChecklist({
  needs,
  stock,
  catalog,
  onSetStockState,
  subs,
  onSetSub,
}: {
  needs: ResolvedRef[];
  stock: Record<string, StockState>;
  catalog?: Material[];
  onSetStockState: (id: string, state: StockState) => void;
  subs?: Record<string, string>;
  onSetSub?: (refId: string, label: string | null) => void;
}) {
  // Per-day editing is on only when a placement wired both the subs map and the
  // writer (opened FROM an event). Library-opened = canonical list, no row actions.
  const canSub = Boolean(onSetSub);
  // The row a Swap picker is currently open over (refId), plus its draft text.
  const [swapping, setSwapping] = useState<string | null>(null);

  // The EFFECTIVE need per row: a subbed row's coverage key + label follow the
  // REPLACEMENT (its own slug), a skipped row is excluded from the lens entirely.
  // We carry the original alongside so the row can say "instead of <original>".
  const rows = useMemo(
    () =>
      needs.map((n) => {
        const sub = subs?.[n.id];
        if (sub === undefined) return { ...n, kind: "plain" as const, coverId: n.id, coverLabel: n.label };
        if (sub === "") return { ...n, kind: "skip" as const, coverId: n.id, coverLabel: n.label };
        const coverId = materialTagId(sub);
        return { ...n, kind: "sub" as const, subLabel: sub, coverId, coverLabel: sub };
      }),
    [needs, subs]
  );

  // Coverage over the EFFECTIVE, non-skipped needs (subbed rows keyed by their
  // replacement's slug), so the pill and the rows agree with the swaps in force.
  const cov = useMemo(() => {
    const active = rows.filter((r) => r.kind !== "skip");
    return coverage(
      { materialRefs: active.map((r) => ({ id: r.coverId })) } as Activity,
      stock,
      catalog
    );
  }, [rows, stock, catalog]);
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
        {rows.map((n) => {
          const skipped = n.kind === "skip";
          const subbed = n.kind === "sub";
          const viaId = viaById.get(n.coverId);
          const own = stock[n.coverId];
          const state: StockState | "via" = viaId ? "via" : own ?? "out";
          const viaName = viaId ? catalogNameFor(catalog, viaId) : "";
          const stateWord = skipped
            ? "skipped today"
            : state === "via"
              ? "covered by " + viaName
              : state === "have"
                ? "have"
                : state === "low"
                  ? "low"
                  : "out";
          const rowClass = skipped
            ? " is-skip"
            : unset
              ? ""
              : state === "have" || state === "via"
                ? " is-have"
                : state === "low"
                  ? " is-low"
                  : " is-out";
          // The tappable status button (cycles the row's effective stock). A
          // skipped row's status is inert (nothing to stock).
          const statusBtn = (
            <button
              type="button"
              className={"matkit__item" + rowClass}
              disabled={skipped}
              onClick={() => (skipped ? undefined : onSetStockState(n.coverId, nextStockState(own)))}
              aria-label={(subbed ? n.subLabel : n.label) + ": " + stateWord}
            >
              <span className="matkit__check" aria-hidden="true">
                {skipped && <CampIcon.Minus />}
                {!skipped && !unset && (state === "have" || state === "via") && <CampIcon.Check />}
                {!skipped && !unset && state === "low" && <CampIcon.Minus />}
                {!skipped && !unset && state === "out" && <CampIcon.Close />}
              </span>
              <span className="matkit__name">
                {subbed ? n.subLabel : n.label}
                {subbed && <span className="matkit__instead"> — instead of {n.label}</span>}
                {skipped && <span className="matkit__instead"> — skipped today</span>}
              </span>
              {!skipped && !unset && state === "via" && (
                <span className="matkit__via">
                  <CampIcon.Repeat />
                  via {viaName}
                </span>
              )}
            </button>
          );

          if (!canSub) {
            return (
              <div key={n.id} className="matkit__rowline">
                {statusBtn}
              </div>
            );
          }
          return (
            <div key={n.id} className="matkit__rowline">
              {statusBtn}
              <span className="matkit__acts">
                {subbed || skipped ? (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm matkit__revert"
                    onClick={() => onSetSub?.(n.id, null)}
                    aria-label={"Revert " + n.label + " to the original"}
                    title="Revert to the original"
                  >
                    <CampIcon.Close />
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => setSwapping((id) => (id === n.id ? null : n.id))}
                      aria-label={"Swap " + n.label + " for the day"}
                    >
                      Swap…
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => onSetSub?.(n.id, "")}
                      aria-label={"Skip " + n.label + " today"}
                    >
                      Skip today
                    </button>
                  </>
                )}
              </span>
              {swapping === n.id && (
                <MaterialSwapForm
                  original={n.label}
                  catalog={catalog}
                  stock={stock}
                  onPick={(label) => {
                    onSetSub?.(n.id, label);
                    setSwapping(null);
                  }}
                  onClose={() => setSwapping(null)}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// The mini Swap form under a material row (per-placement substitution). Suggests
// catalog items on-hand first (a swap you can actually run today), then the rest,
// and takes free text for anything off-catalog. Tapping a suggestion or committing
// the text writes the replacement label.
function MaterialSwapForm({
  original,
  catalog,
  stock,
  onPick,
  onClose,
}: {
  original: string;
  catalog?: Material[];
  stock: Record<string, StockState>;
  onPick: (label: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  // Catalog names ranked on-hand first (its own slug is stocked), then by name.
  const suggestions = useMemo(() => {
    const query = text.trim().toLowerCase();
    const scored = (catalog ?? [])
      .map((m) => ({ label: m.name, onHand: isStocked(stock[m.id]) }))
      .filter((s) => s.label && (!query || s.label.toLowerCase().includes(query)));
    scored.sort(
      (a, b) => Number(b.onHand) - Number(a.onHand) || a.label.localeCompare(b.label)
    );
    return scored.slice(0, 6);
  }, [catalog, stock, text]);

  return (
    <div className="matkit__swap" role="group" aria-label={"Swap " + original}>
      {/* Same search-field anatomy as QuickAdd's activity search: icon + input
          in one bordered pill (`.quickadd__search`), not a bespoke input. */}
      <label className="quickadd__search matkit__swapsearch">
        <CampIcon.Search />
        <input
          value={text}
          autoFocus
          placeholder={"Replace " + original + " with…"}
          aria-label={"Replacement for " + original}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && text.trim()) onPick(text.trim());
            else if (e.key === "Escape") onClose();
          }}
        />
      </label>
      {(suggestions.length > 0 || text.trim()) && (
        // Same result-list anatomy as QuickAdd's typeahead (`.quickadd__list`
        // of `.quickadd__item` rows with a name + muted meta), so a suggestion
        // row here reads identically to a library search result elsewhere.
        <div className="quickadd__list matkit__swaplist">
          {suggestions.map((s) => (
            <button
              type="button"
              key={s.label}
              className="quickadd__item"
              onClick={() => onPick(s.label)}
            >
              <span className="quickadd__itemdot" aria-hidden="true" />
              <span className="quickadd__name">{s.label}</span>
              {s.onHand && <span className="quickadd__meta">on hand</span>}
            </button>
          ))}
          {text.trim() && (
            <button type="button" className="quickadd__item" onClick={() => onPick(text.trim())}>
              <span className="quickadd__itemdot" aria-hidden="true" />
              <span className="quickadd__name">Use “{text.trim()}”</span>
            </button>
          )}
        </div>
      )}
      <div className="matkit__swapacts">
        <button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// The Details block, in EDIT mode — the activity's scalar facts edited inline as
// structured dropdowns on the run sheet (no separate form above it). Each fact
// is a ledger row (small-caps label left, a compact control right) bound to the
// same FormState the old AddView form drove, so save derives the Activity
// unchanged. STRUCTURED controls (Seg / Select-style menus / chip menu / number
// stepper) — never free text — so a value can't be typed that breaks downstream.
// ----------------------------------------------------------------------------
type DetailFormProps = {
  form: FormState;
  onFormChange: (next: FormState) => void;
  themeKit?: ThemeKit;
  ageUnit?: AgeUnit;
  onAgeUnit?: (v: AgeUnit) => void;
};

// A label-only inline menu picker bound to the run sheet (mirrors the sidebar
// MenuPicker, but hosted in the FloatingLayer so it shares the Escape/scrim
// contract). Used for Type / duration where a long option list beats segments.
// Exported so other ledger-anatomy editors (e.g. DetailSheet's Backup plans
// reason picker) share the exact same `.typepick` pill, not a lookalike copy.
export function LedgerMenu<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  swatch,
}: {
  value: T;
  options: { id: T; label: string; tint?: string }[];
  onChange: (v: T) => void;
  ariaLabel: string;
  swatch?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const current = options.find((o) => o.id === value) ?? options[0];
  return (
    <div className={"typepick rldetail__pick" + (open ? " is-open" : "")}>
      <button
        ref={triggerRef}
        type="button"
        className="typepick__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
      >
        {swatch && (
          <span
            className="typepick__swatch"
            style={current?.tint ? { background: current.tint } : undefined}
            aria-hidden="true"
          />
        )}
        {current?.label}
        <CampIcon.ChevronDown />
      </button>
      {open && triggerRef.current && (
        <FloatingLayer
          anchor={{ kind: "rect", rect: triggerRef.current.getBoundingClientRect(), matchWidth: true }}
          onClose={() => setOpen(false)}
          className="typepick__menu rldetail__menu"
          role="listbox"
          ariaLabel={ariaLabel}
        >
          {options.map((o) => (
            <button
              type="button"
              key={o.id}
              role="option"
              aria-selected={o.id === value}
              className={"typepick__option" + (o.id === value ? " is-on" : "")}
              data-floating-first={o.id === value ? "" : undefined}
              onClick={() => {
                onChange(o.id);
                setOpen(false);
              }}
            >
              {swatch && (
                <span
                  className="typepick__swatch"
                  style={o.tint ? { background: o.tint } : undefined}
                  aria-hidden="true"
                />
              )}
              {o.label}
            </button>
          ))}
        </FloatingLayer>
      )}
    </div>
  );
}

// The multi-select age-group picker — a popover of toggle chips (ages is a list,
// unlike the single-value sidebar AgePicker). The trigger summarizes the picks.
function AgeGroupsMenu({
  ages,
  onToggle,
  ageUnit = "grades",
  onAgeUnit,
}: {
  ages: AgeGroupId[];
  onToggle: (id: AgeGroupId) => void;
  ageUnit?: AgeUnit;
  onAgeUnit?: (v: AgeUnit) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const picked = AGE_GROUPS.filter((g) => ages.indexOf(g.id) >= 0);
  const summary = picked.length
    ? picked.map((g) => bandShort(g, ageUnit)).join(", ")
    : "Any age";
  return (
    <div className={"typepick rldetail__pick" + (open ? " is-open" : "")}>
      <button
        ref={triggerRef}
        type="button"
        className="typepick__trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Age groups"
        onClick={() => setOpen((o) => !o)}
      >
        {summary}
        <CampIcon.ChevronDown />
      </button>
      {open && triggerRef.current && (
        <FloatingLayer
          anchor={{ kind: "rect", rect: triggerRef.current.getBoundingClientRect() }}
          onClose={() => setOpen(false)}
          className="typepick__menu rldetail__agemenu"
          role="dialog"
          ariaLabel="Age groups"
        >
          {onAgeUnit && (
            <div className="rldetail__ageunit">
              <MiniSeg
                ariaLabel="Show ages as"
                value={ageUnit}
                onChange={(value) => onAgeUnit(value as AgeUnit)}
                options={[
                  { id: "grades", label: "Grades" },
                  { id: "ages", label: "Ages" },
                ]}
              />
            </div>
          )}
          <div className="rldetail__agechips" role="group" aria-label="Age groups">
            {AGE_GROUPS.map((g, i) => {
              const on = ages.indexOf(g.id) >= 0;
              return (
                <button
                  type="button"
                  key={g.id}
                  className={"chip" + (on ? " is-on" : "")}
                  aria-pressed={on}
                  data-floating-first={i === 0 ? "" : undefined}
                  onClick={() => onToggle(g.id)}
                >
                  {bandShort(g, ageUnit)}
                </button>
              );
            })}
          </div>
        </FloatingLayer>
      )}
    </div>
  );
}

// The group-size min/max popover (two small inputs, "blank = any").
function GroupSizeMenu({
  groupMin,
  groupMax,
  onChange,
  invalid,
  rangeInvalid,
}: {
  groupMin: string;
  groupMax: string;
  onChange: (patch: { groupMin?: string; groupMax?: string }) => void;
  invalid: boolean;
  rangeInvalid: boolean;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const summary =
    !groupMin.trim() && !groupMax.trim()
      ? "Any size"
      : groupMax.trim()
        ? (groupMin.trim() || "1") + "–" + groupMax.trim()
        : groupMin.trim() + "+";
  return (
    <div className={"typepick rldetail__pick" + (open ? " is-open" : "")}>
      <button
        ref={triggerRef}
        type="button"
        className={"typepick__trigger" + (invalid || rangeInvalid ? " is-invalid" : "")}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Group size"
        onClick={() => setOpen((o) => !o)}
      >
        {summary} kids
        <CampIcon.ChevronDown />
      </button>
      {open && triggerRef.current && (
        <FloatingLayer
          anchor={{ kind: "rect", rect: triggerRef.current.getBoundingClientRect() }}
          onClose={() => setOpen(false)}
          className="typepick__menu rldetail__groupmenu"
          role="dialog"
          ariaLabel="Group size"
        >
          <div className="rldetail__grouprow">
            <label className="sr-only" htmlFor="rldetail-group-min">Minimum group size</label>
            <input
              id="rldetail-group-min"
              className="input rldetail__numin"
              inputMode="numeric"
              placeholder="min"
              value={groupMin}
              data-floating-first
              aria-invalid={invalid || rangeInvalid}
              onChange={(e) => onChange({ groupMin: e.target.value })}
            />
            <span className="rldetail__groupdash" aria-hidden="true">–</span>
            <label className="sr-only" htmlFor="rldetail-group-max">Maximum group size</label>
            <input
              id="rldetail-group-max"
              className="input rldetail__numin"
              inputMode="numeric"
              placeholder="max"
              value={groupMax}
              aria-invalid={invalid || rangeInvalid}
              onChange={(e) => onChange({ groupMax: e.target.value })}
            />
          </div>
          {(invalid || rangeInvalid) && (
            <span className="rldetail__grouperr" role="alert">
              {rangeInvalid ? "Min can't exceed max." : "Use positive whole numbers."}
            </span>
          )}
        </FloatingLayer>
      )}
    </div>
  );
}

function DetailFormControls({ form, onFormChange, themeKit, ageUnit, onAgeUnit }: DetailFormProps) {
  const f = form;
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => onFormChange({ ...f, [k]: v });
  const v = validateForm(f);
  const toggleAge = (id: AgeGroupId) =>
    onFormChange({
      ...f,
      ages: f.ages.indexOf(id) >= 0 ? f.ages.filter((x) => x !== id) : [...f.ages, id],
    });

  return (
    <div className="ledger rldetail">
      <div className="ledger__row rldetail__row">
        <span className="ledger__label">Type</span>
        <LedgerMenu
          value={f.type}
          options={CATEGORIES.map((c) => ({ id: c.id, label: c.label, tint: categoryTint(c.id) }))}
          onChange={(id) => set("type", id)}
          ariaLabel="Category"
          swatch
        />
      </div>
      <div className="ledger__row rldetail__row">
        <span className="ledger__label">Where</span>
        <MiniSeg
          options={[
            { id: "Inside", label: "Inside" },
            { id: "Outside", label: "Outside" },
            { id: "Both", label: "Both" },
          ]}
          value={f.place}
          onChange={(value) => set("place", value)}
          ariaLabel="Where"
        />
      </div>
      <div className="ledger__row rldetail__row">
        <span className="ledger__label">Energy</span>
        <MiniSeg
          options={[
            { id: "Calm", label: "Calm" },
            { id: "Lively", label: "Lively" },
            { id: "Rowdy", label: "Rowdy" },
          ]}
          value={f.energy}
          onChange={(value) => set("energy", value)}
          ariaLabel="Energy"
        />
      </div>
      <div className="ledger__row rldetail__row">
        <span className="ledger__label">Prep</span>
        <MiniSeg
          options={[
            { id: "None", label: "None" },
            { id: "Low", label: "Low" },
            { id: "Medium", label: "Medium" },
            { id: "High", label: "High" },
          ]}
          value={f.prep}
          onChange={(value) => set("prep", value)}
          ariaLabel="Prep effort"
        />
      </div>
      <div className={"ledger__row rldetail__row rldetail__row--minutes" + (v.durationInvalid ? " is-invalid" : "")}>
        <span className="ledger__label">Minutes</span>
        <div className="rldetail__minutes">
          <input
            className="input rldetail__minin"
            inputMode="numeric"
            value={f.durationMin}
            aria-label="Minutes"
            aria-invalid={v.durationInvalid || undefined}
            onChange={(e) => set("durationMin", e.target.value)}
          />
          <span className="rldetail__minunit" aria-hidden="true">min</span>
        </div>
        {v.durationInvalid && (
          <span className="rldetail__grouperr rldetail__grouperr--minutes" role="alert">
            Enter a whole number of minutes, up to {MAX_ACTIVITY_DURATION_MIN}.
          </span>
        )}
      </div>
      <div className="ledger__row rldetail__row">
        <span className="ledger__label">Ages</span>
        <AgeGroupsMenu ages={f.ages} onToggle={toggleAge} ageUnit={ageUnit} onAgeUnit={onAgeUnit} />
      </div>
      <div className="ledger__row rldetail__row">
        <span className="ledger__label">Group size</span>
        <GroupSizeMenu
          groupMin={f.groupMin}
          groupMax={f.groupMax}
          onChange={(patch) => onFormChange({ ...f, ...patch })}
          invalid={v.groupMinInvalid || v.groupMaxInvalid}
          rangeInvalid={v.groupRangeInvalid}
        />
      </div>
      {themeKit && (
        <div className="ledger__row rldetail__row">
          <span className="ledger__label">Theme</span>
          <ThemeField
            value={f.themeId}
            themes={themeKit.themes}
            onChange={(themeId) => set("themeId", themeId ?? "")}
            onCreate={themeKit.onCreate}
            onManage={themeKit.onManage}
            ariaLabel="Activity theme"
          />
        </div>
      )}
      <div className="ledger__row rldetail__row rldetail__row--rating">
        <span className="ledger__label">Rating</span>
        <RatingDots value={f.rating} onChange={(value) => set("rating", value)} />
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
function MaterialsEditor({
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

export function ActivityRunList({
  doc,
  editable,
  onChange,
  activity,
  kitStock,
  materialCatalog,
  onSetStockState,
  materialSubs,
  onSetMaterialSub,
  onSetRating,
  hideAddBlocks,
  canCapture = false,
  editForm,
  onEditFormChange,
  editThemeKit,
  editAgeUnit,
  onEditAgeUnit,
}: {
  doc: RunDoc;
  editable: boolean;
  onChange?: (next: RunDoc) => void;
  activity: Activity;
  /** The effective 3-state kit stock map the Materials checklist reads. Empty
   *  ({}) = UNSET (the checklist renders as a plain list, no can-run state). */
  kitStock: Record<string, StockState>;
  /** The materials catalog — display names + substitution groups for coverage. */
  materialCatalog?: Material[];
  /** Cycle one material's stock state (have → low → out). Staff-gated upstream;
   *  a no-op on public/read-only surfaces. */
  onSetStockState: (id: string, state: StockState) => void;
  /** Per-placement material substitutions ({refId: label}, "" = skipped) from the
   *  calendar event this sheet was opened from. PRESENT (even {}) turns on the
   *  per-day Swap / Skip row actions; ABSENT (library-opened) keeps the canonical
   *  list. */
  materialSubs?: Record<string, string>;
  /** Write (or clear) one placement's substitution for a required material: a
   *  label swaps it, "" skips it for the day, null reverts to the canonical item.
   *  Absent = no per-day editing (library / read-only). */
  onSetMaterialSub?: (refId: string, label: string | null) => void;
  onSetRating?: (value: number) => void;
  /** When provided (edit/create), the Details block renders as structured
   *  dropdowns bound to this form, and the Materials block becomes an inline
   *  editor — the run sheet IS the editor, with no separate form above it. The
   *  details/materials FACTS live here (single source); the run-doc still derives
   *  its scaffold from them on save (stripScaffold), so there's no dual-write. */
  editForm?: FormState;
  onEditFormChange?: (next: FormState) => void;
  editThemeKit?: ThemeKit;
  editAgeUnit?: AgeUnit;
  onEditAgeUnit?: (v: AgeUnit) => void;
  /** Block types kept out of the "Add a block" palettes. In the unified editor
   *  the scalar Activity-card controls own details/materials as plain form
   *  fields, so those scaffold blocks are stripped from the editable play-doc
   *  AND kept out of the palette here — there is no second editable copy of the
   *  detail facts to fight the form on save (the old dual-write). */
  hideAddBlocks?: RunBlockType[];
  /** Make field-note blocks live — directly typeable in the READ-ONLY viewer,
   *  the same way the rating dots are interactive without entering edit mode. The
   *  rest of the read view stays static (a stray tap on a step never pops the
   *  keyboard). Only wired where saving is possible (signed-in staff). */
  canCapture?: boolean;
}) {
  const addableBlocks = hideAddBlocks?.length
    ? ADD_BLOCKS.filter((block) => !hideAddBlocks.includes(block.type))
    : ADD_BLOCKS;

  // Form-bound edit: the run sheet hosts the scalar facts inline (Details +
  // Materials) instead of a separate form above it. Requires the draft form +
  // its onChange; absent in browse/read.
  const isFormEdit = editable && Boolean(editForm && onEditFormChange);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [closing, setClosing] = useState<Record<string, boolean>>({});
  const [openKid, setOpenKid] = useState<string | null>(null);
  const [openTop, setOpenTop] = useState(false);
  const [insertAt, setInsertAt] = useState<number | null>(null);
  // Bumped after a field-note composer commits, so it remounts empty and ready
  // for the next note.
  const [fnDraftKey, setFnDraftKey] = useState(0);
  // The diagram detail (parent step + child id) currently open in the full-screen
  // editor, mirroring how read mode opens diagrams full screen in the lightbox.
  const [fullDiagram, setFullDiagram] = useState<{ stepId: string; childId: string } | null>(null);
  const [lightbox, setLightbox] = useState<ActivityPlaybookData | null>(null);
  const [undoState, setUndoState] = useState<{ message: string; doc: RunDoc } | null>(null);
  const [dragItem, setDragItem] = useState<DragItem | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  // Right-click on a block (edit mode only) → a themed menu mirroring the row
  // tools. Pointer-fine only; touch keeps the always-visible row buttons.
  const [blockMenu, setBlockMenu] = useState<{ item: DragItem; point: { x: number; y: number } } | null>(null);
  // The icon + colour picker for a text-ish block/child, anchored to its node.
  const [runStyle, setRunStyle] = useState<{ item: DragItem; rect: DOMRect } | null>(null);
  const [railSegments, setRailSegments] = useState<RailSegment[]>([]);

  const dragRef = useRef<DragItem | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const railNodes = useRef<Map<string, HTMLElement>>(new Map());
  const closeTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pendingFocusRef = useRef<{ id: string; caret: "start" | "end" } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Focus the step a structural edit just created (Enter-split) or revealed
  // (Backspace-join). Splits carry text into the new step, so the caret goes
  // to its start; joins put the caret at the end of the previous step.
  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    pendingFocusRef.current = null;
    const node = listRef.current?.querySelector<HTMLElement>('[data-rl-focus="' + pending.id + '"]');
    if (!node) return;
    node.focus();
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(node);
      range.collapse(pending.caret === "start");
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }, [doc]);

  useEffect(
    () => () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    },
    []
  );

  useEffect(() => {
    const timers = closeTimers.current;
    return () => Object.values(timers).forEach((t) => clearTimeout(t));
  }, []);

  const materialNeeds = useMemo(() => resolveRefs(activity, materialCatalog), [activity, materialCatalog]);
  const detailTags = useMemo(() => detailTagsForActivity(activity), [activity]);

  const commit = (next: RunDoc) => onChange?.(next);

  // ---- block + child edits (controlled: derive next doc, push up) -----------
  const patchTop = (id: string, patch: Partial<RunBlock>) =>
    commit({ blocks: doc.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)) });

  const patchKid = (pid: string, kid: string, patch: Partial<RunChild>) =>
    commit({
      blocks: doc.blocks.map((b) =>
        b.id === pid
          ? { ...b, children: (b.children || []).map((c) => (c.id === kid ? { ...c, ...patch } : c)) }
          : b
      ),
    });

  // Set the icon/colour override on whatever the picker is open over (a top
  // block or an attached child). Routes through the same patch helpers, so the
  // change persists like any other run-doc edit.
  const applyRunStyle = (patch: { icon?: RunIcon; color?: RunColor }) => {
    const item = runStyle?.item;
    if (!item) return;
    if (item.kind === "top") patchTop(item.id, patch);
    else patchKid(item.parentId, item.id, patch);
  };

  // The leading node for a text-ish block/child: an outlined glyph the staffer
  // can click to recolour / re-icon. The glyph defaults from the semantic type
  // (so derived/old docs look right); a chosen colour tints the ring via --rl-blk.
  const decoNode = (
    railKey: string,
    item: DragItem,
    type: RunBlockType | RunChildType,
    icon: RunIcon | undefined,
    color: RunColor | undefined
  ): ReactNode => {
    const Glyph = RUN_ICON_CMP[icon ?? defaultRunIcon(type)];
    const tinted = !!color && color !== "none";
    const cls =
      "rl-node rl-node--type rl-node--" + type + (tinted ? " rl-node--tinted" : "");
    const style = tinted ? ({ ["--rl-blk"]: RUN_COLOR_TOKEN[color] } as CSSProperties) : undefined;
    if (!editable) {
      return (
        <span ref={railNodeRef(railKey)} className={cls} style={style} contentEditable={false}>
          <Glyph />
        </span>
      );
    }
    return (
      <button
        ref={railNodeRef(railKey)}
        type="button"
        className={cls + " rl-node--pick"}
        style={style}
        contentEditable={false}
        aria-label="Set icon and colour"
        onClick={(e) => setRunStyle({ item, rect: e.currentTarget.getBoundingClientRect() })}
      >
        <Glyph />
      </button>
    );
  };

  // ---- "Specific details" tags (stored on the details block, so a hand edit
  // persists with the run-doc override — the same pattern as steps/notes). The
  // block's seeded facts fall back to the live activity until one is touched.
  const detailTagsOf = (b: RunBlock): RunDetailTag[] =>
    b.tags && b.tags.length ? b.tags : detailTags;

  const commitDetailTag = (b: RunBlock, tagId: string, label: string) => {
    const trimmed = label.trim();
    const tags = detailTagsOf(b);
    // Clearing a tag's text removes it — the same "empty = gone" feel as steps.
    const next = trimmed
      ? tags.map((t) => (t.id === tagId ? { ...t, label: trimmed } : t))
      : tags.filter((t) => t.id !== tagId);
    patchTop(b.id, { tags: next });
  };

  const removeDetailTag = (b: RunBlock, tagId: string) =>
    patchTop(b.id, { tags: detailTagsOf(b).filter((t) => t.id !== tagId) });

  const addDetailTag = (b: RunBlock) => {
    const id = runId("tag");
    pendingFocusRef.current = { id, caret: "end" };
    patchTop(b.id, { tags: [...detailTagsOf(b), { id, label: "" }] });
  };

  // Destructive removals snapshot the doc for a 6-second Undo — a mis-tap on
  // the trash can no longer silently destroys a step and all its details.
  const offerUndo = (message: string) => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    const snapshot = cloneRunDoc(doc);
    setUndoState({ message, doc: snapshot });
    // Destructive undo gets the same 8s window as the calendar's delete toast.
    undoTimerRef.current = setTimeout(() => setUndoState(null), 8000);
  };

  const undoRemoval = () => {
    if (!undoState) return;
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    commit(undoState.doc);
    setUndoState(null);
  };

  const rmTop = (id: string) => {
    const block = doc.blocks.find((b) => b.id === id);
    // Removing a step closes its diagram editor if it happened to be open.
    if (fullDiagram?.stepId === id) setFullDiagram(null);
    offerUndo((block?.type === "step" ? "Step" : "Block") + " removed");
    commit({ blocks: doc.blocks.filter((b) => b.id !== id) });
  };

  // Duplicate a top-level block right below itself, with fresh ids on the block
  // and every attached detail (diagrams deep-cloned) so the copy can't collide
  // with the original.
  const dupTop = (id: string) => {
    const block = doc.blocks.find((b) => b.id === id);
    if (!block) return;
    const copy: RunBlock = {
      ...block,
      id: runId("b"),
      children: (block.children || []).map((c) => cloneRunChild(c, runId("k"))),
    };
    commit(insertBlockAfter(doc, id, copy));
  };

  // Duplicate an attached detail right after itself within the same parent.
  const dupKid = (pid: string, kid: string) => {
    commit({
      blocks: doc.blocks.map((b) => {
        if (b.id !== pid) return b;
        const children = b.children || [];
        const index = children.findIndex((c) => c.id === kid);
        if (index < 0) return b;
        const copy: RunChild = cloneRunChild(children[index], runId("k"));
        return { ...b, children: [...children.slice(0, index + 1), copy, ...children.slice(index + 1)] };
      }),
    });
  };

  // Enter inside a step: split at the caret — text before stays, text after
  // moves into a fresh step that takes focus.
  const splitStep = (id: string, beforeText: string, afterText: string) => {
    const fresh = { ...blankStepBlock(), text: afterText };
    pendingFocusRef.current = { id: fresh.id, caret: "start" };
    commit(insertBlockAfter(doc, id, fresh, { text: beforeText }));
  };

  // Backspace in an empty step: remove it and put the caret back on the
  // previous step.
  const removeEmptyStep = (id: string) => {
    const index = doc.blocks.findIndex((b) => b.id === id);
    if (index < 0) return;
    if (fullDiagram?.stepId === id) setFullDiagram(null);
    const previousStep = [...doc.blocks.slice(0, index)].reverse().find((b) => b.type === "step");
    if (previousStep) pendingFocusRef.current = { id: previousStep.id, caret: "end" };
    commit({ blocks: doc.blocks.filter((b) => b.id !== id) });
  };

  // Reorder a top-level block by one slot. Touch/keyboard-friendly counterpart to
  // the HTML5 drag handles (which never fire on touch devices).
  const moveTopBy = (id: string, dir: -1 | 1) => {
    const idx = doc.blocks.findIndex((b) => b.id === id);
    const swap = idx + dir;
    if (idx < 0 || swap < 0 || swap >= doc.blocks.length) return;
    const blocks = [...doc.blocks];
    [blocks[idx], blocks[swap]] = [blocks[swap], blocks[idx]];
    commit({ blocks });
  };

  // Same for a step's attached details — without this, touch devices have no
  // way to reorder a note/diagram under a step at all.
  const moveChildBy = (parentId: string, childId: string, dir: -1 | 1) => {
    commit({
      blocks: doc.blocks.map((b) => {
        if (b.id !== parentId) return b;
        const children = [...(b.children || [])];
        const idx = children.findIndex((k) => k.id === childId);
        const swap = idx + dir;
        if (idx < 0 || swap < 0 || swap >= children.length) return b;
        [children[idx], children[swap]] = [children[swap], children[idx]];
        return { ...b, children };
      }),
    });
  };

  // Tab on a top-level note/safety/variation: tuck it under the nearest step
  // above as a detail (committing its latest text in the same move). No step
  // above → no-op. Reuses the unit-tested applyDrop + childFromTop conversion.
  const indentTopBlock = (id: string, text: string) => {
    const idx = doc.blocks.findIndex((b) => b.id === id);
    if (idx < 0) return;
    let stepId: string | null = null;
    for (let i = idx - 1; i >= 0; i -= 1) {
      if (doc.blocks[i].type === "step") {
        stepId = doc.blocks[i].id;
        break;
      }
    }
    if (!stepId) return;
    const withText = doc.blocks.map((b) => (b.id === id ? { ...b, text } : b));
    const moving = withText.find((b) => b.id === id);
    if (!moving || !childFromTop(moving)) return;
    const step = withText.find((b) => b.id === stepId);
    const lastKid = step?.children?.length ? step.children[step.children.length - 1].id : null;
    const next = applyDrop(withText, { kind: "top", id }, {
      scope: "children",
      parentId: stepId,
      targetChildId: lastKid,
      position: "after",
    });
    if (!next) return;
    openStep(stepId);
    pendingFocusRef.current = { id, caret: "end" };
    commit({ blocks: next });
  };

  // Shift+Tab on an attached note/safety/variation: lift it back to a top-level
  // block right after its parent step (committing its latest text).
  const outdentChild = (parentId: string, childId: string, text: string) => {
    const parent = doc.blocks.find((b) => b.id === parentId);
    const child = parent?.children?.find((c) => c.id === childId);
    if (!child || !topFromChild(child)) return;
    const withText = doc.blocks.map((b) =>
      b.id === parentId
        ? { ...b, children: (b.children || []).map((c) => (c.id === childId ? { ...c, text } : c)) }
        : b
    );
    const next = applyDrop(withText, { kind: "child", parentId, id: childId }, {
      scope: "top",
      targetId: parentId,
      position: "after",
    });
    if (!next) return;
    pendingFocusRef.current = { id: childId, caret: "end" };
    commit({ blocks: next });
  };

  const rmKid = (pid: string, kid: string) => {
    if (fullDiagram?.childId === kid) setFullDiagram(null);
    offerUndo("Detail removed");
    commit({
      blocks: doc.blocks.map((b) =>
        b.id === pid ? { ...b, children: (b.children || []).filter((c) => c.id !== kid) } : b
      ),
    });
  };

  const addKid = (pid: string, type: RunChildType) => {
    let kid: RunChild;
    if (type === "video") kid = { id: runId("k"), type, title: "", url: "" };
    else if (type === "diagram") kid = blankDiagramChild(activity.id, activity.title);
    else if (type === "materials") kid = { id: runId("k"), type };
    else if (type === "fieldnote") kid = fieldNoteChild();
    else kid = { id: runId("k"), type, text: "" };
    commit({
      blocks: doc.blocks.map((b) =>
        b.id === pid ? { ...b, children: [...(b.children || []), kid] } : b
      ),
    });
    openStep(pid);
    // The palette STAYS OPEN after an add so several sub-blocks (a note, then
    // safety, then materials) go in without reopening it each time — dismissal
    // is the existing close affordance / Escape. A diagram is the exception:
    // it opens straight into the full-screen editor, so the palette closes.
    if (type === "diagram") {
      setOpenKid(null);
      setFullDiagram({ stepId: pid, childId: kid.id });
    }
  };

  const makeTopBlock = (type: RunBlockType): RunBlock => {
    if (type === "step") return { id: runId("b"), type, text: "", collapsed: false, children: [] };
    if (type === "heading") return { id: runId("b"), type, text: "New section", children: [] };
    if (type === "materials") return { id: runId("b"), type, children: [] };
    if (type === "details") return { id: runId("b"), type, children: [] };
    if (type === "fieldnote") return fieldNotesBlock();
    return { id: runId("b"), type, text: "", children: [] };
  };

  const addTop = (type: RunBlockType) => {
    commit({ blocks: [...doc.blocks, makeTopBlock(type)] });
    setOpenTop(false);
  };

  // The between-rows "+" affordance: insert any block type at that gap.
  const addTopAt = (type: RunBlockType, index: number) => {
    const block = makeTopBlock(type);
    if (block.type === "step") pendingFocusRef.current = { id: block.id, caret: "end" };
    commit(insertBlockAt(doc, index, block));
    setInsertAt(null);
  };

  // ---- Field notes log (a self-contained block handled like a step + its
  // sub-steps; entries are typeable in read mode too — see canCapture).
  // The parent's composer: a non-empty commit appends a fresh dated entry below,
  // expands the log if it was collapsed, and resets the line for the next one.
  const addNote = (containerId: string, text: string) => {
    if (!text.trim()) return;
    const entry = fieldNoteChild(text);
    commit({
      blocks: doc.blocks.map((b) =>
        b.id === containerId ? { ...b, children: [...(b.children || []), entry] } : b
      ),
    });
    openStep(containerId);
    setFnDraftKey((n) => n + 1);
  };

  const moveTo = (target: DropTarget) => {
    const source = dragRef.current;
    const destination = source ? resolveDrop(source, target, doc.blocks) : null;
    const blocks = source && destination ? applyDrop(doc.blocks, source, destination) : null;
    if (blocks) {
      // Nesting onto a step's details auto-expands it so the move is visible.
      if (destination?.scope === "children") openStep(destination.parentId);
      commit({ blocks });
    }
    finishDrag();
  };

  const finishDrag = () => {
    dragRef.current = null;
    setDragItem(null);
    setDropTarget(null);
  };

  // ---- collapse state (transient) ------------------------------------------
  const clearTimer = (id: string) => {
    if (closeTimers.current[id]) {
      clearTimeout(closeTimers.current[id]);
      delete closeTimers.current[id];
    }
  };
  // Steps and the Field notes log are both collapsible parents — same transient
  // collapse machinery (the stored `collapsed` is just the default).
  const isCollapsed = (b: RunBlock) =>
    (b.type === "step" || b.type === "fieldnote") && (collapsed[b.id] ?? Boolean(b.collapsed));

  const openStep = (id: string) => {
    clearTimer(id);
    setClosing((m) => {
      const next = { ...m };
      delete next[id];
      return next;
    });
    setCollapsed((m) => ({ ...m, [id]: false }));
  };

  const closeStep = (id: string) => {
    clearTimer(id);
    setOpenKid((open) => (open === id ? null : open));
    setClosing((m) => ({ ...m, [id]: true }));
    closeTimers.current[id] = setTimeout(() => {
      setCollapsed((m) => ({ ...m, [id]: true }));
      setClosing((m) => {
        const next = { ...m };
        delete next[id];
        return next;
      });
      delete closeTimers.current[id];
    }, DETAIL_ANIM_MS);
  };

  const toggleStep = (b: RunBlock) => {
    if (isCollapsed(b) || closing[b.id]) openStep(b.id);
    else closeStep(b.id);
  };

  const allCollapse = (v: boolean) => {
    Object.keys(closeTimers.current).forEach(clearTimer);
    setClosing({});
    if (v) setOpenKid(null);
    const next: Record<string, boolean> = {};
    doc.blocks.forEach((b) => {
      if (b.type === "step") next[b.id] = v;
    });
    setCollapsed(next);
  };

  const hasSteps = useMemo(() => doc.blocks.some((b) => b.type === "step"), [doc.blocks]);

  // ---- drag wiring: rows are the handle; destinations can be top-level or attached details.
  const dragBind = (item: DragItem) => ({
    draggable: editable,
    onDragStart: (e: DragEvent<HTMLElement>) => {
      const target = e.target as HTMLElement;
      if (target.closest("button, input, textarea, select, a, .matkit, .pbe, .rl-embed")) {
        e.preventDefault();
        return;
      }
      dragRef.current = item;
      setDragItem(item);
      e.dataTransfer.effectAllowed = "move";
      try {
        e.dataTransfer.setData("text/plain", item.kind + ":" + item.id);
      } catch {
        /* some browsers reject setData outside a user gesture */
      }
    },
    onDragEnd: finishDrag,
    // Edit-mode-only right-click: suppress the browser's spellcheck/editing
    // menu and open the themed block menu instead. Ignore right-clicks on
    // nested controls (e.g. the diagram editor) so they keep their own surface.
    onContextMenu: editable
      ? (e: ReactMouseEvent<HTMLElement>) => {
          if (typeof window !== "undefined" && !window.matchMedia("(pointer: fine)").matches) return;
          if ((e.target as HTMLElement).closest("button, input, textarea, select, a, .matkit, .pbe, .rl-embed")) return;
          e.preventDefault();
          e.stopPropagation();
          setBlockMenu({ item, point: { x: e.clientX, y: e.clientY } });
        }
      : undefined,
  });

  const dropBind = (item: DragItem) => ({
    onDragOver: (e: DragEvent<HTMLElement>) => {
      const source = dragRef.current;
      if (!editable || source == null) return;
      const target: DropTarget = { item, position: dropPosition(e) };
      if (!resolveDrop(source, target, doc.blocks)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (
        !dropTarget ||
        !sameDragItem(dropTarget.item, item) ||
        dropTarget.position !== target.position
      ) {
        setDropTarget(target);
      }
    },
    onDrop: (e: DragEvent<HTMLElement>) => {
      if (!editable) return;
      e.preventDefault();
      moveTo({ item, position: dropPosition(e) });
    },
  });

  const itemStateClass = (item: DragItem) => {
    const isDrop = dropTarget && sameDragItem(dropTarget.item, item);
    return (
      (isDrop && !sameDragItem(dragItem, item) ? " is-over-" + dropTarget.position : "") +
      (sameDragItem(dragItem, item) ? " is-dragging" : "")
    );
  };

  const railNodeRef = (key: string) => (node: HTMLElement | null) => {
    if (node) railNodes.current.set(key, node);
    else railNodes.current.delete(key);
  };

  const railSections = useMemo(() => {
    const sections: string[][] = [[]];
    const current = () => sections[sections.length - 1];

    doc.blocks.forEach((b) => {
      if (b.type === "heading") {
        if (current().length > 0) sections.push([]);
        return;
      }

      current().push(topRailKey(b.id));

      if (b.type === "step" && (!isCollapsed(b) || closing[b.id])) {
        (b.children || []).forEach((k) => current().push(childRailKey(b.id, k.id)));
      }
    });

    return sections.filter((section) => section.length > 1);
  }, [doc.blocks, collapsed, closing]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    let frame = 0;

    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const listRect = list.getBoundingClientRect();
        const next: RailSegment[] = [];

        railSections.forEach((section, sectionIndex) => {
          section.forEach((from, itemIndex) => {
            const to = section[itemIndex + 1];
            if (!to) return;

            const fromNode = railNodes.current.get(from);
            const toNode = railNodes.current.get(to);
            if (!fromNode || !toNode) return;

            const fromRect = fromNode.getBoundingClientRect();
            const toRect = toNode.getBoundingClientRect();
            const y1 = fromRect.top + fromRect.height / 2 - listRect.top;
            const y2 = toRect.top + toRect.height / 2 - listRect.top;
            if (y2 <= y1 + 1) return;

            next.push({
              id: sectionIndex + ":" + itemIndex + ":" + from + ":" + to,
              x: fromRect.left + fromRect.width / 2 - listRect.left,
              y1,
              y2,
            });
          });
        });

        setRailSegments((prev) => {
          const same =
            prev.length === next.length &&
            prev.every(
              (segment, index) =>
                segment.id === next[index].id &&
                Math.abs(segment.x - next[index].x) < 0.5 &&
                Math.abs(segment.y1 - next[index].y1) < 0.5 &&
                Math.abs(segment.y2 - next[index].y2) < 0.5
            );
          return same ? prev : next;
        });
      });
    };

    measure();
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    resizeObserver?.observe(list);
    railNodes.current.forEach((node) => resizeObserver?.observe(node));
    window.addEventListener("resize", measure);

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [railSections]);

  // Row tools, with optional extra actions (e.g. attach-detail). Revealed on
  // hover/focus on pointer devices and always shown on touch (see globals.css).
  const handles = (id: string, extra?: ReactNode) => {
    if (!editable) return null;
    const idx = doc.blocks.findIndex((b) => b.id === id);
    return (
      <div className="rl-rowtools">
        {/* Not a button on purpose: dragBind ignores drags starting on buttons,
            and the whole row is the actual drag handle this grip advertises. */}
        <span className="rl-grip" title="Drag to reorder" aria-hidden="true">
          <CampIcon.Grip />
        </span>
        {extra}
        <button
          type="button"
          className="rl-iconbtn"
          onClick={() => moveTopBy(id, -1)}
          disabled={idx <= 0}
          aria-label="Move block up"
        >
          <CampIcon.ChevronUp />
        </button>
        <button
          type="button"
          className="rl-iconbtn"
          onClick={() => moveTopBy(id, 1)}
          disabled={idx < 0 || idx >= doc.blocks.length - 1}
          aria-label="Move block down"
        >
          <CampIcon.ChevronDown />
        </button>
        <button type="button" className="rl-iconbtn" onClick={() => rmTop(id)} aria-label="Remove block">
          <CampIcon.Trash />
        </button>
      </div>
    );
  };

  const detailIcon = (icon: string | undefined) => {
    if (icon === "pin") return <CampIcon.Pin />;
    if (icon === "users") return <CampIcon.Users />;
    if (icon === "clock") return <CampIcon.Clock />;
    if (icon === "type") return <CampIcon.Tag />;
    if (icon === "energy") return <CampIcon.Bolt />;
    if (icon === "prep") return <CampIcon.Tool />;
    if (icon === "rating") return <CampIcon.Star />;
    return null;
  };

  // ---- a single attached detail row (a sibling on the same rail) ------------
  const renderChild = (stepId: string, k: RunChild, closingNow: boolean): ReactNode => {
    const Icon = TYPE_ICON[k.type];
    // event-detail-2: the Materials block's header silently switches between
    // the library's canonical kit list and a per-day-substitutable one purely
    // based on whether materialSubs is wired (canSub), with identical chrome —
    // no label told a staffer which mode they were looking at. materialSubs
    // is PRESENT (even {}) only when this sheet was opened FROM a calendar
    // event (see the prop doc above), so its mere presence is the per-day
    // signal; a plain "Materials" heading stays library-wide.
    const label =
      k.type === "materials" && materialSubs !== undefined
        ? RUN_CHILD_META[k.type].label + " · Today only"
        : RUN_CHILD_META[k.type].label;
    // A field-note entry reads as a dated log line: the date+time chip IS its
    // header (the parent log already says "Field notes"), so the type label is
    // suppressed unless the entry somehow has no stamp.
    const timeExtra =
      k.type === "fieldnote" && k.at ? <span className="rl-fndate">{formatStamp(k.at)}</span> : null;
    const timeLabel = k.type === "fieldnote" && k.at ? null : label;
    const parentBlock = doc.blocks.find((b) => b.id === stepId);
    const childIndex = (parentBlock?.children || []).findIndex((c) => c.id === k.id);
    const childCount = parentBlock?.children?.length ?? 0;
    const removeBtn = editable ? (
      <div className="rl-rowtools">
        <span className="rl-grip" title="Drag to reorder" aria-hidden="true">
          <CampIcon.Grip />
        </span>
        <button
          type="button"
          className="rl-iconbtn"
          onClick={() => moveChildBy(stepId, k.id, -1)}
          disabled={childIndex <= 0}
          aria-label="Move detail up"
        >
          <CampIcon.ChevronUp />
        </button>
        <button
          type="button"
          className="rl-iconbtn"
          onClick={() => moveChildBy(stepId, k.id, 1)}
          disabled={childIndex < 0 || childIndex >= childCount - 1}
          aria-label="Move detail down"
        >
          <CampIcon.ChevronDown />
        </button>
        <button type="button" className="rl-iconbtn" onClick={() => rmKid(stepId, k.id)} aria-label="Remove detail">
          <CampIcon.Trash />
        </button>
      </div>
    ) : null;
    // Note / safety / variation details wear the clickable icon/colour node (the
    // picker). Sub-steps stay structural (their own glyph), and the specialized
    // children (diagram / materials / video / fieldnote) keep their fixed node.
    const isTextChild = k.type === "note" || k.type === "safety" || k.type === "variation";
    const nodeEl = isTextChild ? (
      decoNode(childRailKey(stepId, k.id), { kind: "child", parentId: stepId, id: k.id }, k.type, k.icon, k.color)
    ) : (
      <span
        ref={railNodeRef(childRailKey(stepId, k.id))}
        className={"rl-node rl-node--type rl-node--" + k.type}
        contentEditable={false}
      >
        <Icon />
      </span>
    );
    const shell = (body: ReactNode) => (
      <li
        key={k.id}
        {...dragBind({ kind: "child", parentId: stepId, id: k.id })}
        {...dropBind({ kind: "child", parentId: stepId, id: k.id })}
        className={
          "rl-block rl-block--detail rl-block--" +
          k.type +
          (closingNow ? " is-closing" : "") +
          itemStateClass({ kind: "child", parentId: stepId, id: k.id })
        }
      >
        {nodeEl}
        <div className="rl-block__main">
          <div className={"rl-row rl-row--detail rl-row--" + k.type}>
            <div className="rl-body">
              <div className="rl-time">
                {timeLabel}
                {timeExtra}
              </div>
              {body}
            </div>
            {removeBtn}
          </div>
        </div>
      </li>
    );

    if (k.type === "diagram") {
      if (!k.diagram) return shell(null);
      // Both modes open full screen — read mode walks the stages in the lightbox,
      // edit mode opens the roomy editor — so the diagram is never cramped.
      return shell(
        <button
          type="button"
          className="rl-diagram rl-diagram--open"
          onClick={() =>
            editable ? setFullDiagram({ stepId, childId: k.id }) : setLightbox(k.diagram ?? null)
          }
          aria-label={editable ? "Edit diagram full screen" : "View diagram full screen"}
        >
          <ActivityPlaybook playbook={k.diagram} compact />
          <span className="rl-diagram__cue" aria-hidden="true">
            {editable ? (
              <>
                <CampIcon.Pencil />
                Edit
              </>
            ) : (
              <>
                <CampIcon.Maximize />
                Full screen
              </>
            )}
          </span>
        </button>
      );
    }

    if (k.type === "materials") {
      return shell(
        materialNeeds.length === 0 ? (
          <span className="stamp">None needed</span>
        ) : (
          <MaterialChecklist
            needs={materialNeeds}
            stock={kitStock}
            catalog={materialCatalog}
            onSetStockState={onSetStockState}
            subs={materialSubs}
            onSetSub={onSetMaterialSub}
          />
        )
      );
    }

    if (k.type === "video") {
      // A media detail: a YouTube/Vimeo link plays inline; any other link reads
      // as a tappable preview card. In edit mode the staffer sees a live preview.
      const rawUrl = (k.url || "").trim();
      const parsed = parseEmbed(rawUrl);
      if (!editable) {
        return shell(
          <div className="rl-vid">
            <RunEmbed parsed={parsed} title={k.title} />
            {(parsed.kind === "youtube" || parsed.kind === "vimeo" || parsed.kind === "none") && k.title ? (
              <span className="rl-vid__cap">{k.title}</span>
            ) : null}
            {parsed.kind === "none" && rawUrl ? <span className="rl-vid__url">{rawUrl}</span> : null}
          </div>
        );
      }
      return shell(
        <div className="rl-vid">
          <Editable
            className="rl-text"
            value={k.title || ""}
            editable={editable}
            placeholder="Caption (optional)"
            ariaLabel="Media caption"
            onCommit={(v) => patchKid(stepId, k.id, { title: v })}
          />
          <Editable
            className="rl-vid__url"
            tag="span"
            value={k.url || ""}
            editable={editable}
            placeholder="YouTube, Vimeo, or a link…"
            ariaLabel="Media link"
            onCommit={(v) => patchKid(stepId, k.id, { url: v })}
          />
          {parsed.kind !== "none" ? (
            <div className="rl-vid__preview">
              <RunEmbed parsed={parsed} title={k.title} />
            </div>
          ) : null}
        </div>
      );
    }

    const isFieldnote = k.type === "fieldnote";
    return shell(
      <Editable
        className="rl-text"
        value={k.text || ""}
        editable={editable || (isFieldnote && canCapture)}
        placeholder={RUN_CHILD_META[k.type].placeholder}
        ariaLabel={label + " detail text"}
        focusKey={k.id}
        onCommit={
          isFieldnote
            ? (v) => (v.trim() ? patchKid(stepId, k.id, { text: v }) : rmKid(stepId, k.id))
            : (v) => patchKid(stepId, k.id, { text: v })
        }
        onOutdent={isTextChild ? (t) => outdentChild(stepId, k.id, t) : undefined}
      />
    );
  };

  // ---- the Field notes log: handled exactly like a step + its sub-steps.
  // The parent row carries a composer text field; Enter (or blur) logs the typed
  // text as a fresh dated entry that rides beneath the parent as a detail row on
  // the same rail. The parent node toggles collapse, tucking every entry into a
  // "N field notes" pill — the same idiom as collapsing a step. Entries are
  // typeable straight from the read-only viewer when canCapture (no edit mode).
  const renderFieldNotes = (b: RunBlock): ReactNode => {
    const notes = (b.children || []).filter((c) => c.type === "fieldnote");
    const canWrite = editable || canCapture;
    // Nothing to show and no way to add (e.g. the public run sheet): skip it.
    if (notes.length === 0 && !canWrite) return null;

    const collapsedNow = isCollapsed(b);
    const closingNow = Boolean(closing[b.id]);
    const hasKids = notes.length > 0;
    const stateClass =
      (collapsedNow ? " is-collapsed" : "") +
      itemStateClass({ kind: "top", id: b.id }) +
      (closingNow ? " is-closing" : "") +
      (hasKids ? " has-children" : "");

    return (
      <Fragment key={b.id}>
        <li
          {...dragBind({ kind: "top", id: b.id })}
          {...dropBind({ kind: "top", id: b.id })}
          className={"rl-block rl-block--fieldnote rl-block--fnlog" + stateClass}
        >
          {hasKids ? (
            <button
              type="button"
              ref={railNodeRef(topRailKey(b.id))}
              className="rl-node rl-node--fnhead"
              onClick={() => toggleStep(b)}
              aria-label={collapsedNow ? "Expand field notes" : "Collapse field notes"}
              aria-expanded={!collapsedNow && !closingNow}
              contentEditable={false}
            >
              <CampIcon.Flag />
            </button>
          ) : (
            <span
              ref={railNodeRef(topRailKey(b.id))}
              className="rl-node rl-node--fnhead rl-node--plain"
              contentEditable={false}
            >
              <CampIcon.Flag />
            </span>
          )}
          <div className="rl-block__main">
            <div className="rl-row rl-row--fieldnote rl-row--fnlog">
              <div className="rl-body">
                <div className="rl-time">Field notes</div>
                {canWrite ? (
                  <Editable
                    key={"fn:" + b.id + ":" + fnDraftKey}
                    className="rl-text rl-fncompose"
                    value=""
                    editable
                    placeholder={hasKids ? "Jot another field note…" : "Jot a field note…"}
                    ariaLabel="New field note"
                    commitOnEnter
                    onCommit={(v) => addNote(b.id, v)}
                  />
                ) : null}
                {collapsedNow && hasKids && (
                  <div className="rl-summary" contentEditable={false}>
                    <Pill type="fieldnote" n={notes.length} />
                  </div>
                )}
              </div>
              {handles(b.id)}
            </div>
          </div>
        </li>

        {(!collapsedNow || closingNow) && notes.map((k) => renderChild(b.id, k, closingNow))}
      </Fragment>
    );
  };

  let stepNo = 0;

  // A slim "+" between rows: hover-revealed on pointers, always tappable on
  // touch (CSS). Opens the block palette anchored at that gap, so inserting
  // mid-document no longer means append-then-arrow-up.
  const renderInsertZone = (index: number): ReactNode => {
    if (!editable) return null;
    // While dragging, the only positioning cue on screen is the drop indicator —
    // the between-row "+" affordances stay out of the way to cut the clutter.
    // Keep the gap's height (an empty spacer) rather than removing it, or the
    // whole list would collapse upward the instant a drag starts ("reframes").
    if (dragItem) return <li className="rl-insert" aria-hidden="true" />;
    if (insertAt === index) {
      return (
        <li className="rl-block rl-block--add rl-insertopen">
          <span className="rl-node rl-node--spacer" aria-hidden="true" />
          <div className="rl-block__main">
            <div
              className="rl-palette rl-palette--flat"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  setInsertAt(null);
                }
              }}
            >
              {addableBlocks.map(({ type, label, icon: Icon }, i) => (
                <button
                  type="button"
                  key={type}
                  className="rl-ptype"
                  autoFocus={i === 0}
                  onClick={() => addTopAt(type, index)}
                >
                  <Icon />
                  {label}
                </button>
              ))}
              <button type="button" className="rl-ptype rl-ptype--cancel" onClick={() => setInsertAt(null)}>
                <CampIcon.Close />
                Cancel
              </button>
            </div>
          </div>
        </li>
      );
    }
    return (
      <li className="rl-insert" aria-hidden={false}>
        <button
          type="button"
          className="rl-insert__btn"
          onClick={() => setInsertAt(index)}
          aria-label="Insert a block here"
        >
          <CampIcon.Plus />
        </button>
      </li>
    );
  };

  return (
    <div className={"rl" + (editable ? "" : " is-readonly") + (dragItem ? " is-dnd" : "")}>
      <div className="rl-toolbar">
        {hasSteps && (
          <>
            <button type="button" className="rl-tbtn" onClick={() => allCollapse(true)}>
              <CampIcon.CollapseAll />
              Collapse all
            </button>
            <button type="button" className="rl-tbtn" onClick={() => allCollapse(false)}>
              <CampIcon.ExpandAll />
              Expand all
            </button>
          </>
        )}
      </div>

      <div className="rl-doc">
        <ul className="rl-list" ref={listRef}>
          <li className="rl-rail" aria-hidden="true">
            {railSegments.map((segment) => (
              <span
                key={segment.id}
                style={{
                  left: segment.x - 1,
                  top: segment.y1,
                  height: segment.y2 - segment.y1,
                }}
              />
            ))}
          </li>
          {/* ---- FORM-BOUND DETAILS + MATERIALS (edit/create) ----
              The scalar facts live inline as the top of the run sheet, the same
              positions browse shows them as static tags. These render OUTSIDE
              doc.blocks (they bind to editForm, not the run-doc) so the play
              content stays the single editable run-doc; on save the scaffold is
              re-derived from these facts (no dual-write). */}
          {isFormEdit && editForm && onEditFormChange && (
            <>
              <li className="rl-block rl-block--heading rl-block--formhead" aria-hidden="false">
                <div className="rl-block__main">
                  <div className="rl-row rl-row--heading">
                    <div className="rl-body">
                      <span className="rl-heading__t">Details</span>
                    </div>
                  </div>
                </div>
              </li>
              <li className="rl-block rl-block--details rl-block--formdetails">
                <span className="rl-node rl-node--type rl-node--details" contentEditable={false}>
                  <CampIcon.Card />
                </span>
                <div className="rl-block__main">
                  <div className="rl-row rl-row--details">
                    <div className="rl-body">
                      <div className="rl-time">{RUN_TOP_LABEL.details}</div>
                      <DetailFormControls
                        form={editForm}
                        onFormChange={onEditFormChange}
                        themeKit={editThemeKit}
                        ageUnit={editAgeUnit}
                        onAgeUnit={onEditAgeUnit}
                      />
                    </div>
                  </div>
                </div>
              </li>
              <li className="rl-block rl-block--materials rl-block--formmaterials">
                <span className="rl-node rl-node--type rl-node--materials" contentEditable={false}>
                  <CampIcon.Card />
                </span>
                <div className="rl-block__main">
                  <div className="rl-row rl-row--materials">
                    <div className="rl-body">
                      <div className="rl-time">{RUN_TOP_LABEL.materials}</div>
                      <MaterialsEditor
                        rows={editForm.materialRefs}
                        onChange={(materialRefs) => onEditFormChange({ ...editForm, materialRefs })}
                      />
                    </div>
                  </div>
                </div>
              </li>
              {hasSteps && (
                <li className="rl-block rl-block--heading rl-block--formhead" aria-hidden="false">
                  <div className="rl-block__main">
                    <div className="rl-row rl-row--heading">
                      <div className="rl-body">
                        <span className="rl-heading__t">How to play</span>
                      </div>
                    </div>
                  </div>
                </li>
              )}
            </>
          )}
          {doc.blocks.map((b, blockIndex) => (
            <Fragment key={"wrap-" + b.id}>
              {renderInsertZone(blockIndex)}
              {(() => {
            // ---- SECTION HEADING ----
            if (b.type === "heading") {
              stepNo = 0;
              return (
                <li
                  key={b.id}
                  {...dragBind({ kind: "top", id: b.id })}
                  {...dropBind({ kind: "top", id: b.id })}
                  className={"rl-block rl-block--heading" + itemStateClass({ kind: "top", id: b.id })}
                >
                  <div className="rl-block__main">
                    <div className="rl-row rl-row--heading">
                      <div className="rl-body">
                        <Editable
                          className="rl-heading__t"
                          tag="span"
                          value={b.text || ""}
                          editable={editable}
                          placeholder="Section"
                          ariaLabel="Section heading"
                          onCommit={(v) => patchTop(b.id, { text: v })}
                        />
                      </div>
                      {handles(b.id)}
                    </div>
                  </div>
                </li>
              );
            }

            // ---- ACTIVITY DETAILS / TAGS ----
            if (b.type === "details") {
              const tagsEditable = editable;
              const shownTags = detailTagsOf(b);
              return (
                <li
                  key={b.id}
                  {...dragBind({ kind: "top", id: b.id })}
                  {...dropBind({ kind: "top", id: b.id })}
                  className={"rl-block rl-block--details" + itemStateClass({ kind: "top", id: b.id })}
                >
                  <span
                    ref={railNodeRef(topRailKey(b.id))}
                    className="rl-node rl-node--type rl-node--details"
                    contentEditable={false}
                  >
                    <CampIcon.Card />
                  </span>
                  <div className="rl-block__main">
                    <div className="rl-row rl-row--details">
                      <div className="rl-body">
                        <div className="rl-time">{RUN_TOP_LABEL.details}</div>
                        <div className="rl-detailtags">
                          {shownTags
                            .filter((tag) => tag.id !== "rating" || !onSetRating)
                            .map((tag) =>
                              tagsEditable ? (
                                <span className="rl-detailtag rl-detailtag--edit" key={tag.id}>
                                  {detailIcon(tag.icon)}
                                  <Editable
                                    tag="span"
                                    className="rl-detailtag__t"
                                    value={tag.label}
                                    editable
                                    placeholder="Tag"
                                    ariaLabel="Detail tag"
                                    focusKey={tag.id}
                                    onCommit={(v) => commitDetailTag(b, tag.id, v)}
                                  />
                                  <button
                                    type="button"
                                    className="rl-detailtag__x"
                                    onClick={() => removeDetailTag(b, tag.id)}
                                    aria-label={"Remove " + (tag.label || "tag")}
                                  >
                                    <CampIcon.Close />
                                  </button>
                                </span>
                              ) : (
                                <span className="rl-detailtag" key={tag.id}>
                                  {detailIcon(tag.icon)}
                                  {tag.label}
                                </span>
                              )
                            )}
                          {tagsEditable && (
                            <button
                              type="button"
                              className="rl-detailtag rl-detailtag--add"
                              onClick={() => addDetailTag(b)}
                              aria-label="Add a detail tag"
                            >
                              <CampIcon.Plus />
                              Add
                            </button>
                          )}
                        </div>
                        {onSetRating && (
                          <div className="rl-detailrating">
                            <RatingDots value={activity.rating || 0} onChange={onSetRating} />
                          </div>
                        )}
                      </div>
                      {handles(b.id)}
                    </div>
                  </div>
                </li>
              );
            }

            // ---- PLAYBOOK cross-link (legacy; kept for stored docs) ----
            if (b.type === "playbook") {
              return (
                <li
                  key={b.id}
                  {...dragBind({ kind: "top", id: b.id })}
                  {...dropBind({ kind: "top", id: b.id })}
                  className={"rl-block rl-block--playbook" + itemStateClass({ kind: "top", id: b.id })}
                >
                  <span
                    ref={railNodeRef(topRailKey(b.id))}
                    className="rl-node rl-node--type rl-node--playbook"
                    contentEditable={false}
                  >
                    <CampIcon.BookOpen />
                  </span>
                  <div className="rl-block__main">
                    <div className="rl-row rl-row--playbook">
                      <span className="rl-pb__spine" contentEditable={false}>
                        <CampIcon.BookOpen />
                      </span>
                      <div className="rl-body">
                        <Editable
                          className="rl-pb__title"
                          value={b.title || ""}
                          editable={editable}
                          placeholder="Linked activity"
                          ariaLabel="Playbook card title"
                          onCommit={(v) => patchTop(b.id, { title: v })}
                        />
                        <Editable
                          className="rl-pb__meta"
                          tag="span"
                          value={b.meta || ""}
                          editable={editable}
                          placeholder="meta"
                          ariaLabel="Playbook card meta"
                          onCommit={(v) => patchTop(b.id, { meta: v })}
                        />
                      </div>
                      {handles(b.id)}
                    </div>
                  </div>
                </li>
              );
            }

            // ---- TOP-LEVEL MATERIALS / KIT ----
            if (b.type === "materials") {
              return (
                <li
                  key={b.id}
                  {...dragBind({ kind: "top", id: b.id })}
                  {...dropBind({ kind: "top", id: b.id })}
                  className={"rl-block rl-block--materials" + itemStateClass({ kind: "top", id: b.id })}
                >
                  <span
                    ref={railNodeRef(topRailKey(b.id))}
                    className="rl-node rl-node--type rl-node--materials"
                    contentEditable={false}
                  >
                    <CampIcon.Card />
                  </span>
                  <div className="rl-block__main">
                    <div className="rl-row rl-row--materials">
                      <div className="rl-body">
                        <div className="rl-time">{RUN_TOP_LABEL.materials}</div>
                        {materialNeeds.length === 0 ? (
                          <span className="stamp">None needed</span>
                        ) : (
                          <MaterialChecklist
                            needs={materialNeeds}
                            stock={kitStock}
                            catalog={materialCatalog}
                            onSetStockState={onSetStockState}
                            subs={materialSubs}
                            onSetSub={onSetMaterialSub}
                          />
                        )}
                      </div>
                      {handles(b.id)}
                    </div>
                  </div>
                </li>
              );
            }

            // ---- TOP-LEVEL FIELD NOTES LOG (step + sub-steps idiom) ----
            if (b.type === "fieldnote") {
              return renderFieldNotes(b);
            }

            // ---- TOP-LEVEL NOTE / SAFETY / VARIATION ----
            if (b.type !== "step") {
              const label = RUN_TOP_LABEL[b.type as "note" | "safety" | "variation"] || "Note";
              return (
                <li
                  key={b.id}
                  {...dragBind({ kind: "top", id: b.id })}
                  {...dropBind({ kind: "top", id: b.id })}
                  className={"rl-block rl-block--" + b.type + itemStateClass({ kind: "top", id: b.id })}
                >
                  {decoNode(topRailKey(b.id), { kind: "top", id: b.id }, b.type, b.icon, b.color)}
                  <div className="rl-block__main">
                    <div className={"rl-row rl-row--" + b.type}>
                      <div className="rl-body">
                        <div className="rl-time">{label}</div>
                        <Editable
                          className="rl-text"
                          value={b.text || ""}
                          editable={editable}
                          placeholder={label}
                          ariaLabel={label + " text"}
                          focusKey={b.id}
                          onCommit={(v) => patchTop(b.id, { text: v })}
                          onIndent={(t) => indentTopBlock(b.id, t)}
                        />
                      </div>
                      {handles(b.id)}
                    </div>
                  </div>
                </li>
              );
            }

            // ---- STEP (collapsible parent) ----
            stepNo += 1;
            const kids = b.children || [];
            const collapsedNow = isCollapsed(b);
            const closingNow = Boolean(closing[b.id]);
            const summary = RUN_CHILD_TYPES.map((t) => ({
              type: t,
              n: kids.filter((k) => k.type === t).length,
            })).filter((s) => s.n > 0);
            const stateClass =
              (collapsedNow ? " is-collapsed" : "") +
              itemStateClass({ kind: "top", id: b.id }) +
              (closingNow ? " is-closing" : "") +
              (kids.length > 0 ? " has-children" : "");

            const attachBtn = (
              <button
                type="button"
                className="rl-iconbtn"
                onClick={() => {
                  setOpenKid(openKid === b.id ? null : b.id);
                  if (collapsedNow) openStep(b.id);
                }}
                aria-label="Attach detail"
              >
                <CampIcon.Plus />
              </button>
            );

            const hasKids = kids.length > 0;

            return (
              <Fragment key={b.id}>
                <li
                  {...dragBind({ kind: "top", id: b.id })}
                  {...dropBind({ kind: "top", id: b.id })}
                  className={"rl-block rl-block--step" + stateClass}
                >
                  {hasKids ? (
                    <button
                      type="button"
                      ref={railNodeRef(topRailKey(b.id))}
                      className="rl-node rl-node--step"
                      onClick={() => toggleStep(b)}
                      aria-label={collapsedNow ? "Expand step" : "Collapse step"}
                      aria-expanded={!collapsedNow && !closingNow}
                      contentEditable={false}
                    >
                      <span className="rl-node__num">{stepNo}</span>
                    </button>
                  ) : (
                    <span
                      ref={railNodeRef(topRailKey(b.id))}
                      className="rl-node rl-node--step rl-node--plain"
                      contentEditable={false}
                    >
                      <span className="rl-node__num">{stepNo}</span>
                    </span>
                  )}
                  <div className="rl-block__main">
                    <div className="rl-row">
                      <div className="rl-body">
                        {b.time && b.time.trim() ? (
                          <Editable
                            className="rl-time"
                            tag="span"
                            value={b.time}
                            editable={editable}
                            placeholder="time / cue"
                            ariaLabel={"Step " + stepNo + " time or cue"}
                            onCommit={(v) => patchTop(b.id, { time: v })}
                          />
                        ) : null}
                        <Editable
                          className="rl-text"
                          value={b.text || ""}
                          editable={editable}
                          placeholder="Describe this step…"
                          ariaLabel={"Step " + stepNo + " instructions"}
                          focusKey={b.id}
                          onCommit={(v) => patchTop(b.id, { text: v })}
                          onEnter={(before, after) => splitStep(b.id, before, after)}
                          onBackspaceEmpty={() => removeEmptyStep(b.id)}
                        />
                        {collapsedNow && summary.length > 0 && (
                          <div className="rl-summary" contentEditable={false}>
                            {summary.map((s) => (
                              <Pill key={s.type} type={s.type} n={s.n} />
                            ))}
                          </div>
                        )}
                      </div>
                      {handles(b.id, attachBtn)}
                    </div>
                  </div>
                </li>

                {(!collapsedNow || closingNow) &&
                  kids.map((k) => renderChild(b.id, k, closingNow))}

                {editable && !collapsedNow && !closingNow && openKid === b.id && (
                  <li key={b.id + "-add"} className="rl-block rl-block--detail rl-block--add">
                    <span className="rl-node rl-node--spacer" aria-hidden="true" />
                    <div className="rl-block__main">
                      <div
                        className="rl-palette rl-palette--flat"
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            e.preventDefault();
                            e.stopPropagation();
                            setOpenKid(null);
                          }
                        }}
                      >
                        {ATTACH_BLOCKS.map((t, i) => {
                          const Icon = TYPE_ICON[t];
                          return (
                            <button
                              type="button"
                              key={t}
                              className="rl-ptype"
                              autoFocus={i === 0}
                              onClick={() => addKid(b.id, t)}
                            >
                              <Icon />
                              {RUN_CHILD_META[t].label}
                            </button>
                          );
                        })}
                        <button
                          type="button"
                          className="rl-ptype rl-ptype--cancel"
                          onClick={() => setOpenKid(null)}
                        >
                          <CampIcon.Close />
                          Cancel
                        </button>
                      </div>
                    </div>
                  </li>
                )}
              </Fragment>
            );
              })()}
            </Fragment>
          ))}
        </ul>

        {/* An override cleared down to {blocks: []} is a supported empty state
            (see lib/runListResolve.ts) — say so in read mode rather than
            showing a bare, contentless rail. Edit mode already has its own
            affordance (the "Add a block" button just below). */}
        {!editable && doc.blocks.length === 0 && (
          <p className="rl-empty">This run sheet is empty.</p>
        )}

        {editable && (
          <div className="rl-addwrap">
            <div className="rl-addmain">
              {openTop ? (
                <div
                  className="rl-palette rl-palette--top"
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.preventDefault();
                      e.stopPropagation();
                      setOpenTop(false);
                    }
                  }}
                >
                  {addableBlocks.map(({ type, label, icon: Icon }, i) => (
                    <button
                      type="button"
                      key={type}
                      className="rl-ptype"
                      autoFocus={i === 0}
                      onClick={() => addTop(type)}
                    >
                      <Icon />
                      {label}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="rl-ptype rl-ptype--cancel"
                    onClick={() => setOpenTop(false)}
                  >
                    <CampIcon.Close />
                    Cancel
                  </button>
                </div>
              ) : (
                <button type="button" className="rl-addblock" onClick={() => setOpenTop(true)}>
                  <CampIcon.Plus />
                  Add a block
                </button>
              )}
            </div>
          </div>
        )}

      </div>

      {undoState && (
        <div className="rl-toast" role="status">
          <span>{undoState.message}</span>
          <button type="button" onClick={undoRemoval}>
            Undo
          </button>
        </div>
      )}
      {lightbox && <DiagramLightbox playbook={lightbox} onClose={() => setLightbox(null)} />}

      {fullDiagram &&
        (() => {
          const parent = doc.blocks.find((b) => b.id === fullDiagram.stepId);
          const child = parent?.children?.find((c) => c.id === fullDiagram.childId);
          if (!child || child.type !== "diagram" || !child.diagram) return null;
          return (
            <DiagramEditModal
              playbook={child.diagram}
              onChange={(next) => patchKid(fullDiagram.stepId, fullDiagram.childId, { diagram: next })}
              onClose={() => setFullDiagram(null)}
            />
          );
        })()}

      {blockMenu && (() => {
        const item = blockMenu.item;
        if (item.kind === "top") {
          const idx = doc.blocks.findIndex((b) => b.id === item.id);
          return (
            <ContextMenu
              point={blockMenu.point}
              ariaLabel="Block actions"
              onClose={() => setBlockMenu(null)}
              items={[
                {
                  label: "Move up",
                  icon: <CampIcon.ChevronUp />,
                  disabled: idx <= 0,
                  onSelect: () => moveTopBy(item.id, -1),
                },
                {
                  label: "Move down",
                  icon: <CampIcon.ChevronDown />,
                  disabled: idx < 0 || idx >= doc.blocks.length - 1,
                  onSelect: () => moveTopBy(item.id, 1),
                },
                { label: "Duplicate", icon: <CampIcon.Copy />, onSelect: () => dupTop(item.id) },
                {
                  label: "Remove",
                  icon: <CampIcon.Trash />,
                  danger: true,
                  separatorBefore: true,
                  onSelect: () => rmTop(item.id),
                },
              ]}
            />
          );
        }
        const parent = doc.blocks.find((b) => b.id === item.parentId);
        const kids = parent?.children || [];
        const kidIdx = kids.findIndex((c) => c.id === item.id);
        return (
          <ContextMenu
            point={blockMenu.point}
            ariaLabel="Detail actions"
            onClose={() => setBlockMenu(null)}
            items={[
              {
                label: "Move up",
                icon: <CampIcon.ChevronUp />,
                disabled: kidIdx <= 0,
                onSelect: () => moveChildBy(item.parentId, item.id, -1),
              },
              {
                label: "Move down",
                icon: <CampIcon.ChevronDown />,
                disabled: kidIdx < 0 || kidIdx >= kids.length - 1,
                onSelect: () => moveChildBy(item.parentId, item.id, 1),
              },
              { label: "Duplicate", icon: <CampIcon.Copy />, onSelect: () => dupKid(item.parentId, item.id) },
              {
                label: "Remove",
                icon: <CampIcon.Trash />,
                danger: true,
                separatorBefore: true,
                onSelect: () => rmKid(item.parentId, item.id),
              },
            ]}
          />
        );
      })()}

      {runStyle && (() => {
        const item = runStyle.item;
        let cur: { icon?: RunIcon; color?: RunColor; type: RunBlockType | RunChildType } | null = null;
        if (item.kind === "top") {
          const b = doc.blocks.find((x) => x.id === item.id);
          if (b) cur = { icon: b.icon, color: b.color, type: b.type };
        } else {
          const p = doc.blocks.find((x) => x.id === item.parentId);
          const c = p?.children?.find((k) => k.id === item.id);
          if (c) cur = { icon: c.icon, color: c.color, type: c.type };
        }
        if (!cur) return null;
        const curIcon = cur.icon ?? defaultRunIcon(cur.type);
        return (
          <FloatingLayer
            anchor={{ kind: "rect", rect: runStyle.rect }}
            onClose={() => setRunStyle(null)}
            className="rl-stylepop"
            role="dialog"
            ariaLabel="Icon and colour"
          >
            <div className="rl-stylepop__label">Colour</div>
            <div className="rl-stylepop__swatches" role="group" aria-label="Colour">
              {RUN_COLORS.map((c, i) => (
                <button
                  type="button"
                  key={c}
                  className={"rl-swatch" + ((cur!.color ?? "none") === c ? " is-on" : "")}
                  style={{ background: RUN_COLOR_TOKEN[c] } as CSSProperties}
                  data-floating-first={i === 0 ? "" : undefined}
                  aria-label={c}
                  aria-pressed={(cur!.color ?? "none") === c}
                  onClick={() => applyRunStyle({ color: c })}
                />
              ))}
            </div>
            <div className="rl-stylepop__label">Icon</div>
            <div className="rl-stylepop__icons" role="group" aria-label="Icon">
              {RUN_ICONS.map((ic) => {
                const Glyph = RUN_ICON_CMP[ic];
                return (
                  <button
                    type="button"
                    key={ic}
                    className={"rl-iconpick" + (curIcon === ic ? " is-on" : "")}
                    aria-label={RUN_ICON_LABEL[ic]}
                    aria-pressed={curIcon === ic}
                    title={RUN_ICON_LABEL[ic]}
                    onClick={() => applyRunStyle({ icon: ic })}
                  >
                    <Glyph />
                  </button>
                );
              })}
            </div>
          </FloatingLayer>
        );
      })()}
    </div>
  );
}

export { cloneRunDoc };
