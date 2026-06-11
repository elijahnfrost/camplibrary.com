// Present mode's slide model: a pure mapping from the Run List document to a
// linear deck. Steps become slides; a step's attached details become bullets;
// a step's diagram becomes the slide's hero with PowerPoint-build semantics —
// each diagram frame advances on its own tap before the deck moves on.

import type { ActivityPlaybookData } from "./playbooks";
import { detailTagsForActivity, type RunChild, type RunDoc } from "./runList";
import type { Activity } from "./types";

const MAX_BULLETS_PER_SLIDE = 4;

export type PresentBullet = {
  id: string;
  type: "note" | "safety" | "variation" | "substep" | "video";
  text: string;
};

export type PresentSlide =
  | { kind: "title"; title: string; blurb: string; tags: string[] }
  | { kind: "section"; text: string }
  | {
      kind: "step";
      number: number;
      text: string;
      time?: string;
      bullets: PresentBullet[];
      diagram?: ActivityPlaybookData;
    }
  | { kind: "note"; noteType: "note" | "safety" | "variation"; text: string }
  | { kind: "materials" };

function bulletFromChild(child: RunChild): PresentBullet | null {
  if (child.type === "video") {
    const text = [child.title, child.url].filter(Boolean).join(" — ");
    return text ? { id: child.id, type: "video", text } : null;
  }
  if (child.type === "diagram" || child.type === "materials") return null;
  const text = (child.text || "").trim();
  return text ? { id: child.id, type: child.type, text } : null;
}

export function buildPresentSlides(activity: Activity, doc: RunDoc): PresentSlide[] {
  const slides: PresentSlide[] = [
    {
      kind: "title",
      title: activity.title,
      blurb: activity.blurb || "",
      tags: detailTagsForActivity(activity).map((tag) => tag.label),
    },
  ];

  let stepNumber = 0;
  let materialsShown = false;

  for (const block of doc.blocks) {
    if (block.type === "details") continue; // covered by the title slide
    if (block.type === "playbook") continue; // legacy cross-link card

    if (block.type === "heading") {
      const text = (block.text || "").trim();
      // "Details" heads the title slide already; skip empty headings too.
      if (text && text.toLowerCase() !== "details") slides.push({ kind: "section", text });
      continue;
    }

    if (block.type === "materials") {
      if (!materialsShown) {
        slides.push({ kind: "materials" });
        materialsShown = true;
      }
      continue;
    }

    if (block.type === "step") {
      const text = (block.text || "").trim();
      const children = block.children || [];
      const bullets = children
        .map(bulletFromChild)
        .filter((bullet): bullet is PresentBullet => Boolean(bullet));
      const diagram = children.find((child) => child.type === "diagram" && child.diagram)?.diagram;
      const hasMaterialsChild = children.some((child) => child.type === "materials");
      if (text || bullets.length || diagram) {
        stepNumber += 1;
        // A heavily-annotated step would become a wall of text on the
        // projector — cap bullets per slide and continue on the next tap.
        const first = bullets.slice(0, MAX_BULLETS_PER_SLIDE);
        const slide: PresentSlide = { kind: "step", number: stepNumber, text, bullets: first };
        if (block.time && block.time.trim()) slide.time = block.time.trim();
        if (diagram) slide.diagram = diagram;
        slides.push(slide);
        for (let i = MAX_BULLETS_PER_SLIDE; i < bullets.length; i += MAX_BULLETS_PER_SLIDE) {
          slides.push({
            kind: "step",
            number: stepNumber,
            text: text ? text + " (continued)" : "(continued)",
            bullets: bullets.slice(i, i + MAX_BULLETS_PER_SLIDE),
          });
        }
      }
      if (hasMaterialsChild && !materialsShown) {
        slides.push({ kind: "materials" });
        materialsShown = true;
      }
      continue;
    }

    // top-level note / safety / variation
    const text = (block.text || "").trim();
    if (text) slides.push({ kind: "note", noteType: block.type, text });
  }

  return slides;
}

// How many taps a slide consumes: a step with a multi-frame diagram advances
// one frame per tap (build semantics) before moving to the next slide.
export function slideFrameCount(slide: PresentSlide): number {
  if (slide.kind === "step" && slide.diagram && slide.diagram.frames.length > 0) {
    return slide.diagram.frames.length;
  }
  return 1;
}
