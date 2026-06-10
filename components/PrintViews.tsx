"use client";

import type { Activity, DaySchedule, ScheduleBlock } from "@/lib/types";
import {
  activityMeta,
  ageSpan,
  code,
  DAYS,
  durLabel,
  ENERGY,
  groupLabel,
} from "@/lib/data";
import { materialNeedsForActivity } from "@/lib/materials";
import type { RunBlock, RunChild, RunDoc } from "@/lib/runList";
import { blockEndMin, blockStartMin, formatRange, hourMarks, TOTAL_MIN } from "@/lib/scheduleTime";
import { ActivityPlaybook } from "./ActivityPlaybook";

export type PrintIntent =
  | { type: "activity-book"; activityId: string }
  | { type: "run-sheet"; dayIndex: number }
  | { type: "planner"; dayIndex: number };

const CHILD_LABEL: Record<RunChild["type"], string> = {
  note: "Note",
  safety: "Safety",
  video: "Video",
  variation: "Variation",
  substep: "Sub-step",
  diagram: "Diagram",
  materials: "Materials",
};

function sortBlocks(blocks: DaySchedule): DaySchedule {
  return [...blocks].sort((a, b) => blockStartMin(a) - blockStartMin(b));
}

function blockName(block: ScheduleBlock, activity: Activity | null): string {
  if (activity) return activity.title;
  if ((block.fill === "open" || block.fill === "conditional") && block.category) {
    return "Choose a " + block.category;
  }
  return block.label;
}

function blockKindLabel(block: ScheduleBlock, activity: Activity | null): string {
  if (activity) return activityMeta(activity);
  if (block.kind === "label") return "Schedule note";
  if (block.category) return block.category + " placeholder";
  return "Activity placeholder";
}

function PrintFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="print-fact">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MaterialsList({ activity }: { activity: Activity }) {
  const needs = materialNeedsForActivity(activity);
  const labels = needs.length ? needs.map((need) => need.label) : activity.materials;
  return labels.length ? (
    <ul className="print-chip-list">
      {labels.map((material) => (
        <li key={material}>{material}</li>
      ))}
    </ul>
  ) : (
    <p>None needed.</p>
  );
}

function PrintChild({ child, activity }: { child: RunChild; activity: Activity }) {
  if (child.type === "materials") {
    return (
      <div className="print-run-child">
        <h3>Materials</h3>
        <MaterialsList activity={activity} />
      </div>
    );
  }

  if (child.type === "diagram" && child.diagram) {
    return (
      <div className="print-run-child print-playbook">
        <h3>Diagram</h3>
        <ActivityPlaybook playbook={child.diagram} />
      </div>
    );
  }

  if (child.type === "video") {
    return (
      <div className="print-run-child">
        <h3>Video</h3>
        <p>{child.title || child.url || "Video reference"}</p>
        {child.url ? <small>{child.url}</small> : null}
      </div>
    );
  }

  return (
    <div className={"print-run-child print-run-child--" + child.type}>
      <h3>{CHILD_LABEL[child.type]}</h3>
      <p>{child.text}</p>
    </div>
  );
}

function PrintRunBlock({ block, activity }: { block: RunBlock; activity: Activity }) {
  if (block.type === "heading") {
    return <h2 className="print-run-heading">{block.text}</h2>;
  }

  if (block.type === "details") {
    return (
      <section className="print-facts print-run-details" aria-label="Activity details">
        {(block.tags || []).map((tag) => (
          <PrintFact key={tag.id} label={tag.icon || "Detail"} value={tag.label} />
        ))}
      </section>
    );
  }

  if (block.type === "materials") {
    return (
      <section className="print-section print-section--materials">
        <h2>Materials</h2>
        <MaterialsList activity={activity} />
      </section>
    );
  }

  if (block.type === "step") {
    return (
      <section className="print-run-step">
        <div className="print-run-step__main">
          {block.time ? <span>{block.time}</span> : null}
          <p>{block.text}</p>
        </div>
        {(block.children || []).map((child) => (
          <PrintChild key={child.id} child={child} activity={activity} />
        ))}
      </section>
    );
  }

  if (block.type === "playbook") {
    return (
      <section className="print-run-note">
        <h2>{block.title || "Playbook"}</h2>
        {block.meta ? <p>{block.meta}</p> : null}
      </section>
    );
  }

  return (
    <section className={"print-run-note print-run-note--" + block.type}>
      <h2>{block.type === "note" ? "Note" : block.type === "safety" ? "Safety" : "Variation"}</h2>
      <p>{block.text}</p>
    </section>
  );
}

