"use client";

import { useMemo, useState } from "react";
import type { Activity, ScheduleBlock } from "@/lib/types";
import type { RunDoc } from "@/lib/runList";
import { activityMeta, DAYS, ENERGY, groupLabel } from "@/lib/data";
import { blockEndMin, blockStartMin, formatClock, formatRange } from "@/lib/scheduleTime";
import { materialNeedsForActivity, type MaterialNeed } from "@/lib/materials";
import { CampIcon } from "./icons";
import { Block, EnergyMeter, Fact } from "./primitives";
import { ActivityRunList } from "./ActivityRunList";

export interface ClipboardRun {
  source: "auto" | "pinned";
  activity: Activity;
  dayIndex?: number;
  block?: ScheduleBlock;
}

export type ClipboardEmptyState =
  | { status: "loading" }
  | { status: "weekend"; minutes: number }
  | { status: "outside-hours"; dayIndex: number; minutes: number }
  | { status: "no-block"; dayIndex: number; minutes: number }
  | { status: "label"; dayIndex: number; minutes: number; block: ScheduleBlock }
  | { status: "open-slot"; dayIndex: number; minutes: number; block: ScheduleBlock }
  | {
      status: "missing-activity";
      activityId: string;
      pinned: boolean;
      dayIndex?: number;
      minutes?: number;
      block?: ScheduleBlock;
    };

export type ClipboardState =
  | { kind: "run"; run: ClipboardRun }
  | { kind: "empty"; empty: ClipboardEmptyState };

function pinLabel(run: ClipboardRun): string {
  return run.source === "pinned" ? "Pinned" : "Live now";
}

function runTimeLabel(run: ClipboardRun): string {
  if (!run.block) return "Manual pin";
  return formatRange(blockStartMin(run.block), blockEndMin(run.block));
}

function runDayLabel(run: ClipboardRun): string {
  return run.dayIndex == null ? "Activity" : DAYS[run.dayIndex];
}

function materialGroups(needs: MaterialNeed[], readyIds: string[]) {
  const ready = new Set(readyIds);
  const needed = needs.filter((need) => !ready.has(need.id));
  const packed = needs.filter((need) => ready.has(need.id));
  return { needed, packed };
}

function emptyTitle(empty: ClipboardEmptyState): string {
  switch (empty.status) {
    case "loading":
      return "Finding the current activity";
    case "weekend":
      return "No camp day is active";
    case "outside-hours":
      return "Outside camp hours";
    case "no-block":
      return "No activity is running";
    case "label":
      return empty.block.label;
    case "open-slot":
      return "Open activity slot";
    case "missing-activity":
      return empty.pinned ? "Pinned activity is missing" : "Scheduled activity is missing";
  }
}

function emptyDetail(empty: ClipboardEmptyState): string {
  switch (empty.status) {
    case "loading":
      return "Checking the local clock.";
    case "weekend":
      return "Clipboard follows the Monday-Friday camp schedule.";
    case "outside-hours":
      return "Current time: " + formatClock(empty.minutes) + ".";
    case "no-block":
      return "Current time: " + formatClock(empty.minutes) + " on " + DAYS[empty.dayIndex] + ".";
    case "label":
      return formatRange(blockStartMin(empty.block), blockEndMin(empty.block)) + " on " + DAYS[empty.dayIndex] + ".";
    case "open-slot":
      return formatRange(blockStartMin(empty.block), blockEndMin(empty.block)) + " on " + DAYS[empty.dayIndex] + ".";
    case "missing-activity":
      return "Activity ID: " + empty.activityId + ".";
  }
}

function MaterialSetup({
  activity,
  readyMaterialIds,
  onToggleMaterial,
  onClearMaterials,
}: {
  activity: Activity;
  readyMaterialIds: string[];
  onToggleMaterial: (id: string) => void;
  onClearMaterials: () => void;
}) {
  const [message, setMessage] = useState("");
  const needs = useMemo(() => materialNeedsForActivity(activity), [activity]);
  const { needed, packed } = materialGroups(needs, readyMaterialIds);
  const ready = new Set(readyMaterialIds);
  const ordered = [...needed, ...packed];

  async function copyNeededMaterials() {
    if (!needed.length) {
      setMessage("All materials are ready.");
      return;
    }
    const text = needed.map((need) => "- " + need.label).join("\n");
    const clipboard = navigator.clipboard;
    if (!clipboard?.writeText) {
      setMessage("Clipboard access is unavailable.");
      return;
    }
    try {
      await clipboard.writeText(text);
      setMessage("Copied " + needed.length + (needed.length === 1 ? " material." : " materials."));
    } catch {
      setMessage("Could not copy materials.");
    }
  }

  if (!needs.length) {
    return (
      <Block num="i" name="Materials">
        <span className="stamp">None needed</span>
      </Block>
    );
  }

  return (
    <Block num="i" name="Materials">
      <div className="clipboard-materials">
        <div className="clipboard-materials__bar">
          <span className="matkit__status">
            Need {needed.length} · Ready {packed.length}
          </span>
          <span className="clipboard-materials__actions">
            <button type="button" className="btn btn--quiet btn--sm" onClick={copyNeededMaterials}>
              <CampIcon.Card />
              Copy needed
            </button>
            {packed.length > 0 && (
              <button type="button" className="btn btn--quiet btn--sm" onClick={onClearMaterials}>
                Clear
              </button>
            )}
          </span>
        </div>
        <div className="matkit__list" role="group" aria-label={activity.title + " setup materials"}>
          {ordered.map((need, index) => {
            const isReady = ready.has(need.id);
            const showDivider = index === needed.length && needed.length > 0 && packed.length > 0;
            return (
              <div className="clipboard-materials__row" key={need.id}>
                {showDivider && <span className="matkit__div" role="separator" aria-hidden="true" />}
                <button
                  type="button"
                  className={"matkit__item" + (isReady ? " is-have" : "")}
                  onClick={() => onToggleMaterial(need.id)}
                  aria-pressed={isReady}
                  aria-label={(isReady ? "Ready" : "Needed") + ": " + need.label}
                >
                  <span className="matkit__check" aria-hidden="true">
                    {isReady && <CampIcon.Check />}
                  </span>
                  <span className="matkit__name">{need.label}</span>
                </button>
              </div>
            );
          })}
        </div>
        {message && (
          <span className="clipboard-materials__status" role="status">
            {message}
          </span>
        )}
      </div>
    </Block>
  );
}

