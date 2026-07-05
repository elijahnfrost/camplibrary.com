"use client";

import { useId, type CSSProperties } from "react";
import {
  PLAYBOOK_COLORS,
  type ActivityPlaybookData,
  type PlaybookArrow,
  type PlaybookArrowKind,
  type PlaybookColorId,
  type PlaybookFlag,
  type PlaybookFrame,
  type PlaybookMarker,
  type PlaybookPlayer,
  type PlaybookZone,
} from "@/lib/activity/playbooks";

/* ----------------------------------------------------------------------------
 * Shared, position-aware SVG primitives.
 *
 * Each primitive draws one piece in the 0–100 field space and is used by BOTH
 * the read-only diagram and the interactive editor, so a played-back diagram and
 * an edited one are pixel-identical.
 * ------------------------------------------------------------------------- */

function markerId(base: string, key: string) {
  return base + "-" + key;
}

function arrowKind(kind: PlaybookArrowKind | undefined): PlaybookArrowKind {
  return kind || "neutral";
}

// An arrow's visual identity: a chosen palette color wins, otherwise it falls
// back to the legacy team tint (blue/red/neutral). The returned key drives both
// the stroke class and which arrowhead marker the line points at.
function arrowVisual(arrow: PlaybookArrow): string {
  return arrow.color ? "c-" + arrow.color : arrowKind(arrow.team);
}

const ARROW_VISUAL_KEYS = [
  "blue",
  "red",
  "neutral",
  ...PLAYBOOK_COLORS.map((c) => "c-" + c),
];

export function ArrowDefs({ markerBase }: { markerBase: string }) {
  return (
    <>
      {ARROW_VISUAL_KEYS.map((key) => (
        <marker
          key={key}
          id={markerId(markerBase, key)}
          markerWidth="4"
          markerHeight="4"
          refX="3"
          refY="2"
          orient="auto"
        >
          <path d="M0,0 L3.6,2 L0,4 Z" className={"playbook-arrowhead playbook-arrowhead--" + key} />
        </marker>
      ))}
    </>
  );
}

