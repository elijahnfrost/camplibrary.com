"use client";

// The shared popup shell both the camp editor and the event window render
// through: a header (identity dot + title + X), a body whose groups separate
// with the ONE dashed hairline token, and a footer (destructive left · green
// primary right). It's a layout skin over the real Modal — focus trap, scrim
// and Escape are all inherited; this file never adds its own key handling (the
// floating engine owns the Escape contract).

import type { CSSProperties, ReactNode } from "react";
import { Modal } from "@/components/ui/Modal";
import { CampIcon } from "@/components/ui/icons";

export function FocusSheet({
  label,
  onClose,
  overlayClass,
  tint,
  title,
  footStart,
  footEnd,
  children,
}: {
  /** The dialog's accessible label. */
  label: string;
  onClose: () => void;
  /** Overlay classes — keep the card sizing (overlay--card +
   *  overlay--manager/--quickadd) and add the lc- skin class on top. */
  overlayClass: string;
  /** Identity tint for the header dot (the camp editor); absent = no dot. */
  tint?: string;
  /** Header content — plain text, or the camp editor's live title input. */
  title: ReactNode;
  /** Footer slots: destructive/quiet actions left, the primary action right.
   *  Both absent = no footer row (the event window's slot posture commits from
   *  the list, so a footer would be an empty band). */
  footStart?: ReactNode;
  footEnd?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Modal label={label} onClose={onClose} overlayProps={{ className: overlayClass }}>
      <div className="overlay__bar lc-sheet__bar">
        <div className="lc-sheet__titlewrap">
          {tint && (
            <span
              className="lc-sheet__dot"
              style={{ "--camp-tint": tint } as CSSProperties}
              aria-hidden="true"
            />
          )}
          {title}
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close" title="Close">
          <CampIcon.Close />
        </button>
      </div>
      <div className="overlay__body lc-sheet__body">
        {children}
        {(footStart || footEnd) && (
          <div className="lc-sheet__foot">
            <div className="lc-sheet__footstart">{footStart}</div>
            <div className="lc-sheet__footend">{footEnd}</div>
          </div>
        )}
      </div>
    </Modal>
  );
}
