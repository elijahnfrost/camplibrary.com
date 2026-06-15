"use client";

// Camp Library — the diagram editor.
//
// Event-agnostic: a diagram is a set of generic MARKERS (a color + a shape, with
// an optional caption — "text" markers are pure labels), free-form colored ZONES,
// and ARROWS, laid over a plain / split / grid surface. The same SVG primitives
// the read-only diagram uses are rendered here with drag handles + an inspector.
//
// Legacy Capture-the-Flag diagrams (blue/red players + flags) are folded into
// markers the moment they're opened here (migrateFrameToMarkers), so every
// diagram is edited through one unified set of pieces while un-edited stored data
// keeps rendering through the legacy paths.

import {
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { ArrowDefs, ArrowShape, FieldSurface, MarkerShape, ZoneShape } from "./ActivityPlaybook";
import { CampIcon } from "./icons";
import { ContextMenu } from "./floating/ContextMenu";
import {
  describePlaybookSelection,
  nudgePlaybookSelection,
  type PlaybookSelection,
} from "@/lib/playbookEditorKeyboard";
import {
  PLAYBOOK_COLORS,
  migrateFrameToMarkers,
  newArrow,
  newFrame,
  newMarker,
  newTextMarker,
  newZone,
  playbookId,
  type ActivityPlaybookData,
  type PlaybookColorId,
  type PlaybookFrame,
  type PlaybookMarker,
  type PlaybookMarkerShape,
} from "@/lib/playbooks";

type Selection = PlaybookSelection;

type Drag =
  | { kind: "marker"; id: string; pointerId: number; offX: number; offY: number }
  | { kind: "zone-move"; id: string; pointerId: number; offX: number; offY: number }
  | { kind: "zone-resize"; id: string; pointerId: number }
  | { kind: "arrow"; id: string; end: "from" | "to"; pointerId: number };

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

// The glyph shapes a marker can take, in palette order (text lives behind the
// dedicated "Text" tool, so it's omitted from the shape row).
const GLYPH_SHAPES: PlaybookMarkerShape[] = ["circle", "square", "triangle", "diamond", "flag", "pin"];

// Crisp line icons (the app's house style) for every editor piece — they replace
// the old emoji glyphs, which clashed with the hand-drawn, monochrome UI. Stroke
// + fill inherit from the button via CSS, so selected/hover states recolor them.
const PIECE_ICON_PATHS: Record<PlaybookMarkerShape | "zone" | "arrow", ReactNode> = {
  circle: <circle cx="12" cy="12" r="6.5" />,
  square: <rect x="5.5" y="5.5" width="13" height="13" rx="2" />,
  triangle: <path d="M12 5.5 19 18.5 5 18.5Z" />,
  diamond: <path d="M12 4.5 19.5 12 12 19.5 4.5 12Z" />,
  flag: (
    <>
      <path d="M7 4v16" />
      <path d="M7 4.5h10l-2.4 3 2.4 3H7z" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21c4-4.4 6-7.3 6-10a6 6 0 1 0-12 0c0 2.7 2 5.6 6 10z" />
      <circle cx="12" cy="11" r="2.2" />
    </>
  ),
  text: (
    <>
      <path d="M5 6.5h14" />
      <path d="M12 6.5v11" />
      <path d="M9 17.5h6" />
    </>
  ),
  zone: <rect x="4" y="6" width="16" height="12" rx="2" strokeDasharray="3 2.2" />,
  arrow: (
    <>
      <path d="M4 12h13" />
      <path d="M13 7l5 5-5 5" />
    </>
  ),
};

function PieceIcon({ kind }: { kind: PlaybookMarkerShape | "zone" | "arrow" }) {
  return (
    <svg className="pbe-pieceicon" viewBox="0 0 24 24" aria-hidden="true">
      {PIECE_ICON_PATHS[kind]}
    </svg>
  );
}

type SurfaceTone = "plain" | "split" | "grid";
function surfaceTone(surface: ActivityPlaybookData["surface"]): SurfaceTone {
  if (surface?.grid) return "grid";
  if (surface?.split) return "split";
  return "plain";
}

export function PlaybookEditor({
  value,
  onChange,
}: {
  value: ActivityPlaybookData;
  onChange: (next: ActivityPlaybookData) => void;
}) {
  const baseId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const svgRef = useRef<SVGSVGElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<Drag | null>(null);

  // Every frame is migrated to markers on the way in, so the editor only ever
  // reasons about markers / zones / arrows — never legacy players or flags. The
  // migration only commits to storage once the user makes a real edit.
  const data = useMemo(
    () => ({ ...value, frames: value.frames.map(migrateFrameToMarkers) }),
    [value]
  );

  const [activeIdx, setActiveIdx] = useState(0);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [paintColor, setPaintColor] = useState<PlaybookColorId>("teal");
  const [paintShape, setPaintShape] = useState<PlaybookMarkerShape>("circle");
  // Right-click on a piece opens the shared themed menu (Duplicate / Remove).
  const [pieceMenu, setPieceMenu] = useState<{ sel: Selection; point: { x: number; y: number } } | null>(null);

  const frameIndex = Math.min(activeIdx, data.frames.length - 1);
  const frame = data.frames[frameIndex];
  const markers = frame.markers || [];
  const clipId = baseId + "-clip";
  const markerBase = baseId + "-mk";
  const keyboardHelpId = baseId + "-keyboard-help";

  // The selected piece (if any) and the "active" color/shape the palette shows —
  // a selection's own color when one is selected, else the standing paint color
  // used for the next add. New pieces always take exactly what the palette shows.
  const selMarker = selected?.type === "marker" ? markers.find((m) => m.id === selected.id) : undefined;
  const selZone = selected?.type === "zone" ? frame.zones.find((z) => z.id === selected.id) : undefined;
  const selArrow = selected?.type === "arrow" ? frame.arrows.find((a) => a.id === selected.id) : undefined;
  const activeColor: PlaybookColorId = selMarker?.color ?? selZone?.color ?? selArrow?.color ?? paintColor;
  const activeShape: PlaybookMarkerShape = selMarker?.shape ?? paintShape;

  /* ---- immutable updates -------------------------------------------------- */

  function patch(next: Partial<ActivityPlaybookData>) {
    onChange({ ...data, ...next });
  }

  function updateFrame(mutator: (f: PlaybookFrame) => PlaybookFrame) {
    patch({ frames: data.frames.map((f, i) => (i === frameIndex ? mutator(f) : f)) });
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

  function addMarker() {
    const at = spawn(markers.length);
    const shape = activeShape === "text" ? "circle" : activeShape;
    const piece = newMarker(activeColor, shape, clamp(at.x, 6, 94), clamp(at.y, 6, 94));
    updateFrame((f) => ({ ...f, markers: [...(f.markers || []), piece] }));
    setSelected({ type: "marker", id: piece.id });
  }

  function addText() {
    const at = spawn(markers.length);
    // Amber reads poorly as body text on the field, so default labels to ink.
    const piece = newTextMarker(activeColor === "amber" ? "ink" : activeColor, clamp(at.x, 12, 88), clamp(at.y, 8, 92));
    updateFrame((f) => ({ ...f, markers: [...(f.markers || []), piece] }));
    setSelected({ type: "marker", id: piece.id });
  }

  function addZone() {
    const piece = newZone("area", 38, 40, activeColor);
    updateFrame((f) => ({ ...f, zones: [...f.zones, piece] }));
    setSelected({ type: "zone", id: piece.id });
  }

  function addArrow() {
    const piece = { ...newArrow("neutral"), color: activeColor };
    updateFrame((f) => ({ ...f, arrows: [...f.arrows, piece] }));
    setSelected({ type: "arrow", id: piece.id });
  }

  /* ---- editing the selected piece ---------------------------------------- */

  function updateSelectedMarker(patchMarker: Partial<PlaybookMarker>) {
    if (selected?.type !== "marker") return;
    updateFrame((f) => ({
      ...f,
      markers: (f.markers || []).map((m) => (m.id === selected.id ? { ...m, ...patchMarker } : m)),
    }));
  }

  function updateSelectedZone(patchZone: Partial<{ color: PlaybookColorId; label: string }>) {
    if (selected?.type !== "zone") return;
    updateFrame((f) => ({
      ...f,
      zones: f.zones.map((z) => (z.id === selected.id ? { ...z, ...patchZone } : z)),
    }));
  }

  function updateSelectedArrowColor(color: PlaybookColorId) {
    if (selected?.type !== "arrow") return;
    updateFrame((f) => ({
      ...f,
      arrows: f.arrows.map((a) => (a.id === selected.id ? { ...a, color } : a)),
    }));
  }

  // Picking a color paints the selected piece (if any) and becomes the color new
  // pieces take next. Picking a shape behaves the same for markers.
  function pickColor(color: PlaybookColorId) {
    setPaintColor(color);
    if (selected?.type === "marker") updateSelectedMarker({ color });
    else if (selected?.type === "zone") updateSelectedZone({ color });
    else if (selected?.type === "arrow") updateSelectedArrowColor(color);
  }

  function pickShape(shape: PlaybookMarkerShape) {
    setPaintShape(shape);
    if (selected?.type === "marker") updateSelectedMarker({ shape });
  }

  function deleteSelection(sel: Selection) {
    const { type, id } = sel;
    updateFrame((f) => ({
      ...f,
      markers: type === "marker" ? (f.markers || []).filter((m) => m.id !== id) : f.markers,
      zones: type === "zone" ? f.zones.filter((z) => z.id !== id) : f.zones,
      arrows: type === "arrow" ? f.arrows.filter((a) => a.id !== id) : f.arrows,
    }));
    setSelected((cur) => (cur && cur.id === id ? null : cur));
  }

  function deleteSelected() {
    if (selected) deleteSelection(selected);
  }

  // Duplicate a piece a few units down-right of itself and select the copy.
  function duplicateSelection(sel: Selection) {
    const off = (v: number, lo: number, hi: number) => clamp(v + 4, lo, hi);
    let newId = "";
    updateFrame((f) => {
      if (sel.type === "marker") {
        const m = (f.markers || []).find((x) => x.id === sel.id);
        if (!m) return f;
        newId = playbookId("m");
        const copy = { ...m, id: newId, x: off(m.x, 3, 97), y: off(m.y, 3, 97) };
        return { ...f, markers: [...(f.markers || []), copy] };
      }
      if (sel.type === "zone") {
        const z = f.zones.find((x) => x.id === sel.id);
        if (!z) return f;
        newId = playbookId("z");
        const copy = { ...z, id: newId, x: off(z.x, 1, 99 - z.w), y: off(z.y, 1, 99 - z.h) };
        return { ...f, zones: [...f.zones, copy] };
      }
      if (sel.type === "arrow") {
        const a = f.arrows.find((x) => x.id === sel.id);
        if (!a) return f;
        newId = playbookId("a");
        const copy = {
          ...a,
          id: newId,
          from: [off(a.from[0], 1, 99), off(a.from[1], 1, 99)] as [number, number],
          to: [off(a.to[0], 1, 99), off(a.to[1], 1, 99)] as [number, number],
        };
        return { ...f, arrows: [...f.arrows, copy] };
      }
      return f;
    });
    if (newId) setSelected({ type: sel.type, id: newId });
  }

  function openPieceMenu(e: ReactMouseEvent, sel: Selection) {
    e.preventDefault();
    e.stopPropagation();
    setSelected(sel);
    setPieceMenu({ sel, point: { x: e.clientX, y: e.clientY } });
  }

  function nudgeSelected(dx: number, dy: number) {
    if (!selected) return;
    updateFrame((f) => nudgePlaybookSelection(f, selected, { dx, dy }));
  }

  function onStageKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (!selected) return;
    const step = e.shiftKey ? 5 : 1;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      nudgeSelected(-step, 0);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      nudgeSelected(step, 0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      nudgeSelected(0, -step);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      nudgeSelected(0, step);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      deleteSelected();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setSelected(null);
    }
  }

  /* ---- dragging ----------------------------------------------------------- */

  function clearDrag() {
    const drag = dragRef.current;
    if (!drag) return;
    try {
      svgRef.current?.releasePointerCapture(drag.pointerId);
    } catch {
      /* capture may have been lost already */
    }
    dragRef.current = null;
  }

  function startDrag(e: ReactPointerEvent, drag: Drag, sel: Selection) {
    // Only the primary button drags — right-click opens the menu, never grabs.
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    setSelected(sel);
    // Keep the canvas focused so arrow-key nudging works right after selecting.
    wrapRef.current?.focus({ preventScroll: true });
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
    // Exclusively hold-to-drag: if the button is no longer held (a missed
    // pointerup, or a stray hover-move), drop the piece right where it is rather
    // than letting it keep following the cursor.
    if ((e.buttons & 1) === 0) {
      clearDrag();
      return;
    }
    const { x, y } = toField(e);
    if (drag.kind === "marker") {
      updateFrame((f) => ({
        ...f,
        markers: (f.markers || []).map((m) =>
          m.id === drag.id
            ? { ...m, x: clamp(x - drag.offX, 3, 97), y: clamp(y - drag.offY, 3, 97) }
            : m
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

  function endDrag() {
    clearDrag();
  }

  /* ---- frame management --------------------------------------------------- */

  function addStage() {
    const f = newFrame(data.frames.length + 1 + ". New stage");
    patch({ frames: [...data.frames, f] });
    setActiveIdx(data.frames.length);
    setSelected(null);
  }

  function duplicateStage() {
    const copy: PlaybookFrame = {
      ...frame,
      id: playbookId("frame"),
      name: frame.name + " (copy)",
      zones: frame.zones.map((z) => ({ ...z, id: playbookId("z") })),
      flags: (frame.flags || []).map((fl) => ({ ...fl, id: playbookId("f") })),
      players: (frame.players || []).map((p) => ({ ...p, id: playbookId("p") })),
      arrows: frame.arrows.map((a) => ({ ...a, id: playbookId("a") })),
      markers: (frame.markers || []).map((m) => ({ ...m, id: playbookId("m") })),
    };
    const frames = [...data.frames];
    frames.splice(frameIndex + 1, 0, copy);
    patch({ frames });
    setActiveIdx(frameIndex + 1);
    setSelected(null);
  }

  function deleteStage() {
    if (data.frames.length <= 1) return;
    patch({ frames: data.frames.filter((_, i) => i !== frameIndex) });
    setActiveIdx(Math.max(0, frameIndex - 1));
    setSelected(null);
  }

  /* ---- inspector + surface ------------------------------------------------ */

  const tone = surfaceTone(data.surface);
  function setTone(next: SurfaceTone) {
    patch({ surface: { split: next === "split", grid: next === "grid" } });
  }

  const pieceA11y = (selection: Selection) => ({
    tabIndex: 0,
    role: "button",
    "aria-label": describePlaybookSelection(frame, selection),
    "aria-pressed": selected?.type === selection.type && selected.id === selection.id,
    onFocus: () => setSelected(selection),
    onKeyDown: (e: ReactKeyboardEvent<SVGElement>) => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        setSelected(selection);
      }
    },
  });

  const ColorRow = ({ label }: { label: string }) => (
    <div className="pbe__pick" role="group" aria-label={label}>
      <span className="pbe__pick-label">{label}</span>
      <div className="pbe__swatches">
        {PLAYBOOK_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className={"pbe__swatch pbe__swatch--" + c + (activeColor === c ? " is-on" : "")}
            aria-label={c}
            aria-pressed={activeColor === c}
            onClick={() => pickColor(c)}
          />
        ))}
      </div>
    </div>
  );

  return (
    <div className="pbe">
      <div className="pbe__stages" role="group" aria-label="Diagram stages">
        {data.frames.map((f, i) => (
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

      <div className="pbe__surface" role="group" aria-label="Surface">
        <div className="seg seg--sm">
          {(["plain", "split", "grid"] as SurfaceTone[]).map((t) => (
            <button
              key={t}
              type="button"
              className={tone === t ? "is-on" : ""}
              aria-pressed={tone === t}
              onClick={() => setTone(t)}
            >
              {t === "plain" ? "Plain" : t === "split" ? "Split" : "Grid"}
            </button>
          ))}
        </div>
      </div>

      <ColorRow label="Color" />

      <div className="pbe__pick" role="group" aria-label="Marker shape">
        <span className="pbe__pick-label">Shape</span>
        <div className="pbe__shapes">
          {GLYPH_SHAPES.map((s) => (
            <button
              key={s}
              type="button"
              className={"pbe__shape" + (activeShape === s ? " is-on" : "")}
              aria-label={s}
              aria-pressed={activeShape === s}
              onClick={() => pickShape(s)}
            >
              <PieceIcon kind={s} />
            </button>
          ))}
        </div>
      </div>

      <div className="pbe__tools" role="group" aria-label="Add pieces">
        <button type="button" className="btn btn--ghost btn--sm" onClick={addMarker}>
          <PieceIcon kind={activeShape === "text" ? "circle" : activeShape} /> Marker
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={addText}>
          <PieceIcon kind="text" /> Text
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={addZone}>
          <PieceIcon kind="zone" /> Zone
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={addArrow}>
          <PieceIcon kind="arrow" /> Arrow
        </button>
      </div>

      <div className="pbe__stage-wrap" ref={wrapRef} tabIndex={0} data-autofocus onKeyDown={onStageKeyDown}>
        <p id={keyboardHelpId} className="sr-only">
          Tab through diagram pieces. Arrow keys move the selected piece. Hold Shift to move farther. Delete removes it.
        </p>
        <svg
          ref={svgRef}
          className="playbook-field playbook-field--edit"
          viewBox="0 0 100 100"
          preserveAspectRatio="xMidYMid meet"
          role="application"
          aria-label={frame.name + " — drag pieces to arrange the diagram"}
          aria-describedby={keyboardHelpId}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={endDrag}
          onPointerDown={(e) => {
            // Empty-canvas press clears selection (primary button only).
            if (e.button === 0) setSelected(null);
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <defs>
            <clipPath id={clipId}>
              <rect x="1" y="1" width="98" height="98" rx="5" />
            </clipPath>
            <ArrowDefs markerBase={markerBase} />
          </defs>

          <FieldSurface split={data.surface?.split} grid={data.surface?.grid} clipId={clipId} />

          {frame.zones.map((zone) => (
            <g key={zone.id}>
              <ZoneShape zone={zone} />
              {selected?.id === zone.id ? (
                <rect className="pbe-ring" x={zone.x} y={zone.y} width={zone.w} height={zone.h} rx="1.5" />
              ) : null}
              <rect
                className="pbe-hit"
                x={zone.x}
                y={zone.y}
                width={zone.w}
                height={zone.h}
                {...pieceA11y({ type: "zone", id: zone.id })}
                onContextMenu={(e) => openPieceMenu(e, { type: "zone", id: zone.id })}
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
                  x={zone.x + zone.w - 2.5}
                  y={zone.y + zone.h - 2.5}
                  width="5"
                  height="5"
                  rx="1.2"
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
                {...pieceA11y({ type: "arrow", id: arrow.id })}
                onContextMenu={(e) => openPieceMenu(e, { type: "arrow", id: arrow.id })}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
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
                    r="2.8"
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
                    r="2.8"
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

          {markers.map((marker) => {
            // Tall pieces (flags, pins, labels) get a roomier grab + ring than the
            // compact geometric tokens, so they're easy to catch by the glyph.
            const tall = marker.shape === "flag" || marker.shape === "pin" || marker.shape === "text";
            const hitR = tall ? 4.4 : 3.4;
            return (
              <g key={marker.id}>
                <MarkerShape marker={marker} />
                {selected?.id === marker.id ? (
                  <circle className="pbe-ring" cx={marker.x} cy={marker.y} r={tall ? 4.2 : 3.2} />
                ) : null}
                <circle
                  className="pbe-hit"
                  cx={marker.x}
                  cy={marker.y}
                  r={hitR}
                  {...pieceA11y({ type: "marker", id: marker.id })}
                  onContextMenu={(e) => openPieceMenu(e, { type: "marker", id: marker.id })}
                  onPointerDown={(e) => {
                    const { x, y } = toField(e);
                    startDrag(
                      e,
                      { kind: "marker", id: marker.id, pointerId: e.pointerId, offX: x - marker.x, offY: y - marker.y },
                      { type: "marker", id: marker.id }
                    );
                  }}
                />
              </g>
            );
          })}
        </svg>
      </div>

      <div className="pbe__inspect" aria-live="polite">
        {selMarker ? (
          <>
            <span className="pbe__inspect-label">{selMarker.shape === "text" ? "Label" : "Marker"}</span>
            {selMarker.shape !== "text" && (
              <div className="pbe__shapes pbe__shapes--inspect" role="group" aria-label="Shape">
                {GLYPH_SHAPES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={"pbe__shape" + (selMarker.shape === s ? " is-on" : "")}
                    aria-label={s}
                    aria-pressed={selMarker.shape === s}
                    onClick={() => pickShape(s)}
                  >
                    <PieceIcon kind={s} />
                  </button>
                ))}
              </div>
            )}
            <input
              className="input pbe__zlabel"
              value={selMarker.label || ""}
              placeholder={selMarker.shape === "text" ? "Type a label" : "Caption (optional)"}
              aria-label="Marker label"
              onChange={(e) => updateSelectedMarker({ label: e.target.value })}
            />
            <button type="button" className="btn btn--quiet btn--sm pbe__del" onClick={deleteSelected}>
              Remove
            </button>
          </>
        ) : selZone ? (
          <>
            <span className="pbe__inspect-label">Zone</span>
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
            <button type="button" className="btn btn--quiet btn--sm pbe__del" onClick={deleteSelected}>
              Remove
            </button>
          </>
        ) : (
          <span className="pbe__hint">
            Pick a color &amp; shape, then add a piece · tap a piece to edit · drag to move
          </span>
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
          disabled={data.frames.length <= 1}
        >
          Delete stage
        </button>
      </div>

      {pieceMenu && (
        <ContextMenu
          point={pieceMenu.point}
          ariaLabel="Diagram piece actions"
          onClose={() => setPieceMenu(null)}
          items={[
            {
              label: "Duplicate",
              icon: <CampIcon.Copy />,
              onSelect: () => duplicateSelection(pieceMenu.sel),
            },
            {
              label: "Remove",
              icon: <CampIcon.Trash />,
              danger: true,
              separatorBefore: true,
              onSelect: () => deleteSelection(pieceMenu.sel),
            },
          ]}
        />
      )}
    </div>
  );
}
