"use client";

import { useLayoutEffect, useState, type RefObject } from "react";

// Shared positioning math for every floating layer (dropdowns, date popovers,
// context menus). Generalizes the clamp/flip logic proven in EventPopover so
// the same engine can open BELOW a trigger rect or AT a cursor point, always
// staying inside the viewport.

const MARGIN = 8;

export type FloatingAnchor =
  // Open below a trigger and flip above when the bottom edge is tight.
  | { kind: "rect"; rect: DOMRect; matchWidth?: boolean }
  // Open at a cursor point and flip left/up near the right/bottom edges.
  | { kind: "point"; x: number; y: number };

export type FloatingPosition = {
  left: number;
  top: number;
  /** Set on rect anchors with matchWidth, so the menu spans the trigger. */
  width?: number;
};

// Returns null until the layer has measured itself (one layout pass), so the
// first paint can be suppressed to avoid a flash at (0,0). The phone variant
// (bottom-docked sheet) is handled in CSS — callers pass `docked` to skip
// JS positioning entirely below the tablet breakpoint.
export function useFloatingPosition(
  anchor: FloatingAnchor,
  layerRef: RefObject<HTMLElement | null>,
  docked: boolean
): FloatingPosition | null {
  const [position, setPosition] = useState<FloatingPosition | null>(null);

  // Re-measure whenever the anchor changes. For point anchors that's the x/y;
  // for rect anchors it's the rect identity. Both are passed as deps below.
  const anchorKey =
    anchor.kind === "rect"
      ? `r:${anchor.rect.left},${anchor.rect.top},${anchor.rect.right},${anchor.rect.bottom}:${anchor.matchWidth ? 1 : 0}`
      : `p:${anchor.x},${anchor.y}`;

  useLayoutEffect(() => {
    if (typeof window === "undefined" || docked) {
      setPosition(null);
      return;
    }
    const el = layerRef.current;
    const width = el?.offsetWidth ?? 240;
    const height = el?.offsetHeight ?? 200;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left: number;
    let top: number;

    if (anchor.kind === "rect") {
      const { rect } = anchor;
      left = rect.left;
      if (anchor.matchWidth) {
        left = rect.left;
      } else if (left + width > vw - MARGIN) {
        left = Math.max(MARGIN, vw - width - MARGIN);
      }
      // Open just under the trigger; flip above when there's no room below.
      top = rect.bottom + 4;
      if (top + height > vh - MARGIN) {
        const above = rect.top - height - 4;
        top = above >= MARGIN ? above : Math.max(MARGIN, vh - height - MARGIN);
      }
    } else {
      // Cursor point: place top-left at the cursor, flip leftward/upward when
      // the menu would overflow the right/bottom edge.
      left = anchor.x;
      if (left + width > vw - MARGIN) left = Math.max(MARGIN, anchor.x - width);
      top = anchor.y;
      if (top + height > vh - MARGIN) top = Math.max(MARGIN, anchor.y - height);
    }

    left = Math.min(Math.max(left, MARGIN), Math.max(MARGIN, vw - width - MARGIN));
    setPosition({
      left,
      top,
      width: anchor.kind === "rect" && anchor.matchWidth ? anchor.rect.width : undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorKey, docked]);

  return position;
}
