"use client";

// Per-event location: a multi-select property picker. The staff pick one or more
// places where the block happens from a fixed set (gym, classroom, kitchen,
// playground, fields, baseball pitch). The trigger wears the app's `.select`
// look; the open menu reuses the `.typepick` floating-menu recipe (card surface,
// accent-tint selected rows) — but rows TOGGLE and the menu stays open, so
// several places can be chosen in one pass. An empty array means "no location
// set". Any already-saved value outside the fixed set rides along as an extra
// toggleable row, so older free-text locations aren't lost.
//
// The toggling list BODY is split out as LocationPickerList so the same UI can be
// hosted either off this field's trigger OR cursor-anchored from the calendar's
// bulk context menu (CalendarShell) — one picker, two entry points.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CampIcon } from "../icons";
import { FloatingLayer } from "./FloatingLayer";

// The roving, multi-toggle list of places. Shared by the trigger-based field and
// the cursor-anchored bulk picker so the two read identically. Self-focuses its
// list so keyboard roving works the instant it mounts.
export function LocationPickerList({
  value,
  options,
  onChange,
}: {
  value: string[];
  options: readonly string[];
  onChange: (value: string[]) => void;
}) {
  const [active, setActive] = useState(0);
  const typeahead = useRef<{ buffer: string; at: number }>({ buffer: "", at: 0 });

  const selected = useMemo(() => new Set(value), [value]);

  // The rows shown: the fixed places, plus any already-saved value that isn't one
  // of them (a legacy free-text location) so it stays visible and removable.
  const rows = useMemo(() => {
    const out = [...options];
    for (const place of value) if (!out.includes(place)) out.push(place);
    return out;
  }, [options, value]);

  // Toggle one place in/out, re-deriving the result in row order so the stored
  // array and the summary read consistently regardless of click order.
  function toggle(place: string) {
    const nextSet = new Set(selected);
    if (nextSet.has(place)) nextSet.delete(place);
    else nextSet.add(place);
    onChange(rows.filter((r) => nextSet.has(r)));
  }

  function onMenuKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((a) => (a + 1) % rows.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((a) => (a <= 0 ? rows.length - 1 : a - 1));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActive(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActive(rows.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      // Toggle the active row; the menu stays open so several can be picked.
      event.preventDefault();
      const place = rows[active];
      if (place) toggle(place);
    } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      // Type-ahead: jump to the first row whose label starts with the buffer.
      const now = Date.now();
      const ta = typeahead.current;
      ta.buffer = now - ta.at > 800 ? event.key : ta.buffer + event.key;
      ta.at = now;
      const needle = ta.buffer.toLowerCase();
      const start = ta.buffer.length === 1 ? (active + 1) % rows.length : 0;
      for (let i = 0; i < rows.length; i++) {
        const idx = (start + i) % rows.length;
        if (rows[idx].toLowerCase().startsWith(needle)) {
          setActive(idx);
          break;
        }
      }
    }
  }

  return (
    <div
      className="cselect__list"
      tabIndex={-1}
      data-floating-first
      ref={(node) => {
        // Keep keyboard focus on the list so roving works.
        node?.focus({ preventScroll: true });
      }}
      onKeyDown={onMenuKeyDown}
    >
      {rows.map((place, i) => (
        <LocationRow
          key={place}
          label={place}
          selected={selected.has(place)}
          active={i === active}
          onMouseEnter={() => setActive(i)}
          onClick={() => toggle(place)}
        />
      ))}
    </div>
  );
}

export function LocationField({
  id,
  value,
  options,
  onChange,
  ariaLabel,
}: {
  id?: string;
  /** The chosen places; empty when none is set. */
  value: string[];
  /** The fixed set of places offered. */
  options: readonly string[];
  /** Receives the next selection (kept in row order). */
  onChange: (value: string[]) => void;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const selected = useMemo(() => new Set(value), [value]);
  const rows = useMemo(() => {
    const out = [...options];
    for (const place of value) if (!out.includes(place)) out.push(place);
    return out;
  }, [options, value]);
  const summary = rows.filter((r) => selected.has(r)).join(", ");

  function onTriggerKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen(true);
    }
  }

  return (
    <div className="cselect">
      <button
        id={id}
        ref={triggerRef}
        type="button"
        className={"select cselect__trigger" + (open ? " is-open" : "")}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onTriggerKeyDown}
      >
        <span className={"cselect__value" + (summary ? "" : " is-empty")}>
          {summary || "Add location"}
        </span>
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
          <LocationPickerList value={value} options={options} onChange={onChange} />
        </FloatingLayer>
      )}
    </div>
  );
}

function LocationRow({
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
