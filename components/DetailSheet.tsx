"use client";

// THE unified activity surface: create, edit, and browse all render here.
//
//   · browse (read)  — the item detail view: header + the full resolved run-doc,
//                      read-only. A stray tap never pops the keyboard.
//   · edit (in place)— the SAME surface flips editable: the scalar Activity-card
//                      controls (ActivityFields) at the top + the run-doc editor
//                      (scaffold-stripped play content) below + a Save button.
//   · create         — the same edit surface, opened blank, with no read view to
//                      fall back to (Cancel returns to where you came from).
//
// Every property editable on an existing activity is editable at creation in the
// same positions, because both go through ONE form. The Details/Materials FACTS
// live ONLY in the scalar controls; in edit mode the play-doc has its details/
// materials scaffold stripped (so there's no second editable copy — no dual-
// write). On save, buildSaveDoc re-derives the full scaffold, so saved Activity
// + runLists overrides keep exactly the same shape as before (old data loads).

import { useMemo, useRef, useState, type TouchEvent } from "react";
import type { Activity } from "@/lib/types";
import type { AgeUnit } from "@/lib/data";
import type { Theme } from "@/lib/themes";
import type { RunDoc } from "@/lib/runList";
import {
  BLANK_FORM,
  activityFromForm,
  blankPlayDoc,
  buildSaveDoc,
  formFromActivity,
  newActivityId,
  playDocForActivity,
  validateForm,
  type FormState,
} from "@/lib/activityForm";
import { CampIcon } from "./icons";
import { SaveButton, ThemeBadge } from "./primitives";
import { Modal } from "./Modal";
import { ActivityFields, type ThemeKit } from "./ActivityFields";
import { ActivityRunList } from "./ActivityRunList";
import { DESKTOP_MIN } from "./useDeviceShape";

export type { ThemeKit } from "./ActivityFields";

