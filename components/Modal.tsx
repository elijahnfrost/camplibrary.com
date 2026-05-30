"use client";

import { useEffect, type ReactNode } from "react";

/**
 * Bottom sheet on phones, centered card on larger surfaces.
 * The `.modal-root` wrapper is `display: contents` on mobile (so the sheet
 * animation is untouched) and a flex-centering layer from the tablet
 * breakpoint up — see globals.css.
 */
export function Modal({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-root">
      <div className="scrim" onClick={onClose} />
      <div className="overlay overlay--sheet" role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>
  );
}
