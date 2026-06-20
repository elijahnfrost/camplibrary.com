"use client";

// Shared "print now" intent. When `armed` flips true, the hidden `.print-root`
// artifact has just mounted; we wait two animation frames for the browser to
// lay it out, fire window.print(), then clear the intent so a stale hidden sheet
// can never hijack a later Cmd+P. iOS Safari fires `afterprint` unreliably, so
// we also watch the print media query and keep a 1s belt-and-braces fallback.
//
// `onClear` MUST be stable (wrap in useCallback) — it's a dependency, and a
// fresh function each render would re-arm the print loop.

import { useEffect } from "react";

export function usePrintIntent(armed: boolean, onClear: () => void): void {
  useEffect(() => {
    if (!armed) return;
    let fallback = 0;
    let secondFrame = 0;

    const printMedia = window.matchMedia("print");
    const onPrintMediaChange = (event: MediaQueryListEvent) => {
      if (!event.matches) onClear();
    };
    printMedia.addEventListener?.("change", onPrintMediaChange);

    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        window.print();
        // window.print() blocks while the dialog is open in most browsers, so
        // this fires once it's dismissed.
        fallback = window.setTimeout(onClear, 1000);
      });
    });
    window.addEventListener("afterprint", onClear, { once: true });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
      if (fallback) window.clearTimeout(fallback);
      printMedia.removeEventListener?.("change", onPrintMediaChange);
      window.removeEventListener("afterprint", onClear);
    };
  }, [armed, onClear]);
}
