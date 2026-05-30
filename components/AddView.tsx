"use client";

import { useState } from "react";
import type { Activity, AgeGroupId, CategoryId, Place, Prep } from "@/lib/types";
import { AGE_GROUPS, CATEGORIES } from "@/lib/data";
import { CampIcon } from "./icons";
import { RatingPicker, Seg } from "./primitives";

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
const DEFAULT_DURATION = 20;

function parsePositiveInt(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseOptionalPositiveInt(value: string): number | null {
  return value.trim() ? parsePositiveInt(value) : null;
}

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
  const duration = parsePositiveInt(f.durationMin);
  const groupMin = parseOptionalPositiveInt(f.groupMin);
  const groupMax = parseOptionalPositiveInt(f.groupMax);
  const groupMinInvalid = f.groupMin.trim().length > 0 && groupMin == null;
  const groupMaxInvalid = f.groupMax.trim().length > 0 && groupMax == null;
  const groupRangeInvalid = groupMin != null && groupMax != null && groupMin > groupMax;
  const valid =
    f.title.trim().length > 0 &&
    duration != null &&
    !groupMinInvalid &&
    !groupMaxInvalid &&
    !groupRangeInvalid;

  function submit() {
    if (!valid) return;
    const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
    const ages = f.ages.length ? f.ages : (["g46"] as AgeGroupId[]);
    const picked = AGE_GROUPS.filter((g) => ages.indexOf(g.id) >= 0);
    const slug = f.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const a: Activity = {
      id: (slug || "custom-activity") + "-" + Date.now().toString(36),
      title: f.title.trim(),
      type: f.type,
      place: f.place,
      ages,
      ageMin: Math.min(...picked.map((g) => g.min)),
      ageMax: Math.max(...picked.map((g) => g.max)),
      durationMin: duration || DEFAULT_DURATION,
      groupMin,
      groupMax,
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
        <label className="field__label" htmlFor="activity-title">Name</label>
        <input
          id="activity-title"
          className="input"
          placeholder="e.g. Giant Parachute"
          value={f.title}
          onChange={onIn("title")}
          required
        />
      </div>
      <div className="field">
        <label className="field__label" htmlFor="activity-category">Category</label>
        <select
          id="activity-category"
          className="select"
          value={f.type}
          onChange={(e) => set("type")(e.target.value as CategoryId)}
        >
          {CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <span className="field__label" id="activity-place-label">Where</span>
        <Seg
          options={["Inside", "Outside", "Both"] as const}
          value={f.place}
          onChange={set("place")}
          ariaLabel="Where"
        />
      </div>
      <div className="field">
        <span className="field__label" id="activity-ages-label">
          Age groups <span className="field__hint">tap all that fit</span>
        </span>
        <div className="chiprow" role="group" aria-labelledby="activity-ages-label">
          {AGE_GROUPS.map((g) => (
            <button
              type="button"
              key={g.id}
              className={"chip chip--lg" + (f.ages.indexOf(g.id) >= 0 ? " is-on" : "")}
              aria-pressed={f.ages.indexOf(g.id) >= 0}
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
          <label className="field__label" htmlFor="activity-duration">Minutes</label>
          <input
            id="activity-duration"
            className="input"
            inputMode="numeric"
            value={f.durationMin}
            onChange={onIn("durationMin")}
            aria-invalid={duration == null}
            aria-describedby={duration == null ? "activity-duration-error" : undefined}
          />
          {duration == null && <span className="field__error" id="activity-duration-error">Enter a positive whole number.</span>}
        </div>
        <div className="field">
          <span className="field__label">Energy</span>
          <Seg options={["Calm", "Lively", "Rowdy"] as const} value={f.energy} onChange={set("energy")} ariaLabel="Energy" />
        </div>
      </div>
      <div className="field">
        <span className="field__label">
          Group size <span className="field__hint">blank = any</span>
        </span>
        <div className="row2">
          <label className="sr-only" htmlFor="activity-group-min">Minimum group size</label>
          <input
            id="activity-group-min"
            className="input"
            inputMode="numeric"
            placeholder="min"
            value={f.groupMin}
            onChange={onIn("groupMin")}
            aria-invalid={groupMinInvalid || groupRangeInvalid}
          />
          <label className="sr-only" htmlFor="activity-group-max">Maximum group size</label>
          <input
            id="activity-group-max"
            className="input"
            inputMode="numeric"
            placeholder="max"
            value={f.groupMax}
            onChange={onIn("groupMax")}
            aria-invalid={groupMaxInvalid || groupRangeInvalid}
          />
        </div>
        {(groupMinInvalid || groupMaxInvalid || groupRangeInvalid) && (
          <span className="field__error">
            {groupRangeInvalid ? "Minimum group size cannot exceed maximum." : "Group sizes must be positive whole numbers."}
          </span>
        )}
      </div>
      <div className="field">
        <span className="field__label">Prep effort</span>
        <Seg options={["None", "Low", "Medium", "High"] as const} value={f.prep} onChange={set("prep")} ariaLabel="Prep effort" />
      </div>
      <div className="field">
        <span className="field__label">
          Approval rating <span className="field__hint">reset to &ldquo;not run&rdquo; if it&rsquo;s untried</span>
        </span>
        <RatingPicker value={f.rating} onChange={set("rating")} />
      </div>

      <div className="form__section">The write-up</div>

      <div className="field">
        <label className="field__label" htmlFor="activity-blurb">One-line description</label>
        <input id="activity-blurb" className="input" placeholder="The hook, in a sentence." value={f.blurb} onChange={onIn("blurb")} />
      </div>
      <div className="field">
        <label className="field__label" htmlFor="activity-materials">
          Materials <span className="field__hint">comma-separated</span>
        </label>
        <input id="activity-materials" className="input" placeholder="flags, cones, pinnies" value={f.materials} onChange={onIn("materials")} />
      </div>
      <div className="field">
        <label className="field__label" htmlFor="activity-steps">
          How to play <span className="field__hint">one step per line</span>
        </label>
        <textarea
          id="activity-steps"
          className="textarea"
          placeholder={"Split into teams…\nPlace the flags…"}
          value={f.steps}
          onChange={onIn("steps")}
        />
      </div>
      <div className="field">
        <label className="field__label" htmlFor="activity-notes">Notes &amp; variations</label>
        <textarea id="activity-notes" className="textarea" style={{ minHeight: 64 }} value={f.notes} onChange={onIn("notes")} />
      </div>
      <div className="field">
        <label className="field__label" htmlFor="activity-safety">Safety</label>
        <textarea id="activity-safety" className="textarea" style={{ minHeight: 64 }} value={f.safety} onChange={onIn("safety")} />
      </div>
      <button type="button" className="btn btn--primary btn--block" disabled={!valid} onClick={submit}>
        <CampIcon.Plus />
        Add to library
      </button>
      <div style={{ height: 8 }} />
    </div>
  );
}
