"use client";

import { useId, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  ArrowDefs,
  ArrowShape,
  FieldSurface,
  FlagShape,
  PlaybookLegend,
  PlayerShape,
  ZoneShape,
} from "./ActivityPlaybook";
import {
  newArrow,
  newFlag,
  newFrame,
  newPlayer,
  newZone,
  playbookId,
  type ActivityPlaybookData,
  type PlaybookArrowKind,
  type PlaybookFrame,
  type PlaybookMarkerKind,
  type PlaybookTeamId,
  type PlaybookZoneKind,
} from "@/lib/playbooks";

type SelectionType = "player" | "flag" | "zone" | "arrow";
interface Selection {
  type: SelectionType;
  id: string;
}

type Drag =
  | { kind: "player"; id: string; pointerId: number }
  | { kind: "flag"; id: string; pointerId: number }
  | { kind: "zone-move"; id: string; pointerId: number; offX: number; offY: number }
  | { kind: "zone-resize"; id: string; pointerId: number }
  | { kind: "arrow"; id: string; end: "from" | "to"; pointerId: number };

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function PlaybookEditor({
  value,
  onChange,
}: {
  value: ActivityPlaybookData;
  onChange: (next: ActivityPlaybookData) => void;
}) {
  const baseId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<Drag | null>(null);

  const [activeIdx, setActiveIdx] = useState(0);
  const [selected, setSelected] = useState<Selection | null>(null);

  const frameIndex = Math.min(activeIdx, value.frames.length - 1);
  const frame = value.frames[frameIndex];
  const clipId = baseId + "-clip";
  const markerBase = baseId + "-mk";

  /* ---- immutable updates -------------------------------------------------- */

  function patch(next: Partial<ActivityPlaybookData>) {
    onChange({ ...value, ...next });
  }

  function updateFrame(mutator: (f: PlaybookFrame) => PlaybookFrame) {
    patch({ frames: value.frames.map((f, i) => (i === frameIndex ? mutator(f) : f)) });
  }

  /* ---- coordinate mapping ------------------------------------------------- */

  function toField(e: { clientX: number; clientY: number }) {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return { x: 50, y: 50 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: clamp(p.x, 0, 100), y: clamp(p.y, 0, 100) };
  }

  /* ---- adding pieces ------------------------------------------------------ */

  function spawn(n: number) {
    return { x: 50 + ((n % 6) - 3) * 5 + 2, y: 50 + ((Math.floor(n / 6) % 4) - 1) * 6 };
  }

  function addPlayer(team: PlaybookTeamId) {
    const at = spawn(frame.players.length);
    const piece = newPlayer(team, clamp(at.x, 6, 94), clamp(at.y, 6, 94));
    updateFrame((f) => ({ ...f, players: [...f.players, piece] }));
    setSelected({ type: "player", id: piece.id });
  }

  function addFlag() {
    const piece = newFlag("blue", 50, 50);
    updateFrame((f) => ({ ...f, flags: [...f.flags, piece] }));
    setSelected({ type: "flag", id: piece.id });
  }

  function addZone() {
    const piece = newZone("safe", 38, 40);
    updateFrame((f) => ({ ...f, zones: [...f.zones, piece] }));
    setSelected({ type: "zone", id: piece.id });
  }

  function addArrow() {
    const piece = newArrow("neutral");
    updateFrame((f) => ({ ...f, arrows: [...f.arrows, piece] }));
    setSelected({ type: "arrow", id: piece.id });
  }

  /* ---- editing selected piece -------------------------------------------- */

  function updateSelectedPlayer(p: Partial<{ team: PlaybookTeamId; role?: PlaybookMarkerKind }>) {
    if (selected?.type !== "player") return;
    updateFrame((f) => ({
      ...f,
      players: f.players.map((pl) => (pl.id === selected.id ? { ...pl, ...p } : pl)),
    }));
  }

  function updateSelectedFlagTeam(team: PlaybookTeamId) {
    if (selected?.type !== "flag") return;
    updateFrame((f) => ({
      ...f,
      flags: f.flags.map((fl) => (fl.id === selected.id ? { ...fl, team } : fl)),
    }));
  }

  function updateSelectedZone(z: Partial<{ kind: PlaybookZoneKind; label: string }>) {
    if (selected?.type !== "zone") return;
    updateFrame((f) => ({
      ...f,
      zones: f.zones.map((zo) => (zo.id === selected.id ? { ...zo, ...z } : zo)),
    }));
  }

  function updateSelectedArrowTeam(team: PlaybookArrowKind) {
    if (selected?.type !== "arrow") return;
    updateFrame((f) => ({
      ...f,
      arrows: f.arrows.map((ar) => (ar.id === selected.id ? { ...ar, team } : ar)),
    }));
  }

  function deleteSelected() {
    if (!selected) return;
    const { type, id } = selected;
    updateFrame((f) => ({
      ...f,
      players: type === "player" ? f.players.filter((p) => p.id !== id) : f.players,
      flags: type === "flag" ? f.flags.filter((p) => p.id !== id) : f.flags,
      zones: type === "zone" ? f.zones.filter((p) => p.id !== id) : f.zones,
      arrows: type === "arrow" ? f.arrows.filter((p) => p.id !== id) : f.arrows,
    }));
    setSelected(null);
  }

  /* ---- dragging ----------------------------------------------------------- */

  function startDrag(e: ReactPointerEvent, drag: Drag, sel: Selection) {
    e.stopPropagation();
    setSelected(sel);
    dragRef.current = drag;
    try {
      svgRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already released / not capturable — dragging still works via svg handlers */
    }
  }

  function onPointerMove(e: ReactPointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const { x, y } = toField(e);
    if (drag.kind === "player") {
      updateFrame((f) => ({
        ...f,
        players: f.players.map((p) =>
          p.id === drag.id ? { ...p, x: clamp(x, 3, 97), y: clamp(y, 3, 97) } : p
        ),
      }));
    } else if (drag.kind === "flag") {
      updateFrame((f) => ({
        ...f,
        flags: f.flags.map((p) =>
          p.id === drag.id ? { ...p, x: clamp(x, 4, 96), y: clamp(y, 6, 96) } : p
        ),
      }));
    } else if (drag.kind === "zone-move") {
      updateFrame((f) => ({
        ...f,
        zones: f.zones.map((z) =>
          z.id === drag.id
            ? { ...z, x: clamp(x - drag.offX, 1, 99 - z.w), y: clamp(y - drag.offY, 1, 99 - z.h) }
            : z
        ),
      }));
    } else if (drag.kind === "zone-resize") {
      updateFrame((f) => ({
        ...f,
        zones: f.zones.map((z) =>
          z.id === drag.id
            ? { ...z, w: clamp(x - z.x, 6, 99 - z.x), h: clamp(y - z.y, 6, 99 - z.y) }
            : z
        ),
      }));
    } else if (drag.kind === "arrow") {
      const end: [number, number] = [clamp(x, 1, 99), clamp(y, 1, 99)];
      updateFrame((f) => ({
        ...f,
        arrows: f.arrows.map((a) => (a.id === drag.id ? { ...a, [drag.end]: end } : a)),
      }));
    }
  }

  function endDrag(e: ReactPointerEvent<SVGSVGElement>) {
    if (dragRef.current) {
      try {
        svgRef.current?.releasePointerCapture(e.pointerId);
      } catch {
        /* capture may have been lost already */
      }
      dragRef.current = null;
    }
  }

  /* ---- frame management --------------------------------------------------- */

  function addStage() {
    const f = newFrame(value.frames.length + 1 + ". New stage");
    patch({ frames: [...value.frames, f] });
    setActiveIdx(value.frames.length);
    setSelected(null);
  }

  function duplicateStage() {
    const copy: PlaybookFrame = {
      ...frame,
      id: playbookId("frame"),
      name: frame.name + " (copy)",
      zones: frame.zones.map((z) => ({ ...z, id: playbookId("z") })),
      flags: frame.flags.map((fl) => ({ ...fl, id: playbookId("f") })),
      players: frame.players.map((p) => ({ ...p, id: playbookId("p") })),
      arrows: frame.arrows.map((a) => ({ ...a, id: playbookId("a") })),
    };
    const frames = [...value.frames];
    frames.splice(frameIndex + 1, 0, copy);
    patch({ frames });
    setActiveIdx(frameIndex + 1);
    setSelected(null);
  }

  function deleteStage() {
    if (value.frames.length <= 1) return;
    patch({ frames: value.frames.filter((_, i) => i !== frameIndex) });
    setActiveIdx(Math.max(0, frameIndex - 1));
    setSelected(null);
  }

  /* ---- inspector ---------------------------------------------------------- */

  const selPlayer = selected?.type === "player" ? frame.players.find((p) => p.id === selected.id) : undefined;
  const selFlag = selected?.type === "flag" ? frame.flags.find((p) => p.id === selected.id) : undefined;
  const selZone = selected?.type === "zone" ? frame.zones.find((p) => p.id === selected.id) : undefined;
  const selArrow = selected?.type === "arrow" ? frame.arrows.find((p) => p.id === selected.id) : undefined;

  return (
    <div className="pbe">
      <div className="pbe__top">
        <label className="pbe__toggle">
          <input
            type="checkbox"
            checked={value.surface?.split === true}
            onChange={(e) => patch({ surface: { ...value.surface, split: e.target.checked } })}
          />
          Split field into two team sides
        </label>
        <PlaybookLegend />
      </div>

      <div className="pbe__stages" role="group" aria-label="Diagram stages">
        {value.frames.map((f, i) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={i === frameIndex}
            className={"pbe__stage" + (i === frameIndex ? " is-active" : "")}
            onClick={() => {
              setActiveIdx(i);
              setSelected(null);
            }}
            title={f.name}
          >
            {i + 1}
          </button>
        ))}
        <button type="button" className="pbe__stage pbe__stage--add" onClick={addStage} title="Add a stage">
          +
        </button>
      </div>

      <div className="pbe__meta">
        <input
          className="input pbe__name"
          value={frame.name}
          placeholder={"Stage " + (frameIndex + 1) + " name"}
          aria-label="Stage name"
          onChange={(e) => updateFrame((f) => ({ ...f, name: e.target.value }))}
        />
        <input
          className="input pbe__caption"
          value={frame.caption}
          placeholder="What happens in this stage (optional)"
          aria-label="Stage caption"
          onChange={(e) => updateFrame((f) => ({ ...f, caption: e.target.value }))}
        />
      </div>

      <div className="pbe__tools" role="group" aria-label="Add pieces">
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => addPlayer("blue")}>
          <i className="pbe__swatch pbe__swatch--blue" />Teal
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => addPlayer("red")}>
          <i className="pbe__swatch pbe__swatch--red" />Clay
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={addFlag}>
          Flag
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={addZone}>
          Zone
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={addArrow}>
          Arrow
        </button>
      </div>

      <div
        className="pbe__stage-wrap"
        tabIndex={0}
        onKeyDown={(e) => {
          if ((e.key === "Delete" || e.key === "Backspace") && selected && e.target === e.currentTarget) {
            e.preventDefault();
            deleteSelected();
          }
        }}
      >
        <svg
          ref={svgRef}
          className="playbook-field playbook-field--edit"
          viewBox="0 0 100 100"
          preserveAspectRatio="xMidYMid meet"
          role="application"
          aria-label={frame.name + " — drag pieces to arrange the diagram"}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerDown={() => setSelected(null)}
        >
          <defs>
            <clipPath id={clipId}>
              <rect x="1" y="1" width="98" height="98" rx="5" />
            </clipPath>
            <ArrowDefs markerBase={markerBase} />
          </defs>

          <FieldSurface split={value.surface?.split} clipId={clipId} />

          {frame.zones.map((zone) => (
            <g key={zone.id}>
              <ZoneShape zone={zone} />
              {selected?.id === zone.id ? (
                <rect
                  className="pbe-ring"
                  x={zone.x}
                  y={zone.y}
                  width={zone.w}
                  height={zone.h}
                  rx="1.5"
                />
              ) : null}
              <rect
                className="pbe-hit"
                x={zone.x}
                y={zone.y}
                width={zone.w}
                height={zone.h}
                onPointerDown={(e) => {
                  const { x, y } = toField(e);
                  startDrag(
                    e,
                    { kind: "zone-move", id: zone.id, pointerId: e.pointerId, offX: x - zone.x, offY: y - zone.y },
                    { type: "zone", id: zone.id }
                  );
                }}
              />
              {selected?.id === zone.id ? (
                <rect
                  className="pbe-handle"
                  x={zone.x + zone.w - 2}
                  y={zone.y + zone.h - 2}
                  width="4"
                  height="4"
                  rx="1"
                  onPointerDown={(e) =>
                    startDrag(
                      e,
                      { kind: "zone-resize", id: zone.id, pointerId: e.pointerId },
                      { type: "zone", id: zone.id }
                    )
                  }
                />
              ) : null}
            </g>
          ))}

          {frame.arrows.map((arrow) => (
            <g key={arrow.id}>
              <ArrowShape arrow={arrow} markerBase={markerBase} />
              <path
                className="pbe-hit-line"
                d={"M" + arrow.from[0] + " " + arrow.from[1] + " L" + arrow.to[0] + " " + arrow.to[1]}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  setSelected({ type: "arrow", id: arrow.id });
                }}
              />
              {selected?.id === arrow.id ? (
                <>
                  <circle
                    className="pbe-handle"
                    cx={arrow.from[0]}
                    cy={arrow.from[1]}
                    r="2"
                    onPointerDown={(e) =>
                      startDrag(
                        e,
                        { kind: "arrow", id: arrow.id, end: "from", pointerId: e.pointerId },
                        { type: "arrow", id: arrow.id }
                      )
                    }
                  />
                  <circle
                    className="pbe-handle"
                    cx={arrow.to[0]}
                    cy={arrow.to[1]}
                    r="2"
                    onPointerDown={(e) =>
                      startDrag(
                        e,
                        { kind: "arrow", id: arrow.id, end: "to", pointerId: e.pointerId },
                        { type: "arrow", id: arrow.id }
                      )
                    }
                  />
                </>
              ) : null}
            </g>
          ))}

          {frame.flags.map((flag) => (
            <g key={flag.id}>
              <FlagShape flag={flag} />
              {selected?.id === flag.id ? (
                <rect className="pbe-ring" x={flag.x - 2.4} y={flag.y - 5} width="4.8" height="10" rx="1" />
              ) : null}
              <rect
                className="pbe-hit"
                x={flag.x - 2.4}
                y={flag.y - 5}
                width="4.8"
                height="10"
                onPointerDown={(e) =>
                  startDrag(e, { kind: "flag", id: flag.id, pointerId: e.pointerId }, { type: "flag", id: flag.id })
                }
              />
            </g>
          ))}

          {frame.players.map((player) => (
            <g key={player.id}>
              <PlayerShape player={player} />
              {selected?.id === player.id ? (
                <circle className="pbe-ring" cx={player.x} cy={player.y} r="2.6" />
              ) : null}
              <circle
                className="pbe-hit"
                cx={player.x}
                cy={player.y}
                r="2.8"
                onPointerDown={(e) =>
                  startDrag(
                    e,
                    { kind: "player", id: player.id, pointerId: e.pointerId },
                    { type: "player", id: player.id }
                  )
                }
              />
            </g>
          ))}
        </svg>
      </div>

      <div className="pbe__inspect" aria-live="polite">
        {selPlayer ? (
          <>
            <span className="pbe__inspect-label">Player</span>
            <div className="seg seg--sm" role="group" aria-label="Team">
              {(["blue", "red"] as PlaybookTeamId[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  className={selPlayer.team === t ? "is-on" : ""}
                  onClick={() => updateSelectedPlayer({ team: t })}
                >
                  {t === "blue" ? "Blue" : "Red"}
                </button>
              ))}
            </div>
            <div className="seg seg--sm" role="group" aria-label="Marker">
              <button
                type="button"
                className={!selPlayer.role ? "is-on" : ""}
                onClick={() => updateSelectedPlayer({ role: undefined })}
              >
                Plain
              </button>
              <button
                type="button"
                className={selPlayer.role === "runner" ? "is-on" : ""}
                onClick={() => updateSelectedPlayer({ role: "runner" })}
              >
                Runner
              </button>
              <button
                type="button"
                className={selPlayer.role === "flag" ? "is-on" : ""}
                onClick={() => updateSelectedPlayer({ role: "flag" })}
              >
                Carrier
              </button>
            </div>
            <button type="button" className="btn btn--quiet btn--sm pbe__del" onClick={deleteSelected}>
              Remove
            </button>
          </>
        ) : selFlag ? (
          <>
            <span className="pbe__inspect-label">Flag</span>
            <div className="seg seg--sm" role="group" aria-label="Team">
              {(["blue", "red"] as PlaybookTeamId[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  className={selFlag.team === t ? "is-on" : ""}
                  onClick={() => updateSelectedFlagTeam(t)}
                >
                  {t === "blue" ? "Blue" : "Red"}
                </button>
              ))}
            </div>
            <button type="button" className="btn btn--quiet btn--sm pbe__del" onClick={deleteSelected}>
              Remove
            </button>
          </>
        ) : selZone ? (
          <>
            <span className="pbe__inspect-label">Zone</span>
            <div className="seg seg--sm" role="group" aria-label="Zone type">
              {(["safe", "jail", "area"] as PlaybookZoneKind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  className={selZone.kind === k ? "is-on" : ""}
                  onClick={() => updateSelectedZone({ kind: k })}
                >
                  {k === "safe" ? "Safe" : k === "jail" ? "Jail" : "Area"}
                </button>
              ))}
            </div>
            <input
              className="input pbe__zlabel"
              value={selZone.label || ""}
              placeholder="Label"
              aria-label="Zone label"
              onChange={(e) => updateSelectedZone({ label: e.target.value })}
            />
            <button type="button" className="btn btn--quiet btn--sm pbe__del" onClick={deleteSelected}>
              Remove
            </button>
          </>
        ) : selArrow ? (
          <>
            <span className="pbe__inspect-label">Arrow</span>
            <div className="seg seg--sm" role="group" aria-label="Arrow color">
              {(["neutral", "blue", "red"] as PlaybookArrowKind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  className={(selArrow.team || "neutral") === k ? "is-on" : ""}
                  onClick={() => updateSelectedArrowTeam(k)}
                >
                  {k === "neutral" ? "Path" : k === "blue" ? "Blue" : "Red"}
                </button>
              ))}
            </div>
            <button type="button" className="btn btn--quiet btn--sm pbe__del" onClick={deleteSelected}>
              Remove
            </button>
          </>
        ) : (
          <span className="pbe__hint">Tap a piece to edit it · drag to move · use a corner to resize a zone</span>
        )}
      </div>

      <div className="pbe__stage-actions">
        <button type="button" className="btn btn--ghost btn--sm" onClick={duplicateStage}>
          Duplicate stage
        </button>
        <button
          type="button"
          className="btn btn--quiet btn--sm"
          onClick={deleteStage}
          disabled={value.frames.length <= 1}
        >
          Delete stage
        </button>
      </div>
    </div>
  );
}
