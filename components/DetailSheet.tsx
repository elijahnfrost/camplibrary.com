"use client";

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
import { CampIcon } from "./icons";
import { Block, EnergyMeter, Fact, RatingPicker, SaveButton } from "./primitives";
import { Modal } from "./Modal";

export function DetailSheet({
  activity: a,
  isFav,
  onToggleFav,
  onClose,
  onAddToSchedule,
  added,
  onSetRating,
}: {
  activity: Activity;
  isFav: (id: string) => boolean;
  onToggleFav: (id: string) => void;
  onClose: () => void;
  onAddToSchedule: (a: Activity) => void;
  added: false | "added" | "full";
  onSetRating: (id: string, val: number) => void;
}) {
  return (
    <Modal label={a.title} onClose={onClose}>
      <div className="overlay__bar overlay__bar--float">
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

        <div className="detail__pad">
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

          <RatingPicker value={a.rating || 0} onChange={(value) => onSetRating(a.id, value)} />

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

          <Block num="ii" name="How to play">
            <ol className="steps">
              {a.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          </Block>

          <Block num="iii" name="Notes & variations">
            <p className="prose">{a.notes}</p>
          </Block>

          <Block num="iv" name="Safety">
            <div className="safety">{a.safety}</div>
          </Block>
        </div>
      </div>

      <div className="detail__actions">
        <button
          type="button"
          className="btn btn--primary btn--block"
          onClick={() => onAddToSchedule(a)}
          disabled={added === "full"}
        >
          {added === "added" ? <CampIcon.Check /> : <CampIcon.Calendar />}
          {added === "added"
            ? "Added to schedule"
            : added === "full"
              ? "Day is full"
              : "Add to schedule"}
        </button>
      </div>
    </Modal>
  );
}
