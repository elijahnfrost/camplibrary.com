"use client";

import { useRef, useState, type CSSProperties, type FC, type ReactNode } from "react";
import { AGE_GROUPS, bandLong, ratingColor, RATING_WORD, type AgeUnit } from "@/lib/data";
import type { Theme } from "@/lib/themes";
import { CampIcon } from "./icons";
import { FloatingLayer } from "./floating/FloatingLayer";

// ---- The "switch ledger" control family (desktop sidebar rails) ----
// Every filter dimension is ONE ledger line: small-caps label left, a compact
// control right. The pieces below are that family: AgePicker/ThemePicker/
// MenuPicker (a swatch + label trigger that opens an inline menu, via the
// shared SwatchPicker core), MiniSeg (a small segmented pill for 2–4 way
// choices), and ToggleSwitch (a true on/off switch). The mobile filter sheet
// keeps full chips — these controls are pointer-sized.

type SwatchOption = { id: string; label: string; tint?: string };
type IconCmp = FC<{ className?: string }>;

/** The shared swatch-menu core: one pill trigger showing the current option
 *  (with its color swatch), expanding an inline menu. `label` wraps it in a
 *  ledger row; without it the trigger stands alone (the calendar rail). The
 *  age-group AgePicker and the user-definable ThemePicker both render through
 *  this, so the two tag filters read identically. */
function SwatchPicker({
  value,
  onChange,
  options,
  label,
  icon: Icon,
  ariaLabel,
  manageLabel,
  onManage,
}: {
  value: string;
  onChange: (v: string) => void;
  options: SwatchOption[];
  label?: string;
  /** The axis glyph shown before the label (the property-row vocabulary). */
  icon?: IconCmp;
  ariaLabel: string;
  /** Optional footer action in the menu (e.g. "Manage themes…"). */
  manageLabel?: string;
  onManage?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const current = options.find((o) => o.id === value) ?? options[0];
  // Swatches only when a dimension actually carries color (Type, Theme). A
  // color-less dimension (Ages) renders label-only, so the menu isn't a column
  // of empty boxes.
  const showSwatch = options.some((o) => o.tint);
  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      className="typepick__trigger"
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-label={ariaLabel}
      onClick={() => setOpen((o) => !o)}
    >
      {showSwatch && (
        <span
          className="typepick__swatch"
          style={current?.tint ? { background: current.tint } : undefined}
          aria-hidden="true"
        />
      )}
      {current?.label}
      <CampIcon.ChevronDown />
    </button>
  );
  return (
    <div className={"typepick" + (open ? " is-open" : "")}>
      {label ? (
        <div className="ledger__row">
          <span className="ledger__label">
            {Icon && <Icon className="ledger__ic" />}
            {label}
          </span>
          {trigger}
        </div>
      ) : (
        trigger
      )}
      {open && triggerRef.current && (
        <FloatingLayer
          anchor={{ kind: "rect", rect: triggerRef.current.getBoundingClientRect(), matchWidth: true }}
          onClose={() => setOpen(false)}
          className="typepick__menu"
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
              onClick={() => {
                onChange(o.id);
                setOpen(false);
              }}
            >
              {showSwatch && (
                <span
                  className="typepick__swatch"
                  style={o.tint ? { background: o.tint } : undefined}
                  aria-hidden="true"
                />
              )}
              {o.label}
            </button>
          ))}
          {onManage && (
            <>
              <span className="typepick__div" role="separator" aria-hidden="true" />
              <button
                type="button"
                className="typepick__option typepick__manage"
                onClick={() => {
                  setOpen(false);
                  onManage();
                }}
              >
                <span className="typepick__swatch typepick__swatch--manage" aria-hidden="true">
                  <CampIcon.Pencil />
                </span>
                {manageLabel ?? "Manage…"}
              </button>
            </>
          )}
        </FloatingLayer>
      )}
    </div>
  );
}

/** The age-group selector — a label-only picker (no color swatches). Lives in
 *  the same menu family as the category swatch picker so the filter ledger reads consistently,
 *  and unlike the old MiniSeg it scales past 3–4 groups without cramping the
 *  narrow rail. Value is "All" or an AgeGroupId. */
