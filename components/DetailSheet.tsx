"use client";

import type { CSSProperties, Dispatch, KeyboardEvent, PointerEvent, SetStateAction } from "react";
import type { Activity, BookViewerState, BookViewerView } from "@/lib/types";
import {
  ageSpan,
  ageStamps,
  code,
  ENERGY,
  groupLabel,
  monogram,
  ratingColor,
} from "@/lib/data";
import { CampIcon } from "./icons";
import { Block, EnergyMeter, Fact, RatingPicker, SaveButton } from "./primitives";
import { Modal } from "./Modal";

const VIEWER_MIN_WIDTH = 360;
const VIEWER_MAX_WIDTH = 960;
const VIEWER_WIDTH_STEP = 32;
const BOOK_SPREAD_WIDTH = 760;

const VIEWER_VIEW_OPTIONS: {
  value: BookViewerView;
  label: string;
  icon: (typeof CampIcon)[keyof typeof CampIcon];
}[] = [
  { value: "book", label: "Book spread", icon: CampIcon.BookOpen },
  { value: "card", label: "Detail card", icon: CampIcon.Card },
  { value: "prep", label: "Prep view", icon: CampIcon.Tool },
];

function clampWidth(width: number) {
  return Math.max(VIEWER_MIN_WIDTH, Math.min(VIEWER_MAX_WIDTH, Math.round(width)));
}

