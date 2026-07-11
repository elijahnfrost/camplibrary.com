"use client";

// ============================================================
// Camp Library — Run List controls & shared meta
//
// The presentational sub-components and shared metadata for "The Run List"
// (ActivityRunList): the inline Editable cell, summary Pill, embed player,
// materials checklist, the ledger / age / group pickers, and the details +
// materials editors — plus the icon maps, block palettes, and rail / stamp
// helpers they share with the shell. Extracted verbatim from ActivityRunList.tsx
// (structural cleanup, no behavior change).
// ============================================================
import { useRef, useState } from "react";
import type { AgeGroupId } from "@/lib/types";
import { AGE_GROUPS, bandShort, CATEGORIES, categoryTint, type AgeUnit } from "@/lib/content/data";
import { MAX_ACTIVITY_DURATION_MIN, validateForm, type FormState } from "@/lib/activity/activityForm";
import { CampIcon } from "../ui/icons";
import { FloatingLayer } from "../floating/FloatingLayer";
import { MiniSeg, RatingDots } from "../ui/primitives";
import { ThemeField, type ThemeKit } from "../library/ThemeField";


// ----------------------------------------------------------------------------
// The Details block, in EDIT mode — the activity's scalar facts edited inline as
// structured dropdowns on the run sheet (no separate form above it). Each fact
// is a ledger row (small-caps label left, a compact control right) bound to the
// same FormState the old AddView form drove, so save derives the Activity
// unchanged. STRUCTURED controls (Seg / Select-style menus / chip menu / number
// stepper) — never free text — so a value can't be typed that breaks downstream.
// ----------------------------------------------------------------------------
type DetailFormProps = {
  form: FormState;
  onFormChange: (next: FormState) => void;
  themeKit?: ThemeKit;
  ageUnit?: AgeUnit;
  onAgeUnit?: (v: AgeUnit) => void;
};

// A label-only inline menu picker bound to the run sheet (mirrors the sidebar
// MenuPicker, but hosted in the FloatingLayer so it shares the Escape/scrim
// contract). Used for Type / duration where a long option list beats segments.
// Exported so other ledger-anatomy editors (e.g. DetailSheet's Backup plans
// reason picker) share the exact same `.typepick` pill, not a lookalike copy.
export function LedgerMenu<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  swatch,
}: {
  value: T;
  options: { id: T; label: string; tint?: string }[];
  onChange: (v: T) => void;
  ariaLabel: string;
  swatch?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const current = options.find((o) => o.id === value) ?? options[0];
  return (
    <div className={"typepick rldetail__pick" + (open ? " is-open" : "")}>
      <button
        ref={triggerRef}
        type="button"
        className="typepick__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
      >
        {swatch && (
          <span
            className="typepick__swatch"
            style={current?.tint ? { background: current.tint } : undefined}
            aria-hidden="true"
          />
        )}
        {current?.label}
        <CampIcon.ChevronDown />
      </button>
      {open && triggerRef.current && (
        <FloatingLayer
          anchor={{ kind: "rect", rect: triggerRef.current.getBoundingClientRect(), matchWidth: true }}
          onClose={() => setOpen(false)}
          className="typepick__menu rldetail__menu"
          role="listbox"
          ariaLabel={ariaLabel}
        >
          {options.map((o) => (
            <button
              type="button"
              key={o.id}
              role="option"
              aria-selected={o.id === value}
              className={"typepick__option" + (o.id === value ? " is-on" : "")}
              data-floating-first={o.id === value ? "" : undefined}
              onClick={() => {
                onChange(o.id);
                setOpen(false);
              }}
            >
              {swatch && (
                <span
                  className="typepick__swatch"
                  style={o.tint ? { background: o.tint } : undefined}
                  aria-hidden="true"
                />
              )}
              {o.label}
            </button>
          ))}
        </FloatingLayer>
      )}
    </div>
  );
}

