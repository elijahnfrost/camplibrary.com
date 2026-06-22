// The ONE run-sheet renderer, shared by the Print tab's PrintRunSheet (the
// `pd-` class vocabulary, styled on screen AND print) and the public token-gated
// RunSheetView (`runsheet__` classes, runsheet.css). They used to be two parallel
// walks of the RunDoc that drifted (different facts, diagram clamp); this is the
// single source so a new block type or fact lands in both at once. The SVG
// diagram (ActivityPlaybook) was already shared; now the whole body is.

import type { ElementType } from "react";
import { ageSpan, code, durLabel, ENERGY, groupLabel } from "@/lib/data";
import { materialNeedsForActivity } from "@/lib/materials";
import type { RunBlock, RunChild, RunDoc } from "@/lib/runList";
import type { Activity } from "@/lib/types";
import { ActivityPlaybook } from "./ActivityPlaybook";

export type RunSheetVariant = "print" | "web";

const CHILD_LABEL: Record<RunChild["type"], string> = {
  note: "Note",
  safety: "Safety",
  video: "Media",
  variation: "Variation",
  substep: "Sub-step",
  diagram: "Diagram",
  materials: "Materials",
};

// The two presentational vocabularies. Structure is identical; only class names,
// the title/heading element levels, and whether media links are anchors differ.
const VARIANTS = {
  print: {
    root: "pd-runsheet",
    head: "pd-runsheet__head",
    kicker: "pd-kicker",
    title: "pd-runsheet__title",
    titleTag: "h2" as ElementType,
    blurb: "pd-runsheet__blurb",
    aka: "pd-runsheet__aka",
    facts: "pd-facts pd-facts--grid",
    fact: "pd-fact",
    list: "pd-run-list",
    heading: "pd-run-heading",
    headingTag: "h3" as ElementType,
    step: "pd-step",
    stepMain: "pd-step__main",
    cue: "pd-step__cue",
    noteBase: "pd-run-note",
    childBase: "pd-child",
    diagramChild: "pd-child pd-playbook",
    chips: "pd-chips",
    muted: "",
    linkVideos: false,
  },
  web: {
    root: "runsheet",
    head: "runsheet__header",
    kicker: "runsheet__kicker",
    title: "runsheet__title",
    titleTag: "h1" as ElementType,
    blurb: "runsheet__blurb",
    aka: "runsheet__aka",
    facts: "runsheet__facts",
    fact: "runsheet__fact",
    list: "runsheet__list",
    heading: "runsheet__heading",
    headingTag: "h2" as ElementType,
    step: "runsheet__step",
    stepMain: "runsheet__step-main",
    cue: "runsheet__cue",
    noteBase: "runsheet__block",
    childBase: "runsheet__detail",
    diagramChild: "runsheet__detail runsheet__detail--diagram",
    chips: "runsheet__chips",
    muted: "runsheet__muted",
    linkVideos: true,
  },
} as const;

type Vars = (typeof VARIANTS)[RunSheetVariant];

function MaterialsList({ activity, c }: { activity: Activity; c: Vars }) {
  const needs = materialNeedsForActivity(activity);
  const labels = needs.length ? needs.map((need) => need.label) : activity.materials;
  return labels.length ? (
    <ul className={c.chips}>
      {labels.map((material) => (
        <li key={material}>{material}</li>
      ))}
    </ul>
  ) : (
    <p className={c.muted || undefined}>None needed.</p>
  );
}