export function DetailSheet({
  activity: a,
  isFav,
  onToggleFav,
  onClose,
  onAddToSchedule,
  added,
  onSetRating,
  dayName,
  alreadyScheduled,
  isCustom,
  onEdit,
  onDelete,
  showScheduleAction = true,
  showOwnerActions = true,
  viewer,
  onViewerChange,
}: {
  activity: Activity;
  isFav: (id: string) => boolean;
  onToggleFav: (id: string) => void;
  onClose: () => void;
  onAddToSchedule: (a: Activity) => void;
  added: false | "added";
  onSetRating: (id: string, val: number) => void;
  dayName: string;
  alreadyScheduled: boolean;
  isCustom: boolean;
  onEdit: (a: Activity) => void;
  onDelete: (a: Activity) => void;
  showScheduleAction?: boolean;
  showOwnerActions?: boolean;
  viewer: BookViewerState;
  onViewerChange: Dispatch<SetStateAction<BookViewerState>>;
}) {
  const setViewerWidth = (width: number) => {
    onViewerChange((current) => ({ ...current, width: clampWidth(width) }));
  };

  const setViewerView = (view: BookViewerView) => {
    onViewerChange((current) => ({
      view,
      width: view === "book" && current.width < BOOK_SPREAD_WIDTH ? BOOK_SPREAD_WIDTH : current.width,
    }));
  };

  const onResizePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (typeof window === "undefined" || window.innerWidth < 768) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    const resize = (moveEvent: globalThis.PointerEvent) => {
      setViewerWidth(window.innerWidth - moveEvent.clientX);
    };
    const stopResize = () => {
      window.removeEventListener("pointermove", resize);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    };

    window.addEventListener("pointermove", resize);
    window.addEventListener("pointerup", stopResize, { once: true });
    window.addEventListener("pointercancel", stopResize, { once: true });
  };

  const onResizeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setViewerWidth(viewer.width + VIEWER_WIDTH_STEP);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      setViewerWidth(viewer.width - VIEWER_WIDTH_STEP);
    }
    if (event.key === "Home") {
      event.preventDefault();
      setViewerWidth(VIEWER_MIN_WIDTH);
    }
    if (event.key === "End") {
      event.preventDefault();
      setViewerWidth(VIEWER_MAX_WIDTH);
    }
  };

  const style = { "--viewer-width": viewer.width + "px" } as CSSProperties;

  const hero = (
    <div className="detail__hero" style={{ background: ratingColor(a.rating) }}>
      <div className="plate__grid" />
      <span className="detail__mono">{monogram(a.title)}</span>
      <span className="detail__ribbon">
        <SaveButton
          on={isFav(a.id)}
          onToggle={() => onToggleFav(a.id)}
          stop={false}
          variant="ribbon"
        />
      </span>
    </div>
  );

  const titleSummary = (
    <>
      <div className="detail__eyebrow">
        {code(a)} · {a.type}
      </div>
      <h2 className="detail__title">{a.title}</h2>
      <p className="detail__blurb">{a.blurb}</p>

      <div className="detail__stamps">
        <span className="stamp stamp--accent">{a.place}</span>
        {ageStamps(a).map((s, i) => (
          <span className="stamp" key={i}>
            {s}
          </span>
        ))}
        <span className="stamp">{ENERGY[a.energy]}</span>
        <span className="stamp">{a.prep === "None" ? "No prep" : a.prep + " prep"}</span>
      </div>
    </>
  );

  const facts = (
    <div className="facts">
      <Fact k="Ages">{ageSpan(a)}</Fact>
      <Fact k="Group size">{groupLabel(a)}</Fact>
      <Fact k="Time">
        <span>{a.durationMin}</span>
        <small>min</small>
      </Fact>
      <Fact k="Energy">
        <EnergyMeter level={a.energy} />
        <small>{ENERGY[a.energy]}</small>
      </Fact>
      <Fact k="Place">{a.place}</Fact>
      <Fact k="Prep">{a.prep}</Fact>
    </div>
  );

  const materials = (
    <Block num="i" name="Materials">
      {a.materials.length === 0 ? (
        <span className="stamp">None needed</span>
      ) : (
        <div className="matlist">
          {a.materials.map((m, i) => (
            <span className="stamp" key={i}>
              {m}
            </span>
          ))}
        </div>
      )}
    </Block>
  );

  const steps = (
    <Block num="ii" name="How to play">
      <ol className="steps">
        {a.steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
    </Block>
  );

  const notes = (
    <Block num="iii" name="Notes & variations">
      <p className="prose">{a.notes}</p>
    </Block>
  );

  const safety = (
    <Block num="iv" name="Safety">
      <div className="safety">{a.safety}</div>
    </Block>
  );

  const cardView = (
    <>
      {hero}
      <div className="detail__pad">
        {titleSummary}
        <RatingPicker value={a.rating || 0} onChange={(value) => onSetRating(a.id, value)} />
        {facts}
        {materials}
        {steps}
        {notes}
        {safety}
      </div>
    </>
  );

  const bookView = (
    <div className="book-spread" aria-label="Book spread view">
      <section className="book-page book-page--summary">
        {hero}
        <div className="detail__pad">
          {titleSummary}
          <RatingPicker value={a.rating || 0} onChange={(value) => onSetRating(a.id, value)} />
          {facts}
        </div>
      </section>
      <section className="book-page book-page--instructions">
        <div className="detail__pad">
          {materials}
          {steps}
          {safety}
        </div>
      </section>
    </div>
  );

  const prepView = (
    <>
      {hero}
      <div className="detail__pad detail__pad--prep">
        {titleSummary}
        {facts}
        <div className="prep-grid">
          {materials}
          {safety}
        </div>
        {notes}
      </div>
    </>
  );

  return (
    <Modal
      label={a.title}
      onClose={onClose}
      overlayProps={{
        className: "overlay--viewer",
        "data-viewer-view": viewer.view,
        style,
      }}
    >
      <div
        className="viewer-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize book preview"
        aria-valuemin={VIEWER_MIN_WIDTH}
        aria-valuemax={VIEWER_MAX_WIDTH}
        aria-valuenow={viewer.width}
        tabIndex={0}
        onPointerDown={onResizePointerDown}
        onKeyDown={onResizeKeyDown}
      />

      <div className="overlay__bar overlay__bar--float">
        <div className="viewer-controls" aria-label="Book viewer controls">
          <div className="viewer-controls__group" role="group" aria-label="View">
            {VIEWER_VIEW_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={"viewer-controls__btn" + (viewer.view === option.value ? " is-on" : "")}
                onClick={() => setViewerView(option.value)}
                aria-label={option.label}
                aria-pressed={viewer.view === option.value}
                title={option.label}
              >
                <option.icon />
              </button>
            ))}
          </div>
        </div>
        <div className="overlay__handle" />
        <button
          type="button"
          className="icon-btn icon-btn--float"
          onClick={onClose}
          aria-label="Close"
        >
          <CampIcon.Close />
        </button>
      </div>

      <div className="overlay__body">
        {viewer.view === "book" && bookView}
        {viewer.view === "card" && cardView}
        {viewer.view === "prep" && prepView}
      </div>

      {(showOwnerActions || showScheduleAction) && (
        <div className="detail__actions">
          {showOwnerActions && isCustom && (
            <div className="detail__owner">
              <button type="button" className="btn btn--quiet detail__owner-btn" onClick={() => onEdit(a)}>
                <CampIcon.Tool />
                Edit
              </button>
              <button
                type="button"
                className="btn btn--quiet detail__owner-btn detail__owner-btn--danger"
                onClick={() => onDelete(a)}
              >
                <CampIcon.Trash />
                Delete
              </button>
            </div>
          )}
          {showScheduleAction && (
            <button
              type="button"
              className="btn btn--primary btn--block"
              onClick={() => onAddToSchedule(a)}
            >
              {added === "added" ? <CampIcon.Check /> : <CampIcon.Calendar />}
              {added === "added"
                ? "Added to " + dayName
                : alreadyScheduled
                  ? "Add another to " + dayName
                  : "Add to " + dayName}
            </button>
          )}
        </div>
      )}
    </Modal>
  );
}
