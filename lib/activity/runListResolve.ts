// Pure run-doc resolution, lifted out of the client-only useActivityLibrary
// hook so the same logic runs on the server (the public run-sheet page) and in
// the app without drifting. No "use client" — isomorphic. The override maps are
// passed in explicitly (the hook reads them from synced docs; the server reads
// them from getUserDocs).

import { PLAYBOOKS_BY_ACTIVITY_ID, type ActivityPlaybookData } from "./playbooks";
import { buildRunDoc, ensureSectionHeadings, promoteMaterialsBlocks, type RunDoc } from "./runList";
import type { Activity } from "../types";

// A custom book carries its own diagram; built-in books fall back to an
// editable override, then the seed registry.
export function resolvePlaybook(
  activity: Activity,
  playbookOverrides: Record<string, ActivityPlaybookData>
): ActivityPlaybookData | null {
  return activity.playbook ?? playbookOverrides[activity.id] ?? PLAYBOOKS_BY_ACTIVITY_ID[activity.id] ?? null;
}

// The Run List doc: a saved override if one exists, else derived from the
// activity — its steps/notes/safety plus a materials block and (when the
// activity has one) the field diagram seeded in as a diagram block.
export function resolveRunDoc(
  activity: Activity,
  runListOverrides: Record<string, RunDoc>,
  playbookOverrides: Record<string, ActivityPlaybookData>
): RunDoc {
  const hasOverride = Object.prototype.hasOwnProperty.call(runListOverrides, activity.id);
  const doc = hasOverride
    ? promoteMaterialsBlocks(runListOverrides[activity.id])
    : buildRunDoc(activity, resolvePlaybook(activity, playbookOverrides));
  if (hasOverride && doc.blocks.length === 0) return doc;
  return ensureSectionHeadings(activity, doc);
}
