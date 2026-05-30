"use client";

import type { ReactNode } from "react";
import { useDialogFocus } from "./useDialogFocus";

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
  className = "",
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const dialogRef = useDialogFocus<HTMLDivElement>(onClose);

  return (
    <div className="modal-root">
      <div className="scrim" onClick={onClose} />
      <div
        ref={dialogRef}
        className={"overlay overlay--sheet" + (className ? " " + className : "")}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}
