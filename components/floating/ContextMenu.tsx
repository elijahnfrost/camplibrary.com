"use client";

import { useRef, type ReactNode } from "react";
import { FloatingLayer } from "./FloatingLayer";
import { CampIcon } from "../icons";

export type ContextMenuItem = {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Render a hairline separator BEFORE this item. */
  separatorBefore?: boolean;
  /** When set, the item is a radio choice (part of a mutually-exclusive
   *  group like Have/Low/Out) rather than a one-shot command: it renders
   *  role="menuitemradio" + aria-checked, and the current choice gets a
   *  trailing check glyph so the selection reads without relying on color
   *  alone. Leave undefined for an ordinary command item. */
  selected?: boolean;
};

// A themed right-click menu. Opens at a cursor point via FloatingLayer, with
// arrow-key roving focus and Enter/Space activation. The danger variant (e.g.
// Delete) gets the warm-clay danger treatment from globals.css.
export function ContextMenu({
  point,
  items,
  ariaLabel,
  onClose,
}: {
  point: { x: number; y: number };
  items: ContextMenuItem[];
  ariaLabel: string;
  onClose: () => void;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);

  const enabledIndexes = items.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0);

  const focusItem = (index: number) => {
    const btn = listRef.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]')[index];
    btn?.focus({ preventScroll: true });
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End")
      return;
    event.preventDefault();
    const buttons = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not([aria-disabled="true"])') ?? []
    );
    if (!buttons.length) return;
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next = current;
    if (event.key === "ArrowDown") next = current < 0 ? 0 : (current + 1) % buttons.length;
    else if (event.key === "ArrowUp") next = current <= 0 ? buttons.length - 1 : current - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = buttons.length - 1;
    buttons[next]?.focus({ preventScroll: true });
  };

  return (
    <FloatingLayer
      anchor={{ kind: "point", x: point.x, y: point.y }}
      onClose={onClose}
      className="cmenu"
      role="menu"
      ariaLabel={ariaLabel}
    >
      <div ref={listRef} className="cmenu__list" onKeyDown={onKeyDown}>
        {items.map((item, i) => (
          <div key={item.label + i} role="presentation">
            {item.separatorBefore && <div className="cmenu__sep" role="separator" aria-hidden="true" />}
            <button
              type="button"
              role={item.selected === undefined ? "menuitem" : "menuitemradio"}
              aria-checked={item.selected === undefined ? undefined : item.selected}
              tabIndex={-1}
              className={
                "cmenu__item" +
                (item.danger ? " cmenu__item--danger" : "") +
                (item.selected ? " is-selected" : "")
              }
              aria-disabled={item.disabled || undefined}
              disabled={item.disabled}
              data-floating-first={enabledIndexes[0] === i || undefined}
              onClick={() => {
                if (item.disabled) return;
                onClose();
                item.onSelect();
              }}
            >
              {item.icon && <span className="cmenu__icon" aria-hidden="true">{item.icon}</span>}
              <span className="cmenu__label">{item.label}</span>
              {item.selected && (
                <span className="cmenu__sel" aria-hidden="true">
                  <CampIcon.Check />
                </span>
              )}
            </button>
          </div>
        ))}
      </div>
    </FloatingLayer>
  );
}
