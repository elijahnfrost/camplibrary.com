"use client";

import { useState } from "react";
import { CampIcon } from "./icons";
import { Modal } from "./Modal";

// A clean management screen for a user-definable list (camps, themes). Create at
// the top, then a list of rows — switch (camps), rename, delete. One surface so
// both features get the same clear, discoverable "screen" instead of a cramped
// inline dropdown.

export type ManagedItem = { id: string; label: string; tint?: string };

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
  onSelect,
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
  /** Provide to make rows selectable (the camp switcher); omit for themes. */
  onSelect?: (id: string) => void;
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
                    {item.tint && (
                      <span className="manager__swatch" style={{ background: item.tint }} aria-hidden="true" />
                    )}
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
                  {onSelect ? (
                    <button
                      type="button"
                      className="manager__pick"
                      aria-current={item.id === activeId ? "true" : undefined}
                      onClick={() => onSelect(item.id)}
                    >
                      {item.tint && (
                        <span className="manager__swatch" style={{ background: item.tint }} aria-hidden="true" />
                      )}
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
                      {item.tint && (
                        <span className="manager__swatch" style={{ background: item.tint }} aria-hidden="true" />
                      )}
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
                </li>
              )
            )}
          </ul>
        )}
      </div>
    </Modal>
  );
}
