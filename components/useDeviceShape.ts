"use client";

import { useLayoutEffect, useState } from "react";

// ONE source of truth for the app's responsive form factors. Before this hook,
// "is this mobile?" was answered three different ways that could disagree:
// matchMedia("(min-width:768px)") in the shell, innerWidth<768 reads in the
// floating/sheet layers (stale across rotation), and pointer:coarse in the
// calendar — so a 700px window could be "phone" to one and "tablet" to another.
//
// The three tiers map to the CSS shell:
//   · phone   (<768)      — bottom tab bar, FAB, full-screen sheets, docked menus
//   · tablet  (768–1023)  — SAME purpose-built touch shell, but roomy grids; NO
//                           desk sidebar (it would eat ~40% of an iPad-portrait
//                           viewport — the "shrunk desktop" we're removing)
//   · desktop (>=1024)    — the "desk": persistent sidebar + textured stage
//
// `isDesktop` is the seam the desk chrome keys off (sidebar rail portals): it is
// true at >=1024, matching the @media (min-width:1024px) shell block in
// globals.css/calendar.css. Keep these constants and that breakpoint in lockstep.

export const TABLET_MIN = 768;
export const DESKTOP_MIN = 1024;

export type DeviceShape = {
  /** Viewport < 768px. */
  isPhone: boolean;
  /** 768px <= viewport < 1024px (iPad portrait): touch shell, no desk sidebar. */
  isTablet: boolean;
  /** Viewport >= 1024px: the desk shell (sidebar + stage). */
  isDesktop: boolean;
  /** Phone OR tablet: the purpose-built touch shell (tab bar, sheets, FAB). */
  isTouchShell: boolean;
  /** No fine pointer available (touch-primary device). */
  isCoarse: boolean;
};

// SSR / first render assumes the desk so the sidebar rail portals stay mounted
// (matches the prior `useState(true)` default); corrected in a layout effect
// before paint, so phones/tablets never flash desk chrome.
const SERVER_SHAPE: DeviceShape = {
  isPhone: false,
  isTablet: false,
  isDesktop: true,
  isTouchShell: false,
  isCoarse: false,
};

function readShape(): DeviceShape {
  if (typeof window === "undefined") return SERVER_SHAPE;
  const w = window.innerWidth;
  const isDesktop = w >= DESKTOP_MIN;
  const isTablet = w >= TABLET_MIN && w < DESKTOP_MIN;
  const isPhone = w < TABLET_MIN;
  const isCoarse = window.matchMedia("(pointer: coarse)").matches;
  return { isPhone, isTablet, isDesktop, isTouchShell: !isDesktop, isCoarse };
}

export function useDeviceShape(): DeviceShape {
  // Constant initial value (not readShape()) so the hydration render matches the
  // server; the layout effect reconciles to the real viewport before paint.
  const [shape, setShape] = useState<DeviceShape>(SERVER_SHAPE);

  useLayoutEffect(() => {
    let frame = 0;
    const update = () => setShape(readShape());
    update();
    // matchMedia change events fire when a tier boundary is crossed; a coalesced
    // resize listener catches same-tier rotations that callers may care about.
    const mqs = [
      window.matchMedia(`(min-width: ${TABLET_MIN}px)`),
      window.matchMedia(`(min-width: ${DESKTOP_MIN}px)`),
      window.matchMedia("(pointer: coarse)"),
    ];
    const onResize = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        update();
      });
    };
    mqs.forEach((mq) => mq.addEventListener("change", update));
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", update);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      mqs.forEach((mq) => mq.removeEventListener("change", update));
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  return shape;
}