export function AgePicker<T extends string>({
  value,
  onChange,
  label,
  icon,
  ariaLabel,
  unit = "grades",
}: {
  value: T;
  onChange: (v: T) => void;
  label?: string;
  icon?: IconCmp;
  ariaLabel: string;
  /** Caption unit: grade bands ("Grades 4–6") or plain ages ("9–12 yrs"). */
  unit?: AgeUnit;
}) {
  const options: SwatchOption[] = [
    { id: "All", label: "All ages" },
    ...AGE_GROUPS.map((g) => ({ id: g.id, label: bandLong(g, unit) })),
  ];
  return (
    <SwatchPicker
      value={value}
      onChange={(v) => onChange(v as T)}
      options={options}
      label={label}
      icon={icon}
      ariaLabel={ariaLabel}
    />
  );
}

/** The theme selector — the user-definable parallel to the category filter's
 *  swatch picker, fed the current theme vocabulary. Selection-only
 *  (create/rename live in the editor's ThemeField); value is "All" or a
 *  themeId. */
export function ThemePicker({
  value,
  onChange,
  themes,
  label,
  icon,
  ariaLabel,
  onManage,
}: {
  value: string;
  onChange: (v: string) => void;
  themes: Theme[];
  label?: string;
  icon?: IconCmp;
  ariaLabel: string;
  /** Adds a "Manage themes…" footer to the menu (the library filter rail). */
  onManage?: () => void;
}) {
  const options: SwatchOption[] = [
    { id: "All", label: "All themes" },
    ...themes.map((t) => ({ id: t.id, label: t.label, tint: t.tint })),
  ];
  return (
    <SwatchPicker
      value={value}
      onChange={onChange}
      options={options}
      label={label}
      icon={icon}
      ariaLabel={ariaLabel}
      manageLabel="Manage themes…"
      onManage={onManage}
    />
  );
}

/** A label-only inline menu picker — the Ages-filter shape generalized, for any
 *  single choice whose options are too long to sit as segments in the narrow rail
 *  (e.g. the Print tab's per-activity detail, timeline spacing, camp). Same
 *  trigger + floating menu as Type/Theme/Ages, so every rail picker reads as one
 *  family. Wraps itself in a ledger row when given a `label`. */
export function MenuPicker<T extends string>({
  value,
  onChange,
  options,
  label,
  icon,
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { id: T; label: string }[];
  label?: string;
  /** The axis glyph shown before the label (the property-row vocabulary). */
  icon?: IconCmp;
  ariaLabel: string;
}) {
  return (
    <SwatchPicker
      value={value}
      onChange={(v) => onChange(v as T)}
      options={options}
      label={label}
      icon={icon}
      ariaLabel={ariaLabel}
    />
  );
}

/** A theme tag — swatch + label, so it never relies on color alone. Renders
 *  nothing when the activity has no (resolvable) theme. */
export function ThemeBadge({ theme, className }: { theme: Theme | null; className?: string }) {
  if (!theme) return null;
  return (
    <span
      className={"theme-badge" + (className ? " " + className : "")}
      style={{ "--theme-tint": theme.tint } as CSSProperties}
    >
      <span className="theme-badge__swatch" aria-hidden="true" />
      <span className="theme-badge__label">{theme.label}</span>
    </span>
  );
}

/** A compact segmented pill for 2–4 way single choices (Where, Ages). Labels
 *  are display-short ("In"/"Out"); ariaLabel carries the full name. An
 *  optional per-option `icon` renders before the label — the Library
 *  toolbar's collection seg (Activities|Materials) and browse-view seg
 *  (Shelf|Deck|Catalog) both need an icon+label option, so this is the ONE
 *  shared segmented-control implementation for every single-choice pill in
 *  the app (radiogroup/radio semantics throughout — no bespoke ARIA per
 *  control). `variant="toolbar"` swaps the compact `.miniseg` shell for the
 *  toolbar's larger `.viewswitch` shell (same seg-slide thumb mechanism,
 *  bigger touch targets) — used ONLY by the two Library toolbar switches. */
