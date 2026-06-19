// Read-only render of an activity's Run List, for the public, token-gated
// run-sheet page reached from a subscribed calendar event. No editor, no state,
// no interactivity — a server-renderable presentational walk of the RunDoc
// (modeled on ActivityBookPrint, styled for screen). Diagrams reuse the shared
// SVG ActivityPlaybook so a printed/edited/published diagram is pixel-identical.

import { ageSpan, code, durLabel, ENERGY, groupLabel } from "@/lib/data";
import { materialNeedsForActivity } from "@/lib/materials";
import type { RunBlock, RunChild, RunDoc } from "@/lib/runList";
import type { Activity } from "@/lib/types";
import { ActivityPlaybook } from "./ActivityPlaybook";

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
    <ul className="runsheet__chips">
      {labels.map((material) => (
        <li key={material}>{material}</li>
      ))}
    </ul>
  ) : (
    <p className="runsheet__muted">None needed.</p>
  );
}

function RunSheetChild({ child, activity }: { child: RunChild; activity: Activity }) {
  if (child.type === "materials") {
    return (
      <div className="runsheet__detail">
        <h4>Materials</h4>
        <MaterialsList activity={activity} />
      </div>
    );
  }

  if (child.type === "diagram" && child.diagram) {
    return (
      <div className="runsheet__detail runsheet__detail--diagram">
        <h4>Diagram</h4>
        <ActivityPlaybook playbook={child.diagram} />
      </div>
    );
  }

  if (child.type === "video") {
    return (
      <div className="runsheet__detail">
        <h4>Media</h4>
        {child.url ? (
          <a href={child.url} target="_blank" rel="noopener noreferrer">
            {child.title || child.url}
          </a>
        ) : (
          <p>{child.title || "Linked media"}</p>
        )}
      </div>
    );
  }

  return (
    <div className={"runsheet__detail runsheet__detail--" + child.type}>
      <h4>{CHILD_LABEL[child.type]}</h4>
      <p>{child.text}</p>
    </div>
  );
}

function RunSheetBlock({ block, activity }: { block: RunBlock; activity: Activity }) {
  if (block.type === "heading") {
    return <h2 className="runsheet__heading">{block.text}</h2>;
  }

  // The facts strip in the header already shows every activity fact, so the
  // doc's derived details block would just repeat it.
  if (block.type === "details") return null;

  if (block.type === "materials") {
    return (
      <section className="runsheet__block runsheet__block--materials">
        <h3>Materials</h3>
        <MaterialsList activity={activity} />
      </section>
    );
  }

  if (block.type === "step") {
    return (
      <section className="runsheet__step">
        <div className="runsheet__step-main">
          {block.time ? <span className="runsheet__cue">{block.time}</span> : null}
          <p>{block.text}</p>
        </div>
        {(block.children || []).map((child) => (
          <RunSheetChild key={child.id} child={child} activity={activity} />
        ))}
      </section>
    );
  }

  if (block.type === "playbook") {
    return (
      <section className="runsheet__block runsheet__block--note">
        <h3>{block.title || "Playbook"}</h3>
        {block.meta ? <p>{block.meta}</p> : null}
      </section>
    );
  }

  // note / safety / variation
  return (
    <section className={"runsheet__block runsheet__block--" + block.type}>
      <h3>{block.type === "note" ? "Note" : block.type === "safety" ? "Safety" : "Variation"}</h3>
      <p>{block.text}</p>
    </section>
  );
}

export function RunSheetView({ activity, runDoc }: { activity: Activity; runDoc: RunDoc }) {
  return (
    <article className="runsheet">
      <header className="runsheet__header">
        <span className="runsheet__kicker">
          {code(activity)} · {activity.type}
        </span>
        <h1 className="runsheet__title">{activity.title}</h1>
        {activity.blurb ? <p className="runsheet__blurb">{activity.blurb}</p> : null}
      </header>

      <section className="runsheet__facts" aria-label="Activity facts">
        <div className="runsheet__fact">
          <span>Ages</span>
          <strong>{ageSpan(activity)}</strong>
        </div>
        <div className="runsheet__fact">
          <span>Group</span>
          <strong>{groupLabel(activity)}</strong>
        </div>
        <div className="runsheet__fact">
          <span>Time</span>
          <strong>{durLabel(activity)}</strong>
        </div>
        {activity.energy ? (
          <div className="runsheet__fact">
            <span>Energy</span>
            <strong>{ENERGY[activity.energy]}</strong>
          </div>
        ) : null}
        <div className="runsheet__fact">
          <span>Place</span>
          <strong>{activity.place}</strong>
        </div>
        <div className="runsheet__fact">
          <span>Prep</span>
          <strong>{activity.prep}</strong>
        </div>
      </section>

      <div className="runsheet__list">
        {runDoc.blocks.map((block) => (
          <RunSheetBlock key={block.id} block={block} activity={activity} />
        ))}
      </div>
    </article>
  );
}
