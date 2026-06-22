// The Print tab's full run sheet — now a thin wrapper over the shared
// RunSheetBody (the `print` variant uses the self-contained `pd-` classes, styled
// on screen AND in print so the live preview matches the printout). The body is
// shared with the public RunSheetView so the two can't drift again.

import type { RunDoc } from "@/lib/runList";
import type { Activity } from "@/lib/types";
import { RunSheetBody } from "../RunSheetBody";

export function PrintRunSheet({ activity, runDoc }: { activity: Activity; runDoc: RunDoc }) {
  return <RunSheetBody activity={activity} runDoc={runDoc} variant="print" />;
}