// The multi-select age-group picker — a popover of toggle chips (ages is a list,
// unlike the single-value sidebar AgePicker). The trigger summarizes the picks.
function AgeGroupsMenu({
  ages,
  onToggle,
  ageUnit = "grades",
  onAgeUnit,
}: {
  ages: AgeGroupId[];
  onToggle: (id: AgeGroupId) => void;
  ageUnit?: AgeUnit;
  onAgeUnit?: (v: AgeUnit) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const picked = AGE_GROUPS.filter((g) => ages.indexOf(g.id) >= 0);
  const summary = picked.length
    ? picked.map((g) => bandShort(g, ageUnit)).join(", ")
    : "Any age";
  return (
    <div className={"typepick rldetail__pick" + (open ? " is-open" : "")}>
      <button
        ref={triggerRef}
        type="button"
        className="typepick__trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Age groups"
        onClick={() => setOpen((o) => !o)}
      >
        {summary}
        <CampIcon.ChevronDown />
      </button>
      {open && triggerRef.current && (
        <FloatingLayer
          anchor={{ kind: "rect", rect: triggerRef.current.getBoundingClientRect() }}
          onClose={() => setOpen(false)}
          className="typepick__menu rldetail__agemenu"
          role="dialog"
          ariaLabel="Age groups"
        >
          {onAgeUnit && (
            <div className="rldetail__ageunit">
              <MiniSeg
                ariaLabel="Show ages as"
                value={ageUnit}
                onChange={(value) => onAgeUnit(value as AgeUnit)}
                options={[
                  { id: "grades", label: "Grades" },
                  { id: "ages", label: "Ages" },
                ]}
              />
            </div>
          )}
          <div className="rldetail__agechips" role="group" aria-label="Age groups">
            {AGE_GROUPS.map((g, i) => {
              const on = ages.indexOf(g.id) >= 0;
              return (
                <button
                  type="button"
                  key={g.id}
                  className={"chip" + (on ? " is-on" : "")}
                  aria-pressed={on}
                  data-floating-first={i === 0 ? "" : undefined}
                  onClick={() => onToggle(g.id)}
                >
                  {bandShort(g, ageUnit)}
                </button>
              );
            })}
          </div>
        </FloatingLayer>
      )}
    </div>
  );
}

// The group-size min/max popover (two small inputs, "blank = any").
function GroupSizeMenu({
  groupMin,
  groupMax,
  onChange,
  invalid,
  rangeInvalid,
}: {
  groupMin: string;
  groupMax: string;
  onChange: (patch: { groupMin?: string; groupMax?: string }) => void;
  invalid: boolean;
  rangeInvalid: boolean;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const summary =
    !groupMin.trim() && !groupMax.trim()
      ? "Any size"
      : groupMax.trim()
        ? (groupMin.trim() || "1") + "–" + groupMax.trim()
        : groupMin.trim() + "+";
  return (
    <div className={"typepick rldetail__pick" + (open ? " is-open" : "")}>
      <button
        ref={triggerRef}
        type="button"
        className={"typepick__trigger" + (invalid || rangeInvalid ? " is-invalid" : "")}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Group size"
        onClick={() => setOpen((o) => !o)}
      >
        {summary} kids
        <CampIcon.ChevronDown />
      </button>
      {open && triggerRef.current && (
        <FloatingLayer
          anchor={{ kind: "rect", rect: triggerRef.current.getBoundingClientRect() }}
          onClose={() => setOpen(false)}
          className="typepick__menu rldetail__groupmenu"
          role="dialog"
          ariaLabel="Group size"
        >
          <div className="rldetail__grouprow">
            <label className="sr-only" htmlFor="rldetail-group-min">Minimum group size</label>
            <input
              id="rldetail-group-min"
              className="input rldetail__numin"
              inputMode="numeric"
              placeholder="min"
              value={groupMin}
              data-floating-first
              aria-invalid={invalid || rangeInvalid}
              onChange={(e) => onChange({ groupMin: e.target.value })}
            />
            <span className="rldetail__groupdash" aria-hidden="true">–</span>
            <label className="sr-only" htmlFor="rldetail-group-max">Maximum group size</label>
            <input
              id="rldetail-group-max"
              className="input rldetail__numin"
              inputMode="numeric"
              placeholder="max"
              value={groupMax}
              aria-invalid={invalid || rangeInvalid}
              onChange={(e) => onChange({ groupMax: e.target.value })}
            />
          </div>
          {(invalid || rangeInvalid) && (
            <span className="rldetail__grouperr" role="alert">
              {rangeInvalid ? "Min can't exceed max." : "Use positive whole numbers."}
            </span>
          )}
        </FloatingLayer>
      )}
    </div>
  );
}

export function DetailFormControls({ form, onFormChange, themeKit, ageUnit, onAgeUnit }: DetailFormProps) {
  const f = form;
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => onFormChange({ ...f, [k]: v });
  const v = validateForm(f);
  const toggleAge = (id: AgeGroupId) =>
    onFormChange({
      ...f,
      ages: f.ages.indexOf(id) >= 0 ? f.ages.filter((x) => x !== id) : [...f.ages, id],
    });

  return (
    <div className="ledger rldetail">
      <div className="ledger__row rldetail__row">
        <span className="ledger__label">Type</span>
        <LedgerMenu
          value={f.type}
          options={CATEGORIES.map((c) => ({ id: c.id, label: c.label, tint: categoryTint(c.id) }))}
          onChange={(id) => set("type", id)}
          ariaLabel="Category"
          swatch
        />
      </div>
      <div className="ledger__row rldetail__row">
        <span className="ledger__label">Where</span>
        <MiniSeg
          options={[
            { id: "Inside", label: "Inside" },
            { id: "Outside", label: "Outside" },
            { id: "Both", label: "Both" },
          ]}
          value={f.place}
          onChange={(value) => set("place", value)}
          ariaLabel="Where"
        />
      </div>
      <div className="ledger__row rldetail__row">
        <span className="ledger__label">Energy</span>
        <MiniSeg
          options={[
            { id: "Calm", label: "Calm" },
            { id: "Lively", label: "Lively" },
            { id: "Rowdy", label: "Rowdy" },
          ]}
          value={f.energy}
          onChange={(value) => set("energy", value)}
          ariaLabel="Energy"
        />
      </div>
      <div className="ledger__row rldetail__row">
        <span className="ledger__label">Prep</span>
        <MiniSeg
          options={[
            { id: "None", label: "None" },
            { id: "Low", label: "Low" },
            { id: "Medium", label: "Medium" },
            { id: "High", label: "High" },
          ]}
          value={f.prep}
          onChange={(value) => set("prep", value)}
          ariaLabel="Prep effort"
        />
      </div>
      <div className={"ledger__row rldetail__row rldetail__row--minutes" + (v.durationInvalid ? " is-invalid" : "")}>
        <span className="ledger__label">Minutes</span>
        <div className="rldetail__minutes">
          <input
            className="input rldetail__minin"
            inputMode="numeric"
            value={f.durationMin}
            aria-label="Minutes"
            aria-invalid={v.durationInvalid || undefined}
            onChange={(e) => set("durationMin", e.target.value)}
          />
          <span className="rldetail__minunit" aria-hidden="true">min</span>
        </div>
        {v.durationInvalid && (
          <span className="rldetail__grouperr rldetail__grouperr--minutes" role="alert">
            Enter a whole number of minutes, up to {MAX_ACTIVITY_DURATION_MIN}.
          </span>
        )}
      </div>
      <div className="ledger__row rldetail__row">
        <span className="ledger__label">Ages</span>
        <AgeGroupsMenu ages={f.ages} onToggle={toggleAge} ageUnit={ageUnit} onAgeUnit={onAgeUnit} />
      </div>
      <div className="ledger__row rldetail__row">
        <span className="ledger__label">Group size</span>
        <GroupSizeMenu
          groupMin={f.groupMin}
          groupMax={f.groupMax}
          onChange={(patch) => onFormChange({ ...f, ...patch })}
          invalid={v.groupMinInvalid || v.groupMaxInvalid}
          rangeInvalid={v.groupRangeInvalid}
        />
      </div>
      {themeKit && (
        <div className="ledger__row rldetail__row">
          <span className="ledger__label">Theme</span>
          <ThemeField
            value={f.themeId}
            themes={themeKit.themes}
            onChange={(themeId) => set("themeId", themeId ?? "")}
            onCreate={themeKit.onCreate}
            onManage={themeKit.onManage}
            ariaLabel="Activity theme"
          />
        </div>
      )}
      <div className="ledger__row rldetail__row rldetail__row--rating">
        <span className="ledger__label">Rating</span>
        <RatingDots value={f.rating} onChange={(value) => set("rating", value)} />
      </div>
    </div>
  );
}

