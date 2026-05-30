"use client";

import { useState } from "react";
import type { Activity } from "@/lib/types";
import { code, durLabel } from "@/lib/data";
import { matchesActivityFilters } from "@/lib/activityFilters";
import { CampIcon } from "./icons";
import { clickable } from "./primitives";
import { Modal } from "./Modal";
import { Filters, type AgeFilter, type CatFilter, type PlaceFilter } from "./Filters";

export function ActivityPicker({
  items,
  onPick,
  onClose,
  slotLabel,
}: {
  items: Activity[];
  onPick: (a: Activity) => void;
  onClose: () => void;
  slotLabel: string;
}) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<CatFilter>("All");
  const [place, setPlace] = useState<PlaceFilter>("All");
  const [age, setAge] = useState<AgeFilter>("All");

  const list = items
    .filter((a) => matchesActivityFilters(a, { cat, place, age, query: q }))
    .sort((a, b) => a.title.localeCompare(b.title));

  return (
    <Modal label="Choose an activity" onClose={onClose}>
      <div className="overlay__bar">
        <div className="overlay__handle" />
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
          <CampIcon.Close />
        </button>
        <div className="overlay__bar-spacer" />
      </div>
      <div className="picker__head">
        <div className="label" style={{ marginBottom: 6 }}>
          Add to {slotLabel}
        </div>
        <div className="picker__q">What goes here?</div>
      </div>
      <div style={{ padding: "10px 18px 0" }}>
        <div className="field">
          <input
            className="input"
            placeholder="Search the library…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>
      <Filters
        variant="bar"
        cat={cat}
        place={place}
        age={age}
        onCat={setCat}
        onPlace={setPlace}
        onAge={setAge}
      />
      <div className="overlay__body">
        <div className="catalog">
          {list.map((a) => (
            <div className="cat-row" key={a.id} aria-label={a.title} {...clickable(() => onPick(a))}>
              <div className="cat-code">{code(a)}</div>
              <div className="cat-main">
                <div className="cat-title">{a.title}</div>
                <div className="cat-stamps">
                  <span className="stamp">{a.type}</span>
                  <span className="stamp">{durLabel(a)}</span>
                  <span className="stamp">{a.place}</span>
                </div>
              </div>
              <button type="button" className="icon-btn" aria-label="Add">
                <CampIcon.Plus />
              </button>
            </div>
          ))}
          {!list.length && (
            <div className="empty">
              <div className="empty__mark">
                <CampIcon.Search />
              </div>
              <div className="empty__title">No matches</div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
