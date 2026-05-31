"use client";

import type { Activity, ScheduleBlock } from "@/lib/types";
import { activityMeta } from "@/lib/data";
import { formatRange } from "@/lib/scheduleTime";
import type { Laid } from "@/lib/layoutEvents";
import { CampIcon } from "./icons";
import { useDialogFocus } from "./useDialogFocus";

// The "+N more" disclosure: a focus-trapped dialog listing the events collapsed
// out of a crowded overlap slot. Each row is a stretched-button (open) with a
// sibling remove button — same no-nesting pattern as the library/saved cards.
export function OverflowSheet({
  items,
  startMin,
  endMin,
  byId,
  onEdit,
  onRemove,
  onClose,
}: {
  items: Laid[];
  startMin: number;
  endMin: number;
  byId: Record<string, Activity>;
  onEdit: (block: ScheduleBlock) => void;
  onRemove: (blockId: string) => void;
  onClose: () => void;
}) {
  const dialogRef = useDialogFocus<HTMLDivElement>(onClose);
  const blocks = items
    .map((item) => item.block)
    .filter((block): block is ScheduleBlock => Boolean(block));

  return (
    <div
      ref={dialogRef}
      className="composer-scrim"
      role="dialog"
      aria-modal="true"
      aria-label={blocks.length + " overlapping events, " + formatRange(startMin, endMin)}
      tabIndex={-1}
    >
      <div className="composer-backdrop" onClick={onClose} />
      <div className="composer overflow-sheet fadein">
        <header className="composer__head">
          <div>
            <span className="composer__kicker">{formatRange(startMin, endMin)}</span>
            <h2 className="composer__title">{blocks.length} more here</h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <CampIcon.Close />
          </button>
        </header>

        <div className="overflow-sheet__list">
          {items.map((item) => {
            const block = item.block;
            if (!block) return null;
            const activity = block.activityId ? byId[block.activityId] : null;
            const title = activity ? activity.title : block.label;
            return (
              <div className="cat-row overflow-row" key={block.id}>
                <button
                  type="button"
                  className="cat-row__open stretch"
                  aria-label={"Edit " + title + ", " + formatRange(item.startMin, item.endMin)}
                  onClick={() => onEdit(block)}
                >
                  <span className="overflow-row__time">{formatRange(item.startMin, item.endMin)}</span>
                  <span className="cat-main">
                    <span className="cat-title overflow-row__title">{title}</span>
                    {activity && <span className="overflow-row__meta">{activityMeta(activity)}</span>}
                  </span>
                </button>
                <button
                  type="button"
                  className="overflow-row__remove"
                  aria-label={"Remove " + title}
                  onClick={() => onRemove(block.id)}
                >
                  <CampIcon.Close />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
