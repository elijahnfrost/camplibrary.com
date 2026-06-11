"use client";

// Full-screen, one-frame-at-a-time diagram viewer — the projector-friendly way
// to walk a field setup. Reuses the playbook SVG primitives untouched, adds a
// prev/next frame stepper (FrameStepper) with the caption at reading size.

import { useId, useState } from "react";
import { createPortal } from "react-dom";
import type { ActivityPlaybookData } from "@/lib/playbooks";
import { CampIcon } from "./icons";
import { FieldFrame } from "./ActivityPlaybook";
import { useDialogFocus } from "./useDialogFocus";

export function FrameStepper({
  playbook,
  frameIndex,
  onFrameIndex,
  idBase,
}: {
  playbook: ActivityPlaybookData;
  frameIndex: number;
  onFrameIndex: (next: number) => void;
  idBase: string;
}) {
  const frames = playbook.frames;
  const index = Math.max(0, Math.min(frames.length - 1, frameIndex));
  const frame = frames[index];
  if (!frame) return null;

  return (
    <div className="framestep">
      <div className="framestep__stage">
        <FieldFrame
          frame={frame}
          split={playbook.surface?.split}
          showHead={false}
          markerBase={idBase + "-" + frame.id}
        />
      </div>
      <div className="framestep__bar">
        <button
          type="button"
          className="icon-btn"
          onClick={() => onFrameIndex(index - 1)}
          disabled={index === 0}
          aria-label="Previous stage"
        >
          <CampIcon.ChevronLeft />
        </button>
        <div className="framestep__caption">
          <strong>{frame.name}</strong>
          {frame.caption ? <p>{frame.caption}</p> : null}
        </div>
        <button
          type="button"
          className="icon-btn"
          onClick={() => onFrameIndex(index + 1)}
          disabled={index >= frames.length - 1}
          aria-label="Next stage"
        >
          <CampIcon.ChevronRight />
        </button>
      </div>
      {frames.length > 1 && (
        <div className="framestep__dots" aria-hidden="true">
          {frames.map((f, i) => (
            <span key={f.id} className={i === index ? "is-on" : ""} />
          ))}
        </div>
      )}
    </div>
  );
}

export function DiagramLightbox({
  playbook,
  onClose,
}: {
  playbook: ActivityPlaybookData;
  onClose: () => void;
}) {
  const dialogRef = useDialogFocus<HTMLDivElement>(onClose);
  const [frameIndex, setFrameIndex] = useState(0);
  const idBase = useId().replace(/[^a-zA-Z0-9_-]/g, "");

  // Portaled out of the sheet's DOM so the layers stack independently —
  // Escape closes only the lightbox (useDialogFocus gates on focus ownership).
  return createPortal(
    <div className="lightbox-root">
      <button type="button" className="lightbox__scrim" aria-label="Close diagram" onClick={onClose} />
      <div
        ref={dialogRef}
        className="lightbox"
        role="dialog"
        aria-modal="true"
        aria-label={playbook.title + " diagram"}
        tabIndex={-1}
      >
        <div className="lightbox__head">
          <h3 className="lightbox__title">{playbook.title}</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <CampIcon.Close />
          </button>
        </div>
        <FrameStepper
          playbook={playbook}
          frameIndex={frameIndex}
          onFrameIndex={(next) => setFrameIndex(Math.max(0, Math.min(playbook.frames.length - 1, next)))}
          idBase={"lightbox-" + idBase}
        />
      </div>
    </div>,
    document.body
  );
}
