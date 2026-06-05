"use client";

import { useMemo, useState } from "react";
import type { Activity, AgeGroupId, CategoryId, Place, Prep } from "@/lib/types";
import { AGE_GROUPS, CATEGORIES } from "@/lib/data";
import { materialTagsFromMaterials } from "@/lib/materials";
import {
  buildRunDoc,
  cloneRunDoc,
  detailsBlock,
  detailsHeadingBlock,
  materialsBlock,
  playHeadingBlock,
  runId,
  type RunChild,
  type RunDoc,
} from "@/lib/runList";
import { TOTAL_MIN } from "@/lib/scheduleTime";
import { CampIcon } from "./icons";
import { RatingPicker, Seg } from "./primitives";
import { ActivityRunList } from "./ActivityRunList";

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
}

type ExtractedRunText = {
  steps: string[];
  notes: string;
  safety: string;
  playbook: Activity["playbook"];
};

const ENERGY_MAP: Record<EnergyWord, number> = { Calm: 1, Lively: 2, Rowdy: 3 };
const ENERGY_WORD: Record<number, EnergyWord> = { 1: "Calm", 2: "Lively", 3: "Rowdy" };
const DEFAULT_DURATION = 20;

const BLANK_FORM: FormState = {
  title: "",
  type: "Game",
  place: "Outside",
  ages: ["g46"],
  durationMin: "20",
  groupMin: "",
  groupMax: "",
  energy: "Lively",
  prep: "Low",
  rating: 0,
  blurb: "",
  materials: "",
};

function formFromActivity(a: Activity): FormState {
  return {
    title: a.title,
    type: a.type,
    place: a.place,
    ages: a.ages.length ? a.ages : ["g46"],
    durationMin: String(a.durationMin),
    groupMin: a.groupMin == null ? "" : String(a.groupMin),
    groupMax: a.groupMax == null ? "" : String(a.groupMax),
    energy: ENERGY_WORD[a.energy] ?? "Lively",
    prep: a.prep,
    rating: a.rating,
    blurb: a.blurb,
    materials: a.materials.join(", "),
  };
}

