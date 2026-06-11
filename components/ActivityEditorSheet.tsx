"use client";

import type { Activity } from "@/lib/types";
import type { RunDoc } from "@/lib/runList";
import { CampIcon } from "./icons";
import { Modal } from "./Modal";
import { AddView } from "./AddView";

/**
 * The Add/Edit activity form as an in-Library sheet, replacing the old
 * standalone Add tab. `editing` null = cataloging a new activity.
 */
export function ActivityEditorSheet({
  editing,
  initialRunDoc,
  onClose,
  onSubmit,
}: {
  editing: Activity | null;
  initialRunDoc: RunDoc | null;
  onClose: () => void;
  onSubmit: (a: Activity, runDoc?: RunDoc) => void;
}) {
  return (
    <Modal
      label={editing ? "Edit " + editing.title : "Add activity"}
      onClose={onClose}
      overlayProps={{
        className: "overlay--viewer",
        "data-viewer-view": "stack",
      }}
    >
      <div className="overlay__body rlv-body">
        {/* Always-visible escape hatch — on a phone the sheet covers the
            whole screen and a scrim tap shouldn't be the only way out. */}
        <div className="rlv-head__row sheet-head">
          <button type="button" className="rlv-back" onClick={onClose} aria-label="Back to Library">
            <CampIcon.ChevronLeft />
            Library
          </button>
          <span className="rlv-head__sp" />
          <span className="sheet-head__title">{editing ? "Edit activity" : "New activity"}</span>
        </div>
        <AddView
          initial={editing}
          initialRunDoc={initialRunDoc}
          onCancelEdit={onClose}
          onSubmit={onSubmit}
        />
      </div>
    </Modal>
  );
}
