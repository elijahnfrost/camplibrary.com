"use client";

import { useState } from "react";
import type { Activity, CategoryId } from "@/lib/types";
import { CATEGORIES, code, durLabel } from "@/lib/data";
import { CampIcon } from "./icons";
import { clickable } from "./primitives";
import { Modal } from "./Modal";

type CatFilter = "All" | CategoryId;
type PlaceFilter = "All" | "Inside" | "Outside";

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

  const list = items
    .filter((a) => {
      if (cat !== "All" && a.type !== cat) return false;
      if (place === "Inside" && !(a.place === "Inside" || a.place === "Both")) return false;
      if (place === "Outside" && !(a.place === "Outside" || a.place === "Both")) return false;
      const s = q.trim().toLowerCase();
      if (
        s &&
        !(a.title + " " + a.type + " " + a.place + " " + a.blurb + " " + a.materials.join(" "))
          .toLowerCase()
          .includes(s)
      )
        return false;
      return true;
    })
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
      <div className="filterbar" style={{ paddingTop: 10 }}>
        <button
          type="button"
          className={"chip" + (cat === "All" ? " is-on" : "")}
          onClick={() => setCat("All")}
        >
          All
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            className={"chip" + (cat === c.id ? " is-on" : "")}
            onClick={() => setCat((p) => (p === c.id ? "All" : c.id))}
          >
            {c.label}
          </button>
        ))}
        <span className="filterbar__div" />
        {(["Inside", "Outside"] as const).map((p) => (
          <button
            key={p}
            type="button"
            className={"chip" + (place === p ? " is-on" : "")}
            onClick={() => setPlace((cur) => (cur === p ? "All" : p))}
          >
            {p}
          </button>
        ))}
      </div>
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