export function ClipboardView({
  state,
  readyMaterialIds,
  onToggleMaterial,
  onClearMaterials,
  onPin,
  onUnpin,
  onOpenActivity,
  onOpenPlanner,
  runDoc,
}: {
  state: ClipboardState;
  readyMaterialIds: string[];
  onToggleMaterial: (id: string) => void;
  onClearMaterials: () => void;
  onPin: () => void;
  onUnpin: () => void;
  onOpenActivity: (activity: Activity) => void;
  onOpenPlanner: (dayIndex?: number) => void;
  runDoc: RunDoc | null;
}) {
  if (state.kind === "empty") {
    const empty = state.empty;
    const canOpenPlanner =
      empty.status === "no-block" ||
      empty.status === "label" ||
      empty.status === "open-slot" ||
      empty.status === "missing-activity";
    const plannerDay =
      empty.status === "no-block" ||
      empty.status === "label" ||
      empty.status === "open-slot" ||
      empty.status === "outside-hours"
        ? empty.dayIndex
        : empty.status === "missing-activity"
          ? empty.dayIndex
          : undefined;
    return (
      <div className="clipboard-view fadein">
        <section className="clipboard-empty" aria-live="polite">
          <span className="clipboard-empty__mark">
            <CampIcon.Clipboard />
          </span>
          <span className="clipboard-empty__kicker">Clipboard</span>
          <h2>{emptyTitle(empty)}</h2>
          <p>{emptyDetail(empty)}</p>
          <div className="clipboard-empty__actions">
            {empty.status === "missing-activity" && empty.pinned && (
              <button type="button" className="btn btn--primary" onClick={onUnpin}>
                <CampIcon.Pin />
                Unpin
              </button>
            )}
            {canOpenPlanner && (
              <button type="button" className="btn" onClick={() => onOpenPlanner(plannerDay)}>
                <CampIcon.Calendar />
                Open Planner
              </button>
            )}
          </div>
        </section>
      </div>
    );
  }

  const { run } = state;
  const activity = run.activity;
  return (
    <div className="clipboard-view fadein">
      <section className={"clipboard-run" + (run.source === "pinned" ? " is-pinned" : "")}>
        <div className="clipboard-run__head">
          <div className="clipboard-run__titleblock">
            <span className="clipboard-run__kicker">
              {pinLabel(run)} · {runDayLabel(run)}
            </span>
            <h2>{activity.title}</h2>
            <span className="clipboard-run__time">{runTimeLabel(run)}</span>
          </div>
          <div className="clipboard-run__actions">
            <button type="button" className="btn" onClick={() => onOpenActivity(activity)}>
              <CampIcon.BookOpen />
              Details
            </button>
            {run.source === "pinned" ? (
              <button type="button" className="btn btn--primary" onClick={onUnpin}>
                <CampIcon.Pin />
                Unpin
              </button>
            ) : (
              <button type="button" className="btn btn--primary" onClick={onPin}>
                <CampIcon.Pin />
                Pin
              </button>
            )}
          </div>
        </div>

        <p className="clipboard-run__blurb">{activity.blurb}</p>
        <div className="facts clipboard-run__facts">
          <Fact k="Meta">{activityMeta(activity)}</Fact>
          <Fact k="Group">{groupLabel(activity)}</Fact>
          <Fact k="Energy">
            <EnergyMeter level={activity.energy} />
            <small>{ENERGY[activity.energy]}</small>
          </Fact>
          <Fact k="Prep">{activity.prep}</Fact>
        </div>

        <div className="clipboard-run__grid">
          <section className="clipboard-run__panel">
            <MaterialSetup
              activity={activity}
              readyMaterialIds={readyMaterialIds}
              onToggleMaterial={onToggleMaterial}
              onClearMaterials={onClearMaterials}
            />
          </section>
          <section className="clipboard-run__panel">
            {runDoc ? (
              <ActivityRunList
                doc={runDoc}
                editable={false}
                activity={activity}
                availableMaterials={readyMaterialIds}
                onToggleMaterial={onToggleMaterial}
              />
            ) : (
              <>
                <Block num="ii" name="How to run">
                  <ol className="steps">
                    {activity.steps.map((step, index) => (
                      <li key={index}>{step}</li>
                    ))}
                  </ol>
                </Block>
                <Block num="iii" name="Notes & safety">
                  <p className="prose">{activity.notes}</p>
                  <div className="safety">{activity.safety}</div>
                </Block>
              </>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}
