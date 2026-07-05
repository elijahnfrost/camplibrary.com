// The Print tab's full run sheet — now a thin wrapper over the shared
// RunSheetBody (the `print` variant uses the self-contained `pd-` classes, styled
// on screen AND in print so the live preview matches the printout). The body is
// shared with the public RunSheetView so the two can't drift again.

import type { Material } from "@/lib/materials/materialCatalog";
import type { StockState } from "@/lib/materials/kitStock";
import type { RunDoc } from "@/lib/activity/runList";
import type { Activity } from "@/lib/types";
import { RunSheetBody } from "../activity/RunSheetBody";

export function PrintRunSheet({
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
      variant="print"
      kitStock={kitStock}
      materialCatalog={materialCatalog}
    />
  );
}
