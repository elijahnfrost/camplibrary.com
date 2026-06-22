"use client";

import { useRef, useState, type TouchEvent } from "react";
import type { Activity } from "@/lib/types";
import type { Theme } from "@/lib/themes";
import type { RunDoc } from "@/lib/runList";
import { CampIcon } from "./icons";
import { SaveButton, ThemeBadge } from "./primitives";
import { Modal } from "./Modal";
import { ActivityRunList } from "./ActivityRunList";

export function DetailSheet({
  activity: a,
  isFav,
  onToggleFav,
  onClose,
  onSetRating,
  isCustom,
  onEdit,
  onDuplicate,
  onDelete,
  onPrint,
  showOwnerActions = true,
  availableMaterials,
  onToggleMaterial,
  runDoc,
  onSaveRunDoc,
  eventContext,
  backLabel = "Library",
  theme = null,
}: {
  activity: Activity;
  isFav: (id: string) => boolean;
  onToggleFav: (id: string) => void;
  onClose: () => void;
  onSetRating?: (id: string, val: number) => void;
  isCustom: boolean;
  onEdit: (a: Activity) => void;
  onDuplicate: (a: Activity) => void;
  onDelete: (a: Activity) => void;
  onPrint: (a: Activity) => void;
  showOwnerActions?: boolean;
  availableMaterials: string[];
  onToggleMaterial: (id: string) => void;
  runDoc: RunDoc;
  onSaveRunDoc?: (activityId: string, doc: RunDoc) => void;
  /** Display-only strings from the calendar event this was opened from. */
  eventContext?: { dateLabel: string; timeLabel: string };
  /** Where closing the viewer returns to (the surface it was opened from). */
  backLabel?: string;
  /** The activity's theme tag (null = untagged); display-only here. */
  theme?: Theme | null;
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const swipeStartRef = useRef<{ x: number; y: number; scrollTop: number } | null>(null);

  // Read-only by default: on a phone mirrored to a projector, a stray tap must
  // never pop the keyboard. The pencil toggle opts into editing explicitly.
  const [editing, setEditing] = useState(false);
  const canEdit = Boolean(onSaveRunDoc);
  const editable = editing && canEdit;
  const showOwner = showOwnerActions && isCustom;

  // On phones, a downward swipe that STARTS on the header closes the viewer —
  // scoping it to the header keeps iOS rubber-band overscroll in the step list
  // from accidentally dismissing the whole sheet mid-activity.
  const onBodyTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 1 || typeof window === "undefined" || window.innerWidth >= 768) return;
    const body = bodyRef.current;
    const onHeader = Boolean((event.target as HTMLElement).closest(".rlv-head, .overlay__handle"));
    if (!body || body.scrollTop > 4 || !onHeader) {
      swipeStartRef.current = null;
      return;
    }
    const touch = event.touches[0];
    swipeStartRef.current = { x: touch.clientX, y: touch.clientY, scrollTop: body.scrollTop };
  };

  const onBodyTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start || start.scrollTop > 4 || event.changedTouches.length !== 1) return;
    const touch = event.changedTouches[0];
    const dx = Math.abs(touch.clientX - start.x);
    const dy = touch.clientY - start.y;
    if (dy > 96 && dy > dx * 1.4) onClose();
  };

  const onBodyTouchCancel = () => {
    swipeStartRef.current = null;
  };

  return (
    <Modal
      label={a.title}
      onClose={onClose}
      overlayProps={{
        className: "overlay--viewer",
        "data-viewer-view": "stack",
      }}
    >
      <div
        className="overlay__body rlv-body"
        ref={bodyRef}
        onTouchStart={onBodyTouchStart}
        onTouchEnd={onBodyTouchEnd}
        onTouchCancel={onBodyTouchCancel}
      >
        <article className="rlv">
          <header className="rlv-head">
            <div className="rlv-head__row">
              <button type="button" className="rlv-back" onClick={onClose} aria-label={"Back to " + backLabel}>
                <CampIcon.ChevronLeft />
                {backLabel}
              </button>
              <span className="rlv-head__sp" />
              {canEdit && (
                <button
                  type="button"
                  className={"rlv-headbtn" + (editing ? " is-on" : "")}
                  onClick={() => setEditing((on) => !on)}
                  aria-label={editing ? "Done editing" : "Edit run list"}
                  aria-pressed={editing}
                  title={editing ? "Done editing" : "Edit run list"}
                >
                  <CampIcon.Pencil />
                </button>
              )}
              {showOwnerActions && editing && (
                // Duplicate works for built-ins too (it forks a custom copy),
                // so it lives outside the isCustom gate the edit/delete pair uses.
                <button
                  type="button"
                  className="rlv-headbtn"
                  onClick={() => onDuplicate(a)}
                  aria-label="Duplicate activity"
                  title="Duplicate activity"
                >
                  <CampIcon.Copy />
                </button>
              )}
              {showOwner && editing && (
                // Owner actions live inside edit mode — read mode keeps the
                // header to the essentials so it fits one row on a phone.
                <>
                  <button type="button" className="rlv-headbtn" onClick={() => onEdit(a)} aria-label="Edit activity">
                    <CampIcon.Tool />
                  </button>
                  <button
                    type="button"
                    className="rlv-headbtn rlv-headbtn--danger"
                    onClick={() => onDelete(a)}
                    aria-label="Delete activity"
                  >
                    <CampIcon.Trash />
                  </button>
                </>
              )}
              <button
                type="button"
                className="book-print-chip"
                onClick={() => onPrint(a)}
                aria-label={"Print or save " + a.title + " as a PDF"}
                title="Print this book — or save it as a PDF from the print dialog"
              >
                <CampIcon.Print />
                <span>Print / PDF</span>
              </button>
              <SaveButton on={isFav(a.id)} onToggle={() => onToggleFav(a.id)} stop={false} />
            </div>

            {eventContext && (
              <div className="rlv-eventchip">
                <CampIcon.Calendar />
                <span>
                  {eventContext.dateLabel} · {eventContext.timeLabel}
                </span>
              </div>
            )}

            <h2 className="rlv-title">{a.title}</h2>
            {a.blurb ? <p className="rlv-blurb">{a.blurb}</p> : null}
            {a.altNames && a.altNames.length ? (
              <p className="rlv-aka">Also called {a.altNames.join(" · ")}</p>
            ) : null}
            {theme && <ThemeBadge theme={theme} className="rlv-theme" />}
          </header>

          <ActivityRunList
            doc={runDoc}
            editable={editable}
            onChange={(next) => onSaveRunDoc?.(a.id, next)}
            activity={a}
            availableMaterials={availableMaterials}
            onToggleMaterial={onToggleMaterial}
            onSetRating={onSetRating ? (value) => onSetRating(a.id, value) : undefined}
          />
        </article>
      </div>
    </Modal>
  );
}
