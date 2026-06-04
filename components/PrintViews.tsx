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
import type { ActivityPlaybookData } from "@/lib/playbooks";
import { blockEndMin, blockStartMin, formatRange, hourMarks, TOTAL_MIN } from "@/lib/scheduleTime";
import { ActivityPlaybook } from "./ActivityPlaybook";

export type PrintIntent =
  | { type: "activity-book"; activityId: string }
  | { type: "run-sheet"; dayIndex: number }
  | { type: "planner"; dayIndex: number };

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

function ActivityBookPrint({
  activity,
  playbook,
}: {
  activity: Activity;
  playbook: ActivityPlaybookData | null;
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

      <section className="print-section print-section--materials">
        <h2>Materials</h2>
        {activity.materials.length ? (
          <ul className="print-chip-list">
            {activity.materials.map((material) => (
              <li key={material}>{material}</li>
            ))}
          </ul>
        ) : (
          <p>None needed.</p>
        )}
      </section>

      <section className="print-section">
        <h2>How to Play</h2>
        {playbook ? (
          <div className="print-playbook">
            <ActivityPlaybook playbook={playbook} />
          </div>
        ) : (
          <ol className="print-steps">
            {activity.steps.map((step, index) => (
              <li key={index}>{step}</li>
            ))}
          </ol>
        )}
      </section>

      <section className="print-section print-two-col">
        <div>
          <h2>Notes & Variations</h2>
          <p>{activity.notes}</p>
        </div>
        <div>
          <h2>Safety</h2>
          <p>{activity.safety}</p>
        </div>
      </section>
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
  resolvePlaybook,
}: {
  intent: PrintIntent | null;
  byId: Record<string, Activity>;
  weekBlocks: Record<number, DaySchedule>;
  resolvePlaybook: (activity: Activity) => ActivityPlaybookData | null;
}) {
  if (!intent) return null;

  if (intent.type === "activity-book") {
    const activity = byId[intent.activityId];
    if (!activity) return null;
    return (
      <div className="print-root" aria-hidden="true">
        <ActivityBookPrint activity={activity} playbook={resolvePlaybook(activity)} />
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
