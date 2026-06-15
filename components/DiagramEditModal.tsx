"use client";

// Full-screen diagram editor. The read-only viewer already opens diagrams full
// screen (DiagramLightbox) so they're easy to read on a projector; editing now
// gets the same roomy canvas instead of being squeezed into a list row. Portaled
// out of the run-sheet DOM and gated on the dialog focus stack, so Escape /
// outside-click close only this layer and the run sheet underneath stays put.

import { createPortal } from "react-dom";
import type { ActivityPlaybookData } from "@/lib/playbooks";
import { CampIcon } from "./icons";
import { PlaybookEditor } from "./PlaybookEditor";
import { useDialogFocus } from "./useDialogFocus";

export function DiagramEditModal({
  playbook,
  onChange,
  onClose,
}: {
  playbook: ActivityPlaybookData;
  onChange: (next: ActivityPlaybookData) => void;
  onClose: () => void;
}) {
  const dialogRef = useDialogFocus<HTMLDivElement>(onClose);

  return createPortal(
    <div className="diagram-edit-root">
      <button type="button" className="diagram-edit__scrim" aria-label="Done editing diagram" onClick={onClose} />
      <div
        ref={dialogRef}
        className="diagram-edit"
        role="dialog"
        aria-modal="true"
        aria-label={(playbook.title || "Diagram") + " editor"}
        tabIndex={-1}
      >
        <div className="diagram-edit__head">
          <h3 className="diagram-edit__title">{playbook.title || "Diagram"}</h3>
          <button type="button" className="btn btn--primary btn--sm" onClick={onClose}>
            <CampIcon.Check />
            Done
          </button>
        </div>
        <div className="diagram-edit__body">
          <PlaybookEditor value={playbook} onChange={onChange} />
        </div>
      </div>
    </div>,
    document.body
  );
}
