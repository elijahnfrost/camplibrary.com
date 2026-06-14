"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { CampIcon } from "../icons";
import { FloatingLayer } from "./FloatingLayer";

export type SelectOption<V> = { value: V; label: string };

// A custom, themed replacement for a native <select>. The trigger wears the
// app's `.select` look; the open menu reuses the `.typepick` floating-menu
// recipe (card surface, ink border, accent-tint selected row). Keyboard:
// Up/Down move the active row, Home/End jump, Enter/Space commit, type-ahead
// jumps to a label prefix — the native <select> contract, themed.
export function Select<V extends string | number>({
  id,
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: {
  id?: string;
  value: V;
  options: SelectOption<V>[];
  onChange: (value: V) => void;
  ariaLabel: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const typeahead = useRef<{ buffer: string; at: number }>({ buffer: "", at: 0 });

  const selectedIndex = Math.max(0, options.findIndex((o) => o.value === value));
  const current = options[selectedIndex] ?? options[0];

  function openMenu() {
    setActive(selectedIndex);
    setOpen(true);
  }

  function commit(index: number) {
    const opt = options[index];
    if (opt) onChange(opt.value);
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  }

  function onTriggerKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openMenu();
    }
  }

  function onMenuKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((a) => (a + 1) % options.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((a) => (a <= 0 ? options.length - 1 : a - 1));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActive(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActive(options.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      commit(active);
    } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      // Type-ahead: accumulate keys pressed in quick succession, jump to the
      // first matching label. A repeated single key cycles same-prefix rows.
      const now = Date.now();
      const ta = typeahead.current;
      ta.buffer = now - ta.at > 800 ? event.key : ta.buffer + event.key;
      ta.at = now;
      const needle = ta.buffer.toLowerCase();
      const start = ta.buffer.length === 1 ? (active + 1) % options.length : 0;
      for (let i = 0; i < options.length; i++) {
        const idx = (start + i) % options.length;
        if (options[idx].label.toLowerCase().startsWith(needle)) {
          setActive(idx);
          break;
        }
      }
    }
  }

  return (
    <div className={"cselect" + (className ? " " + className : "")}>
      <button
        id={id}
        ref={triggerRef}
        type="button"
        className={"select cselect__trigger" + (open ? " is-open" : "")}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="cselect__value">{current?.label}</span>
        <CampIcon.ChevronDown />
      </button>
      {open && triggerRef.current && (
        <FloatingLayer
          anchor={{ kind: "rect", rect: triggerRef.current.getBoundingClientRect(), matchWidth: true }}
          onClose={() => setOpen(false)}
          className="typepick__menu cselect__menu"
          role="listbox"
          ariaLabel={ariaLabel}
          initialFocus={false}
        >
          <div
            className="cselect__list"
            tabIndex={-1}
            data-floating-first
            ref={(node) => {
              // Keep keyboard focus on the list so roving works; scroll the
              // active row into view as it moves.
              node?.focus({ preventScroll: true });
            }}
            onKeyDown={onMenuKeyDown}
          >
            {options.map((opt, i) => (
              <SelectRow
                key={String(opt.value)}
                label={opt.label}
                selected={opt.value === value}
                active={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => commit(i)}
              />
            ))}
          </div>
        </FloatingLayer>
      )}
    </div>
  );
}

function SelectRow({
  label,
  selected,
  active,
  onMouseEnter,
  onClick,
}: {
  label: string;
  selected: boolean;
  active: boolean;
  onMouseEnter: () => void;
  onClick: () => void;
}): ReactNode {
  const ref = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);
  return (
    <button
      ref={ref}
      type="button"
      role="option"
      tabIndex={-1}
      aria-selected={selected}
      className={"typepick__option cselect__option" + (selected ? " is-on" : "") + (active ? " is-active" : "")}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
    >
      <span className="cselect__optlabel">{label}</span>
      {selected && <CampIcon.Check />}
    </button>
  );
}