function RunChildView({ child, activity, c }: { child: RunChild; activity: Activity; c: Vars }) {
  if (child.type === "materials") {
    return (
      <div className={c.childBase}>
        <h4>Materials</h4>
        <MaterialsList activity={activity} c={c} />
      </div>
    );
  }
  if (child.type === "diagram" && child.diagram) {
    return (
      <div className={c.diagramChild}>
        <h4>Diagram</h4>
        <ActivityPlaybook playbook={child.diagram} />
      </div>
    );
  }
  if (child.type === "video") {
    return (
      <div className={c.childBase}>
        <h4>Media</h4>
        {c.linkVideos && child.url ? (
          <a href={child.url} target="_blank" rel="noopener noreferrer">
            {child.title || child.url}
          </a>
        ) : (
          <>
            <p>{child.title || child.url || "Linked media"}</p>
            {child.url ? <small>{child.url}</small> : null}
          </>
        )}
      </div>
    );
  }
  return (
    <div className={c.childBase + " " + c.childBase + "--" + child.type}>
      <h4>{CHILD_LABEL[child.type]}</h4>
      <p>{child.text}</p>
    </div>
  );
}

function RunBlockView({ block, activity, c }: { block: RunBlock; activity: Activity; c: Vars }) {
  const Heading = c.headingTag;
  if (block.type === "heading") {
    return <Heading className={c.heading}>{block.text}</Heading>;
  }
  // The facts grid already prints every activity fact — the derived details block
  // would repeat it (with icon ids as labels), so skip it here.
  if (block.type === "details") return null;

  if (block.type === "materials") {
    return (
      <section className={c.noteBase + " " + c.noteBase + "--materials"}>
        <h3>Materials</h3>
        <MaterialsList activity={activity} c={c} />
      </section>
    );
  }

  if (block.type === "step") {
    return (
      <section className={c.step}>
        <div className={c.stepMain}>
          {block.time ? <span className={c.cue}>{block.time}</span> : null}
          <p>{block.text}</p>
        </div>
        {(block.children || []).map((child) => (
          <RunChildView key={child.id} child={child} activity={activity} c={c} />
        ))}
      </section>
    );
  }

  if (block.type === "playbook") {
    return (
      <section className={c.noteBase + " " + c.noteBase + "--note"}>
        <h3>{block.title || "Playbook"}</h3>
        {block.meta ? <p>{block.meta}</p> : null}
      </section>
    );
  }

  // note / safety / variation
  return (
    <section className={c.noteBase + " " + c.noteBase + "--" + block.type}>
      <h3>{block.type === "note" ? "Note" : block.type === "safety" ? "Safety" : "Variation"}</h3>
      <p>{block.text}</p>
    </section>
  );
}

export function RunSheetBody({
  activity,
  runDoc,
  variant,
}: {
  activity: Activity;
  runDoc: RunDoc;
  variant: RunSheetVariant;
}) {
  const c = VARIANTS[variant];
  const Title = c.titleTag;
  return (
    <article className={c.root} aria-label={"Run sheet for " + activity.title}>
      <header className={c.head}>
        <span className={c.kicker}>
          {code(activity)} · {activity.type}
        </span>
        <Title className={c.title}>{activity.title}</Title>
        {activity.altNames && activity.altNames.length ? (
          <p className={c.aka}>Also called {activity.altNames.join(" · ")}</p>
        ) : null}
        {activity.blurb ? <p className={c.blurb}>{activity.blurb}</p> : null}
      </header>

      {/* The reconciled 6-fact set (Approval/rating dropped — a run sheet is for
          running the activity, not ranking it). Same six on print and web. */}
      <section className={c.facts} aria-label="Activity facts">
        <div className={c.fact}><span>Ages</span><strong>{ageSpan(activity)}</strong></div>
        <div className={c.fact}><span>Group</span><strong>{groupLabel(activity)}</strong></div>
        <div className={c.fact}><span>Time</span><strong>{durLabel(activity)}</strong></div>
        <div className={c.fact}><span>Energy</span><strong>{ENERGY[activity.energy] || "—"}</strong></div>
        <div className={c.fact}><span>Place</span><strong>{activity.place}</strong></div>
        <div className={c.fact}><span>Prep</span><strong>{activity.prep}</strong></div>
      </section>

      <div className={c.list}>
        {runDoc.blocks.map((block) => (
          <RunBlockView key={block.id} block={block} activity={activity} c={c} />
        ))}
      </div>
    </article>
  );
}
