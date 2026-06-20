// Camp Library — condensed run-sheet summary (the "TLDR" the Print tab can fold
// into each scheduled event). Pure: it reads a resolved RunDoc and reduces it
// to the lines worth glancing at on a one-page-per-day schedule — the play
// steps, any safety calls, and the kit — without the diagrams, media links, or
// nested detail the full run sheet carries.

import { materialNeedsForActivity } from "@/lib/materials";
import type { RunDoc } from "@/lib/runList";
import type { Activity } from "@/lib/types";

export interface RunSummary {
  // Numbered play steps, each as a single line (with its time/cue chip if any).
  steps: string[];
  // Safety calls — pulled from both top-level safety blocks and step children.
  safety: string[];
  // Notes / variations worth carrying onto the schedule.
  notes: string[];
  // Distinct materials (kit) labels in authored order.
  materials: string[];
  // Whether the full run sheet carries a field diagram (so the schedule can
  // hint "diagram on the run sheet" without trying to print it inline).
  hasDiagram: boolean;
}

function pushText(into: string[], value: string | undefined): void {
  const trimmed = (value || "").trim();
  if (trimmed) into.push(trimmed);
}

// Reduce a resolved RunDoc to its glanceable essentials. Headings, the details
// block (already shown as facts elsewhere), playbook cross-links, and embedded
// diagrams/media are intentionally dropped — this is the at-a-glance layer.
export function summarizeRunDoc(activity: Activity, doc: RunDoc): RunSummary {
  const steps: string[] = [];
  const safety: string[] = [];
  const notes: string[] = [];
  let hasDiagram = false;

  for (const block of doc.blocks) {
    if (block.type === "step") {
      const cue = (block.time || "").trim();
      const text = (block.text || "").trim();
      if (text) steps.push(cue ? cue + " — " + text : text);
    } else if (block.type === "safety") {
      pushText(safety, block.text);
    } else if (block.type === "note" || block.type === "variation") {
      pushText(notes, block.text);
    }

    for (const child of block.children || []) {
      if (child.type === "safety") pushText(safety, child.text);
      else if (child.type === "note" || child.type === "variation") pushText(notes, child.text);
      else if (child.type === "diagram") hasDiagram = true;
    }
  }

  const materials = materialNeedsForActivity(activity).map((need) => need.label);
  return { steps, safety, notes, materials, hasDiagram };
}

// True when there is anything worth printing as a TLDR (so the schedule can
// skip the block entirely for a bare custom event).
export function hasSummaryContent(summary: RunSummary): boolean {
  return (
    summary.steps.length > 0 ||
    summary.safety.length > 0 ||
    summary.notes.length > 0 ||
    summary.materials.length > 0
  );
}
