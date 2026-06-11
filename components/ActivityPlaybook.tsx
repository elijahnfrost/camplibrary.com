"use client";

import { useId, type CSSProperties } from "react";
import type {
  ActivityPlaybookData,
  PlaybookArrow,
  PlaybookArrowKind,
  PlaybookFlag,
  PlaybookFrame,
  PlaybookPlayer,
  PlaybookZone,
} from "@/lib/playbooks";

/* ----------------------------------------------------------------------------
 * Shared, position-aware SVG primitives.
 *
 * Each primitive draws one piece in the 0–100 field space and is used by BOTH
 * the read-only diagram and the interactive editor, so a played-back diagram and
 * an edited one are pixel-identical.
 * ------------------------------------------------------------------------- */

export function markerId(base: string, kind: PlaybookArrowKind) {
  return base + "-" + kind;
}

export function arrowKind(kind: PlaybookArrowKind | undefined): PlaybookArrowKind {
  return kind || "neutral";
}

export function ArrowDefs({ markerBase }: { markerBase: string }) {
  return (
    <>
      {(["blue", "red", "neutral"] as PlaybookArrowKind[]).map((kind) => (
        <marker
          key={kind}
          id={markerId(markerBase, kind)}
          markerWidth="4"
          markerHeight="4"
          refX="3"
          refY="2"
          orient="auto"
        >
          <path d="M0,0 L3.6,2 L0,4 Z" className={"playbook-arrowhead playbook-arrowhead--" + kind} />
        </marker>
      ))}
    </>
  );
}

export function FieldSurface({ split, clipId }: { split?: boolean; clipId: string }) {
  return (
    <>
      <rect className="playbook-field__grass" x="1" y="1" width="98" height="98" rx="5" />
      {split ? (
        <>
          <g clipPath={"url(#" + clipId + ")"}>
            <path className="playbook-field__half playbook-field__half--blue" d="M1 1H50V99H1Z" />
            <path className="playbook-field__half playbook-field__half--red" d="M50 1H99V99H50Z" />
          </g>
          <path className="playbook-field__mid" d="M50 1V99" />
        </>
      ) : null}
    </>
  );
}

export function ZoneShape({ zone }: { zone: PlaybookZone }) {
  return (
    <g className="playbook-zone">
      <rect
        className={"playbook-field__zone playbook-field__zone--" + zone.kind}
        x={zone.x}
        y={zone.y}
        width={zone.w}
        height={zone.h}
        rx="1.5"
      />
      {zone.label ? (
        <text
          className="playbook-field__zlabel"
          x={zone.x + zone.w / 2}
          y={zone.y + zone.h / 2}
          dominantBaseline="middle"
        >
          {zone.label}
        </text>
      ) : null}
    </g>
  );
}

export function ArrowShape({ arrow, markerBase }: { arrow: PlaybookArrow; markerBase: string }) {
  const kind = arrowKind(arrow.team);
  return (
    <path
      className={"playbook-arrow playbook-arrow--" + kind}
      d={"M" + arrow.from[0] + " " + arrow.from[1] + " L" + arrow.to[0] + " " + arrow.to[1]}
      markerEnd={"url(#" + markerId(markerBase, kind) + ")"}
    />
  );
}

export function FlagShape({ flag }: { flag: PlaybookFlag }) {
  return (
    <g
      className={"playbook-flag playbook-flag--" + flag.team}
      transform={"translate(" + flag.x + " " + flag.y + ")"}
    >
      <path d="M0 -4V4" />
      <path d="M0 -4h3.5l-1 1.5 1 1.5H0z" />
      <circle cx="0" cy="4" r="0.7" />
    </g>
  );
}

export function playerClass(point: PlaybookPlayer) {
  return "playbook-player playbook-player--" + point.team + (point.role ? " is-" + point.role : "");
}

export function PlayerShape({ player }: { player: PlaybookPlayer }) {
  return (
    <g className={playerClass(player)} transform={"translate(" + player.x + " " + player.y + ")"}>
      {player.team === "blue" ? (
        <circle r={1.4} />
      ) : (
        <rect x="-1.3" y="-1.3" width="2.6" height="2.6" rx="0.45" />
      )}
      {player.role === "flag" ? <path d="M-0.6 -2.4h1.9L0.75 -1.55l0.55 0.85h-1.9z" /> : null}
    </g>
  );
}

