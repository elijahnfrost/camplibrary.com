"use client";

// THE unified activity surface: create, edit, and browse all render here.
//
//   · browse (read)  — the item detail view: header + the full resolved run-doc,
//                      read-only. A stray tap never pops the keyboard.
//   · edit (in place)— the SAME surface flips editable: the RUN SHEET becomes the
//                      editor. Title/blurb/also-called are inline-editable in the
//                      header (with the color swatch); the detail FACTS are
//                      structured dropdowns inside the run sheet's Details block;
//                      Materials are edited inline in the Materials block; the
//                      play content (steps/notes/safety/…) edits in place; a Save
//                      button commits. There is NO separate form above the doc.
//   · create         — the same edit surface, opened blank (a clean slate): an
//                      empty title placeholder, default tags as dropdowns, one
//                      empty step, empty materials. Cancel returns to where you
//                      came from (there is no read view to fall back to).
//
// Every property editable on an existing activity is editable at creation in the
// same positions, because both go through ONE FormState draft. The Details/
// Materials FACTS live ONLY in the inline dropdown controls (single source); in
// edit mode the play-doc has its details/materials scaffold stripped (so there's
// no second editable copy — no dual-write). On save, buildSaveDoc re-derives the
// full scaffold from the form, so saved Activity + runLists overrides keep
// exactly the same shape as before (old data loads).

import { useMemo, useRef, useState, type TouchEvent } from "react";
import type { Activity } from "@/lib/types";
import type { AgeUnit } from "@/lib/data";
import type { Theme } from "@/lib/themes";
import type { RunDoc } from "@/lib/runList";
import type { Material } from "@/lib/materialCatalog";
import type { StockState } from "@/lib/kitStock";
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
import { categoryTint } from "@/lib/data";
import { CampIcon } from "./icons";
import { SaveButton, ThemeBadge } from "./primitives";
import { Modal } from "./Modal";
import { ColorField } from "./floating/ColorField";
import { ActivityRunList } from "./ActivityRunList";
import { type ThemeKit } from "./ThemeField";
import { DESKTOP_MIN } from "./useDeviceShape";

export type { ThemeKit } from "./ThemeField";

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
  kitStock,
  materialCatalog,
  onSetStockState,
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
  /** The effective 3-state kit stock map (material id → have/low/out) the run
   *  sheet's checklist reads. Empty ({}) = UNSET (the availability lens is inert).
   *  Absent on read-only/public surfaces (they stay availability-inert). */
  kitStock?: Record<string, StockState>;
  /** The materials catalog — display names + substitution groups for coverage. */
  materialCatalog?: Material[];
  /** Cycle one material's stock state (have → low → out). Staff-gated upstream;
   *  absent on public/read-only surfaces (the checklist becomes a no-op). */
  onSetStockState?: (id: string, state: StockState) => void;
  runDoc: RunDoc;
  /** Live run-doc save (read-mode field-note capture). Gates `canCapture`. */
  onSaveRunDoc?: (activityId: string, doc: RunDoc) => void;
  /** Theme vocabulary + quick-create for the edit-mode Theme field. */
  themeKit?: ThemeKit;
  ageUnit?: AgeUnit;
  onAgeUnit?: (v: AgeUnit) => void;
  /** Display-only strings from the calendar event this was opened from. `note`
   *  is the per-placement "day note" — the heads-up the staffer wrote on THIS
   *  event, surfaced here so it reconciles with the run sheet (it's distinct from
   *  the evergreen Field-notes log in the body, which is per-activity). */
  eventContext?: { dateLabel: string; timeLabel: string; note?: string };
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
          // ---- CREATE / EDIT: the run sheet IS the editor, in place ----
          // No separate form above the doc: the title/blurb/aka are inline-
          // editable in the header (with the color swatch), and the detail FACTS
          // are structured dropdowns inside the run sheet's Details block.
          <article className="rlv rlv--edit fadein">
            <header className="rlv-head">
              {/* Always-visible escape hatch — on a phone the sheet covers the
                  whole screen and a scrim tap shouldn't be the only way out.
                  Owner actions (Duplicate/Delete) live here in edit mode. */}
              <div className="rlv-head__row">
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
                <ColorField
                  value={form.color || undefined}
                  fallback={categoryTint(form.type)}
                  onChange={(color) => setForm((f) => ({ ...f, color: color ?? "" }))}
                  ariaLabel="Activity color"
                />
                {showOwnerActions && !isCreate && (
                  <>
                    {/* Duplicate works for built-ins too (it forks a custom copy).
                        Named "in library" to disambiguate from the calendar's
                        Duplicate, which places a copy on the grid — this one
                        creates the library fork and navigates to the catalog. */}
                    <button
                      type="button"
                      className="rlv-headbtn"
                      onClick={() => onDuplicate(a)}
                      aria-label="Duplicate in library"
                      title="Duplicate in library"
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

              <input
                className="rlv-title rlv-title--edit"
                value={form.title}
                placeholder="Name this activity"
                aria-label="Activity name"
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              />
              <input
                className="rlv-blurb rlv-blurb--edit"
                value={form.blurb}
                placeholder="The hook, in a sentence."
                aria-label="One-line description"
                onChange={(e) => setForm((f) => ({ ...f, blurb: e.target.value }))}
              />
              <input
                className="rlv-aka rlv-aka--edit"
                value={form.altNames}
                placeholder="Also called… (comma-separated, searchable)"
                aria-label="Also known as"
                onChange={(e) => setForm((f) => ({ ...f, altNames: e.target.value }))}
              />
            </header>

            <ActivityRunList
              doc={playDoc}
              editable
              onChange={setPlayDoc}
              activity={draftActivity}
              kitStock={{}}
              onSetStockState={() => {}}
              hideAddBlocks={["details", "materials"]}
              editForm={form}
              onEditFormChange={setForm}
              editThemeKit={themeKit}
              editAgeUnit={ageUnit}
              onEditAgeUnit={onAgeUnit}
            />

            <div className="rlv-save">
              <button
                type="button"
                className="btn btn--primary btn--block"
                disabled={!v.valid}
                onClick={submit}
              >
                {isCreate ? <CampIcon.Plus /> : <CampIcon.Check />}
                {isCreate ? "Add to library" : "Save changes"}
              </button>
            </div>
          </article>
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

              {/* The per-placement "day note" rides up here with the date chip —
                  the heads-up written on THIS calendar event, so it's reconciled
                  with the run sheet instead of stranded on the calendar. Distinct
                  from the evergreen Field-notes log further down the sheet. */}
              {eventContext?.note && (
                <div className="rlv-daynote">
                  <span className="rlv-daynote__label">
                    <CampIcon.Note />
                    Day note · {eventContext.dateLabel}
                  </span>
                  <p className="rlv-daynote__text">{eventContext.note}</p>
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
              kitStock={kitStock ?? {}}
              materialCatalog={materialCatalog}
              onSetStockState={onSetStockState ?? (() => {})}
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
