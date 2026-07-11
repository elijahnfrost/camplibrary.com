"use client";

// The bloom dot — THE stock control, everywhere stock is shown (the Kit
// editor's rows, the run sheet's material chips, the calendar's Gather
// popover). Picked from the Stock Lab drafts (concept 1): a row RESTS as pure
// status — one colored dot, no visible controls — and tapping the dot blooms
// the three explicit choices in place; picking one folds it back to a single
// dot. Never a cycle (the choice is always named), and never a floating
// layer — the bloom is inline DOM, so it can live inside the Gather popover
// (itself a FloatingLayer, which can't nest another) and inside modals
// without any layer-contract gymnastics.
//
// Escape follows the app's capture-phase handshake (see FloatingLayer.tsx):
// the handler runs in the capture phase and preventDefault()s, so an open
// bloom swallows the Escape that would otherwise close the modal/popover
// above it. Outside pointerdown folds the bloom without claiming the event.

import { useEffect, useRef, useState } from "react";
import type { StockState } from "@/lib/materials/kitStock";
import { CampIcon } from "../ui/icons";

const OPTIONS: { id: StockState; word: string; Icon: (typeof CampIcon)[keyof typeof CampIcon] }[] = [
  { id: "have", word: "Have", Icon: CampIcon.Check },
  { id: "low", word: "Low", Icon: CampIcon.Minus },
  { id: "out", word: "Out", Icon: CampIcon.Close },
];

/** What the resting dot shows. "via" is the run sheet's covered-by-substitute
 *  face (green ↔) — the item itself may be unmarked, so the bloom highlights
 *  `current` (the item's OWN state), not the displayed face. */
export type StockDotDisplay = StockState | "via" | undefined;

export function StockDot({
  name,
  display,
  current,
  onSet,
  disabled,
}: {
  /** The material's human name — carried into every aria-label. */
  name: string;
  /** The resting face (usually the same as `current`; the run sheet passes
   *  its effective display state, e.g. "via" or the implied "out"). */
  display: StockDotDisplay;
  /** The item's own recorded state — the bloomed option left un-dimmed. */
  current: StockState | undefined;
  onSet: (state: StockState) => void;
  /** Read-only sessions get the status face with no bloom. */
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const dotRef = useRef<HTMLButtonElement | null>(null);
  // Re-focus the resting dot after a keyboard close, but not after a pick by
  // pointer (yanking focus around on tap feels broken on touch).
  const refocus = useRef(false);

  useEffect(() => {
    if (!open) {
      if (refocus.current) {
        refocus.current = false;
        dotRef.current?.focus({ preventScroll: true });
      }
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== "Escape") return;
      event.preventDefault();
      refocus.current = true;
      setOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown);
    // Focus lands on the current choice (or the first option), so keyboard
    // users arrive where they left off and Enter twice is a no-op.
    const frame = requestAnimationFrame(() => {
      rootRef.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  const word =
    display === "via"
      ? "covered by a substitute"
      : display === "have"
        ? "have"
        : display === "low"
          ? "low"
          : display === "out"
            ? "out"
            : "unmarked";

  if (open && !disabled) {
    return (
      <span className="stockdot stockdot--bloom" ref={rootRef} role="group" aria-label={name + " stock"}>
        {OPTIONS.map(({ id, word: optWord, Icon }, index) => (
          <button
            key={id}
            type="button"
            className={
              "stockdot__opt stockdot__opt--" + id + (current && current !== id ? " is-dim" : "")
            }
            data-autofocus={current ? current === id || undefined : index === 0 || undefined}
            title={optWord}
            aria-label={name + ": mark " + optWord.toLowerCase()}
            aria-pressed={current === id}
            onClick={() => {
              onSet(id);
              setOpen(false);
            }}
          >
            <Icon />
          </button>
        ))}
      </span>
    );
  }

  return (
    <span className="stockdot" ref={rootRef}>
      <button
        ref={dotRef}
        type="button"
        className={"stockdot__dot" + (display ? " is-" + (display === "via" ? "via" : display) : "")}
        disabled={disabled}
        aria-label={name + ": " + word + (disabled ? "" : ". Change stock")}
        aria-haspopup="true"
        aria-expanded={false}
        onClick={() => setOpen(true)}
      >
        {(display === "have" || display === "via") && (display === "via" ? <CampIcon.Repeat /> : <CampIcon.Check />)}
        {display === "low" && <CampIcon.Minus />}
        {display === "out" && <CampIcon.Close />}
      </button>
    </span>
  );
}
