"use client";

import type { HTMLAttributes, ReactNode } from "react";
import { useDialogFocus } from "./useDialogFocus";

type ModalOverlayProps = HTMLAttributes<HTMLDivElement> & {
  [key: `data-${string}`]: string | undefined;
};

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
  overlayProps,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  overlayProps?: ModalOverlayProps;
}) {
  const dialogRef = useDialogFocus<HTMLDivElement>(onClose);
  const { className: overlayClassName, ...restOverlayProps } = overlayProps ?? {};
  const classes = ["overlay", "overlay--sheet", overlayClassName, className].filter(Boolean).join(" ");

  return (
    <div className="modal-root">
      <button type="button" className="scrim" aria-label="Close" onClick={onClose} />
      <div
        {...restOverlayProps}
        ref={dialogRef}
        className={classes}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
      >
        <div className="overlay__handle" aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}
