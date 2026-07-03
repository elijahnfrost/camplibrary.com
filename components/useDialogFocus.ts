"use client";

import { useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusWithoutScroll(element: HTMLElement) {
  element.focus({ preventScroll: true });
}

// Stacked dialogs (sheet → lightbox → present…) each listen on document; only
// the TOPMOST layer may handle keys, so Escape closes one layer at a time.
const dialogStack: HTMLElement[] = [];

// Other document-level key handlers (e.g. the calendar's selection-clearing
// Escape) must bail while any dialog is open — otherwise a capture-phase
// listener outside the stack can eat the key before the topmost dialog sees it.
export function hasOpenDialog(): boolean {
  return dialogStack.length > 0;
}

export function useDialogFocus<T extends HTMLElement>(onClose: () => void) {
  const ref = useRef<T | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const activeDialog = dialog;
    dialogStack.push(activeDialog);

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusFirst = () => {
      // A [data-autofocus] field wins (e.g. the editor's main input) so focus
      // never lands on the Close button just because it's first in the DOM.
      const preferred = activeDialog.querySelector<HTMLElement>("[data-autofocus]");
      const first = preferred || activeDialog.querySelector<HTMLElement>(FOCUSABLE);
      focusWithoutScroll(first || activeDialog);
    };
    const frame = window.requestAnimationFrame(focusFirst);

    function onKeyDown(event: KeyboardEvent) {
      // Inner widgets (palettes, inline editors) claim a key by preventing its
      // default — stopPropagation can't help them, since React's root handlers
      // and this listener both live on `document` in the App Router.
      if (event.defaultPrevented) return;
      if (dialogStack[dialogStack.length - 1] !== activeDialog) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(activeDialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (item) => item.offsetParent !== null || item === document.activeElement,
      );
      if (!focusable.length) {
        event.preventDefault();
        focusWithoutScroll(activeDialog);
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        focusWithoutScroll(last);
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        focusWithoutScroll(first);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      const stackIndex = dialogStack.lastIndexOf(activeDialog);
      if (stackIndex !== -1) dialogStack.splice(stackIndex, 1);
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      if (previouslyFocused?.isConnected) focusWithoutScroll(previouslyFocused);
    };
  }, []);

  return ref;
}
