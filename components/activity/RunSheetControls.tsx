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
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FC,
} from "react";
import type { Activity, AgeGroupId } from "@/lib/types";
import { AGE_GROUPS, bandShort, CATEGORIES, categoryTint, type AgeUnit } from "@/lib/content/data";
import { coverage, type ResolvedRef } from "@/lib/materials/materials";
import { catalogNameFor, type Material } from "@/lib/materials/materialCatalog";
import type { StockState } from "@/lib/materials/kitStock";
import {
  MAX_ACTIVITY_DURATION_MIN,
  mintMaterialRow,
  renameMaterialRow,
  validateForm,
  type FormState,
  type MaterialFormRow,
} from "@/lib/activity/activityForm";
import { CampIcon } from "../ui/icons";
import { StockDot } from "../materials/StockDot";
import { FloatingLayer } from "../floating/FloatingLayer";
import { MiniSeg, RatingDots } from "../ui/primitives";
import { ThemeField, type ThemeKit } from "../library/ThemeField";
import {
  RUN_CHILD_TYPES,
  runPillLabel,
  type RunBlockType,
  type RunChildType,
  type RunIcon,
} from "@/lib/activity/runList";
import { type ParsedEmbed } from "@/lib/activity/embed";

export const DETAIL_ANIM_MS = 170;

type IconCmp = FC<{ className?: string }>;

export const TYPE_ICON: Record<string, IconCmp> = {
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
export const RUN_ICON_CMP: Record<RunIcon, IconCmp> = {
  note: CampIcon.Note,
  safety: CampIcon.Shield,
  tip: CampIcon.Variation,
  bell: CampIcon.Bell,
  star: CampIcon.Star,
  flag: CampIcon.Flag,
};
export const RUN_ICON_LABEL: Record<RunIcon, string> = {
  note: "Note",
  safety: "Safety",
  tip: "Tip",
  bell: "Reminder",
  star: "Star",
  flag: "Flag",
};

// Blocks you can append from the "Add a block" palette (top level).
export const ADD_BLOCKS: { type: RunBlockType; label: string; icon: IconCmp }[] = [
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
export const ATTACH_BLOCKS = RUN_CHILD_TYPES.filter((type) => type !== "materials" && type !== "fieldnote");

// "Jun 23 · 2:05 PM" from a local "YYYY-MM-DDTHH:mm" (or just "Jun 23" from a
// legacy date-only stamp) — parsed by hand so the chip never drifts a day across
// timezones (no Date() reparse of the stored string).
const STAMP_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function formatStamp(at: string | undefined): string {
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

export type RailSegment = {
  id: string;
  x: number;
  y1: number;
  y2: number;
};

export const topRailKey = (id: string) => "top:" + id;
export const childRailKey = (parentId: string, id: string) => "child:" + parentId + ":" + id;

export function dropPosition(e: DragEvent<HTMLElement>): "before" | "after" {
  const rect = e.currentTarget.getBoundingClientRect();
  return e.clientY < rect.top + rect.height / 2 ? "before" : "after";
}

// ----------------------------------------------------------------------------
// Inline contentEditable cell. Commits on blur; only rewrites the DOM when the
// value changes from the outside (never mid-keystroke). Escape restores the
// pre-edit value instead of committing; Enter/Backspace hooks let step rows
// split and join like a text document.
// ----------------------------------------------------------------------------
export function Editable({
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

export function Pill({ type, n }: { type: RunChildType; n: number }) {
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
export function RunEmbed({ parsed, title }: { parsed: ParsedEmbed; title?: string }) {
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

export function DetailFormControls({ form, onFormChange, themeKit, ageUnit, onAgeUnit }: DetailFormProps) {
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
