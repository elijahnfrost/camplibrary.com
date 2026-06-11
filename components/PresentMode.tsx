"use client";

// Present mode — the projector view. Full-viewport, big type, screen wake
// lock. Tap the right side / Space / ArrowRight to advance; a step's diagram
// frames build one tap at a time (Setup → Raid → Return) before the deck
// moves on. Tap left / ArrowLeft goes back. Escape exits.

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { slideFrameCount, type PresentSlide } from "@/lib/presentSlides";
import { materialNeedsForActivity, type MaterialNeed } from "@/lib/materials";
import type { Activity } from "@/lib/types";
import { CampIcon } from "./icons";
import { FrameStepper } from "./DiagramLightbox";
import { useDialogFocus } from "./useDialogFocus";

const BULLET_LABEL: Record<string, string> = {
  note: "Note",
  safety: "Safety",
  variation: "Variation",
  substep: "Then",
  video: "Video",
};

function MaterialsSlide({
  needs,
  availableMaterials,
  onToggleMaterial,
}: {
  needs: MaterialNeed[];
  availableMaterials: string[];
  onToggleMaterial: (id: string) => void;
}) {
  const haveSet = new Set(availableMaterials);
  return (
    <div className="present__materials">
      <h2 className="present__heading">Materials</h2>
      {needs.length === 0 ? (
        <p className="present__text">Nothing needed — just campers.</p>
      ) : (
        <ul className="present__matlist">
          {needs.map((need) => {
            const has = haveSet.has(need.id);
            return (
              <li key={need.id}>
                <button
                  type="button"
                  className={"present__mat" + (has ? " is-have" : "")}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleMaterial(need.id);
                  }}
                  aria-pressed={has}
                >
                  <span className="present__matcheck" aria-hidden="true">
                    {has && <CampIcon.Check />}
                  </span>
                  {need.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function PresentMode({
  activity,
  slides,
  availableMaterials,
  onToggleMaterial,
  onClose,
}: {
  activity: Activity;
  slides: PresentSlide[];
  availableMaterials: string[];
  onToggleMaterial: (id: string) => void;
  onClose: () => void;
}) {
  const [slideIndex, setSlideIndex] = useState(0);
  const [frameIndex, setFrameIndex] = useState(0);
  // Escape + focus trap; owning focus also keeps the underlying sheet's
  // Escape handler quiet while presenting.
  const dialogRef = useDialogFocus<HTMLDivElement>(onClose);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  const idBase = useId().replace(/[^a-zA-Z0-9_-]/g, "");

  const slide = slides[Math.max(0, Math.min(slides.length - 1, slideIndex))];
  const frames = slideFrameCount(slide);

  const advance = useCallback(() => {
    if (frameIndex < frames - 1) {
      setFrameIndex(frameIndex + 1);
      return;
    }
    if (slideIndex < slides.length - 1) {
      setSlideIndex(slideIndex + 1);
      setFrameIndex(0);
    }
  }, [frameIndex, frames, slideIndex, slides.length]);

  const goBack = useCallback(() => {
    if (frameIndex > 0) {
      setFrameIndex(frameIndex - 1);
      return;
    }
    if (slideIndex > 0) {
      const previous = slides[slideIndex - 1];
      setSlideIndex(slideIndex - 1);
      setFrameIndex(slideFrameCount(previous) - 1);
    }
  }, [frameIndex, slideIndex, slides]);

  // Keep the phone awake on the projector; re-acquire when the tab returns.
  useEffect(() => {
    let cancelled = false;
    const acquire = async () => {
      try {
        const lock = await navigator.wakeLock?.request("screen");
        if (lock) {
          if (cancelled) await lock.release();
          else wakeLockRef.current = lock;
        }
      } catch {
        /* unsupported / low battery — non-fatal */
      }
    };
    void acquire();
    const onVisible = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void wakeLockRef.current?.release().catch(() => undefined);
      wakeLockRef.current = null;
    };
  }, []);

  // Best-effort fullscreen (iPhone Safari rejects; the fixed overlay already
  // fills the viewport there).
  useEffect(() => {
    const node = rootRef.current;
    node?.requestFullscreen?.().catch(() => undefined);
    return () => {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, []);

  // Escape is handled by useDialogFocus; this covers slide navigation.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight" || event.key === " " || event.key === "Enter") {
        event.preventDefault();
        advance();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        goBack();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [advance, goBack]);

  const onStageClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      if (target.closest("button")) return; // checklist taps aren't navigation
      const rect = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - rect.left;
      if (x < rect.width * 0.33) goBack();
      else advance();
    },
    [advance, goBack]
  );

  const needs = materialNeedsForActivity(activity);
  const atEnd = slideIndex >= slides.length - 1 && frameIndex >= frames - 1;

  return createPortal(
    <div
      ref={(node) => {
        rootRef.current = node;
        dialogRef.current = node;
      }}
      className="present"
      role="dialog"
      aria-modal="true"
      aria-label={"Presenting " + activity.title}
      tabIndex={-1}
    >
      <div className="present__top">
        <span className="present__crumb">{activity.title}</span>
        <span className="present__count">
          {slideIndex + 1} / {slides.length}
        </span>
        <button type="button" className="present__exit" onClick={onClose} aria-label="Exit presentation">
          <CampIcon.Close />
          <span>Exit</span>
        </button>
      </div>

      <div className="present__stage" onClick={onStageClick}>
        {slide.kind === "title" && (
          <div className="present__title-slide">
            <span className="present__kicker">Up next</span>
            <h1 className="present__title">{slide.title}</h1>
            {slide.blurb ? <p className="present__blurb">{slide.blurb}</p> : null}
            <div className="present__tags">
              {slide.tags.map((tag) => (
                <span key={tag} className="present__tag">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {slide.kind === "section" && <h2 className="present__section">{slide.text}</h2>}

        {slide.kind === "step" && (
          <div className={"present__step" + (slide.diagram ? " has-diagram" : "")}>
            <div className="present__step-head">
              <span className="present__stepnum">{slide.number}</span>
              <div className="present__step-copy">
                {slide.time ? <span className="present__time">{slide.time}</span> : null}
                <p className="present__text">{slide.text}</p>
              </div>
            </div>
            {slide.diagram && (
              <div className="present__diagram">
                <FrameStepper
                  playbook={slide.diagram}
                  frameIndex={frameIndex}
                  onFrameIndex={(next) =>
                    setFrameIndex(Math.max(0, Math.min(slideFrameCount(slide) - 1, next)))
                  }
                  idBase={"present-" + idBase}
                />
              </div>
            )}
            {slide.bullets.length > 0 && (
              <ul className="present__bullets">
                {slide.bullets.map((bullet) => (
                  <li key={bullet.id} className={"present__bullet present__bullet--" + bullet.type}>
                    <span className="present__bullet-label">{BULLET_LABEL[bullet.type]}</span>
                    {bullet.text}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {slide.kind === "note" && (
          <div className={"present__note present__note--" + slide.noteType}>
            <span className="present__bullet-label">{BULLET_LABEL[slide.noteType]}</span>
            <p className="present__text">{slide.text}</p>
          </div>
        )}

        {slide.kind === "materials" && (
          <MaterialsSlide
            needs={needs}
            availableMaterials={availableMaterials}
            onToggleMaterial={onToggleMaterial}
          />
        )}
      </div>

      <div className="present__foot" aria-hidden="true">
        <div className="present__dots">
          {slides.map((s, i) => (
            <span key={i} className={i === slideIndex ? "is-on" : ""} />
          ))}
        </div>
        <span className="present__hint">{atEnd ? "That's everything — go run it" : "Tap right to continue"}</span>
      </div>
    </div>,
    document.body
  );
}
