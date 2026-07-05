"use client";

// Print layout for a single activity book — the one print artifact that
// survived the planner teardown (reached from the activity viewer's Print
// chip). It now renders through the SHARED RunSheetBody (`print` variant, the
// `pd-` class vocabulary) inside the same `.print-doc` shell the schedule print
// uses, so the single-activity book, the appended schedule run sheets, and the
// public /run page are ONE document system — same typography, spacing, and item
// styling. The old bespoke `@media print` `.print-*` grey CSS is gone.

import type { Material } from "@/lib/materials/materialCatalog";
import type { StockState } from "@/lib/materials/kitStock";
import type { Activity } from "@/lib/types";
import type { RunDoc } from "@/lib/activity/runList";
import { RunSheetBody } from "./RunSheetBody";

export function ActivityBookPrint({
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
  // Color + styled so the book gets the brand cover/spine treatment and the
  // category accents; the existing `.app:has(.print-root)` chrome-hiding rules
  // make this the only thing that prints (display:none on screen).
  return (
    <div className="print-root" aria-hidden="true">
      <div className="print-doc print-doc--color print-doc--styled">
        <RunSheetBody
          activity={activity}
          runDoc={runDoc}
          variant="print"
          kitStock={kitStock}
          materialCatalog={materialCatalog}
        />
      </div>
    </div>
  );
}
