"use client";

// The Camps zone (desktop calendar rail) — a collapsible disclosure like the
// DISPLAY/WEATHER zones (one disclosure grammar per zone, no exceptions). The
// closed row stays legible: its summary echoes the ACTIVE camp's name, so
// "which camp am I on" never costs a click. Open, the roster keeps radio
// semantics — tint dot + name, whole-row hit target that switches; the ACTIVE
// row shows a ringed dot, an accent-weight name, AND an always-visible bordered
// "Edit" chip (the edit path is discoverable without hovering — never
// hover-only for the relevant row). Inactive rows reveal their chip on
// hover/focus-within. Below the list, a quiet "+ Add camp" row grows an inline
// name input.

import { useState, type CSSProperties } from "react";
import { campTint, type Camp } from "@/lib/content/camps";
import { CampIcon } from "./icons";
import { Disclosure } from "./Disclosure";

export type CampsRailProps = {
  camps: Camp[];
  activeCampId: string | null;
  onSwitch: (id: string) => void;
  /** Opens the per-camp editor popup for this camp. */
  onEditCamp: (id: string) => void;
  /** Creates a camp with this name (the host opens its popup on success). */
  onAddCamp: (name: string) => void;
};

export function CampsRail({ camps, activeCampId, onSwitch, onEditCamp, onAddCamp }: CampsRailProps) {
  const [adding, setAdding] = useState(false);
  const [draftName, setDraftName] = useState("");

  const commitAdd = () => {
    const name = draftName.trim();
    if (!name) return;
    onAddCamp(name);
    setDraftName("");
    setAdding(false);
  };

  const activeCamp = activeCampId != null ? camps.find((c) => c.id === activeCampId) ?? null : null;
  const summary = activeCamp ? activeCamp.name : camps.length ? "all camps" : "none yet";

  return (
    <Disclosure className="lc-zone lc-camps" title="Camps" summary={summary}>
      {camps.length ? (
        <ul className="lc-camps__list">
          {camps.map((camp) => {
            const active = camp.id === activeCampId;
            return (
              <li key={camp.id} className={"lc-camps__row" + (active ? " is-active" : "")}>
                <button
                  type="button"
                  className="lc-camps__pick"
                  onClick={() => onSwitch(camp.id)}
                  aria-pressed={active}
                >
                  <span
                    className="lc-camps__dot"
                    style={{ "--camp-tint": campTint(camp.id, camps) } as CSSProperties}
                    aria-hidden="true"
                  />
                  <span className="lc-camps__name">{camp.name}</span>
                </button>
                <button
                  type="button"
                  className="lc-camps__edit"
                  aria-label={"Edit " + camp.name}
                  title={"Edit " + camp.name}
                  onClick={() => onEditCamp(camp.id)}
                >
                  <CampIcon.Pencil />
                  <span className="lc-camps__editlabel">Edit</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="lc-camps__empty">No camps yet — everything shows on one shared calendar.</p>
      )}

      {adding ? (
        <form
          className="lc-camps__addform"
          onSubmit={(e) => {
            e.preventDefault();
            commitAdd();
          }}
        >
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <input
            className="input lc-camps__addinput"
            value={draftName}
            autoFocus
            placeholder="e.g. Summer Day Camp"
            aria-label="New camp name"
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              // Claim Escape (the app's convention) — but only if no floating
              // layer already consumed it in its capture phase.
              if (e.key === "Escape" && !e.defaultPrevented) {
                e.preventDefault();
                setAdding(false);
                setDraftName("");
              }
            }}
          />
          <button
            type="submit"
            className="icon-btn lc-camps__addok"
            aria-label="Create camp"
            title="Create camp"
            disabled={!draftName.trim()}
          >
            <CampIcon.Check />
          </button>
        </form>
      ) : (
        <button type="button" className="lc-camps__new" onClick={() => setAdding(true)}>
          <CampIcon.Plus />
          Add camp
        </button>
      )}
    </Disclosure>
  );
}
