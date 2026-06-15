"use client";

import { useRef, useState } from "react";
import { MAX_CAMP_NAME, type Camp } from "@/lib/camps";
import { CampIcon } from "../icons";
import { FloatingLayer } from "../floating/FloatingLayer";
import { ListManagerModal } from "../ListManagerModal";

// The calendar's camp control — a header pill sized to match the Today / view
// controls. With no camps it reads "Add camp"; once camps exist it shows the
// active one and opens a quick switcher: one click changes the calendar you're
// looking at, an inline field adds a camp, and "Manage camps…" opens the full
// editor (rename / delete). The library catalog is shared; only the schedule is
// per-camp. The dropdown rides the app's shared FloatingLayer engine, so it
// shares the same Escape / outside-click / scroll-dismiss / mobile-dock contract
// as every other menu — which is why the chevron now behaves like a chevron.

export function CampSwitcher({
  camps,
  activeCampId,
  onSwitch,
  onCreate,
  onRename,
  onDelete,
}: {
  camps: Camp[];
  activeCampId: string | null;
  onSwitch: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string, name: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const empty = camps.length === 0;
  const active = camps.find((c) => c.id === activeCampId) ?? null;

  function onTriggerClick() {
    // No camps yet → skip the (empty) switcher and go straight to the create
    // screen, which explains what a camp is. Otherwise toggle the switcher.
    if (empty) setManageOpen(true);
    else setMenuOpen((o) => !o);
  }

  function pick(id: string) {
    onSwitch(id);
    setMenuOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  }

  function openManage() {
    setMenuOpen(false);
    setManageOpen(true);
  }

  function submitNew(event: React.FormEvent) {
    event.preventDefault();
    const name = draft.trim();
    if (!name) return;
    onCreate(name); // parent gates on staff and auto-switches to the new camp
    setDraft("");
    setMenuOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  }

  // Roving arrow keys over the camp rows, matching the app's other menus. The
  // inline "new camp" field sits outside this list, so typing there is untouched.
  function onRowsKeyDown(event: React.KeyboardEvent) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const rows = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>(".campmenu__camp") ?? []
    );
    if (!rows.length) return;
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    let next = at;
    if (event.key === "ArrowDown") next = at < 0 ? 0 : (at + 1) % rows.length;
    else if (event.key === "ArrowUp") next = at <= 0 ? rows.length - 1 : at - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = rows.length - 1;
    rows[next]?.focus({ preventScroll: true });
  }

  return (
    <div className="campswitch">
      <button
        ref={triggerRef}
        type="button"
        className={
          "campswitch__trigger" + (empty ? " is-empty" : "") + (menuOpen ? " is-open" : "")
        }
        aria-haspopup={empty ? "dialog" : "menu"}
        aria-expanded={menuOpen}
        aria-label={empty ? "Add a camp" : "Switch camp — currently " + (active?.name ?? "")}
        onClick={onTriggerClick}
      >
        <CampIcon.Pin />
        <span className="campswitch__name">{empty ? "Add camp" : active?.name ?? "Camps"}</span>
        {empty ? <CampIcon.Plus /> : <CampIcon.ChevronDown />}
      </button>

      {menuOpen && triggerRef.current && (
        <FloatingLayer
          anchor={{ kind: "rect", rect: triggerRef.current.getBoundingClientRect() }}
          onClose={() => setMenuOpen(false)}
          className="campmenu"
          role="menu"
          ariaLabel="Switch camp"
        >
          <p className="campmenu__eyebrow">Switch camp</p>
          <div className="campmenu__list" role="none" ref={listRef} onKeyDown={onRowsKeyDown}>
            {camps.map((camp) => {
              const isActive = camp.id === activeCampId;
              return (
                <button
                  key={camp.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={isActive}
                  tabIndex={-1}
                  data-floating-first={isActive || undefined}
                  className={"campmenu__camp" + (isActive ? " is-on" : "")}
                  onClick={() => pick(camp.id)}
                >
                  <CampIcon.Pin />
                  <span className="campmenu__name">{camp.name}</span>
                  {isActive && <CampIcon.Check />}
                </button>
              );
            })}
          </div>

          <div className="campmenu__sep" role="separator" aria-hidden="true" />

          <form className="campmenu__new" onSubmit={submitNew}>
            <input
              className="input campmenu__newinput"
              value={draft}
              maxLength={MAX_CAMP_NAME}
              placeholder="New camp…"
              aria-label="New camp name"
              onChange={(e) => setDraft(e.target.value)}
            />
            <button
              type="submit"
              className="icon-btn campmenu__newbtn"
              disabled={!draft.trim()}
              aria-label="Add camp"
              title="Add camp"
            >
              <CampIcon.Plus />
            </button>
          </form>

          <div className="campmenu__sep" role="separator" aria-hidden="true" />

          <button type="button" role="menuitem" tabIndex={-1} className="campmenu__manage" onClick={openManage}>
            <CampIcon.Tool />
            <span>Manage camps…</span>
          </button>
        </FloatingLayer>
      )}

      {manageOpen && (
        <ListManagerModal
          title="Camps"
          intro="Each camp keeps its own schedule. Your activity library is shared across all of them."
          items={camps.map((c) => ({ id: c.id, label: c.name }))}
          activeId={activeCampId}
          createPlaceholder="e.g. Summer Day Camp"
          createLabel="Add camp"
          emptyHint="No camps yet. Add one to keep its schedule separate from the rest."
          onSelect={(id) => {
            onSwitch(id);
            setManageOpen(false);
          }}
          onCreate={onCreate}
          onRename={onRename}
          onDelete={(item) => onDelete(item.id, item.label)}
          onClose={() => setManageOpen(false)}
        />
      )}
    </div>
  );
}
