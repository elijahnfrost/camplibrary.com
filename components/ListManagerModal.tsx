"use client";

import { useState } from "react";
import { CampIcon } from "./icons";
import { Modal } from "./Modal";
import { Select } from "./floating/Select";
import { ColorSwatchField } from "./floating/ColorField";

// A clean management screen for a user-definable list (camps, themes, locations).
// Create at the top, then a list of rows — switch (camps), rename, delete, and
// (camps only) edit per-camp viewing hours. One surface so each feature gets the
// same clear, discoverable "screen" instead of a cramped inline dropdown.

export type ManagedItem = {
  id: string;
  label: string;
  tint?: string;
  /** The explicit color override for this item, or undefined when it inherits
   *  its default. With onChangeTint + tintFallback, the row's swatch becomes a
   *  color PICKER seeded from this value (locations). */
  tintValue?: string;
  /** The inherited default color, shown by the picker when no override is set
   *  and used as its "reset to default" target. */
  tintFallback?: string;
  /** Camps carry per-camp viewing hours; present both to render the Open–Close
   *  editor on this row. Themes leave them undefined and get no hours sub-row. */
  openMin?: number;
  closeMin?: number;
};

export function ListManagerModal({
  title,
  intro,
  items,
  activeId,
  createPlaceholder = "Name",
  createLabel = "Add",
  emptyHint,
  onCreate,
  onRename,
  onDelete,
  onChangeTint,
  onSelect,
  hourOptions,
  onChangeHours,
  onClose,
}: {
  title: string;
  intro?: string;
  items: ManagedItem[];
  /** When set with onSelect, the matching row reads as the active selection. */
  activeId?: string | null;
  createPlaceholder?: string;
  createLabel?: string;
  emptyHint?: string;
  onCreate: (label: string) => void;
  onRename: (id: string, label: string) => void;
  onDelete: (item: ManagedItem) => void;
  /** When set (with each item's tintValue/tintFallback), every row's swatch is a
   *  color PICKER — pick a color or reset to the default (locations). Passing
   *  undefined clears the override. Omit for read-only swatches (themes). */
  onChangeTint?: (id: string, color: string | undefined) => void;
  /** Provide to make rows selectable (the camp switcher); omit for themes. */
  onSelect?: (id: string) => void;
  /** 15-min clock options for the per-camp hours editor. With onChangeHours and
   *  an item's openMin/closeMin, the row shows an Open–Close editor. */
  hourOptions?: { value: number; label: string }[];
  onChangeHours?: (id: string, field: "open" | "close", value: number) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  function create() {
    const name = draft.trim();
    if (!name) return;
    onCreate(name);
    setDraft("");
  }

  function commitRename(id: string) {
    const name = editDraft.trim();
    if (name) onRename(id, name);
    setEditingId(null);
  }

  // The leading color chip for a row. With onChangeTint (+ the item's fallback)
  // it's an interactive picker; otherwise it's a static swatch. `interactive`
  // is forced off where the chip would sit inside a <button> (the selectable
  // camp row) — a button can't nest a button.
  function renderSwatch(item: ManagedItem, interactive: boolean) {
    if (interactive && onChangeTint && item.tintFallback) {
      return (
        <ColorSwatchField
          value={item.tintValue}
          fallback={item.tintFallback}
          onChange={(color) => onChangeTint(item.id, color)}
          ariaLabel={"Color for " + item.label}
        />
      );
    }
    if (item.tint) {
      return <span className="manager__swatch" style={{ background: item.tint }} aria-hidden="true" />;
    }
    return null;
  }

  return (
    <Modal label={title} onClose={onClose} overlayProps={{ className: "overlay--card overlay--manager" }}>
      <div className="overlay__bar">
        <h2 className="manager__title">{title}</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
          <CampIcon.Close />
        </button>
      </div>
      <div className="overlay__body manager">
        {intro && <p className="manager__intro">{intro}</p>}

        <form
          className="manager__create"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <input
            className="input manager__createinput"
            value={draft}
            autoFocus
            placeholder={createPlaceholder}
            aria-label={createPlaceholder}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit" className="btn btn--primary manager__createbtn" disabled={!draft.trim()}>
            <CampIcon.Plus />
            {createLabel}
          </button>
        </form>

        {items.length === 0 ? (
          <p className="manager__empty">{emptyHint}</p>
        ) : (
          <ul className="manager__list">
            {items.map((item) =>
              editingId === item.id ? (
                <li key={item.id} className="manager__row">
                  <form
                    className="manager__rowedit"
                    onSubmit={(e) => {
                      e.preventDefault();
                      commitRename(item.id);
                    }}
                  >
                    {renderSwatch(item, true)}
                    {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
                    <input
                      className="input manager__editinput"
                      value={editDraft}
                      autoFocus
                      aria-label={"Rename " + item.label}
                      onChange={(e) => setEditDraft(e.target.value)}
                      onBlur={() => commitRename(item.id)}
                    />
                    <button type="submit" className="icon-btn manager__rowbtn" aria-label="Save name">
                      <CampIcon.Check />
                    </button>
                  </form>
                </li>
              ) : (
                <li
                  key={item.id}
                  className={"manager__row" + (onSelect && item.id === activeId ? " is-active" : "")}
                >
                  <div className="manager__rowmain">
                    {onSelect ? (
                      <button
                        type="button"
                        className="manager__pick"
                        aria-current={item.id === activeId ? "true" : undefined}
                        onClick={() => onSelect(item.id)}
                      >
                        {renderSwatch(item, false)}
                        <span className="manager__label">{item.label}</span>
                        {item.id === activeId && (
                          <span className="manager__active">
                            <CampIcon.Check />
                            Active
                          </span>
                        )}
                      </button>
                    ) : (
                      <span className="manager__pick manager__pick--static">
                        {renderSwatch(item, true)}
                        <span className="manager__label">{item.label}</span>
                      </span>
                    )}
                    <button
                      type="button"
                      className="icon-btn manager__rowbtn"
                      aria-label={"Rename " + item.label}
                      onClick={() => {
                        setEditingId(item.id);
                        setEditDraft(item.label);
                      }}
                    >
                      <CampIcon.Pencil />
                    </button>
                    <button
                      type="button"
                      className="icon-btn manager__rowbtn manager__rowbtn--danger"
                      aria-label={"Delete " + item.label}
                      onClick={() => onDelete(item)}
                    >
                      <CampIcon.Trash />
                    </button>
                  </div>
                  {hourOptions && onChangeHours && item.openMin != null && item.closeMin != null && (
                    <div className="manager__rowhours">
                      <div className="manager__hoursfield">
                        <span className="manager__hourslabel">Open</span>
                        <Select
                          value={item.openMin}
                          options={hourOptions}
                          onChange={(value) => onChangeHours(item.id, "open", value)}
                          ariaLabel={item.label + " opening time"}
                        />
                      </div>
                      <span className="manager__hoursdash" aria-hidden="true">
                        &ndash;
                      </span>
                      <div className="manager__hoursfield">
                        <span className="manager__hourslabel">Close</span>
                        <Select
                          value={item.closeMin}
                          options={hourOptions}
                          onChange={(value) => onChangeHours(item.id, "close", value)}
                          ariaLabel={item.label + " pickup time"}
                        />
                      </div>
                    </div>
                  )}
                </li>
              )
            )}
          </ul>
        )}
      </div>
    </Modal>
  );
}