/* ----------------------------------------------------------------------------
 * Read-only diagram.
 * ------------------------------------------------------------------------- */

export function FieldFrame({
  frame,
  split,
  markerBase,
  showHead = true,
}: {
  frame: PlaybookFrame;
  split?: boolean;
  markerBase: string;
  showHead?: boolean;
}) {
  const descId = markerBase + "-desc";
  const clipId = markerBase + "-clip";
  const altText = frame.alt || frame.caption || frame.name;

  return (
    <article className="playbook-frame">
      {showHead ? (
        <header className="playbook-frame__head">
          <h4>{frame.name}</h4>
          {frame.caption ? <p>{frame.caption}</p> : null}
        </header>
      ) : null}
      <svg
        className="playbook-field"
        viewBox="0 0 100 100"
        role="img"
        aria-label={frame.name + " play diagram. " + altText}
        aria-describedby={descId}
        preserveAspectRatio="xMidYMid meet"
      >
        <desc id={descId}>{altText}</desc>
        <defs>
          <clipPath id={clipId}>
            <rect x="1" y="1" width="98" height="98" rx="5" />
          </clipPath>
          <ArrowDefs markerBase={markerBase} />
        </defs>

        <FieldSurface split={split} clipId={clipId} />
        {frame.zones.map((zone) => (
          <ZoneShape key={zone.id} zone={zone} />
        ))}
        {frame.arrows.map((arrow) => (
          <ArrowShape key={arrow.id} arrow={arrow} markerBase={markerBase} />
        ))}
        {frame.flags.map((flag) => (
          <FlagShape key={flag.id} flag={flag} />
        ))}
        {frame.players.map((player) => (
          <PlayerShape key={player.id} player={player} />
        ))}
      </svg>
    </article>
  );
}

export function PlaybookLegend() {
  return (
    <div className="playbook__legend" aria-label="Diagram legend">
      <span>
        <i className="playbook__legend-dot playbook__legend-dot--blue" />
        Blue circles
      </span>
      <span>
        <i className="playbook__legend-square playbook__legend-square--red" />
        Red squares
      </span>
      <span>
        <i className="playbook__legend-flag" />
        Flag
      </span>
    </div>
  );
}

export function ActivityPlaybook({
  playbook,
  onRequestEdit,
  compact = false,
}: {
  playbook: ActivityPlaybookData;
  onRequestEdit?: () => void;
  // Compact: drop the legend + summary chrome and (for a single-stage diagram)
  // the frame header, so the diagram reads as a clean embedded field — the way a
  // video sub-item reads as a clean embedded player.
  compact?: boolean;
}) {
  const safeId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const showHead = !compact || playbook.frames.length > 1;

  return (
    <div
      className={"playbook" + (onRequestEdit ? " playbook--editable" : "") + (compact ? " playbook--compact" : "")}
      aria-label={playbook.title}
      onDoubleClick={onRequestEdit}
      title={onRequestEdit ? "Double-click to edit this diagram" : undefined}
    >
      {compact ? null : (
        <div className="playbook__intro">
          {playbook.summary ? <p>{playbook.summary}</p> : <p />}
          <PlaybookLegend />
        </div>
      )}
      {onRequestEdit ? (
        <div className="playbook__editcue">
          <button type="button" className="btn btn--ghost btn--sm" onClick={onRequestEdit}>
            Edit diagram
          </button>
          <span className="playbook__editcue-hint">or double-click a stage</span>
        </div>
      ) : null}
      <div
        className="playbook__frames"
        style={{ "--pb-cols": Math.min(3, Math.max(2, playbook.frames.length)) } as CSSProperties}
      >
        {playbook.frames.map((frame) => (
          <FieldFrame
            key={frame.id}
            frame={frame}
            split={playbook.surface?.split}
            showHead={showHead}
            markerBase={"playbook-" + playbook.id + "-" + frame.id + "-" + safeId}
          />
        ))}
      </div>
    </div>
  );
}
