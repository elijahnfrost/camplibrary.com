// Geometry for dragging a reminder marker on the time grid, kept pure so it's
// unit-tested apart from the DOM. A reminder is drawn as an overlay marker
// positioned by a top percentage of a day column's frame (gridStart..gridEnd), so
// a drag maps the cursor's vertical offset back to a minute-of-day the same way.

import { SNAP_MIN } from "./time";

// Map a vertical pixel offset within a day column's frame to a snapped
// minute-of-day, clamped to the drawn window. `relY` is measured from the frame's
// top; `frameHeight` is the frame's full drawn height (which spans the window
// gridStart..gridEnd). Mirrors the marker's own top% placement, inverted.
export function yToMinutes(
  relY: number,
  frameHeight: number,
  gridStart: number,
  gridEnd: number,
  snap: number = SNAP_MIN
): number {
  const span = gridEnd - gridStart;
  if (frameHeight <= 0 || span <= 0) return gridStart;
  const raw = gridStart + (relY / frameHeight) * span;
  const snapped = Math.round(raw / snap) * snap;
  return Math.max(gridStart, Math.min(gridEnd, snapped));
}