export function DetailSheet({
  activity: a,
  mode = "view",
  startEditing = false,
  isFav,
  onToggleFav,
  onClose,
  onSetRating,
  onSubmit,
  onDuplicate,
  onDelete,
  onPrint,
  showOwnerActions = true,
  availableMaterials,
  onToggleMaterial,
  runDoc,
  onSaveRunDoc,
  themeKit,
  ageUnit = "grades",
  onAgeUnit,
  eventContext,
  backLabel = "Library",
  theme = null,
}: {
  activity: Activity;
  /** "create" opens blank in edit mode with no read view; "view" browses. */
  mode?: "create" | "view";
  /** Open an EXISTING activity straight in edit mode (e.g. a "Edit" menu item),
   *  rather than browse-then-pencil. Ignored in create mode (always editing). */
  startEditing?: boolean;
  isFav: (id: string) => boolean;
  onToggleFav: (id: string) => void;
  onClose: () => void;
  onSetRating?: (id: string, val: number) => void;
  /** Commit the edited activity + its run doc + theme. Required for create/edit;
   *  absent (e.g. public viewer) keeps the surface strictly read-only. */
  onSubmit?: (a: Activity, runDoc: RunDoc, themeId: string | null) => void;
  onDuplicate: (a: Activity) => void;
  onDelete: (a: Activity) => void;
  onPrint: (a: Activity) => void;
  showOwnerActions?: boolean;
  availableMaterials: string[];
  onToggleMaterial: (id: string) => void;
  runDoc: RunDoc;
  /** Live run-doc save (read-mode field-note capture). Gates `canCapture`. */
  onSaveRunDoc?: (activityId: string, doc: RunDoc) => void;
  /** Theme vocabulary + quick-create for the edit-mode Theme field. */
  themeKit?: ThemeKit;
  ageUnit?: AgeUnit;
  onAgeUnit?: (v: AgeUnit) => void;
  /** Display-only strings from the calendar event this was opened from. */
  eventContext?: { dateLabel: string; timeLabel: string };
  /** Where closing the viewer returns to (the surface it was opened from). */
  backLabel?: string;
  /** The activity's theme tag (null = untagged); display-only here. */
  theme?: Theme | null;
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const swipeStartRef = useRef<{ x: number; y: number; scrollTop: number } | null>(null);

  const isCreate = mode === "create";
  const canEdit = Boolean(onSubmit);

  // Read-only by default: on a phone mirrored to a projector, a stray tap must
  // never pop the keyboard. The pencil toggle opts into editing explicitly.
  // Create opens straight into the form (there is no read view to show yet); an
  // explicit "Edit" entry point can also start an existing activity in edit.
  const [editing, setEditing] = useState(isCreate || (startEditing && canEdit));

  // The edit-mode draft: the scalar form state + the scaffold-stripped play
  // content. Seeded once on entering edit, committed atomically on Save (the
  // same draft-then-save model the old AddView used, now hosted in place).
  const [form, setForm] = useState<FormState>(() =>
    isCreate
      ? { ...BLANK_FORM, themeId: themeKit?.initialThemeId ?? "" }
      : formFromActivity(a, themeKit?.initialThemeId ?? "")
  );
  const [playDoc, setPlayDoc] = useState<RunDoc>(() =>
    isCreate ? blankPlayDoc() : playDocForActivity(a, runDoc)
  );

  // The activity object the run-doc editor previews against while editing — its
  // category tint, materials, etc. track the scalar controls live (the same
  // draft the old AddView fed the embedded run list).
  const draftActivity = useMemo(
    () => activityFromForm(form, isCreate ? "draft-activity" : a.id),
    [form, isCreate, a.id]
  );

  const v = validateForm(form);

  // Enter edit on an existing activity: snapshot a fresh draft from the live
  // facts so an aborted edit (Cancel) never half-applies.
  const beginEdit = () => {
    if (!canEdit) return;
    setForm(formFromActivity(a, themeKit?.initialThemeId ?? ""));
    setPlayDoc(playDocForActivity(a, runDoc));
    setEditing(true);
  };

  const cancelEdit = () => {
    // On create there is nothing behind the form, so Cancel closes the surface.
    if (isCreate) onClose();
    else setEditing(false);
  };

  const submit = () => {
    if (!onSubmit || !v.valid) return;
    const id = isCreate ? newActivityId(form.title) : a.id;
    const { doc, extracted } = buildSaveDoc(form, id, playDoc);
    // The Activity is derived ENTIRELY from the form (+ the run text extracted
    // from the doc), exactly as the old AddView.submit did — so the saved record
    // shape is unchanged and old data keeps loading.
    onSubmit(activityFromForm(form, id, extracted), doc, form.themeId || null);
    // The parent owns what happens next (close on create, drop edit on save);
    // dropping local edit here keeps the read view consistent if it stays open.
    if (!isCreate) setEditing(false);
  };

  // On the touch shell (phone + tablet), a downward swipe that STARTS on the
  // BROWSE header closes the viewer — scoping it to the header keeps iOS
  // rubber-band overscroll in the step list from accidentally dismissing the
  // whole sheet mid-activity. Disabled in edit mode (a swipe must never discard
  // unsaved edits — the explicit Cancel button is the escape hatch there).
  // Re-read per gesture, so rotation is always reflected.
  const onBodyTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    if (editing || event.touches.length !== 1 || typeof window === "undefined" || window.innerWidth >= DESKTOP_MIN) return;
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

  const modalLabel = isCreate ? "Add activity" : editing ? "Edit " + a.title : a.title;

  return (
    <Modal
      label={modalLabel}
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
        {editing ? (
          // ---- CREATE / EDIT: the one form, in place ----
          <>
            {/* Always-visible escape hatch — on a phone the sheet covers the
                whole screen and a scrim tap shouldn't be the only way out.
                Owner actions (Duplicate/Delete) live here in edit mode, where
                the old viewer kept them, so the browse header stays minimal. */}
            <div className="rlv-head__row sheet-head">
              <button
                type="button"
                className="rlv-back"
                onClick={cancelEdit}
                aria-label={isCreate ? "Back to " + backLabel : "Cancel editing"}
              >
                <CampIcon.ChevronLeft />
                {isCreate ? backLabel : "Cancel"}
              </button>
              <span className="rlv-head__sp" />
              <span className="sheet-head__title">{isCreate ? "New activity" : "Editing"}</span>
              {showOwnerActions && !isCreate && (
                <>
                  {/* Duplicate works for built-ins too (it forks a custom copy). */}
                  <button
                    type="button"
                    className="rlv-headbtn"
                    onClick={() => onDuplicate(a)}
                    aria-label="Duplicate activity"
                    title="Duplicate activity"
                  >
                    <CampIcon.Copy />
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
            </div>
            <div className="form form--activity fadein">
              <ActivityFields
                form={form}
                onChange={setForm}
                themeKit={themeKit}
                ageUnit={ageUnit}
                onAgeUnit={onAgeUnit}
              />

              <div className="form__section">How to play</div>
              <div className="form__runlist">
                <ActivityRunList
                  doc={playDoc}
                  editable
                  onChange={setPlayDoc}
                  activity={draftActivity}
                  availableMaterials={[]}
                  onToggleMaterial={() => {}}
                  hideAddBlocks={["details", "materials"]}
                />
              </div>

              <button
                type="button"
                className="btn btn--primary btn--block"
                disabled={!v.valid}
                onClick={submit}
              >
                {isCreate ? <CampIcon.Plus /> : <CampIcon.Check />}
                {isCreate ? "Add to library" : "Save changes"}
              </button>
              <div style={{ height: 8 }} />
            </div>
          </>
        ) : (
          // ---- BROWSE: the item detail view, read-only ----
          <article className="rlv">
            <header className="rlv-head">
              <div className="rlv-head__row">
                <button type="button" className="rlv-back" onClick={onClose} aria-label={"Back to " + backLabel}>
                  <CampIcon.ChevronLeft />
                  {backLabel}
                </button>
                <span className="rlv-head__sp" />
                {canEdit && (
                  // The pencil opens the SAME surface in edit mode (the form +
                  // the run-doc editor); owner actions live in that edit header.
                  <button
                    type="button"
                    className="rlv-headbtn"
                    onClick={beginEdit}
                    aria-label="Edit activity"
                    title="Edit activity"
                  >
                    <CampIcon.Pencil />
                  </button>
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
              editable={false}
              onChange={(next) => onSaveRunDoc?.(a.id, next)}
              activity={a}
              availableMaterials={availableMaterials}
              onToggleMaterial={onToggleMaterial}
              onSetRating={onSetRating ? (value) => onSetRating(a.id, value) : undefined}
              // Lets staff jot field notes straight from the read-only viewer
              // while running the game — no edit-mode toggle needed.
              canCapture={Boolean(onSaveRunDoc)}
            />
          </article>
        )}
      </div>
    </Modal>
  );
}