export function MiniSeg<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  variant = "mini",
  className,
}: {
  options: { id: T; label: string; ariaLabel?: string; icon?: IconCmp }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
  variant?: "mini" | "toolbar";
  /** Extra class(es) appended after the variant's base shell class — e.g. the
   *  Library toolbar's collection seg adds `.collseg` on top of `.viewswitch`
   *  for its narrower desktop sizing. */
  className?: string;
}) {
  // --seg-n / --seg-i drive the sliding thumb (the ::before pill) so the green
  // selection glides between options instead of teleporting. -1 hides it.
  const activeIndex = options.findIndex((opt) => opt.id === value);
  const base = variant === "toolbar" ? "viewswitch seg-slide" : "miniseg seg-slide";
  return (
    <span
      className={className ? base + " " + className : base}
      role="radiogroup"
      aria-label={ariaLabel}
      style={{ "--seg-n": options.length, "--seg-i": activeIndex } as CSSProperties}
    >
      {options.map((opt) => {
        const on = value === opt.id;
        const Icon = opt.icon;
        return (
          <button
            type="button"
            key={opt.id}
            role="radio"
            aria-checked={on}
            aria-label={opt.ariaLabel}
            className={on ? "is-on" : undefined}
            onClick={() => {
              if (!on) onChange(opt.id);
            }}
          >
            {Icon && <Icon />}
            {opt.label}
          </button>
        );
      })}
    </span>
  );
}

/** A true on/off switch (Starred only). */
export function ToggleSwitch({
  on,
  onChange,
  ariaLabel,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel}
      className={"lswitch" + (on ? " is-on" : "")}
      onClick={() => onChange(!on)}
    >
      <span className="lswitch__knob" aria-hidden="true" />
    </button>
  );
}

/** A dual-handle range slider (min…max) for a numeric window like duration.
 *  Two native range inputs overlap; pointer-events are limited to each thumb
 *  (see .rangeslider__input in globals) so either handle stays grabbable. The
 *  filled segment and thumb positions are driven by the --lo/--hi percentages.
 *  The handles never cross — the low input is capped at the high value and
 *  vice-versa. */
export function RangeSlider({
  min,
  max,
  step = 1,
  value,
  onChange,
  ariaLabelMin,
  ariaLabelMax,
  format,
}: {
  min: number;
  max: number;
  step?: number;
  value: [number, number];
  onChange: (v: [number, number]) => void;
  ariaLabelMin: string;
  ariaLabelMax: string;
  /** Render a value as its accessible text (e.g. "30 min"). */
  format?: (v: number) => string;
}) {
  const span = Math.max(1, max - min);
  const [lo, hi] = value;
  const loPct = ((Math.min(lo, hi) - min) / span) * 100;
  const hiPct = ((Math.max(lo, hi) - min) / span) * 100;
  const fmt = (v: number) => (format ? format(v) : String(v));
  return (
    <span
      className="rangeslider"
      style={{ "--lo": loPct + "%", "--hi": hiPct + "%" } as CSSProperties}
    >
      <span className="rangeslider__track" aria-hidden="true" />
      <span className="rangeslider__fill" aria-hidden="true" />
      <input
        type="range"
        className="rangeslider__input rangeslider__input--lo"
        min={min}
        max={max}
        step={step}
        value={lo}
        aria-label={ariaLabelMin}
        aria-valuetext={fmt(lo)}
        onChange={(e) => onChange([Math.min(Number(e.target.value), hi), hi])}
      />
      <input
        type="range"
        className="rangeslider__input rangeslider__input--hi"
        min={min}
        max={max}
        step={step}
        value={hi}
        aria-label={ariaLabelMax}
        aria-valuetext={fmt(hi)}
        onChange={(e) => onChange([lo, Math.max(Number(e.target.value), lo)])}
      />
    </span>
  );
}

