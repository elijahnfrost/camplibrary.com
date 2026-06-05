"use client";

import { useState } from "react";
import type { ApplyMode, DaySchedule, DayTemplate } from "@/lib/types";
import { DAYS } from "@/lib/data";
import { hasPlannedActivity } from "@/lib/scheduleValidation";
import { CampIcon } from "./icons";
import { useDialogFocus } from "./useDialogFocus";

const APPLY_MODES: { id: ApplyMode; label: string; hint: string }[] = [
  { id: "replace", label: "Replace each day", hint: "Clear the day, then stamp the template." },
  { id: "fill", label: "Only empty days", hint: "Skip days that already have an activity planned." },
  { id: "merge", label: "Add to existing", hint: "Keep what's there; add blocks that don't clash." },
];

export function ApplyTemplateSheet({
  template,
  dayIndex,
  weekBlocks,
  validActivityIds,
  onConfirm,
  onClose,
}: {
  template: DayTemplate;
  dayIndex: number;
  weekBlocks: Record<number, DaySchedule>;
  validActivityIds: Iterable<string>;
  onConfirm: (targetDays: number[], mode: ApplyMode) => void;
  onClose: () => void;
}) {
  const [days, setDays] = useState<number[]>(() => DAYS.map((_, index) => index));
  const [mode, setMode] = useState<ApplyMode>("replace");
  const dialogRef = useDialogFocus<HTMLDivElement>(onClose);

  const toggleDay = (index: number) =>
    setDays((current) =>
      current.includes(index)
        ? current.filter((item) => item !== index)
        : [...current, index].sort((a, b) => a - b)
    );

  const withPlans = days.filter((index) => hasPlannedActivity(weekBlocks[index] || [], validActivityIds)).length;
  const openInTemplate = template.blocks.filter(
    (block) => (block.fill === "open" || block.fill === "conditional") && !block.activityId
  ).length;
  const blockCount = template.blocks.length;
  const canConfirm = days.length > 0;

  return (
    <div
      ref={dialogRef}
      className="composer-scrim"
      role="dialog"
      aria-modal="true"
      aria-label={"Apply " + template.name}
      tabIndex={-1}
    >
      <div className="composer-backdrop" onClick={onClose} />
      <form
        className="composer fadein"
        onSubmit={(event) => {
          event.preventDefault();
          if (canConfirm) onConfirm(days, mode);
        }}
      >
        <header className="composer__head">
          <div>
            <span className="composer__kicker">Apply template</span>
            <h2 className="composer__title">{template.name}</h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <CampIcon.Close />
          </button>
        </header>

        <div className="field">
          <span className="field__label">Apply to</span>
          <div className="apply-days" role="group" aria-label="Target days">
            {DAYS.map((day, index) => (
              <button
                key={day}
                type="button"
                className={"apply-day" + (days.includes(index) ? " is-on" : "")}
                aria-pressed={days.includes(index)}
                onClick={() => toggleDay(index)}
              >
                {day.slice(0, 3)}
              </button>
            ))}
          </div>
          <div className="apply-presets">
            <button type="button" onClick={() => setDays(DAYS.map((_, index) => index))}>
              All week
            </button>
            <button type="button" onClick={() => setDays([dayIndex])}>
              This day only
            </button>
          </div>
        </div>

        <div className="field">
          <span className="field__label">If a day already has a plan</span>
          <div className="apply-modes" role="radiogroup" aria-label="Conflict handling">
            {APPLY_MODES.map((item) => (
              <label
                key={item.id}
                className={"apply-mode" + (mode === item.id ? " is-on" : "")}
                style={{ gridTemplateColumns: "auto 1fr", columnGap: 10, alignItems: "start" }}
              >
                <input
                  type="radio"
                  name="apply-template-mode"
                  value={item.id}
                  checked={mode === item.id}
                  onChange={() => setMode(item.id)}
                  style={{ margin: "2px 0 0" }}
                />
                <span style={{ display: "grid", gap: 2 }}>
                  <strong>{item.label}</strong>
                  <small>{item.hint}</small>
                </span>
              </label>
            ))}
          </div>
        </div>

        <p className="apply-preview">
          Stamps {blockCount} {blockCount === 1 ? "block" : "blocks"} onto {days.length}{" "}
          {days.length === 1 ? "day" : "days"}
          {openInTemplate ? " - leaves " + openInTemplate + " open to fill" : ""}
          {withPlans ? " - " + withPlans + " already " + (withPlans === 1 ? "has" : "have") + " an activity planned" : ""}.
        </p>

        <footer className="composer__foot">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={!canConfirm}>
            <CampIcon.Check />
            Apply to {days.length} {days.length === 1 ? "day" : "days"}
          </button>
        </footer>
      </form>
    </div>
  );
}
