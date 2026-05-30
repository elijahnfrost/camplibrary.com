"use client";

import { useState } from "react";
import type { Activity, AgeGroupId, CategoryId, Place, Prep } from "@/lib/types";
import { AGE_GROUPS, CATEGORIES, ratingColor, RATING_WORD } from "@/lib/data";
import { CampIcon } from "./icons";
import { ApprovalDots, Seg } from "./primitives";

type EnergyWord = "Calm" | "Lively" | "Rowdy";

interface FormState {
  title: string;
  type: CategoryId;
  place: Place;
  ages: AgeGroupId[];
  durationMin: string;
  groupMin: string;
  groupMax: string;
  energy: EnergyWord;
  prep: Prep;
  rating: number;
  blurb: string;
  materials: string;
  steps: string;
  notes: string;
  safety: string;
}

const ENERGY_MAP: Record<EnergyWord, number> = { Calm: 1, Lively: 2, Rowdy: 3 };

export function AddView({ onSubmit }: { onSubmit: (a: Activity) => void }) {
  const [f, setF] = useState<FormState>({
    title: "", type: "Game", place: "Outside", ages: ["g46"],
    durationMin: "20", groupMin: "", groupMax: "", energy: "Lively", prep: "Low", rating: 0,
    blurb: "", materials: "", steps: "", notes: "", safety: "",
  });

  const set =
    <K extends keyof FormState>(k: K) =>
    (v: FormState[K]) =>
      setF((p) => ({ ...p, [k]: v }));
  const onIn =
    (k: "title" | "durationMin" | "groupMin" | "groupMax" | "blurb" | "materials" | "steps" | "notes" | "safety") =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setF((p) => ({ ...p, [k]: e.target.value }));
  const toggleAge = (id: AgeGroupId) =>
    setF((p) => ({
      ...p,
      ages: p.ages.indexOf(id) >= 0 ? p.ages.filter((x) => x !== id) : [...p.ages, id],
    }));
  const valid = f.title.trim().length > 0;

  function submit() {
    if (!valid) return;
    const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
    const ages = f.ages.length ? f.ages : (["g46"] as AgeGroupId[]);
    const picked = AGE_GROUPS.filter((g) => ages.indexOf(g.id) >= 0);
    const a: Activity = {
      id:
        f.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") +
        "-" +
        Date.now().toString(36),
      title: f.title.trim(),
      type: f.type,
      place: f.place,
      ages,
      ageMin: Math.min(...picked.map((g) => g.min)),
      ageMax: Math.max(...picked.map((g) => g.max)),
      durationMin: parseInt(f.durationMin || "20", 10),
      groupMin: f.groupMin ? parseInt(f.groupMin, 10) : null,
      groupMax: f.groupMax ? parseInt(f.groupMax, 10) : null,
      energy: ENERGY_MAP[f.energy],
      prep: f.prep,
      rating: f.rating,
      blurb: f.blurb.trim() || "A new entry in the library.",
      materials: f.materials.split(",").map((x) => x.trim()).filter(Boolean),
      steps: lines(f.steps),
      notes: f.notes.trim() || "—",
      safety: f.safety.trim() || "—",
    };
    onSubmit(a);
  }

  return (
    <div className="form fadein">
      <div className="form__section">The basics</div>

      <div className="field">
        <label className="field__label">Name</label>
        <input className="input" placeholder="e.g. Giant Parachute" value={f.title} onChange={onIn("title")} />
      </div>
      <div className="field">
        <label className="field__label">Category</label>
        <select className="select" value={f.type} onChange={(e) => set("type")(e.target.value as CategoryId)}>
          {CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="field__label">Where</label>
        <Seg options={["Inside", "Outside", "Both"] as const} value={f.place} onChange={set("place")} />
      </div>
      <div className="field">
        <label className="field__label">
          Age groups <span className="field__hint">tap all that fit</span>
        </label>
        <div className="chiprow">
          {AGE_GROUPS.map((g) => (
            <button
              type="button"
              key={g.id}
              className={"chip chip--lg" + (f.ages.indexOf(g.id) >= 0 ? " is-on" : "")}
              onClick={() => toggleAge(g.id)}
            >
              {g.short}
            </button>
          ))}
        </div>
      </div>

      <div className="form__section">At a glance</div>

      <div className="row2">
        <div className="field">
          <label className="field__label">Minutes</label>
          <input className="input" inputMode="numeric" value={f.durationMin} onChange={onIn("durationMin")} />
        </div>
        <div className="field">
          <label className="field__label">Energy</label>
          <Seg options={["Calm", "Lively", "Rowdy"] as const} value={f.energy} onChange={set("energy")} />
        </div>
      </div>
      <div className="field">
        <label className="field__label">
          Group size <span className="field__hint">blank = any</span>
        </label>
        <div className="row2">
          <input className="input" inputMode="numeric" placeholder="min" value={f.groupMin} onChange={onIn("groupMin")} />
          <input className="input" inputMode="numeric" placeholder="max" value={f.groupMax} onChange={onIn("groupMax")} />
        </div>
      </div>
      <div className="field">
        <label className="field__label">Prep effort</label>
        <Seg options={["None", "Low", "Medium", "High"] as const} value={f.prep} onChange={set("prep")} />
      </div>
      <div className="field">
        <label className="field__label">
          Approval rating <span className="field__hint">leave at &ldquo;not run&rdquo; if it&rsquo;s untried</span>
        </label>
        <div className="approval approval--form">
          <div className="approval__row">
            <ApprovalDots rating={f.rating} />
            <span
              className="approval__word"
              style={{ color: f.rating ? ratingColor(f.rating) : "var(--ink-faint)" }}
            >
              {RATING_WORD[f.rating || 0]}
            </span>
            <span className="approval__num">{f.rating ? f.rating + "/5" : "Unrated"}</span>
          </div>
          <input
            className="rating-range"
            type="range"
            min="0"
            max="5"
            step="1"
            value={f.rating}
            onChange={(e) => set("rating")(parseInt(e.target.value, 10))}
            aria-label="Set approval rating"
          />
          <div className="approval__scale">
            <span>Not run</span>
            <span>Loved it</span>
          </div>
        </div>
      </div>

      <div className="form__section">The write-up</div>

      <div className="field">
        <label className="field__label">One-line description</label>
        <input className="input" placeholder="The hook, in a sentence." value={f.blurb} onChange={onIn("blurb")} />
      </div>
      <div className="field">
        <label className="field__label">
          Materials <span className="field__hint">comma-separated</span>
        </label>
        <input className="input" placeholder="flags, cones, pinnies" value={f.materials} onChange={onIn("materials")} />
      </div>
      <div className="field">
        <label className="field__label">
          How to play <span className="field__hint">one step per line</span>
        </label>
        <textarea
          className="textarea"
          placeholder={"Split into teams…\nPlace the flags…"}
          value={f.steps}
          onChange={onIn("steps")}
        />
      </div>
      <div className="field">
        <label className="field__label">Notes &amp; variations</label>
        <textarea className="textarea" style={{ minHeight: 64 }} value={f.notes} onChange={onIn("notes")} />
      </div>
      <div className="field">
        <label className="field__label">Safety</label>
        <textarea className="textarea" style={{ minHeight: 64 }} value={f.safety} onChange={onIn("safety")} />
      </div>
      <button type="button" className="btn btn--primary btn--block" disabled={!valid} onClick={submit}>
        <CampIcon.Plus />
        Add to library
      </button>
      <div style={{ height: 8 }} />
    </div>
  );
}
