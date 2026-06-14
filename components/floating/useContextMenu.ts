"use client";

import { useCallback, useState, type MouseEvent } from "react";

export type ContextMenuState<T> = { target: T; point: { x: number; y: number } };

// Wires a right-click into a themed ContextMenu in one line per call site.
// `open(event, target)` captures the cursor point, suppresses the browser's
// native context menu, and stores the domain object the menu acts on.
//
// Right-click is a pointer-fine affordance: contextmenu doesn't fire on a
// touch tap, and every action is also reachable through the app's tap
// surfaces (EventPopover, DetailSheet, always-visible run-list tools). We
// still gate explicitly so intent is clear and a stylus/long-press can't
// surprise a touch user.
export function useContextMenu<T>() {
  const [state, setState] = useState<ContextMenuState<T> | null>(null);

  const open = useCallback((event: MouseEvent, target: T) => {
    if (typeof window !== "undefined" && !window.matchMedia("(pointer: fine)").matches) return;
    event.preventDefault();
    setState({ target, point: { x: event.clientX, y: event.clientY } });
  }, []);

  const close = useCallback(() => setState(null), []);

  return { state, open, close };
}