function ActivityBookPrint({
  activity,
  runDoc,
}: {
  activity: Activity;
  runDoc: RunDoc;
}) {
  return (
    <article className="print-sheet print-book" aria-label={"Print layout for " + activity.title}>
      <header className="print-header">
        <span className="print-kicker">{code(activity)} · {activity.type}</span>
        <h1>{activity.title}</h1>
        <p>{activity.blurb}</p>
      </header>

      <section className="print-facts" aria-label="Activity facts">
        <PrintFact label="Ages" value={ageSpan(activity)} />
        <PrintFact label="Group size" value={groupLabel(activity)} />
        <PrintFact label="Time" value={durLabel(activity)} />
        <PrintFact label="Energy" value={ENERGY[activity.energy]} />
        <PrintFact label="Place" value={activity.place} />
        <PrintFact label="Prep" value={activity.prep} />
        <PrintFact label="Approval" value={activity.rating ? activity.rating + "/5" : "Not run"} />
      </section>

      <div className="print-run-list">
        {runDoc.blocks.map((block) => (
          <PrintRunBlock key={block.id} block={block} activity={activity} />
        ))}
      </div>
    </article>
  );
}

function RunSheetPrint({
  dayIndex,
  blocks,
  byId,
}: {
  dayIndex: number;
  blocks: DaySchedule;
  byId: Record<string, Activity>;
}) {
  const sorted = sortBlocks(blocks);
  const activityCount = sorted.filter((block) => block.kind === "activity" && block.activityId).length;

  return (
    <article className="print-sheet print-runsheet" aria-label={DAYS[dayIndex] + " run sheet print layout"}>
      <header className="print-header">
        <span className="print-kicker">Run Sheet · {activityCount} planned</span>
        <h1>{DAYS[dayIndex]}</h1>
        <p>Camp day agenda with every scheduled block, activity, and placeholder.</p>
      </header>

      <section className="print-agenda" aria-label={DAYS[dayIndex] + " agenda"}>
        {sorted.length ? (
          sorted.map((block) => {
            const activity = block.activityId ? byId[block.activityId] || null : null;
            return (
              <div className="print-agenda-row" key={block.id}>
                <span className="print-agenda-row__time">
                  {formatRange(blockStartMin(block), blockEndMin(block))}
                </span>
                <span className="print-agenda-row__main">
                  <strong>{blockName(block, activity)}</strong>
                  <small>{blockKindLabel(block, activity)}</small>
                </span>
              </div>
            );
          })
        ) : (
          <p className="print-empty">Nothing planned for {DAYS[dayIndex]} yet.</p>
        )}
      </section>
    </article>
  );
}

function PlannerPrint({
  dayIndex,
  blocks,
  byId,
}: {
  dayIndex: number;
  blocks: DaySchedule;
  byId: Record<string, Activity>;
}) {
  const marks = hourMarks();
  const sorted = sortBlocks(blocks);

  return (
    <article className="print-sheet print-planner" aria-label={DAYS[dayIndex] + " planner print layout"}>
      <header className="print-header">
        <span className="print-kicker">Planner · {sorted.length} blocks</span>
        <h1>{DAYS[dayIndex]}</h1>
        <p>Timeline view for a standard letter page.</p>
      </header>

      <section className="print-timeline" aria-label={DAYS[dayIndex] + " timeline"}>
        <div className="print-timeline__axis" aria-hidden="true">
          {marks.map((mark) => (
            <span key={mark.min} style={{ top: ((mark.min - marks[0].min) / TOTAL_MIN) * 100 + "%" }}>
              {mark.label}
            </span>
          ))}
        </div>
        <div className="print-timeline__grid">
          {marks.map((mark) => (
            <span
              key={mark.min}
              className="print-timeline__line"
              style={{ top: ((mark.min - marks[0].min) / TOTAL_MIN) * 100 + "%" }}
            />
          ))}
          {sorted.map((block) => {
            const start = blockStartMin(block);
            const end = blockEndMin(block);
            const activity = block.activityId ? byId[block.activityId] || null : null;
            return (
              <div
                key={block.id}
                className={"print-timeblock" + (block.kind === "label" ? " print-timeblock--label" : "")}
                style={{
                  top: ((start - marks[0].min) / TOTAL_MIN) * 100 + "%",
                  height: Math.max(3.4, ((end - start) / TOTAL_MIN) * 100) + "%",
                }}
              >
                <span>{formatRange(start, end)}</span>
                <strong>{blockName(block, activity)}</strong>
                <small>{blockKindLabel(block, activity)}</small>
              </div>
            );
          })}
        </div>
      </section>
    </article>
  );
}

export function PrintViews({
  intent,
  byId,
  weekBlocks,
  resolveRunDoc,
}: {
  intent: PrintIntent | null;
  byId: Record<string, Activity>;
  weekBlocks: Record<number, DaySchedule>;
  resolveRunDoc: (activity: Activity) => RunDoc;
}) {
  if (!intent) return null;

  if (intent.type === "activity-book") {
    const activity = byId[intent.activityId];
    if (!activity) return null;
    return (
      <div className="print-root" aria-hidden="true">
        <ActivityBookPrint activity={activity} runDoc={resolveRunDoc(activity)} />
      </div>
    );
  }

  const blocks = weekBlocks[intent.dayIndex] || [];
  return (
    <div className="print-root" aria-hidden="true">
      {intent.type === "run-sheet" ? (
        <RunSheetPrint dayIndex={intent.dayIndex} blocks={blocks} byId={byId} />
      ) : (
        <PlannerPrint dayIndex={intent.dayIndex} blocks={blocks} byId={byId} />
      )}
    </div>
  );
}
