"use client";

import type { Activity } from "@/lib/types";
import type { RunDoc } from "@/lib/runList";
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
