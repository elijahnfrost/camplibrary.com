"use client";

import { useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusWithoutScroll(element: HTMLElement) {
  element.focus({ preventScroll: true });
}

export function useDialogFocus<T extends HTMLElement>(onClose: () => void) {
  const ref = useRef<T | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const activeDialog = dialog;

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusFirst = () => {
      const first = activeDialog.querySelector<HTMLElement>(FOCUSABLE);
      focusWithoutScroll(first || activeDialog);
    };
    const frame = window.requestAnimationFrame(focusFirst);

    function onKeyDown(event: KeyboardEvent) {
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
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      if (previouslyFocused?.isConnected) focusWithoutScroll(previouslyFocused);
    };
  }, []);

  return ref;
}