function parsePositiveInt(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseOptionalPositiveInt(value: string): number | null {
  return value.trim() ? parsePositiveInt(value) : null;
}

function lines(value: string): string[] {
  return value.split(",").map((x) => x.trim()).filter(Boolean);
}

function activityFromForm(f: FormState, id: string, extracted?: ExtractedRunText): Activity {
  const ages = f.ages.length ? f.ages : (["g46"] as AgeGroupId[]);
  const picked = AGE_GROUPS.filter((g) => ages.indexOf(g.id) >= 0);
  const duration = Math.min(parsePositiveInt(f.durationMin) || DEFAULT_DURATION, TOTAL_MIN);
  const materials = lines(f.materials);

  return {
    id,
    title: f.title.trim() || "Untitled activity",
    type: f.type,
    place: f.place,
    ages,
    ageMin: Math.min(...picked.map((g) => g.min)),
    ageMax: Math.max(...picked.map((g) => g.max)),
    durationMin: duration,
    groupMin: parseOptionalPositiveInt(f.groupMin),
    groupMax: parseOptionalPositiveInt(f.groupMax),
    energy: ENERGY_MAP[f.energy],
    prep: f.prep,
    rating: f.rating,
    blurb: f.blurb.trim() || "A new entry in the library.",
    materials,
    materialTags: materialTagsFromMaterials(materials),
    steps: extracted?.steps || [],
    notes: extracted?.notes || "—",
    safety: extracted?.safety || "—",
    playbook: extracted?.playbook,
  };
}

function starterRunDoc(activity: Activity): RunDoc {
  return {
    blocks: [
      detailsHeadingBlock(activity),
      detailsBlock(activity),
      materialsBlock(activity.id),
      playHeadingBlock(activity),
      { id: runId("b"), type: "step", text: "", collapsed: false, children: [] },
    ],
  };
}

function childText(child: RunChild): string {
  if (child.type === "video") return [child.title, child.url].filter(Boolean).join(" ");
  return child.text || "";
}

function prepareRunDoc(doc: RunDoc, activityId: string, title: string): RunDoc {
  return {
    blocks: doc.blocks.map((block) => ({
      ...block,
      id: block.type === "details" ? activityId + "-details" : block.id,
      tags: block.type === "details" ? undefined : block.tags,
      children: (block.children || []).map((child) =>
        child.type === "diagram" && child.diagram
          ? { ...child, diagram: { ...child.diagram, activityId, title } }
          : { ...child }
      ),
    })),
  };
}

function extractRunText(doc: RunDoc): ExtractedRunText {
  const steps: string[] = [];
  const notes: string[] = [];
  const safety: string[] = [];
  let playbook: Activity["playbook"];

  const collectChild = (child: RunChild) => {
    const text = childText(child).trim();
    if (child.type === "substep" && text) steps.push(text);
    if ((child.type === "note" || child.type === "variation" || child.type === "video") && text) notes.push(text);
    if (child.type === "safety" && text) safety.push(text);
    if (child.type === "diagram" && child.diagram && !playbook) playbook = child.diagram;
  };

  doc.blocks.forEach((block) => {
    const text = (block.text || "").trim();
    if (block.type === "step" && text) steps.push(text);
    if ((block.type === "note" || block.type === "variation") && text) notes.push(text);
    if (block.type === "safety" && text) safety.push(text);
    (block.children || []).forEach(collectChild);
  });

  return {
    steps,
    notes: notes.join("\n") || "—",
    safety: safety.join("\n") || "—",
    playbook,
  };
}

export function AddView({
  onSubmit,
  initial,
  initialRunDoc,
  onCancelEdit,
}: {
  onSubmit: (a: Activity, runDoc?: RunDoc) => void;
  initial?: Activity | null;
  initialRunDoc?: RunDoc | null;
  onCancelEdit?: () => void;
}) {
  const isEdit = Boolean(initial);
  const initialForm = useMemo(() => (initial ? formFromActivity(initial) : BLANK_FORM), [initial]);
  const [f, setF] = useState<FormState>(() => initialForm);
  const [runDoc, setRunDoc] = useState<RunDoc>(() => {
    if (initialRunDoc) return cloneRunDoc(initialRunDoc);
    if (initial) return buildRunDoc(initial, initial.playbook ?? null);
    return starterRunDoc(activityFromForm(initialForm, "draft-activity"));
  });

  const set =
    <K extends keyof FormState>(k: K) =>
    (v: FormState[K]) =>
      setF((p) => ({ ...p, [k]: v }));
  const onIn =
    (k: "title" | "durationMin" | "groupMin" | "groupMax" | "blurb" | "materials") =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setF((p) => ({ ...p, [k]: e.target.value }));
  const toggleAge = (id: AgeGroupId) =>
    setF((p) => ({
      ...p,
      ages: p.ages.indexOf(id) >= 0 ? p.ages.filter((x) => x !== id) : [...p.ages, id],
    }));

  const duration = parsePositiveInt(f.durationMin);
  const durationInvalid = duration == null || duration > TOTAL_MIN;
  const groupMin = parseOptionalPositiveInt(f.groupMin);
  const groupMax = parseOptionalPositiveInt(f.groupMax);
  const groupMinInvalid = f.groupMin.trim().length > 0 && groupMin == null;
  const groupMaxInvalid = f.groupMax.trim().length > 0 && groupMax == null;
  const groupRangeInvalid = groupMin != null && groupMax != null && groupMin > groupMax;
  const valid =
    f.title.trim().length > 0 &&
    !durationInvalid &&
    !groupMinInvalid &&
    !groupMaxInvalid &&
    !groupRangeInvalid;
  const draftActivity = activityFromForm(f, initial?.id || "draft-activity", extractRunText(runDoc));

  function submit() {
    if (!valid) return;
    const slug = f.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const id = initial ? initial.id : (slug || "custom-activity") + "-" + Date.now().toString(36);
    const preparedDoc = prepareRunDoc(runDoc, id, f.title.trim());
    const extracted = extractRunText(preparedDoc);
    onSubmit(activityFromForm(f, id, extracted), preparedDoc);
  }

  return (
    <div className="form fadein">
      {isEdit && (
        <div className="form__editbar">
          <span>Editing “{initial?.title}”</span>
          <button type="button" className="btn btn--ghost" onClick={onCancelEdit}>
            Cancel
          </button>
        </div>
      )}

      <div className="form__section">Activity card</div>
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
        <label className="field__label" htmlFor="activity-blurb">One-line description</label>
        <input
          id="activity-blurb"
          className="input"
          placeholder="The hook, in a sentence."
          value={f.blurb}
          onChange={onIn("blurb")}
        />
      </div>

      <div className="form__section">Run document</div>
      <div className="form__runlist">
        <ActivityRunList
          doc={runDoc}
          editable
          onChange={setRunDoc}
          activity={draftActivity}
          availableMaterials={[]}
          onToggleMaterial={() => {}}
          detailsEditor={
            <div className="rl-detailform__grid">
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
                <label className="field__label" htmlFor="activity-duration">Minutes</label>
                <input
                  id="activity-duration"
                  className="input"
                  inputMode="numeric"
                  value={f.durationMin}
                  onChange={onIn("durationMin")}
                  aria-invalid={durationInvalid}
                  aria-describedby={durationInvalid ? "activity-duration-error" : undefined}
                />
                {durationInvalid && (
                  <span className="field__error" id="activity-duration-error" role="alert">
                    {duration == null
                      ? "Enter a positive whole number."
                      : "Duration must fit inside the camp day."}
                  </span>
                )}
              </div>
              <div className="field">
                <span className="field__label">Energy</span>
                <Seg options={["Calm", "Lively", "Rowdy"] as const} value={f.energy} onChange={set("energy")} ariaLabel="Energy" />
              </div>
              <div className="field rl-detailform__wide">
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
                    aria-describedby={
                      groupMinInvalid || groupRangeInvalid ? "activity-group-size-error" : undefined
                    }
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
                    aria-describedby={
                      groupMaxInvalid || groupRangeInvalid ? "activity-group-size-error" : undefined
                    }
                  />
                </div>
                {(groupMinInvalid || groupMaxInvalid || groupRangeInvalid) && (
                  <span className="field__error" id="activity-group-size-error" role="alert">
                    {groupRangeInvalid ? "Minimum group size cannot exceed maximum." : "Group sizes must be positive whole numbers."}
                  </span>
                )}
              </div>
              <div className="field">
                <span className="field__label">Prep effort</span>
                <Seg options={["None", "Low", "Medium", "High"] as const} value={f.prep} onChange={set("prep")} ariaLabel="Prep effort" />
              </div>
              <div className="field rl-detailform__wide">
                <span className="field__label">
                  Approval rating <span className="field__hint">reset to &ldquo;not run&rdquo; if it&rsquo;s untried</span>
                </span>
                <RatingPicker value={f.rating} onChange={set("rating")} />
              </div>
            </div>
          }
          materialsEditor={
            <div className="field">
              <label className="field__label" htmlFor="activity-materials">
                Kit list <span className="field__hint">comma-separated</span>
              </label>
              <input
                id="activity-materials"
                className="input"
                placeholder="flags, cones, pinnies"
                value={f.materials}
                onChange={onIn("materials")}
              />
            </div>
          }
        />
      </div>

      <button type="button" className="btn btn--primary btn--block" disabled={!valid} onClick={submit}>
        {isEdit ? <CampIcon.Check /> : <CampIcon.Plus />}
        {isEdit ? "Save changes" : "Add to library"}
      </button>
      <div style={{ height: 8 }} />
    </div>
  );
}