export function FieldSurface({
  split,
  grid,
  clipId,
}: {
  split?: boolean;
  grid?: boolean;
  clipId: string;
}) {
  return (
    <>
      <rect className="playbook-field__grass" x="1" y="1" width="98" height="98" rx="5" />
      {grid ? (
        <g className="playbook-field__grid" clipPath={"url(#" + clipId + ")"} aria-hidden="true">
          {[20, 40, 60, 80].map((v) => (
            <path key={"gv" + v} d={"M" + v + " 1V99"} />
          ))}
          {[20, 40, 60, 80].map((v) => (
            <path key={"gh" + v} d={"M1 " + v + "H99"} />
          ))}
        </g>
      ) : null}
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

// A zone's outline color: a chosen palette color wins, else the kind preset.
function zoneClass(zone: PlaybookZone): string {
  const base = "playbook-field__zone playbook-field__zone--" + zone.kind;
  return zone.color ? base + " playbook-field__zone--c-" + zone.color : base;
}

export function ZoneShape({ zone }: { zone: PlaybookZone }) {
  return (
    <g className="playbook-zone">
      <rect className={zoneClass(zone)} x={zone.x} y={zone.y} width={zone.w} height={zone.h} rx="1.5" />
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
  const key = arrowVisual(arrow);
  return (
    <path
      className={"playbook-arrow playbook-arrow--" + key}
      d={"M" + arrow.from[0] + " " + arrow.from[1] + " L" + arrow.to[0] + " " + arrow.to[1]}
      markerEnd={"url(#" + markerId(markerBase, key) + ")"}
    />
  );
}

// Half-height (field units) of a marker glyph — used to place its caption just
// beneath it. Flags/pins are taller than the compact geometric tokens.
function markerLabelOffset(shape: PlaybookMarker["shape"]): number {
  return shape === "flag" || shape === "pin" ? 6.4 : 3.7;
}

export function MarkerShape({ marker }: { marker: PlaybookMarker }) {
  const label = (marker.label || "").trim();
  const cls =
    "playbook-marker playbook-marker--" + marker.color + " playbook-marker--shape-" + marker.shape;

  if (marker.shape === "text") {
    return (
      <g className={cls} transform={"translate(" + marker.x + " " + marker.y + ")"}>
        {label ? (
          <text
            className="playbook-marker__text"
            fontSize={4}
            dominantBaseline="middle"
            textAnchor="middle"
          >
            {label}
          </text>
        ) : null}
      </g>
    );
  }

  return (
    <g className={cls} transform={"translate(" + marker.x + " " + marker.y + ")"}>
      {marker.shape === "circle" ? <circle r={1.5} /> : null}
      {marker.shape === "square" ? <rect x={-1.4} y={-1.4} width={2.8} height={2.8} rx={0.5} /> : null}
      {marker.shape === "triangle" ? <path d="M0 -1.8 L1.7 1.4 L-1.7 1.4 Z" /> : null}
      {marker.shape === "diamond" ? <path d="M0 -1.9 L1.9 0 L0 1.9 L-1.9 0 Z" /> : null}
      {marker.shape === "flag" ? (
        <g className="playbook-marker__flag">
          <path className="playbook-marker__pole" d="M0 -4V4" />
          <path d="M0 -4h3.5l-1 1.5 1 1.5H0z" />
          <circle cx="0" cy="4" r="0.7" />
        </g>
      ) : null}
      {marker.shape === "pin" ? (
        <g className="playbook-marker__pin">
          <path d="M0 3.8C-1.9 1.2 -2.6 -0.2 -2.6 -1.6A2.6 2.6 0 1 1 2.6 -1.6C2.6 -0.2 1.9 1.2 0 3.8Z" />
          <circle className="playbook-marker__pinhole" cx="0" cy="-1.6" r="0.95" />
        </g>
      ) : null}
      {label ? (
        <text
          className="playbook-marker__label"
          y={markerLabelOffset(marker.shape)}
          fontSize={2.8}
          textAnchor="middle"
        >
          {label}
        </text>
      ) : null}
    </g>
  );
}

function FlagShape({ flag }: { flag: PlaybookFlag }) {
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

function playerClass(point: PlaybookPlayer) {
  return "playbook-player playbook-player--" + point.team + (point.role ? " is-" + point.role : "");
}

function PlayerShape({ player }: { player: PlaybookPlayer }) {
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
  grid,
  markerBase,
  showHead = true,
}: {
  frame: PlaybookFrame;
  split?: boolean;
  grid?: boolean;
  markerBase: string;
  showHead?: boolean;
}) {
  const descId = markerBase + "-desc";
  const clipId = markerBase + "-clip";
  const altText = frame.alt || frame.caption || frame.name;
  const markers = frame.markers || [];

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

        <FieldSurface split={split} grid={grid} clipId={clipId} />
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
        {markers.map((marker) => (
          <MarkerShape key={marker.id} marker={marker} />
        ))}
      </svg>
    </article>
  );
}

// Does any frame still carry the legacy two-team CTF pieces? Drives whether the
// blue/red/flag legend is meaningful (generic marker diagrams suppress it).
function usesTeamPieces(playbook: ActivityPlaybookData): boolean {
  return playbook.frames.some((f) => (f.players?.length || 0) > 0 || (f.flags?.length || 0) > 0);
}

function PlaybookLegend() {
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
  const showLegend = usesTeamPieces(playbook);

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
          {showLegend ? <PlaybookLegend /> : null}
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
            grid={playbook.surface?.grid}
            showHead={showHead}
            markerBase={"playbook-" + playbook.id + "-" + frame.id + "-" + safeId}
          />
        ))}
      </div>
    </div>
  );
}
