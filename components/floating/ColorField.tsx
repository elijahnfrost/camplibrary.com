"use client";

// Per-item color picker, hosted in the floating-popover engine (like DatePopover
// / Select). A swatch trigger opens a popover with a quick-pick earthy palette,
// a custom hue/sat area (react-colorful — the battle-tested, ~2.8kB library) and
// a hex field, plus "Reset to tag color". value === undefined means "inherit the
// tag color"; the trigger shows that resolved fallback so it's never blank.
//
// The popover BODY is split out as ColorPickerBody so the same UI can be hosted
// either off this field's trigger OR cursor-anchored from the calendar's bulk
// context menu (CalendarShell) — one picker, two entry points.

import { useRef, useState } from "react";
import { HexColorInput, HexColorPicker } from "react-colorful";
import { normalizeHexColor } from "@/lib/content/color";
import { FloatingLayer } from "./FloatingLayer";

// The quick-pick palette — authored on the warm/earthy ladder (the five category
// tints plus lighter/darker earthy neighbours). A starting set; easy to tune.
const SWATCHES = [
  "#3f6b45", // pine (Game)
  "#5b8c5a", // sage
  "#85a45f", // olive
  "#357a6b", // teal-pine
  "#4d7a86", // river (Water)
  "#6b9aa6", // sky-slate
  "#4a4660", // dusk (Quiet)
  "#6a5d7a", // plum-dusk
  "#9a6b8c", // mauve
  "#b3603f", // terracotta (Craft)
  "#a8503a", // rust
  "#c4906f", // clay
  "#d99a3c", // amber (Song)
  "#e0b15a", // honey
  "#7a6a52", // bark
  "#8f8470", // taupe (the neutral default)
];

// The picker UI itself (swatches + hue/sat area + hex field + reset). Shared by
// the trigger-based ColorField popover and the cursor-anchored bulk picker so the
// two read identically. Owns only the live `draft` hue; the chosen value flows
// out through onCommit / onReset.
export function ColorPickerBody({
  value,
  fallback,
  onCommit,
  onReset,
}: {
  /** The chosen hex, or undefined to inherit the tag color. */
  value: string | undefined;
  /** The resolved tag color, shown when no explicit color is set. */
  fallback: string;
  /** A concrete hex was picked. */
  onCommit: (hex: string) => void;
  /** Clear the override ("reset to tag color"). */
  onReset: () => void;
}) {
  const current = normalizeHexColor(value);
  // react-colorful needs a concrete hex; seed from the override or the fallback.
  const [draft, setDraft] = useState(current ?? normalizeHexColor(fallback) ?? "#8f8470");

  function commit(hex: string) {
    const norm = normalizeHexColor(hex);
    if (!norm) return;
    setDraft(norm);
    onCommit(norm);
  }

  return (
    <>
      <div className="ccolor__swatches" role="group" aria-label="Quick colors">
        {SWATCHES.map((swatch, i) => (
          <button
            key={swatch}
            type="button"
            className={"ccolor__chip" + (current === swatch ? " is-on" : "")}
            style={{ background: swatch }}
            aria-label={"Color " + swatch}
            aria-pressed={current === swatch}
            onClick={() => commit(swatch)}
            data-floating-first={i === 0 ? "" : undefined}
          />
        ))}
      </div>
      <HexColorPicker color={draft} onChange={commit} className="ccolor__picker" />
      <div className="ccolor__row">
        <span className="ccolor__hash" aria-hidden="true">
          #
        </span>
        <HexColorInput
          color={draft}
          onChange={(hex) => commit("#" + hex)}
          className="input ccolor__hex"
          aria-label="Hex color value"
        />
        <button type="button" className="btn btn--ghost ccolor__reset" onClick={onReset}>
          Reset to tag
        </button>
      </div>
    </>
  );
}

export function ColorField({
  id,
  value,
  fallback,
  onChange,
  ariaLabel,
}: {
  id?: string;
  /** The chosen hex, or undefined to inherit the tag color. */
  value: string | undefined;
  /** The resolved tag color, shown when no explicit color is set. */
  fallback: string;
  /** undefined clears the override ("reset to tag color"). */
  onChange: (value: string | undefined) => void;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const current = normalizeHexColor(value);

  function reset() {
    onChange(undefined);
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  }

  return (
    <div className="ccolor">
      <button
        id={id}
        ref={triggerRef}
        type="button"
        className={"select cselect__trigger ccolor__trigger" + (open ? " is-open" : "")}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="ccolor__swatch" style={{ background: current ?? fallback }} aria-hidden="true" />
        <span className="cselect__value">{current ? current : "Tag color"}</span>
      </button>
      {open && triggerRef.current && (
        <FloatingLayer
          anchor={{ kind: "rect", rect: triggerRef.current.getBoundingClientRect() }}
          onClose={() => setOpen(false)}
          className="ccolor__pop"
          role="dialog"
          ariaLabel={ariaLabel}
        >
          <ColorPickerBody value={value} fallback={fallback} onCommit={onChange} onReset={reset} />
        </FloatingLayer>
      )}
    </div>
  );
}

// A compact, swatch-only entry point onto the SAME ColorPickerBody — for tight
// rows like the Locations manager where a full `.select`-styled trigger would be
// too wide. The colored square IS the trigger; it opens the identical popover
// (palette + hue/sat + hex + reset). value === undefined means "inherit the
// fallback color", which the swatch then shows so it's never blank.
export function ColorSwatchField({
  value,
  fallback,
  onChange,
  ariaLabel,
}: {
  /** The chosen hex, or undefined to inherit the fallback color. */
  value: string | undefined;
  /** The resolved default color, shown when no explicit color is set. */
  fallback: string;
  /** undefined clears the override ("reset to tag color"). */
  onChange: (value: string | undefined) => void;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const current = normalizeHexColor(value);

  function reset() {
    onChange(undefined);
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  }

  return (
    <span className="ccolor ccolor--swatch">
      <button
        ref={triggerRef}
        type="button"
        className={"ccolor__swatchbtn" + (open ? " is-open" : "")}
        style={{ background: current ?? fallback }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
      />
      {open && triggerRef.current && (
        <FloatingLayer
          anchor={{ kind: "rect", rect: triggerRef.current.getBoundingClientRect() }}
          onClose={() => setOpen(false)}
          className="ccolor__pop"
          role="dialog"
          ariaLabel={ariaLabel}
        >
          <ColorPickerBody value={value} fallback={fallback} onCommit={onChange} onReset={reset} />
        </FloatingLayer>
      )}
    </span>
  );
}
