"use client";

// Full run-sheet renderer for the Print tab — the activity-book level of detail
// (facts grid + the complete Run List with its steps, attached notes/safety,
// materials, and field diagrams). It mirrors ActivityBookPrint's content but
// uses the tab's self-contained `pd-` classes, which are styled on screen AND
// in print, so the live preview matches the printed sheet exactly. (The viewer's
// ActivityBookPrint keeps its own print-only styling and is left untouched.)

import { ageSpan, code, durLabel, ENERGY, groupLabel } from "@/lib/data";
import { materialNeedsForActivity } from "@/lib/materials";
import type { RunBlock, RunChild, RunDoc } from "@/lib/runList";
import type { Activity } from "@/lib/types";
import { ActivityPlaybook } from "../ActivityPlaybook";

const CHILD_LABEL: Record<RunChild["type"], string> = {
  note: "Note",
  safety: "Safety",
  video: "Media",
  variation: "Variation",
  substep: "Sub-step",
  diagram: "Diagram",
  materials: "Materials",
};

function MaterialsList({ activity }: { activity: Activity }) {
  const needs = materialNeedsForActivity(activity);
  const labels = needs.length ? needs.map((need) => need.label) : activity.materials;
  return labels.length ? (
    <ul className="pd-chips">
      {labels.map((material) => (
        <li key={material}>{material}</li>
      ))}
    </ul>
  ) : (
    <p>None needed.</p>
  );
}

function RunChildView({ child, activity }: { child: RunChild; activity: Activity }) {
  if (child.type === "materials") {
    return (
      <div className="pd-child">
        <h4>Materials</h4>
        <MaterialsList activity={activity} />
      </div>
    );
  }
  if (child.type === "diagram" && child.diagram) {
    return (
      <div className="pd-child pd-playbook">
        <h4>Diagram</h4>
        <ActivityPlaybook playbook={child.diagram} />
      </div>
    );
  }
  if (child.type === "video") {
    return (
      <div className="pd-child">
        <h4>Media</h4>
        <p>{child.title || child.url || "Linked media"}</p>
        {child.url ? <small>{child.url}</small> : null}
      </div>
    );
  }
  return (
    <div className={"pd-child pd-child--" + child.type}>
      <h4>{CHILD_LABEL[child.type]}</h4>
      <p>{child.text}</p>
    </div>
  );
}

function RunBlockView({ block, activity }: { block: RunBlock; activity: Activity }) {
  if (block.type === "heading") {
    return <h3 className="pd-run-heading">{block.text}</h3>;
  }
  // The facts grid already prints every activity fact — the details block would
  // repeat it (with icon ids as labels), so skip it here as ActivityBookPrint does.
  if (block.type === "details") return null;

  if (block.type === "materials") {
    return (
      <section className="pd-run-note">
        <h3>Materials</h3>
        <MaterialsList activity={activity} />
      </section>
    );
  }

  if (block.type === "step") {
    return (
      <section className="pd-step">
        <div className="pd-step__main">
          {block.time ? <span className="pd-step__cue">{block.time}</span> : null}
          <p>{block.text}</p>
        </div>
        {(block.children || []).map((child) => (
          <RunChildView key={child.id} child={child} activity={activity} />
        ))}
      </section>
    );
  }

  if (block.type === "playbook") {
    return (
      <section className="pd-run-note">
        <h3>{block.title || "Playbook"}</h3>
        {block.meta ? <p>{block.meta}</p> : null}
      </section>
    );
  }

  return (
    <section className={"pd-run-note pd-run-note--" + block.type}>
      <h3>{block.type === "note" ? "Note" : block.type === "safety" ? "Safety" : "Variation"}</h3>
      <p>{block.text}</p>
    </section>
  );
}

export function PrintRunSheet({ activity, runDoc }: { activity: Activity; runDoc: RunDoc }) {
  return (
    <article className="pd-runsheet" aria-label={"Run sheet for " + activity.title}>
      <header className="pd-runsheet__head">
        <span className="pd-kicker">
          {code(activity)} · {activity.type}
        </span>
        <h2 className="pd-runsheet__title">{activity.title}</h2>
        {activity.blurb ? <p className="pd-runsheet__blurb">{activity.blurb}</p> : null}
      </header>

      <section className="pd-facts pd-facts--grid" aria-label="Activity facts">
        <div className="pd-fact"><span>Ages</span><strong>{ageSpan(activity)}</strong></div>
        <div className="pd-fact"><span>Group size</span><strong>{groupLabel(activity)}</strong></div>
        <div className="pd-fact"><span>Time</span><strong>{durLabel(activity)}</strong></div>
        <div className="pd-fact"><span>Energy</span><strong>{ENERGY[activity.energy] || "—"}</strong></div>
        <div className="pd-fact"><span>Place</span><strong>{activity.place}</strong></div>
        <div className="pd-fact"><span>Prep</span><strong>{activity.prep}</strong></div>
        <div className="pd-fact"><span>Approval</span><strong>{activity.rating ? activity.rating + "/5" : "Not run"}</strong></div>
      </section>

      <div className="pd-run-list">
        {runDoc.blocks.map((block) => (
          <RunBlockView key={block.id} block={block} activity={activity} />
        ))}
      </div>
    </article>
  );
}
