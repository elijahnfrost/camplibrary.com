"use client";

// Themed replacement for the native browser confirm() dialog. Two pieces:
//   · requestConfirm(opts) — call from anywhere (components, hooks, plain
//     functions); returns a Promise<boolean> that resolves true on Confirm,
//     false on Cancel/scrim/Escape.
//   · <ConfirmHost /> — mount ONCE near the app root; it renders the active
//     request (if any) in the shared Modal, so it inherits the scrim/focus/
//     Escape stack contract from useDialogFocus for free.
//
// Only one confirm shows at a time. A second request while one is open is
// QUEUED (not resolved false) — house rule chosen so a rapid double-trigger
// (e.g. two menu clicks) never silently drops the second action; the caller
// just waits an extra beat for their dialog.

import { useEffect, useState } from "react";
import { Modal } from "./Modal";

export type ConfirmOptions = {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Confirm button reads as destructive (danger treatment). */
  danger?: boolean;
};

type ConfirmRequest = ConfirmOptions & {
  resolve: (value: boolean) => void;
};

let activeRequest: ConfirmRequest | null = null;
const queue: ConfirmRequest[] = [];
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function advance() {
  activeRequest = queue.shift() ?? null;
  notify();
}

export function requestConfirm(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const request: ConfirmRequest = { ...opts, resolve };
    if (activeRequest) {
      queue.push(request);
      return;
    }
    activeRequest = request;
    notify();
  });
}

function settle(value: boolean) {
  const request = activeRequest;
  if (!request) return;
  request.resolve(value);
  advance();
}

export function ConfirmHost() {
  const [request, setRequest] = useState<ConfirmRequest | null>(activeRequest);

  useEffect(() => {
    const listener = () => setRequest(activeRequest);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  if (!request) return null;

  const { title, body, danger } = request;
  const confirmLabel = request.confirmLabel ?? "Confirm";
  const cancelLabel = request.cancelLabel ?? "Cancel";

  return (
    <Modal label={title} onClose={() => settle(false)} overlayProps={{ className: "overlay--card overlay--confirm" }}>
      <div className="confirm">
        <div className="confirm__body">
          <strong className="confirm__title">{title}</strong>
          {body && <p className="confirm__copy">{body}</p>}
        </div>
        <div className="confirm__foot">
          <button type="button" className="btn btn--ghost" onClick={() => settle(false)} data-autofocus={danger ? true : undefined}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={"btn btn--primary" + (danger ? " confirm__btn--danger" : "")}
            onClick={() => settle(true)}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
