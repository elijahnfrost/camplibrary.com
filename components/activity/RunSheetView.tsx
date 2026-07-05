// Read-only render of an activity's Run List for the public, token-gated run-sheet
// page (reached from a subscribed calendar event). Now a thin wrapper over the
// shared RunSheetBody (`web` variant → `runsheet__` classes, runsheet.css) — the
// same body the Print tab uses, so the printed and published sheets stay identical.
// Server-renderable: no editor, no state, no "use client".

import type { Material } from "@/lib/materials/materialCatalog";
import type { StockState } from "@/lib/materials/kitStock";
import type { RunDoc } from "@/lib/activity/runList";
import type { Activity } from "@/lib/types";
import { RunSheetBody } from "./RunSheetBody";

export function RunSheetView({
  activity,
  runDoc,
  kitStock,
  materialCatalog,
}: {
  activity: Activity;
  runDoc: RunDoc;
  kitStock?: Record<string, StockState>;
  materialCatalog?: Material[];
}) {
  return (
    <RunSheetBody
      activity={activity}
      runDoc={runDoc}
      variant="web"
      kitStock={kitStock}
      materialCatalog={materialCatalog}
    />
  );
}