// Compact approval rating — five dots that fill with the warm rating colour,
// plus the rating word. Short enough to sit inline in the viewer header.
// Tap a filled dot again to clear.
export function RatingDots({
  value,
  onChange,
  label = "Approval rating",
}: {
  value: number;
  onChange: (value: number) => void;
  label?: string;
}) {
  const color = value ? ratingColor(value) : "var(--ink-faint)";
  return (
    <div className="ratingdots" role="group" aria-label={label}>
      <span className="ratingdots__dots">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            className={"ratingdots__dot" + (value >= n ? " is-on" : "")}
            aria-label={"Set approval " + n + " of 5"}
            aria-pressed={value === n}
            style={value >= n ? { background: color, borderColor: color } : undefined}
            onClick={() => onChange(n === value ? 0 : n)}
          />
        ))}
      </span>
      <span className="ratingdots__word" style={{ color }}>
        {RATING_WORD[value || 0]}
      </span>
    </div>
  );
}

// A bookmark drawn tall, so it reads as a ribbon hanging down from a top edge.
export function RibbonMark() {
  return (
    <svg className="ribbon-svg" viewBox="0 0 24 40" aria-hidden="true">
      <path d="M3 1H21V35L12 27L3 35Z" />
    </svg>
  );
}

// One save control, one cozy honey-gold treatment everywhere. Two form factors:
// an inline `chip` for list rows, and a `ribbon` that hangs over a card/hero
// top edge. Saved colour comes from --star-gold/--star-ink (no per-item hues).
export function SaveButton({
  on,
  onToggle,
  stop = true,
  variant = "chip",
}: {
  on: boolean;
  onToggle: () => void;
  stop?: boolean;
  variant?: "chip" | "ribbon";
}) {
  // The plant/pop save animation plays via a TRANSIENT class added on the toggle
  // — not on `.is-on` — so a saved card mounting (e.g. arriving in the library)
  // doesn't replay it. Removed after the animation so a re-save fires it again.
  const [justSaved, setJustSaved] = useState(false);
  return (
    <button
      type="button"
      className={"star star--" + variant + (on ? " is-on" : "") + (justSaved ? " is-justsaved" : "")}
      aria-label={on ? "Remove from saved" : "Save"}
      aria-pressed={on}
      onClick={(e) => {
        if (stop) e.stopPropagation();
        if (!on) {
          setJustSaved(true);
          window.setTimeout(() => setJustSaved(false), 480);
        }
        onToggle();
      }}
    >
      {variant === "ribbon" ? <RibbonMark /> : <CampIcon.Bookmark />}
    </button>
  );
}

export function EmptyResults() {
  return (
    <div className="empty">
      <div className="empty__mark">
        <CampIcon.Search />
      </div>
      <div className="empty__title">Nothing on this shelf</div>
      <div className="empty__sub">
        No activities match these filters. Loosen a tag or clear the search.
      </div>
    </div>
  );
}

// A calm, branded loading screen — three earthy bars that rise in a gentle wave
// (no spinners; the app speaks in pops and fades). Used both while the print
// preview paginates and while a heavier tab mounts. The wave is decorative and
// stilled under prefers-reduced-motion; the label carries the meaning for AT.
export function LoadingVeil({
  label = "Loading",
  sub,
  className,
  decorative = false,
}: {
  label?: string;
  sub?: string;
  className?: string;
  // Decorative veils (e.g. a 300ms tab transition) skip the live region so screen
  // readers aren't told "One moment…" on every navigation; the text stays visible.
  decorative?: boolean;
}) {
  const live = decorative
    ? ({ "aria-hidden": true } as const)
    : ({ role: "status", "aria-live": "polite" } as const);
  return (
    <div className={"loadveil" + (className ? " " + className : "")} {...live}>
      <div className="loadveil__mark" aria-hidden="true">
        <span className="loadveil__bar" />
        <span className="loadveil__bar" />
        <span className="loadveil__bar" />
      </div>
      <div className="loadveil__title">{label}</div>
      {sub && <div className="loadveil__sub">{sub}</div>}
    </div>
  );
}
