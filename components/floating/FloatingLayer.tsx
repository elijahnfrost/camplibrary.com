"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useFloatingPosition, type FloatingAnchor } from "./useFloatingPosition";
import { DESKTOP_MIN } from "../useDeviceShape";

// The portaled floating engine shared by Select, DatePopover, and ContextMenu.
// It owns the universal layer behaviour: a transparent scrim that catches the
// outside click, pointerdown-outside dismissal, Escape, and scroll/resize
// dismissal — exactly the contract EventPopover established, generalized to
// open from either a trigger rect or a cursor point.
//
//  · Portals to document.body so the layer escapes the overflow:hidden on
//    modals (.overlay) and scroll containers (.app__scroll).
//  · Escape calls event.preventDefault() and NEVER stopPropagation — the
//    document-level useDialogFocus handler bails on event.defaultPrevented, so
//    Escape closes this layer first without also closing an underlying Modal.
//  · It does NOT register on useDialogFocus's dialogStack: a transient menu is
//    not a focus-trapping dialog. The preventDefault contract is the handshake.

export function FloatingLayer({
  anchor,
  onClose,
  className,
  role,
  ariaLabel,
  initialFocus = true,
  children,
}: {
  anchor: FloatingAnchor;
  onClose: () => void;
  className: string;
  role: "menu" | "listbox" | "dialog";
  ariaLabel: string;
  /** Move focus into the layer on open (menus); false keeps focus on a trigger. */
  initialFocus?: boolean;
  children: ReactNode;
}) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Below the desk breakpoint (phone + tablet) the layer is a bottom-docked sheet
  // styled in CSS; at/above it, JS anchors it to the trigger. The layer closes on
  // resize, so this recomputes each open — no stale read across rotation.
  const docked = typeof window !== "undefined" && window.innerWidth < DESKTOP_MIN;
  const position = useFloatingPosition(anchor, layerRef, docked);

  // Restore focus to whatever was focused before the layer opened.
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previouslyFocused.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (layerRef.current && !layerRef.current.contains(event.target as Node)) {
        onCloseRef.current();
      }
    };
    // A scroll anywhere outside the layer detaches it from its anchor — close
    // rather than chase it (matches EventPopover). The layer's own internal
    // scroll (a long option list) is excluded via contains().
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && layerRef.current?.contains(event.target)) return;
      onCloseRef.current();
    };

    const onResize = () => onCloseRef.current();
    // Capture phase so this Escape handler runs BEFORE any bubble-phase
    // document listener an underlying Modal registered (useDialogFocus). It
    // preventDefault()s, so the Modal's handler then bails on defaultPrevented
    // — Escape closes this layer first, the Modal stays open. (A later-mounted
    // bubble listener would run AFTER the Modal's, closing both.)
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", onResize);

    const frame = window.requestAnimationFrame(() => {
      if (!initialFocus) return;
      const first = layerRef.current?.querySelector<HTMLElement>(
        '[data-floating-first], [role="menuitem"]:not([aria-disabled="true"]), [role="option"], button:not([disabled])'
      );
      (first ?? layerRef.current)?.focus({ preventScroll: true });
    });

    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("scroll", onScroll, { capture: true } as EventListenerOptions);
      window.removeEventListener("resize", onResize);
      if (previouslyFocused.current?.isConnected) {
        previouslyFocused.current.focus({ preventScroll: true });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="floating-root">
      <button type="button" className="floating__scrim" aria-label="Close" onClick={onClose} />
      <div
        ref={layerRef}
        className={className}
        role={role}
        aria-label={ariaLabel}
        tabIndex={-1}
        style={
          docked
            ? undefined
            : position
              ? { left: position.left, top: position.top, width: position.width, visibility: "visible" }
              : { left: 0, top: 0, visibility: "hidden" }
        }
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
