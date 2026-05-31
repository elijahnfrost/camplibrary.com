"use client";

import { useEffect, useRef, useState, type TouchEvent } from "react";
import type { Activity } from "@/lib/types";
import {
  ageSpan,
  ageStamps,
  code,
  ENERGY,
  groupLabel,
  monogram,
  ratingColor,
} from "@/lib/data";
import { blankPlaybook, type ActivityPlaybookData } from "@/lib/playbooks";
import { CampIcon } from "./icons";
import { Block, EnergyMeter, Fact, RatingPicker, SaveButton } from "./primitives";
import { Modal } from "./Modal";
import { ActivityPlaybook } from "./ActivityPlaybook";
import { PlaybookEditor } from "./PlaybookEditor";

export function DetailSheet({
  activity: a,
  isFav,
  onToggleFav,
  onClose,
  onSetRating,
  isCustom,
  onEdit,
  onDelete,
  showOwnerActions = true,
  playbook = null,
  onSavePlaybook,
  canEditPlaybook = true,
}: {
  activity: Activity;
  isFav: (id: string) => boolean;
  onToggleFav: (id: string) => void;
  onClose: () => void;
  onSetRating: (id: string, val: number) => void;
  isCustom: boolean;
  onEdit: (a: Activity) => void;
  onDelete: (a: Activity) => void;
  showOwnerActions?: boolean;
  playbook?: ActivityPlaybookData | null;
  onSavePlaybook?: (activityId: string, data: ActivityPlaybookData) => void;
  canEditPlaybook?: boolean;
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [pbEditing, setPbEditing] = useState(false);
  const [draft, setDraft] = useState<ActivityPlaybookData | null>(null);

  const canEditDiagram = canEditPlaybook && Boolean(onSavePlaybook);

  // Reset the editor whenever the open activity changes.
  useEffect(() => {
    setPbEditing(false);
    setDraft(null);
  }, [a.id]);

  function startPlaybookEdit() {
    setDraft(playbook ?? blankPlaybook(a.id, a.title));
    setPbEditing(true);
  }

  function savePlaybookEdit() {
    if (draft && onSavePlaybook) onSavePlaybook(a.id, draft);
    setPbEditing(false);
  }

  function cancelPlaybookEdit() {
    setPbEditing(false);
    setDraft(null);
  }
  const swipeStartRef = useRef<{ x: number; y: number; scrollTop: number } | null>(null);

  const onBodyTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 1 || typeof window === "undefined" || window.innerWidth >= 768) return;
    const body = bodyRef.current;
    if (!body || body.scrollTop > 4) {
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

  const steps = (num = "ii") => (
    <Block num={num} name="How to play">
      {pbEditing && draft ? (
        <div className="pb-editwrap">
          <PlaybookEditor value={draft} onChange={setDraft} />
          <div className="pb-editwrap__actions">
            <button type="button" className="btn btn--primary btn--sm" onClick={savePlaybookEdit}>
              <CampIcon.Check />
              Save diagram
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={cancelPlaybookEdit}>
              Cancel
            </button>
          </div>
        </div>
      ) : playbook ? (
        <ActivityPlaybook
          playbook={playbook}
          onRequestEdit={canEditDiagram ? startPlaybookEdit : undefined}
        />
      ) : (
        <>
          <ol className="steps">
            {a.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          {canEditDiagram ? (
            <button type="button" className="btn btn--ghost btn--sm pb-add" onClick={startPlaybookEdit}>
              <CampIcon.Plus />
              Add a diagram
            </button>
          ) : null}
        </>
      )}
    </Block>
  );

  const notes = (num = "iii") => (
    <Block num={num} name="Notes & variations">
      <p className="prose">{a.notes}</p>
    </Block>
  );

  const safety = (num = "iv") => (
    <Block num={num} name="Safety">
      <div className="safety">{a.safety}</div>
    </Block>
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
          {steps("ii")}
          {notes("iii")}
          {safety("iv")}
        </div>
      </section>
    </div>
  );

  return (
    <Modal
      label={a.title}
      onClose={onClose}
      overlayProps={{
        className: "overlay--viewer",
        "data-viewer-view": "book",
      }}
    >
      <div
        className="overlay__body"
        ref={bodyRef}
        onTouchStart={onBodyTouchStart}
        onTouchEnd={onBodyTouchEnd}
        onTouchCancel={onBodyTouchCancel}
      >
        {bookView}
      </div>

      {showOwnerActions && isCustom && (
        <div className="detail__actions">
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
        </div>
      )}
    </Modal>
  );
}
