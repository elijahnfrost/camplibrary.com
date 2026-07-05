"use client";

import type { SeriesScope } from "@/lib/calendar/recurrence";
import { Modal } from "../ui/Modal";

// The Google Calendar scope chooser. The P3 wave made routine gestures commit
// instantly with toast escalation, so this dialog is no longer the default path —
// it survives ONLY as the deliberate "Delete entire series…" safety hatch on the
// right-click menu (mode "delete", the following/all scopes). `scopes` filters
// which choices show; it defaults to all three for any future caller.

const SCOPE_LABELS: Record<SeriesScope, string> = {
  this: "This event",
  following: "This and following events",
  all: "All events",
};

export function SeriesScopeDialog({
  action,
  title,
  scopes = ["this", "following", "all"],
  onPick,
  onClose,
}: {
  action: "edit" | "delete";
  title: string;
  /** Which scope choices to offer (in order). The safety-hatch caller passes
   *  ["following", "all"] — "this" already has its own instant path. */
  scopes?: SeriesScope[];
  onPick: (scope: SeriesScope) => void;
  onClose: () => void;
}) {
  const verb = action === "delete" ? "Delete" : "Edit";
  const danger = action === "delete";
  const options: { scope: SeriesScope; label: string }[] = scopes.map((scope) => ({
    scope,
    label: SCOPE_LABELS[scope],
  }));

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
          {options.map((option, index) => (
            <button
              key={option.scope}
              type="button"
              className={"scopedlg__opt" + (danger ? " is-danger" : "")}
              onClick={() => onPick(option.scope)}
              data-autofocus={index === 0 ? true : undefined}
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
