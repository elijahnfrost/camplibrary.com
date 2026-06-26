"use client";

// The scalar "Activity card" controls — the SINGLE source of truth for every
// non-document property (title, blurb, also-known-as, category, theme, place,
// color, duration, energy, age groups, group size, prep effort, rating,
// materials). Extracted verbatim from the old AddView form so each property is
// set the same way it always was; the run-doc editor (ActivityRunList) hosts the
// document-shaped properties (steps/notes/safety/variations/diagrams/media)
// below. Rating — which the form never exposed — is added here so it too is
// editable at create AND edit. The Details/Materials FACTS are owned here, never
// hand-edited again as run-doc tags (that was the dual-write hazard).

import { type CSSProperties } from "react";
import type { AgeGroupId } from "@/lib/types";
import { AGE_GROUPS, bandShort, CATEGORIES, categoryTint, type AgeUnit } from "@/lib/data";
import { ColorField } from "./floating/ColorField";
import type { FormState } from "@/lib/activityForm";
import { validateForm } from "@/lib/activityForm";
import type { Theme } from "@/lib/themes";
import { MiniSeg, RatingDots, Seg } from "./primitives";
import { ThemeField } from "./ThemeField";

/** The theme vocabulary + quick-create, supplied by the library hook. Optional
 *  so the fields still render where themes aren't wired. Rename/delete live in
 *  the Themes manager, so the field stays a clean select + create. */
export interface ThemeKit {
  themes: Theme[];
  initialThemeId: string;
  onCreate: (label: string) => Theme | null;
}

export function ActivityFields({
  form,
  onChange,
  themeKit,
  ageUnit = "grades",
  onAgeUnit,
}: {
  form: FormState;
  onChange: (next: FormState) => void;
  themeKit?: ThemeKit;
  /** Grades⇄Ages caption unit + its toggle — relabels the age-group chips. */
  ageUnit?: AgeUnit;
  onAgeUnit?: (v: AgeUnit) => void;
}) {
  const f = form;
  const set =
    <K extends keyof FormState>(k: K) =>
    (v: FormState[K]) =>
      onChange({ ...f, [k]: v });
  const onIn =
    (k: "title" | "altNames" | "durationMin" | "groupMin" | "groupMax" | "blurb" | "materials") =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      onChange({ ...f, [k]: e.target.value });
  const toggleAge = (id: AgeGroupId) =>
    onChange({
      ...f,
      ages: f.ages.indexOf(id) >= 0 ? f.ages.filter((x) => x !== id) : [...f.ages, id],
    });

  const v = validateForm(f);

  return (
    <>
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
      <div className="field">
        <label className="field__label" htmlFor="activity-altnames">
          Also known as <span className="field__hint">comma-separated · searchable</span>
        </label>
        <input
          id="activity-altnames"
          className="input"
          placeholder="Octopus, Fishes and Sharks"
          value={f.altNames}
          onChange={onIn("altNames")}
        />
      </div>

      <div className="form__section">Details</div>
      <div className="form__grid">
        <div className="field form__wide">
          <span className="field__label" id="activity-category-label">Category</span>
          <div className="chiprow" role="radiogroup" aria-labelledby="activity-category-label">
            {CATEGORIES.map((c) => {
              const on = f.type === c.id;
              return (
                <button
                  type="button"
                  key={c.id}
                  role="radio"
                  aria-checked={on}
                  className={"chip chip--lg" + (on ? " is-on" : "")}
                  style={on ? ({ "--chip-on": categoryTint(c.id) } as CSSProperties) : undefined}
                  onClick={() => set("type")(c.id)}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
        </div>
        {themeKit && (
          <div className="field">
            <label className="field__label" htmlFor="activity-theme">
              Theme <span className="field__hint">optional</span>
            </label>
            <ThemeField
              id="activity-theme"
              value={f.themeId}
              themes={themeKit.themes}
              onChange={(themeId) => set("themeId")(themeId ?? "")}
              onCreate={themeKit.onCreate}
              ariaLabel="Activity theme"
            />
          </div>
        )}
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
          <label className="field__label" htmlFor="activity-color">
            Color <span className="field__hint">optional</span>
          </label>
          <ColorField
            id="activity-color"
            value={f.color || undefined}
            fallback={categoryTint(f.type)}
            onChange={(color) => set("color")(color ?? "")}
            ariaLabel="Activity color"
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
            aria-invalid={v.durationInvalid}
            aria-describedby={v.durationInvalid ? "activity-duration-error" : undefined}
          />
          {v.durationInvalid && (
            <span className="field__error" id="activity-duration-error" role="alert">
              {v.duration == null
                ? "Enter a positive whole number."
                : "Duration must fit inside the camp day."}
            </span>
          )}
        </div>
        <div className="field">
          <span className="field__label">Energy</span>
          <Seg options={["Calm", "Lively", "Rowdy"] as const} value={f.energy} onChange={set("energy")} ariaLabel="Energy" />
        </div>
        <div className="field form__wide">
          <div className="form__agehead">
            <span className="field__label" id="activity-ages-label">
              Age groups <span className="field__hint">tap all that fit</span>
            </span>
            {onAgeUnit && (
              <MiniSeg
                ariaLabel="Show ages as"
                value={ageUnit}
                onChange={(value) => onAgeUnit(value as AgeUnit)}
                options={[
                  { id: "grades", label: "Grades" },
                  { id: "ages", label: "Ages" },
                ]}
              />
            )}
          </div>
          <div className="chiprow" role="group" aria-labelledby="activity-ages-label">
            {AGE_GROUPS.map((g) => (
              <button
                type="button"
                key={g.id}
                className={"chip chip--lg" + (f.ages.indexOf(g.id) >= 0 ? " is-on" : "")}
                aria-pressed={f.ages.indexOf(g.id) >= 0}
                onClick={() => toggleAge(g.id)}
              >
                {bandShort(g, ageUnit)}
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
              aria-invalid={v.groupMinInvalid || v.groupRangeInvalid}
              aria-describedby={
                v.groupMinInvalid || v.groupRangeInvalid ? "activity-group-size-error" : undefined
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
              aria-invalid={v.groupMaxInvalid || v.groupRangeInvalid}
              aria-describedby={
                v.groupMaxInvalid || v.groupRangeInvalid ? "activity-group-size-error" : undefined
              }
            />
          </div>
          {(v.groupMinInvalid || v.groupMaxInvalid || v.groupRangeInvalid) && (
            <span className="field__error" id="activity-group-size-error" role="alert">
              {v.groupRangeInvalid ? "Minimum group size cannot exceed maximum." : "Group sizes must be positive whole numbers."}
            </span>
          )}
        </div>
        <div className="field">
          <span className="field__label">Prep effort</span>
          <Seg options={["None", "Low", "Medium", "High"] as const} value={f.prep} onChange={set("prep")} ariaLabel="Prep effort" />
        </div>
        <div className="field form__wide">
          <span className="field__label" id="activity-rating-label">
            Approval <span className="field__hint">your rating</span>
          </span>
          <div className="form__rating" role="group" aria-labelledby="activity-rating-label">
            <RatingDots value={f.rating} onChange={(value) => set("rating")(value)} />
          </div>
        </div>
      </div>

      <div className="form__section">Materials</div>
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
    </>
  );
}
