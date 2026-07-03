"use client";

import { useRef, useState } from "react";
import type { Theme } from "@/lib/themes";
import { CampIcon } from "./icons";
import { FloatingLayer } from "./floating/FloatingLayer";

// The activity editor's theme control: pick the activity's theme, or coin a new
// one inline while assigning. Renaming/deleting the vocabulary lives in the
// Themes manager (ListManagerModal), so this stays a clean select + create.

/** The theme vocabulary + quick-create, supplied by the library hook. Optional
 *  so the inline theme control still renders where themes aren't wired. Rename/
 *  delete live in the Themes manager, so the field stays a clean select + create. */
export interface ThemeKit {
  themes: Theme[];
  initialThemeId: string;
  onCreate: (label: string) => Theme | null;
  /** Opens the Themes manager — surfaced as the picker's "Manage themes…"
   *  footer (the one sanctioned path to vocabulary management), matching the
   *  Library sidebar's theme picker. Absent = the footer doesn't render. */
  onManage?: () => void;
}

export function ThemeField({
  id,
  value,
  themes,
  onChange,
  onCreate,
  onManage,
  ariaLabel = "Theme",
}: {
  id?: string;
  /** The assigned themeId, or "" for none. */
  value: string;
  themes: Theme[];
  onChange: (themeId: string | null) => void;
  onCreate: (label: string) => Theme | null;
  onManage?: () => void;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createDraft, setCreateDraft] = useState("");
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const current = themes.find((t) => t.id === value) ?? null;

  function close() {
    setOpen(false);
    setCreating(false);
    setCreateDraft("");
  }

  function select(themeId: string | null) {
    onChange(themeId);
    close();
  }

  function commitCreate() {
    const created = onCreate(createDraft);
    if (created) select(created.id);
    else {
      setCreating(false);
      setCreateDraft("");
    }
  }

  return (
    <div className={"themefield typepick" + (open ? " is-open" : "")}>
      <button
        id={id}
        ref={triggerRef}
        type="button"
        className="typepick__trigger themefield__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span className="themefield__value">
          {current ? (
            <>
              <span className="themefield__swatch" style={{ background: current.tint }} aria-hidden="true" />
              {current.label}
            </>
          ) : (
            <span className="themefield__none">No theme</span>
          )}
        </span>
        <CampIcon.ChevronDown />
      </button>

      {open && triggerRef.current && (
        <FloatingLayer
          anchor={{ kind: "rect", rect: triggerRef.current.getBoundingClientRect() }}
          onClose={close}
          className="typepick__menu themefield__menu"
          role="menu"
          ariaLabel="Choose theme"
        >
          <button
            type="button"
            role="menuitemradio"
            aria-checked={!value}
            className={"typepick__option themefield__pick" + (!value ? " is-on" : "")}
            onClick={() => select(null)}
          >
            <span className="themefield__swatch themefield__swatch--none" aria-hidden="true" />
            <span className="themefield__picklabel">No theme</span>
          </button>

          {themes.map((theme) => (
            <button
              type="button"
              key={theme.id}
              role="menuitemradio"
              aria-checked={value === theme.id}
              className={"typepick__option themefield__pick" + (value === theme.id ? " is-on" : "")}
              onClick={() => select(theme.id)}
            >
              <span
                className="themefield__swatch"
                style={{ background: theme.tint }}
                aria-hidden="true"
              />
              <span className="themefield__picklabel">{theme.label}</span>
            </button>
          ))}

          <span className="themefield__div" role="separator" aria-hidden="true" />

          {creating ? (
            <form
              className="themefield__row themefield__row--edit"
              onSubmit={(e) => {
                e.preventDefault();
                commitCreate();
              }}
            >
              <span className="themefield__swatch themefield__swatch--new" aria-hidden="true">
                <CampIcon.Plus />
              </span>
              {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
              <input
                className="input themefield__input"
                value={createDraft}
                autoFocus
                placeholder="e.g. Ocean Week"
                aria-label="New theme name"
                onChange={(e) => setCreateDraft(e.target.value)}
              />
              <button
                type="submit"
                className="themefield__rowbtn"
                aria-label="Create theme"
                disabled={!createDraft.trim()}
              >
                <CampIcon.Check />
              </button>
            </form>
          ) : (
            <button
              type="button"
              role="menuitem"
              className="typepick__option themefield__new"
              onClick={() => {
                setCreating(true);
                setCreateDraft("");
              }}
            >
              <span className="themefield__swatch themefield__swatch--new" aria-hidden="true">
                <CampIcon.Plus />
              </span>
              <span className="themefield__picklabel">New theme…</span>
            </button>
          )}
          {/* Rename/delete live in the Themes manager; this footer is the one
              sanctioned path there (same affordance as the Library sidebar's
              theme picker). */}
          {onManage && (
            <button
              type="button"
              role="menuitem"
              className="typepick__option typepick__manage"
              onClick={() => {
                close();
                onManage();
              }}
            >
              <span className="typepick__swatch typepick__swatch--manage" aria-hidden="true">
                <CampIcon.Pencil />
              </span>
              Manage themes…
            </button>
          )}
        </FloatingLayer>
      )}
    </div>
  );
}
