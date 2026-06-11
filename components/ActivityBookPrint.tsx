"use client";

// Print layout for a single activity book — the one print artifact that
// survived the planner teardown (reached from the activity viewer's Print
// chip). Renders the full Run List document for a letter page.

import type { Activity } from "@/lib/types";
import { ageSpan, code, durLabel, ENERGY, groupLabel } from "@/lib/data";
import { materialNeedsForActivity } from "@/lib/materials";
import type { RunBlock, RunChild, RunDoc } from "@/lib/runList";
import { ActivityPlaybook } from "./ActivityPlaybook";

const CHILD_LABEL: Record<RunChild["type"], string> = {
  note: "Note",
  safety: "Safety",
  video: "Video",
  variation: "Variation",
  substep: "Sub-step",
  diagram: "Diagram",
  materials: "Materials",
};

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

  // The header's facts section already prints every activity fact — the
  // doc's details block would repeat it (with icon ids as labels, no less).
  if (block.type === "details") return null;

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

export function ActivityBookPrint({ activity, runDoc }: { activity: Activity; runDoc: RunDoc }) {
  return (
    <div className="print-root" aria-hidden="true">
      <article className="print-sheet print-book" aria-label={"Print layout for " + activity.title}>
        <header className="print-header">
          <span className="print-kicker">
            {code(activity)} · {activity.type}
          </span>
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
    </div>
  );
}
