"use client";

import type { SeriesScope } from "@/lib/calendar/recurrence";
import { Modal } from "../Modal";

// The Google Calendar scope chooser: editing or deleting one occurrence of a
// repeating event asks whether it applies to just this event, this and the
// following ones, or the whole series. Three plain choices + cancel.

export function SeriesScopeDialog({
  action,
  title,
  onPick,
  onClose,
}: {
  action: "edit" | "delete";
  title: string;
  onPick: (scope: SeriesScope) => void;
  onClose: () => void;
}) {
  const verb = action === "delete" ? "Delete" : "Edit";
  const danger = action === "delete";
  const options: { scope: SeriesScope; label: string }[] = [
    { scope: "this", label: "This event" },
    { scope: "following", label: "This and following events" },
    { scope: "all", label: "All events" },
  ];

  return (
    <Modal
      label={verb + " repeating event"}
      onClose={onClose}
      overlayProps={{ className: "overlay--card overlay--scope" }}
    >
      <div className="scopedlg">
        <div className="scopedlg__head">
          <h2 className="scopedlg__title">{verb} repeating event</h2>
          <p className="scopedlg__sub">“{title || "Untitled"}”</p>
        </div>
        <div className="scopedlg__opts">
          {options.map((option) => (
            <button
              key={option.scope}
              type="button"
              className={"scopedlg__opt" + (danger ? " is-danger" : "")}
              onClick={() => onPick(option.scope)}
              data-autofocus={option.scope === "this" ? true : undefined}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="scopedlg__foot">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}
