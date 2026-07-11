"use client";

// ============================================================
// Camp Library — "The Run List" (the activity's instruction document)
//
// One editable stack. Numbered steps are collapsible and own attached detail
// that's intertwined with the flow — a note, a field diagram, the materials
// checklist, a safety call, a variation, a video — so e.g. Step 1 "Split the
// field" can carry the field diagram and a "lots of players?" variation right
// beneath it. Collapsing a step tucks all of that away behind summary pills.
//
// No modes: click any line to edit, drag a block to move it, trash to remove.
// Structural + text edits are pushed up via `onChange`; collapse is
// transient view state.
// ============================================================

import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import type { Activity } from "@/lib/types";
import { type AgeUnit } from "@/lib/content/data";
import { resolveRefs } from "@/lib/materials/materials";
import { type Material } from "@/lib/materials/materialCatalog";
import type { StockState } from "@/lib/materials/kitStock";
import {
  type FormState,
} from "@/lib/activity/activityForm";
import { CampIcon } from "../ui/icons";
import { ContextMenu } from "../floating/ContextMenu";
import { FloatingLayer } from "../floating/FloatingLayer";
import { RatingDots } from "../ui/primitives";
import { type ThemeKit } from "../library/ThemeField";
import { ActivityPlaybook } from "./ActivityPlaybook";
import {
  RUN_CHILD_META,
  RUN_CHILD_TYPES,
  RUN_COLORS,
  RUN_COLOR_TOKEN,
  RUN_ICONS,
  RUN_TOP_LABEL,
  applyDrop,
  blankDiagramChild,
  blankStepBlock,
  childFromTop,
  cloneRunChild,
  cloneRunDoc,
  defaultRunIcon,
  detailTagsForActivity,
  fieldNoteChild,
  fieldNotesBlock,
  insertBlockAfter,
  insertBlockAt,
  resolveDrop,
  runId,
  sameDragItem,
  topFromChild,
  type DragItem,
  type DropTarget,
  type RunBlock,
  type RunBlockType,
  type RunChild,
  type RunChildType,
  type RunColor,
  type RunDetailTag,
  type RunDoc,
  type RunIcon,
} from "@/lib/activity/runList";
import {
  duplicateChild,
  moveBlock,
  moveChild,
  patchBlock,
  patchChild,
  removeBlock,
  removeChild,
} from "@/lib/activity/runDocOps";
import type { ActivityPlaybookData } from "@/lib/activity/playbooks";
import { parseEmbed } from "@/lib/activity/embed";
import { DiagramLightbox } from "./DiagramLightbox";
import { DiagramEditModal } from "./DiagramEditModal";
import {
  ADD_BLOCKS,
  ATTACH_BLOCKS,
  DETAIL_ANIM_MS,
  dropPosition,
  Editable,
  formatStamp,
  Pill,
  RUN_ICON_CMP,
  RUN_ICON_LABEL,
  RunEmbed,
  TYPE_ICON,
  childRailKey,
  topRailKey,
  type RailSegment,
} from "./RunSheetControls";
import { DetailFormControls } from "./RunSheetDetailForm";
import { MaterialChecklist, MaterialsEditor } from "./RunSheetMaterials";

export function ActivityRunList({
  doc,
  editable,
  onChange,
  activity,
  kitStock,
  materialCatalog,
  onSetStockState,
  onSetRating,
  hideAddBlocks,
  canCapture = false,
  editForm,
  onEditFormChange,
  editThemeKit,
  editAgeUnit,
  onEditAgeUnit,
}: {
  doc: RunDoc;
  editable: boolean;
  onChange?: (next: RunDoc) => void;
  activity: Activity;
  /** The effective 3-state kit stock map the Materials checklist reads. Empty
   *  ({}) = UNSET (the checklist renders as a plain list, no can-run state). */
  kitStock: Record<string, StockState>;
  /** The materials catalog — display names + substitution groups for coverage. */
  materialCatalog?: Material[];
  /** Set one material's stock state via the checklist's bloom dot. Staff-gated
   *  upstream; a no-op on public/read-only surfaces. */
  onSetStockState: (id: string, state: StockState) => void;
  onSetRating?: (value: number) => void;
  /** When provided (edit/create), the Details block renders as structured
   *  dropdowns bound to this form, and the Materials block becomes an inline
   *  editor — the run sheet IS the editor, with no separate form above it. The
   *  details/materials FACTS live here (single source); the run-doc still derives
   *  its scaffold from them on save (stripScaffold), so there's no dual-write. */
  editForm?: FormState;
  onEditFormChange?: (next: FormState) => void;
  editThemeKit?: ThemeKit;
  editAgeUnit?: AgeUnit;
  onEditAgeUnit?: (v: AgeUnit) => void;
  /** Block types kept out of the "Add a block" palettes. In the unified editor
   *  the scalar Activity-card controls own details/materials as plain form
   *  fields, so those scaffold blocks are stripped from the editable play-doc
   *  AND kept out of the palette here — there is no second editable copy of the
   *  detail facts to fight the form on save (the old dual-write). */
  hideAddBlocks?: RunBlockType[];
  /** Make field-note blocks live — directly typeable in the READ-ONLY viewer,
   *  the same way the rating dots are interactive without entering edit mode. The
   *  rest of the read view stays static (a stray tap on a step never pops the
   *  keyboard). Only wired where saving is possible (signed-in staff). */
  canCapture?: boolean;
}) {
  const addableBlocks = hideAddBlocks?.length
    ? ADD_BLOCKS.filter((block) => !hideAddBlocks.includes(block.type))
    : ADD_BLOCKS;

  // Form-bound edit: the run sheet hosts the scalar facts inline (Details +
  // Materials) instead of a separate form above it. Requires the draft form +
  // its onChange; absent in browse/read.
  const isFormEdit = editable && Boolean(editForm && onEditFormChange);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [closing, setClosing] = useState<Record<string, boolean>>({});
  const [openKid, setOpenKid] = useState<string | null>(null);
  const [openTop, setOpenTop] = useState(false);
  const [insertAt, setInsertAt] = useState<number | null>(null);
  // Bumped after a field-note composer commits, so it remounts empty and ready
  // for the next note.
  const [fnDraftKey, setFnDraftKey] = useState(0);
  // The diagram detail (parent step + child id) currently open in the full-screen
  // editor, mirroring how read mode opens diagrams full screen in the lightbox.
  const [fullDiagram, setFullDiagram] = useState<{ stepId: string; childId: string } | null>(null);
  const [lightbox, setLightbox] = useState<ActivityPlaybookData | null>(null);
  const [undoState, setUndoState] = useState<{ message: string; doc: RunDoc } | null>(null);
  const [dragItem, setDragItem] = useState<DragItem | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  // Right-click on a block (edit mode only) → a themed menu mirroring the row
  // tools. Pointer-fine only; touch keeps the always-visible row buttons.
  const [blockMenu, setBlockMenu] = useState<{ item: DragItem; point: { x: number; y: number } } | null>(null);
  // The icon + colour picker for a text-ish block/child, anchored to its node.
  const [runStyle, setRunStyle] = useState<{ item: DragItem; rect: DOMRect } | null>(null);
  const [railSegments, setRailSegments] = useState<RailSegment[]>([]);

  const dragRef = useRef<DragItem | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const railNodes = useRef<Map<string, HTMLElement>>(new Map());
  const closeTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pendingFocusRef = useRef<{ id: string; caret: "start" | "end" } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Focus the step a structural edit just created (Enter-split) or revealed
  // (Backspace-join). Splits carry text into the new step, so the caret goes
  // to its start; joins put the caret at the end of the previous step.
  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    pendingFocusRef.current = null;
    const node = listRef.current?.querySelector<HTMLElement>('[data-rl-focus="' + pending.id + '"]');
    if (!node) return;
    node.focus();
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(node);
      range.collapse(pending.caret === "start");
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }, [doc]);

  useEffect(
    () => () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    },
    []
  );

  useEffect(() => {
    const timers = closeTimers.current;
    return () => Object.values(timers).forEach((t) => clearTimeout(t));
  }, []);

  const materialNeeds = useMemo(() => resolveRefs(activity, materialCatalog), [activity, materialCatalog]);
  const detailTags = useMemo(() => detailTagsForActivity(activity), [activity]);

  const commit = (next: RunDoc) => onChange?.(next);

  // ---- block + child edits (controlled: derive next doc, push up) -----------
  // The structural transforms live in lib/activity/runDocOps (pure + unit-tested);
  // the wrappers here add the component-side effects (undo snapshot, focus, the
  // open/close of a step) around a single commit.
  const patchTop = (id: string, patch: Partial<RunBlock>) => commit(patchBlock(doc, id, patch));

  const patchKid = (pid: string, kid: string, patch: Partial<RunChild>) =>
    commit(patchChild(doc, pid, kid, patch));

  // Set the icon/colour override on whatever the picker is open over (a top
  // block or an attached child). Routes through the same patch helpers, so the
  // change persists like any other run-doc edit.
  const applyRunStyle = (patch: { icon?: RunIcon; color?: RunColor }) => {
    const item = runStyle?.item;
    if (!item) return;
    if (item.kind === "top") patchTop(item.id, patch);
    else patchKid(item.parentId, item.id, patch);
  };

  // The leading node for a text-ish block/child: an outlined glyph the staffer
  // can click to recolour / re-icon. The glyph defaults from the semantic type
  // (so derived/old docs look right); a chosen colour tints the ring via --rl-blk.
  const decoNode = (
    railKey: string,
    item: DragItem,
    type: RunBlockType | RunChildType,
    icon: RunIcon | undefined,
    color: RunColor | undefined
  ): ReactNode => {
    const Glyph = RUN_ICON_CMP[icon ?? defaultRunIcon(type)];
    const tinted = !!color && color !== "none";
    const cls =
      "rl-node rl-node--type rl-node--" + type + (tinted ? " rl-node--tinted" : "");
    const style = tinted ? ({ ["--rl-blk"]: RUN_COLOR_TOKEN[color] } as CSSProperties) : undefined;
    if (!editable) {
      return (
        <span ref={railNodeRef(railKey)} className={cls} style={style} contentEditable={false}>
          <Glyph />
        </span>
      );
    }
    return (
      <button
        ref={railNodeRef(railKey)}
        type="button"
        className={cls + " rl-node--pick"}
        style={style}
        contentEditable={false}
        aria-label="Set icon and colour"
        onClick={(e) => setRunStyle({ item, rect: e.currentTarget.getBoundingClientRect() })}
      >
        <Glyph />
      </button>
    );
  };

  // ---- "Specific details" tags (stored on the details block, so a hand edit
  // persists with the run-doc override — the same pattern as steps/notes). The
  // block's seeded facts fall back to the live activity until one is touched.
  const detailTagsOf = (b: RunBlock): RunDetailTag[] =>
    b.tags && b.tags.length ? b.tags : detailTags;

  const commitDetailTag = (b: RunBlock, tagId: string, label: string) => {
    const trimmed = label.trim();
    const tags = detailTagsOf(b);
    // Clearing a tag's text removes it — the same "empty = gone" feel as steps.
    const next = trimmed
      ? tags.map((t) => (t.id === tagId ? { ...t, label: trimmed } : t))
      : tags.filter((t) => t.id !== tagId);
    patchTop(b.id, { tags: next });
  };

  const removeDetailTag = (b: RunBlock, tagId: string) =>
    patchTop(b.id, { tags: detailTagsOf(b).filter((t) => t.id !== tagId) });

  const addDetailTag = (b: RunBlock) => {
    const id = runId("tag");
    pendingFocusRef.current = { id, caret: "end" };
    patchTop(b.id, { tags: [...detailTagsOf(b), { id, label: "" }] });
  };

  // Destructive removals snapshot the doc for a 6-second Undo — a mis-tap on
  // the trash can no longer silently destroys a step and all its details.
  const offerUndo = (message: string) => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    const snapshot = cloneRunDoc(doc);
    setUndoState({ message, doc: snapshot });
    // Destructive undo gets the same 8s window as the calendar's delete toast.
    undoTimerRef.current = setTimeout(() => setUndoState(null), 8000);
  };

  const undoRemoval = () => {
    if (!undoState) return;
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    commit(undoState.doc);
    setUndoState(null);
  };

  const rmTop = (id: string) => {
    const block = doc.blocks.find((b) => b.id === id);
    // Removing a step closes its diagram editor if it happened to be open.
    if (fullDiagram?.stepId === id) setFullDiagram(null);
    offerUndo((block?.type === "step" ? "Step" : "Block") + " removed");
    commit(removeBlock(doc, id));
  };

  // Duplicate a top-level block right below itself, with fresh ids on the block
  // and every attached detail (diagrams deep-cloned) so the copy can't collide
  // with the original.
  const dupTop = (id: string) => {
    const block = doc.blocks.find((b) => b.id === id);
    if (!block) return;
    const copy: RunBlock = {
      ...block,
      id: runId("b"),
      children: (block.children || []).map((c) => cloneRunChild(c, runId("k"))),
    };
    commit(insertBlockAfter(doc, id, copy));
  };

  // Duplicate an attached detail right after itself within the same parent.
  const dupKid = (pid: string, kid: string) => commit(duplicateChild(doc, pid, kid, runId("k")));

  // Enter inside a step: split at the caret — text before stays, text after
  // moves into a fresh step that takes focus.
  const splitStep = (id: string, beforeText: string, afterText: string) => {
    const fresh = { ...blankStepBlock(), text: afterText };
    pendingFocusRef.current = { id: fresh.id, caret: "start" };
    commit(insertBlockAfter(doc, id, fresh, { text: beforeText }));
  };

  // Backspace in an empty step: remove it and put the caret back on the
  // previous step.
  const removeEmptyStep = (id: string) => {
    const index = doc.blocks.findIndex((b) => b.id === id);
    if (index < 0) return;
    if (fullDiagram?.stepId === id) setFullDiagram(null);
    const previousStep = [...doc.blocks.slice(0, index)].reverse().find((b) => b.type === "step");
    if (previousStep) pendingFocusRef.current = { id: previousStep.id, caret: "end" };
    commit(removeBlock(doc, id));
  };

  // Reorder a top-level block by one slot. Touch/keyboard-friendly counterpart to
  // the HTML5 drag handles (which never fire on touch devices).
  const moveTopBy = (id: string, dir: -1 | 1) => {
    const next = moveBlock(doc, id, dir);
    if (next) commit(next);
  };

  // Same for a step's attached details — without this, touch devices have no
  // way to reorder a note/diagram under a step at all.
  const moveChildBy = (parentId: string, childId: string, dir: -1 | 1) =>
    commit(moveChild(doc, parentId, childId, dir));

  // Tab on a top-level note/safety/variation: tuck it under the nearest step
  // above as a detail (committing its latest text in the same move). No step
  // above → no-op. Reuses the unit-tested applyDrop + childFromTop conversion.
  const indentTopBlock = (id: string, text: string) => {
    const idx = doc.blocks.findIndex((b) => b.id === id);
    if (idx < 0) return;
    let stepId: string | null = null;
    for (let i = idx - 1; i >= 0; i -= 1) {
      if (doc.blocks[i].type === "step") {
        stepId = doc.blocks[i].id;
        break;
      }
    }
    if (!stepId) return;
    const withText = doc.blocks.map((b) => (b.id === id ? { ...b, text } : b));
    const moving = withText.find((b) => b.id === id);
    if (!moving || !childFromTop(moving)) return;
    const step = withText.find((b) => b.id === stepId);
    const lastKid = step?.children?.length ? step.children[step.children.length - 1].id : null;
    const next = applyDrop(withText, { kind: "top", id }, {
      scope: "children",
      parentId: stepId,
      targetChildId: lastKid,
      position: "after",
    });
    if (!next) return;
    openStep(stepId);
    pendingFocusRef.current = { id, caret: "end" };
    commit({ blocks: next });
  };

  // Shift+Tab on an attached note/safety/variation: lift it back to a top-level
  // block right after its parent step (committing its latest text).
  const outdentChild = (parentId: string, childId: string, text: string) => {
    const parent = doc.blocks.find((b) => b.id === parentId);
    const child = parent?.children?.find((c) => c.id === childId);
    if (!child || !topFromChild(child)) return;
    const withText = doc.blocks.map((b) =>
      b.id === parentId
        ? { ...b, children: (b.children || []).map((c) => (c.id === childId ? { ...c, text } : c)) }
        : b
    );
    const next = applyDrop(withText, { kind: "child", parentId, id: childId }, {
      scope: "top",
      targetId: parentId,
      position: "after",
    });
    if (!next) return;
    pendingFocusRef.current = { id: childId, caret: "end" };
    commit({ blocks: next });
  };

  const rmKid = (pid: string, kid: string) => {
    if (fullDiagram?.childId === kid) setFullDiagram(null);
    offerUndo("Detail removed");
    commit(removeChild(doc, pid, kid));
  };

  const addKid = (pid: string, type: RunChildType) => {
    let kid: RunChild;
    if (type === "video") kid = { id: runId("k"), type, title: "", url: "" };
    else if (type === "diagram") kid = blankDiagramChild(activity.id, activity.title);
    else if (type === "materials") kid = { id: runId("k"), type };
    else if (type === "fieldnote") kid = fieldNoteChild();
    else kid = { id: runId("k"), type, text: "" };
    commit({
      blocks: doc.blocks.map((b) =>
        b.id === pid ? { ...b, children: [...(b.children || []), kid] } : b
      ),
    });
    openStep(pid);
    // The palette STAYS OPEN after an add so several sub-blocks (a note, then
    // safety, then materials) go in without reopening it each time — dismissal
    // is the existing close affordance / Escape. A diagram is the exception:
    // it opens straight into the full-screen editor, so the palette closes.
    if (type === "diagram") {
      setOpenKid(null);
      setFullDiagram({ stepId: pid, childId: kid.id });
    }
  };

  const makeTopBlock = (type: RunBlockType): RunBlock => {
    if (type === "step") return { id: runId("b"), type, text: "", collapsed: false, children: [] };
    if (type === "heading") return { id: runId("b"), type, text: "New section", children: [] };
    if (type === "materials") return { id: runId("b"), type, children: [] };
    if (type === "details") return { id: runId("b"), type, children: [] };
    if (type === "fieldnote") return fieldNotesBlock();
    return { id: runId("b"), type, text: "", children: [] };
  };

  const addTop = (type: RunBlockType) => {
    commit({ blocks: [...doc.blocks, makeTopBlock(type)] });
    setOpenTop(false);
  };

  // The between-rows "+" affordance: insert any block type at that gap.
  const addTopAt = (type: RunBlockType, index: number) => {
    const block = makeTopBlock(type);
    if (block.type === "step") pendingFocusRef.current = { id: block.id, caret: "end" };
    commit(insertBlockAt(doc, index, block));
    setInsertAt(null);
  };

  // ---- Field notes log (a self-contained block handled like a step + its
  // sub-steps; entries are typeable in read mode too — see canCapture).
  // The parent's composer: a non-empty commit appends a fresh dated entry below,
  // expands the log if it was collapsed, and resets the line for the next one.
  const addNote = (containerId: string, text: string) => {
    if (!text.trim()) return;
    const entry = fieldNoteChild(text);
    commit({
      blocks: doc.blocks.map((b) =>
        b.id === containerId ? { ...b, children: [...(b.children || []), entry] } : b
      ),
    });
    openStep(containerId);
    setFnDraftKey((n) => n + 1);
  };

  const moveTo = (target: DropTarget) => {
    const source = dragRef.current;
    const destination = source ? resolveDrop(source, target, doc.blocks) : null;
    const blocks = source && destination ? applyDrop(doc.blocks, source, destination) : null;
    if (blocks) {
      // Nesting onto a step's details auto-expands it so the move is visible.
      if (destination?.scope === "children") openStep(destination.parentId);
      commit({ blocks });
    }
    finishDrag();
  };

  const finishDrag = () => {
    dragRef.current = null;
    setDragItem(null);
    setDropTarget(null);
  };

  // ---- collapse state (transient) ------------------------------------------
  const clearTimer = (id: string) => {
    if (closeTimers.current[id]) {
      clearTimeout(closeTimers.current[id]);
      delete closeTimers.current[id];
    }
  };
  // Steps and the Field notes log are both collapsible parents — same transient
  // collapse machinery (the stored `collapsed` is just the default).
  const isCollapsed = (b: RunBlock) =>
    (b.type === "step" || b.type === "fieldnote") && (collapsed[b.id] ?? Boolean(b.collapsed));

  const openStep = (id: string) => {
    clearTimer(id);
    setClosing((m) => {
      const next = { ...m };
      delete next[id];
      return next;
    });
    setCollapsed((m) => ({ ...m, [id]: false }));
  };

  const closeStep = (id: string) => {
    clearTimer(id);
    setOpenKid((open) => (open === id ? null : open));
    setClosing((m) => ({ ...m, [id]: true }));
    closeTimers.current[id] = setTimeout(() => {
      setCollapsed((m) => ({ ...m, [id]: true }));
      setClosing((m) => {
        const next = { ...m };
        delete next[id];
        return next;
      });
      delete closeTimers.current[id];
    }, DETAIL_ANIM_MS);
  };

  const toggleStep = (b: RunBlock) => {
    if (isCollapsed(b) || closing[b.id]) openStep(b.id);
    else closeStep(b.id);
  };

  const allCollapse = (v: boolean) => {
    Object.keys(closeTimers.current).forEach(clearTimer);
    setClosing({});
    if (v) setOpenKid(null);
    const next: Record<string, boolean> = {};
    doc.blocks.forEach((b) => {
      if (b.type === "step") next[b.id] = v;
    });
    setCollapsed(next);
  };

  const hasSteps = useMemo(() => doc.blocks.some((b) => b.type === "step"), [doc.blocks]);

  // ---- drag wiring: rows are the handle; destinations can be top-level or attached details.
  const dragBind = (item: DragItem) => ({
    draggable: editable,
    onDragStart: (e: DragEvent<HTMLElement>) => {
      const target = e.target as HTMLElement;
      if (target.closest("button, input, textarea, select, a, .matkit, .pbe, .rl-embed")) {
        e.preventDefault();
        return;
      }
      dragRef.current = item;
      setDragItem(item);
      e.dataTransfer.effectAllowed = "move";
      try {
        e.dataTransfer.setData("text/plain", item.kind + ":" + item.id);
      } catch {
        /* some browsers reject setData outside a user gesture */
      }
    },
    onDragEnd: finishDrag,
    // Edit-mode-only right-click: suppress the browser's spellcheck/editing
    // menu and open the themed block menu instead. Ignore right-clicks on
    // nested controls (e.g. the diagram editor) so they keep their own surface.
    onContextMenu: editable
      ? (e: ReactMouseEvent<HTMLElement>) => {
          if (typeof window !== "undefined" && !window.matchMedia("(pointer: fine)").matches) return;
          if ((e.target as HTMLElement).closest("button, input, textarea, select, a, .matkit, .pbe, .rl-embed")) return;
          e.preventDefault();
          e.stopPropagation();
          setBlockMenu({ item, point: { x: e.clientX, y: e.clientY } });
        }
      : undefined,
  });

  const dropBind = (item: DragItem) => ({
    onDragOver: (e: DragEvent<HTMLElement>) => {
      const source = dragRef.current;
      if (!editable || source == null) return;
      const target: DropTarget = { item, position: dropPosition(e) };
      if (!resolveDrop(source, target, doc.blocks)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (
        !dropTarget ||
        !sameDragItem(dropTarget.item, item) ||
        dropTarget.position !== target.position
      ) {
        setDropTarget(target);
      }
    },
    onDrop: (e: DragEvent<HTMLElement>) => {
      if (!editable) return;
      e.preventDefault();
      moveTo({ item, position: dropPosition(e) });
    },
  });

  const itemStateClass = (item: DragItem) => {
    const isDrop = dropTarget && sameDragItem(dropTarget.item, item);
    return (
      (isDrop && !sameDragItem(dragItem, item) ? " is-over-" + dropTarget.position : "") +
      (sameDragItem(dragItem, item) ? " is-dragging" : "")
    );
  };

  const railNodeRef = (key: string) => (node: HTMLElement | null) => {
    if (node) railNodes.current.set(key, node);
    else railNodes.current.delete(key);
  };

  const railSections = useMemo(() => {
    const sections: string[][] = [[]];
    const current = () => sections[sections.length - 1];

    doc.blocks.forEach((b) => {
      if (b.type === "heading") {
        if (current().length > 0) sections.push([]);
        return;
      }

      current().push(topRailKey(b.id));

      if (b.type === "step" && (!isCollapsed(b) || closing[b.id])) {
        (b.children || []).forEach((k) => current().push(childRailKey(b.id, k.id)));
      }
    });

    return sections.filter((section) => section.length > 1);
  }, [doc.blocks, collapsed, closing]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    let frame = 0;

    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const listRect = list.getBoundingClientRect();
        const next: RailSegment[] = [];

        railSections.forEach((section, sectionIndex) => {
          section.forEach((from, itemIndex) => {
            const to = section[itemIndex + 1];
            if (!to) return;

            const fromNode = railNodes.current.get(from);
            const toNode = railNodes.current.get(to);
            if (!fromNode || !toNode) return;

            const fromRect = fromNode.getBoundingClientRect();
            const toRect = toNode.getBoundingClientRect();
            const y1 = fromRect.top + fromRect.height / 2 - listRect.top;
            const y2 = toRect.top + toRect.height / 2 - listRect.top;
            if (y2 <= y1 + 1) return;

            next.push({
              id: sectionIndex + ":" + itemIndex + ":" + from + ":" + to,
              x: fromRect.left + fromRect.width / 2 - listRect.left,
              y1,
              y2,
            });
          });
        });

        setRailSegments((prev) => {
          const same =
            prev.length === next.length &&
            prev.every(
              (segment, index) =>
                segment.id === next[index].id &&
                Math.abs(segment.x - next[index].x) < 0.5 &&
                Math.abs(segment.y1 - next[index].y1) < 0.5 &&
                Math.abs(segment.y2 - next[index].y2) < 0.5
            );
          return same ? prev : next;
        });
      });
    };

    measure();
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    resizeObserver?.observe(list);
    railNodes.current.forEach((node) => resizeObserver?.observe(node));
    window.addEventListener("resize", measure);

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [railSections]);

  // Row tools, with optional extra actions (e.g. attach-detail). Revealed on
  // hover/focus on pointer devices and always shown on touch (see globals.css).
  const handles = (id: string, extra?: ReactNode) => {
    if (!editable) return null;
    const idx = doc.blocks.findIndex((b) => b.id === id);
    return (
      <div className="rl-rowtools">
        {/* Not a button on purpose: dragBind ignores drags starting on buttons,
            and the whole row is the actual drag handle this grip advertises. */}
        <span className="rl-grip" title="Drag to reorder" aria-hidden="true">
          <CampIcon.Grip />
        </span>
        {extra}
        <button
          type="button"
          className="rl-iconbtn"
          onClick={() => moveTopBy(id, -1)}
          disabled={idx <= 0}
          aria-label="Move block up"
        >
          <CampIcon.ChevronUp />
        </button>
        <button
          type="button"
          className="rl-iconbtn"
          onClick={() => moveTopBy(id, 1)}
          disabled={idx < 0 || idx >= doc.blocks.length - 1}
          aria-label="Move block down"
        >
          <CampIcon.ChevronDown />
        </button>
        <button type="button" className="rl-iconbtn" onClick={() => rmTop(id)} aria-label="Remove block">
          <CampIcon.Trash />
        </button>
      </div>
    );
  };

  const detailIcon = (icon: string | undefined) => {
    if (icon === "pin") return <CampIcon.Pin />;
    if (icon === "users") return <CampIcon.Users />;
    if (icon === "clock") return <CampIcon.Clock />;
    if (icon === "type") return <CampIcon.Tag />;
    if (icon === "energy") return <CampIcon.Bolt />;
    if (icon === "prep") return <CampIcon.Tool />;
    if (icon === "rating") return <CampIcon.Star />;
    return null;
  };

  // ---- a single attached detail row (a sibling on the same rail) ------------
  const renderChild = (stepId: string, k: RunChild, closingNow: boolean): ReactNode => {
    const Icon = TYPE_ICON[k.type];
    const label = RUN_CHILD_META[k.type].label;
    // A field-note entry reads as a dated log line: the date+time chip IS its
    // header (the parent log already says "Field notes"), so the type label is
    // suppressed unless the entry somehow has no stamp.
    const timeExtra =
      k.type === "fieldnote" && k.at ? <span className="rl-fndate">{formatStamp(k.at)}</span> : null;
    const timeLabel = k.type === "fieldnote" && k.at ? null : label;
    const parentBlock = doc.blocks.find((b) => b.id === stepId);
    const childIndex = (parentBlock?.children || []).findIndex((c) => c.id === k.id);
    const childCount = parentBlock?.children?.length ?? 0;
    const removeBtn = editable ? (
      <div className="rl-rowtools">
        <span className="rl-grip" title="Drag to reorder" aria-hidden="true">
          <CampIcon.Grip />
        </span>
        <button
          type="button"
          className="rl-iconbtn"
          onClick={() => moveChildBy(stepId, k.id, -1)}
          disabled={childIndex <= 0}
          aria-label="Move detail up"
        >
          <CampIcon.ChevronUp />
        </button>
        <button
          type="button"
          className="rl-iconbtn"
          onClick={() => moveChildBy(stepId, k.id, 1)}
          disabled={childIndex < 0 || childIndex >= childCount - 1}
          aria-label="Move detail down"
        >
          <CampIcon.ChevronDown />
        </button>
        <button type="button" className="rl-iconbtn" onClick={() => rmKid(stepId, k.id)} aria-label="Remove detail">
          <CampIcon.Trash />
        </button>
      </div>
    ) : null;
    // Note / safety / variation details wear the clickable icon/colour node (the
    // picker). Sub-steps stay structural (their own glyph), and the specialized
    // children (diagram / materials / video / fieldnote) keep their fixed node.
    const isTextChild = k.type === "note" || k.type === "safety" || k.type === "variation";
    const nodeEl = isTextChild ? (
      decoNode(childRailKey(stepId, k.id), { kind: "child", parentId: stepId, id: k.id }, k.type, k.icon, k.color)
    ) : (
      <span
        ref={railNodeRef(childRailKey(stepId, k.id))}
        className={"rl-node rl-node--type rl-node--" + k.type}
        contentEditable={false}
      >
        <Icon />
      </span>
    );
    const shell = (body: ReactNode) => (
      <li
        key={k.id}
        {...dragBind({ kind: "child", parentId: stepId, id: k.id })}
        {...dropBind({ kind: "child", parentId: stepId, id: k.id })}
        className={
          "rl-block rl-block--detail rl-block--" +
          k.type +
          (closingNow ? " is-closing" : "") +
          itemStateClass({ kind: "child", parentId: stepId, id: k.id })
        }
      >
        {nodeEl}
        <div className="rl-block__main">
          <div className={"rl-row rl-row--detail rl-row--" + k.type}>
            <div className="rl-body">
              <div className="rl-time">
                {timeLabel}
                {timeExtra}
              </div>
              {body}
            </div>
            {removeBtn}
          </div>
        </div>
      </li>
    );

    if (k.type === "diagram") {
      if (!k.diagram) return shell(null);
      // Both modes open full screen — read mode walks the stages in the lightbox,
      // edit mode opens the roomy editor — so the diagram is never cramped.
      return shell(
        <button
          type="button"
          className="rl-diagram rl-diagram--open"
          onClick={() =>
            editable ? setFullDiagram({ stepId, childId: k.id }) : setLightbox(k.diagram ?? null)
          }
          aria-label={editable ? "Edit diagram full screen" : "View diagram full screen"}
        >
          <ActivityPlaybook playbook={k.diagram} compact />
          <span className="rl-diagram__cue" aria-hidden="true">
            {editable ? (
              <>
                <CampIcon.Pencil />
                Edit
              </>
            ) : (
              <>
                <CampIcon.Maximize />
                Full screen
              </>
            )}
          </span>
        </button>
      );
    }

    if (k.type === "materials") {
      return shell(
        materialNeeds.length === 0 ? (
          <span className="stamp">None needed</span>
        ) : (
          <MaterialChecklist
            needs={materialNeeds}
            stock={kitStock}
            catalog={materialCatalog}
            onSetStockState={onSetStockState}
          />
        )
      );
    }

    if (k.type === "video") {
      // A media detail: a YouTube/Vimeo link plays inline; any other link reads
      // as a tappable preview card. In edit mode the staffer sees a live preview.
      const rawUrl = (k.url || "").trim();
      const parsed = parseEmbed(rawUrl);
      if (!editable) {
        return shell(
          <div className="rl-vid">
            <RunEmbed parsed={parsed} title={k.title} />
            {(parsed.kind === "youtube" || parsed.kind === "vimeo" || parsed.kind === "none") && k.title ? (
              <span className="rl-vid__cap">{k.title}</span>
            ) : null}
            {parsed.kind === "none" && rawUrl ? <span className="rl-vid__url">{rawUrl}</span> : null}
          </div>
        );
      }
      return shell(
        <div className="rl-vid">
          <Editable
            className="rl-text"
            value={k.title || ""}
            editable={editable}
            placeholder="Caption (optional)"
            ariaLabel="Media caption"
            onCommit={(v) => patchKid(stepId, k.id, { title: v })}
          />
          <Editable
            className="rl-vid__url"
            tag="span"
            value={k.url || ""}
            editable={editable}
            placeholder="YouTube, Vimeo, or a link…"
            ariaLabel="Media link"
            onCommit={(v) => patchKid(stepId, k.id, { url: v })}
          />
          {parsed.kind !== "none" ? (
            <div className="rl-vid__preview">
              <RunEmbed parsed={parsed} title={k.title} />
            </div>
          ) : null}
        </div>
      );
    }

    const isFieldnote = k.type === "fieldnote";
    return shell(
      <Editable
        className="rl-text"
        value={k.text || ""}
        editable={editable || (isFieldnote && canCapture)}
        placeholder={RUN_CHILD_META[k.type].placeholder}
        ariaLabel={label + " detail text"}
        focusKey={k.id}
        onCommit={
          isFieldnote
            ? (v) => (v.trim() ? patchKid(stepId, k.id, { text: v }) : rmKid(stepId, k.id))
            : (v) => patchKid(stepId, k.id, { text: v })
        }
        onOutdent={isTextChild ? (t) => outdentChild(stepId, k.id, t) : undefined}
      />
    );
  };

  // ---- the Field notes log: handled exactly like a step + its sub-steps.
  // The parent row carries a composer text field; Enter (or blur) logs the typed
  // text as a fresh dated entry that rides beneath the parent as a detail row on
  // the same rail. The parent node toggles collapse, tucking every entry into a
  // "N field notes" pill — the same idiom as collapsing a step. Entries are
  // typeable straight from the read-only viewer when canCapture (no edit mode).
  const renderFieldNotes = (b: RunBlock): ReactNode => {
    const notes = (b.children || []).filter((c) => c.type === "fieldnote");
    const canWrite = editable || canCapture;
    // Nothing to show and no way to add (e.g. the public run sheet): skip it.
    if (notes.length === 0 && !canWrite) return null;

    const collapsedNow = isCollapsed(b);
    const closingNow = Boolean(closing[b.id]);
    const hasKids = notes.length > 0;
    const stateClass =
      (collapsedNow ? " is-collapsed" : "") +
      itemStateClass({ kind: "top", id: b.id }) +
      (closingNow ? " is-closing" : "") +
      (hasKids ? " has-children" : "");

    return (
      <Fragment key={b.id}>
        <li
          {...dragBind({ kind: "top", id: b.id })}
          {...dropBind({ kind: "top", id: b.id })}
          className={"rl-block rl-block--fieldnote rl-block--fnlog" + stateClass}
        >
          {hasKids ? (
            <button
              type="button"
              ref={railNodeRef(topRailKey(b.id))}
              className="rl-node rl-node--fnhead"
              onClick={() => toggleStep(b)}
              aria-label={collapsedNow ? "Expand field notes" : "Collapse field notes"}
              aria-expanded={!collapsedNow && !closingNow}
              contentEditable={false}
            >
              <CampIcon.Flag />
            </button>
          ) : (
            <span
              ref={railNodeRef(topRailKey(b.id))}
              className="rl-node rl-node--fnhead rl-node--plain"
              contentEditable={false}
            >
              <CampIcon.Flag />
            </span>
          )}
          <div className="rl-block__main">
            <div className="rl-row rl-row--fieldnote rl-row--fnlog">
              <div className="rl-body">
                <div className="rl-time">Field notes</div>
                {canWrite ? (
                  <Editable
                    key={"fn:" + b.id + ":" + fnDraftKey}
                    className="rl-text rl-fncompose"
                    value=""
                    editable
                    placeholder={hasKids ? "Jot another field note…" : "Jot a field note…"}
                    ariaLabel="New field note"
                    commitOnEnter
                    onCommit={(v) => addNote(b.id, v)}
                  />
                ) : null}
                {collapsedNow && hasKids && (
                  <div className="rl-summary" contentEditable={false}>
                    <Pill type="fieldnote" n={notes.length} />
                  </div>
                )}
              </div>
              {handles(b.id)}
            </div>
          </div>
        </li>

        {(!collapsedNow || closingNow) && notes.map((k) => renderChild(b.id, k, closingNow))}
      </Fragment>
    );
  };

  let stepNo = 0;

  // A slim "+" between rows: hover-revealed on pointers, always tappable on
  // touch (CSS). Opens the block palette anchored at that gap, so inserting
  // mid-document no longer means append-then-arrow-up.
  const renderInsertZone = (index: number): ReactNode => {
    if (!editable) return null;
    // While dragging, the only positioning cue on screen is the drop indicator —
    // the between-row "+" affordances stay out of the way to cut the clutter.
    // Keep the gap's height (an empty spacer) rather than removing it, or the
    // whole list would collapse upward the instant a drag starts ("reframes").
    if (dragItem) return <li className="rl-insert" aria-hidden="true" />;
    if (insertAt === index) {
      return (
        <li className="rl-block rl-block--add rl-insertopen">
          <span className="rl-node rl-node--spacer" aria-hidden="true" />
          <div className="rl-block__main">
            <div
              className="rl-palette rl-palette--flat"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  setInsertAt(null);
                }
              }}
            >
              {addableBlocks.map(({ type, label, icon: Icon }, i) => (
                <button
                  type="button"
                  key={type}
                  className="rl-ptype"
                  autoFocus={i === 0}
                  onClick={() => addTopAt(type, index)}
                >
                  <Icon />
                  {label}
                </button>
              ))}
              <button type="button" className="rl-ptype rl-ptype--cancel" onClick={() => setInsertAt(null)}>
                <CampIcon.Close />
                Cancel
              </button>
            </div>
          </div>
        </li>
      );
    }
    return (
      <li className="rl-insert" aria-hidden={false}>
        <button
          type="button"
          className="rl-insert__btn"
          onClick={() => setInsertAt(index)}
          aria-label="Insert a block here"
        >
          <CampIcon.Plus />
        </button>
      </li>
    );
  };

  return (
    <div className={"rl" + (editable ? "" : " is-readonly") + (dragItem ? " is-dnd" : "")}>
      <div className="rl-toolbar">
        {hasSteps && (
          <>
            <button type="button" className="rl-tbtn" onClick={() => allCollapse(true)}>
              <CampIcon.CollapseAll />
              Collapse all
            </button>
            <button type="button" className="rl-tbtn" onClick={() => allCollapse(false)}>
              <CampIcon.ExpandAll />
              Expand all
            </button>
          </>
        )}
      </div>

      <div className="rl-doc">
        <ul className="rl-list" ref={listRef}>
          <li className="rl-rail" aria-hidden="true">
            {railSegments.map((segment) => (
              <span
                key={segment.id}
                style={{
                  left: segment.x - 1,
                  top: segment.y1,
                  height: segment.y2 - segment.y1,
                }}
              />
            ))}
          </li>
          {/* ---- FORM-BOUND DETAILS + MATERIALS (edit/create) ----
              The scalar facts live inline as the top of the run sheet, the same
              positions browse shows them as static tags. These render OUTSIDE
              doc.blocks (they bind to editForm, not the run-doc) so the play
              content stays the single editable run-doc; on save the scaffold is
              re-derived from these facts (no dual-write). */}
          {isFormEdit && editForm && onEditFormChange && (
            <>
              <li className="rl-block rl-block--heading rl-block--formhead" aria-hidden="false">
                <div className="rl-block__main">
                  <div className="rl-row rl-row--heading">
                    <div className="rl-body">
                      <span className="rl-heading__t">Details</span>
                    </div>
                  </div>
                </div>
              </li>
              <li className="rl-block rl-block--details rl-block--formdetails">
                <span className="rl-node rl-node--type rl-node--details" contentEditable={false}>
                  <CampIcon.Card />
                </span>
                <div className="rl-block__main">
                  <div className="rl-row rl-row--details">
                    <div className="rl-body">
                      <div className="rl-time">{RUN_TOP_LABEL.details}</div>
                      <DetailFormControls
                        form={editForm}
                        onFormChange={onEditFormChange}
                        themeKit={editThemeKit}
                        ageUnit={editAgeUnit}
                        onAgeUnit={onEditAgeUnit}
                      />
                    </div>
                  </div>
                </div>
              </li>
              <li className="rl-block rl-block--materials rl-block--formmaterials">
                <span className="rl-node rl-node--type rl-node--materials" contentEditable={false}>
                  <CampIcon.Card />
                </span>
                <div className="rl-block__main">
                  <div className="rl-row rl-row--materials">
                    <div className="rl-body">
                      <div className="rl-time">{RUN_TOP_LABEL.materials}</div>
                      <MaterialsEditor
                        rows={editForm.materialRefs}
                        onChange={(materialRefs) => onEditFormChange({ ...editForm, materialRefs })}
                      />
                    </div>
                  </div>
                </div>
              </li>
              {hasSteps && (
                <li className="rl-block rl-block--heading rl-block--formhead" aria-hidden="false">
                  <div className="rl-block__main">
                    <div className="rl-row rl-row--heading">
                      <div className="rl-body">
                        <span className="rl-heading__t">How to play</span>
                      </div>
                    </div>
                  </div>
                </li>
              )}
            </>
          )}
          {doc.blocks.map((b, blockIndex) => (
            <Fragment key={"wrap-" + b.id}>
              {renderInsertZone(blockIndex)}
              {(() => {
            // ---- SECTION HEADING ----
            if (b.type === "heading") {
              stepNo = 0;
              return (
                <li
                  key={b.id}
                  {...dragBind({ kind: "top", id: b.id })}
                  {...dropBind({ kind: "top", id: b.id })}
                  className={"rl-block rl-block--heading" + itemStateClass({ kind: "top", id: b.id })}
                >
                  <div className="rl-block__main">
                    <div className="rl-row rl-row--heading">
                      <div className="rl-body">
                        <Editable
                          className="rl-heading__t"
                          tag="span"
                          value={b.text || ""}
                          editable={editable}
                          placeholder="Section"
                          ariaLabel="Section heading"
                          onCommit={(v) => patchTop(b.id, { text: v })}
                        />
                      </div>
                      {handles(b.id)}
                    </div>
                  </div>
                </li>
              );
            }

            // ---- ACTIVITY DETAILS / TAGS ----
            if (b.type === "details") {
              const tagsEditable = editable;
              const shownTags = detailTagsOf(b);
              return (
                <li
                  key={b.id}
                  {...dragBind({ kind: "top", id: b.id })}
                  {...dropBind({ kind: "top", id: b.id })}
                  className={"rl-block rl-block--details" + itemStateClass({ kind: "top", id: b.id })}
                >
                  <span
                    ref={railNodeRef(topRailKey(b.id))}
                    className="rl-node rl-node--type rl-node--details"
                    contentEditable={false}
                  >
                    <CampIcon.Card />
                  </span>
                  <div className="rl-block__main">
                    <div className="rl-row rl-row--details">
                      <div className="rl-body">
                        <div className="rl-time">{RUN_TOP_LABEL.details}</div>
                        <div className="rl-detailtags">
                          {shownTags
                            .filter((tag) => tag.id !== "rating" || !onSetRating)
                            .map((tag) =>
                              tagsEditable ? (
                                <span className="rl-detailtag rl-detailtag--edit" key={tag.id}>
                                  {detailIcon(tag.icon)}
                                  <Editable
                                    tag="span"
                                    className="rl-detailtag__t"
                                    value={tag.label}
                                    editable
                                    placeholder="Tag"
                                    ariaLabel="Detail tag"
                                    focusKey={tag.id}
                                    onCommit={(v) => commitDetailTag(b, tag.id, v)}
                                  />
                                  <button
                                    type="button"
                                    className="rl-detailtag__x"
                                    onClick={() => removeDetailTag(b, tag.id)}
                                    aria-label={"Remove " + (tag.label || "tag")}
                                  >
                                    <CampIcon.Close />
                                  </button>
                                </span>
                              ) : (
                                <span className="rl-detailtag" key={tag.id}>
                                  {detailIcon(tag.icon)}
                                  {tag.label}
                                </span>
                              )
                            )}
                          {tagsEditable && (
                            <button
                              type="button"
                              className="rl-detailtag rl-detailtag--add"
                              onClick={() => addDetailTag(b)}
                              aria-label="Add a detail tag"
                            >
                              <CampIcon.Plus />
                              Add
                            </button>
                          )}
                        </div>
                        {onSetRating && (
                          <div className="rl-detailrating">
                            <RatingDots value={activity.rating || 0} onChange={onSetRating} />
                          </div>
                        )}
                      </div>
                      {handles(b.id)}
                    </div>
                  </div>
                </li>
              );
            }

            // ---- PLAYBOOK cross-link (legacy; kept for stored docs) ----
            if (b.type === "playbook") {
              return (
                <li
                  key={b.id}
                  {...dragBind({ kind: "top", id: b.id })}
                  {...dropBind({ kind: "top", id: b.id })}
                  className={"rl-block rl-block--playbook" + itemStateClass({ kind: "top", id: b.id })}
                >
                  <span
                    ref={railNodeRef(topRailKey(b.id))}
                    className="rl-node rl-node--type rl-node--playbook"
                    contentEditable={false}
                  >
                    <CampIcon.BookOpen />
                  </span>
                  <div className="rl-block__main">
                    <div className="rl-row rl-row--playbook">
                      <span className="rl-pb__spine" contentEditable={false}>
                        <CampIcon.BookOpen />
                      </span>
                      <div className="rl-body">
                        <Editable
                          className="rl-pb__title"
                          value={b.title || ""}
                          editable={editable}
                          placeholder="Linked activity"
                          ariaLabel="Playbook card title"
                          onCommit={(v) => patchTop(b.id, { title: v })}
                        />
                        <Editable
                          className="rl-pb__meta"
                          tag="span"
                          value={b.meta || ""}
                          editable={editable}
                          placeholder="meta"
                          ariaLabel="Playbook card meta"
                          onCommit={(v) => patchTop(b.id, { meta: v })}
                        />
                      </div>
                      {handles(b.id)}
                    </div>
                  </div>
                </li>
              );
            }

            // ---- TOP-LEVEL MATERIALS / KIT ----
            if (b.type === "materials") {
              return (
                <li
                  key={b.id}
                  {...dragBind({ kind: "top", id: b.id })}
                  {...dropBind({ kind: "top", id: b.id })}
                  className={"rl-block rl-block--materials" + itemStateClass({ kind: "top", id: b.id })}
                >
                  <span
                    ref={railNodeRef(topRailKey(b.id))}
                    className="rl-node rl-node--type rl-node--materials"
                    contentEditable={false}
                  >
                    <CampIcon.Card />
                  </span>
                  <div className="rl-block__main">
                    <div className="rl-row rl-row--materials">
                      <div className="rl-body">
                        <div className="rl-time">{RUN_TOP_LABEL.materials}</div>
                        {materialNeeds.length === 0 ? (
                          <span className="stamp">None needed</span>
                        ) : (
                          <MaterialChecklist
                            needs={materialNeeds}
                            stock={kitStock}
                            catalog={materialCatalog}
                            onSetStockState={onSetStockState}
                          />
                        )}
                      </div>
                      {handles(b.id)}
                    </div>
                  </div>
                </li>
              );
            }

            // ---- TOP-LEVEL FIELD NOTES LOG (step + sub-steps idiom) ----
            if (b.type === "fieldnote") {
              return renderFieldNotes(b);
            }

            // ---- TOP-LEVEL NOTE / SAFETY / VARIATION ----
            if (b.type !== "step") {
              const label = RUN_TOP_LABEL[b.type as "note" | "safety" | "variation"] || "Note";
              return (
                <li
                  key={b.id}
                  {...dragBind({ kind: "top", id: b.id })}
                  {...dropBind({ kind: "top", id: b.id })}
                  className={"rl-block rl-block--" + b.type + itemStateClass({ kind: "top", id: b.id })}
                  // A custom block colour drives the node badge's fill (via
                  // --rl-blkc), so a recoloured block's icon bracket matches.
                  style={
                    b.color && b.color !== "none"
                      ? ({ ["--rl-blkc"]: RUN_COLOR_TOKEN[b.color] } as CSSProperties)
                      : undefined
                  }
                >
                  {decoNode(topRailKey(b.id), { kind: "top", id: b.id }, b.type, b.icon, b.color)}
                  <div className="rl-block__main">
                    <div className={"rl-row rl-row--" + b.type}>
                      <div className="rl-body">
                        <div className="rl-time">{label}</div>
                        <Editable
                          className="rl-text"
                          value={b.text || ""}
                          editable={editable}
                          placeholder={label}
                          ariaLabel={label + " text"}
                          focusKey={b.id}
                          onCommit={(v) => patchTop(b.id, { text: v })}
                          onIndent={(t) => indentTopBlock(b.id, t)}
                        />
                      </div>
                      {handles(b.id)}
                    </div>
                  </div>
                </li>
              );
            }

            // ---- STEP (collapsible parent) ----
            stepNo += 1;
            const kids = b.children || [];
            const collapsedNow = isCollapsed(b);
            const closingNow = Boolean(closing[b.id]);
            const summary = RUN_CHILD_TYPES.map((t) => ({
              type: t,
              n: kids.filter((k) => k.type === t).length,
            })).filter((s) => s.n > 0);
            const stateClass =
              (collapsedNow ? " is-collapsed" : "") +
              itemStateClass({ kind: "top", id: b.id }) +
              (closingNow ? " is-closing" : "") +
              (kids.length > 0 ? " has-children" : "");

            const attachBtn = (
              <button
                type="button"
                className="rl-iconbtn"
                onClick={() => {
                  setOpenKid(openKid === b.id ? null : b.id);
                  if (collapsedNow) openStep(b.id);
                }}
                aria-label="Attach detail"
              >
                <CampIcon.Plus />
              </button>
            );

            const hasKids = kids.length > 0;

            return (
              <Fragment key={b.id}>
                <li
                  {...dragBind({ kind: "top", id: b.id })}
                  {...dropBind({ kind: "top", id: b.id })}
                  className={"rl-block rl-block--step" + stateClass}
                >
                  {hasKids ? (
                    <button
                      type="button"
                      ref={railNodeRef(topRailKey(b.id))}
                      className="rl-node rl-node--step"
                      onClick={() => toggleStep(b)}
                      aria-label={collapsedNow ? "Expand step" : "Collapse step"}
                      aria-expanded={!collapsedNow && !closingNow}
                      contentEditable={false}
                    >
                      <span className="rl-node__num">{stepNo}</span>
                    </button>
                  ) : (
                    <span
                      ref={railNodeRef(topRailKey(b.id))}
                      className="rl-node rl-node--step rl-node--plain"
                      contentEditable={false}
                    >
                      <span className="rl-node__num">{stepNo}</span>
                    </span>
                  )}
                  <div className="rl-block__main">
                    <div className="rl-row">
                      <div className="rl-body">
                        {b.time && b.time.trim() ? (
                          <Editable
                            className="rl-time"
                            tag="span"
                            value={b.time}
                            editable={editable}
                            placeholder="time / cue"
                            ariaLabel={"Step " + stepNo + " time or cue"}
                            onCommit={(v) => patchTop(b.id, { time: v })}
                          />
                        ) : null}
                        <Editable
                          className="rl-text"
                          value={b.text || ""}
                          editable={editable}
                          placeholder="Describe this step…"
                          ariaLabel={"Step " + stepNo + " instructions"}
                          focusKey={b.id}
                          onCommit={(v) => patchTop(b.id, { text: v })}
                          onEnter={(before, after) => splitStep(b.id, before, after)}
                          onBackspaceEmpty={() => removeEmptyStep(b.id)}
                        />
                        {collapsedNow && summary.length > 0 && (
                          <div className="rl-summary" contentEditable={false}>
                            {summary.map((s) => (
                              <Pill key={s.type} type={s.type} n={s.n} />
                            ))}
                          </div>
                        )}
                      </div>
                      {handles(b.id, attachBtn)}
                    </div>
                  </div>
                </li>

                {(!collapsedNow || closingNow) &&
                  kids.map((k) => renderChild(b.id, k, closingNow))}

                {editable && !collapsedNow && !closingNow && openKid === b.id && (
                  <li key={b.id + "-add"} className="rl-block rl-block--detail rl-block--add">
                    <span className="rl-node rl-node--spacer" aria-hidden="true" />
                    <div className="rl-block__main">
                      <div
                        className="rl-palette rl-palette--flat"
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            e.preventDefault();
                            e.stopPropagation();
                            setOpenKid(null);
                          }
                        }}
                      >
                        {ATTACH_BLOCKS.map((t, i) => {
                          const Icon = TYPE_ICON[t];
                          return (
                            <button
                              type="button"
                              key={t}
                              className="rl-ptype"
                              autoFocus={i === 0}
                              onClick={() => addKid(b.id, t)}
                            >
                              <Icon />
                              {RUN_CHILD_META[t].label}
                            </button>
                          );
                        })}
                        <button
                          type="button"
                          className="rl-ptype rl-ptype--cancel"
                          onClick={() => setOpenKid(null)}
                        >
                          <CampIcon.Close />
                          Cancel
                        </button>
                      </div>
                    </div>
                  </li>
                )}
              </Fragment>
            );
              })()}
            </Fragment>
          ))}
        </ul>

        {/* An override cleared down to {blocks: []} is a supported empty state
            (see lib/runListResolve.ts) — say so in read mode rather than
            showing a bare, contentless rail. Edit mode already has its own
            affordance (the "Add a block" button just below). */}
        {!editable && doc.blocks.length === 0 && (
          <p className="rl-empty">This run sheet is empty.</p>
        )}

        {editable && (
          <div className="rl-addwrap">
            <div className="rl-addmain">
              {openTop ? (
                <div
                  className="rl-palette rl-palette--top"
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.preventDefault();
                      e.stopPropagation();
                      setOpenTop(false);
                    }
                  }}
                >
                  {addableBlocks.map(({ type, label, icon: Icon }, i) => (
                    <button
                      type="button"
                      key={type}
                      className="rl-ptype"
                      autoFocus={i === 0}
                      onClick={() => addTop(type)}
                    >
                      <Icon />
                      {label}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="rl-ptype rl-ptype--cancel"
                    onClick={() => setOpenTop(false)}
                  >
                    <CampIcon.Close />
                    Cancel
                  </button>
                </div>
              ) : (
                <button type="button" className="rl-addblock" onClick={() => setOpenTop(true)}>
                  <CampIcon.Plus />
                  Add a block
                </button>
              )}
            </div>
          </div>
        )}

      </div>

      {undoState && (
        <div className="rl-toast" role="status">
          <span>{undoState.message}</span>
          <button type="button" onClick={undoRemoval}>
            Undo
          </button>
        </div>
      )}
      {lightbox && <DiagramLightbox playbook={lightbox} onClose={() => setLightbox(null)} />}

      {fullDiagram &&
        (() => {
          const parent = doc.blocks.find((b) => b.id === fullDiagram.stepId);
          const child = parent?.children?.find((c) => c.id === fullDiagram.childId);
          if (!child || child.type !== "diagram" || !child.diagram) return null;
          return (
            <DiagramEditModal
              playbook={child.diagram}
              onChange={(next) => patchKid(fullDiagram.stepId, fullDiagram.childId, { diagram: next })}
              onClose={() => setFullDiagram(null)}
            />
          );
        })()}

      {blockMenu && (() => {
        const item = blockMenu.item;
        if (item.kind === "top") {
          const idx = doc.blocks.findIndex((b) => b.id === item.id);
          return (
            <ContextMenu
              point={blockMenu.point}
              ariaLabel="Block actions"
              onClose={() => setBlockMenu(null)}
              items={[
                {
                  label: "Move up",
                  icon: <CampIcon.ChevronUp />,
                  disabled: idx <= 0,
                  onSelect: () => moveTopBy(item.id, -1),
                },
                {
                  label: "Move down",
                  icon: <CampIcon.ChevronDown />,
                  disabled: idx < 0 || idx >= doc.blocks.length - 1,
                  onSelect: () => moveTopBy(item.id, 1),
                },
                { label: "Duplicate", icon: <CampIcon.Copy />, onSelect: () => dupTop(item.id) },
                {
                  label: "Remove",
                  icon: <CampIcon.Trash />,
                  danger: true,
                  separatorBefore: true,
                  onSelect: () => rmTop(item.id),
                },
              ]}
            />
          );
        }
        const parent = doc.blocks.find((b) => b.id === item.parentId);
        const kids = parent?.children || [];
        const kidIdx = kids.findIndex((c) => c.id === item.id);
        return (
          <ContextMenu
            point={blockMenu.point}
            ariaLabel="Detail actions"
            onClose={() => setBlockMenu(null)}
            items={[
              {
                label: "Move up",
                icon: <CampIcon.ChevronUp />,
                disabled: kidIdx <= 0,
                onSelect: () => moveChildBy(item.parentId, item.id, -1),
              },
              {
                label: "Move down",
                icon: <CampIcon.ChevronDown />,
                disabled: kidIdx < 0 || kidIdx >= kids.length - 1,
                onSelect: () => moveChildBy(item.parentId, item.id, 1),
              },
              { label: "Duplicate", icon: <CampIcon.Copy />, onSelect: () => dupKid(item.parentId, item.id) },
              {
                label: "Remove",
                icon: <CampIcon.Trash />,
                danger: true,
                separatorBefore: true,
                onSelect: () => rmKid(item.parentId, item.id),
              },
            ]}
          />
        );
      })()}

      {runStyle && (() => {
        const item = runStyle.item;
        let cur: { icon?: RunIcon; color?: RunColor; type: RunBlockType | RunChildType } | null = null;
        if (item.kind === "top") {
          const b = doc.blocks.find((x) => x.id === item.id);
          if (b) cur = { icon: b.icon, color: b.color, type: b.type };
        } else {
          const p = doc.blocks.find((x) => x.id === item.parentId);
          const c = p?.children?.find((k) => k.id === item.id);
          if (c) cur = { icon: c.icon, color: c.color, type: c.type };
        }
        if (!cur) return null;
        const curIcon = cur.icon ?? defaultRunIcon(cur.type);
        return (
          <FloatingLayer
            anchor={{ kind: "rect", rect: runStyle.rect }}
            onClose={() => setRunStyle(null)}
            className="rl-stylepop"
            role="dialog"
            ariaLabel="Icon and colour"
          >
            <div className="rl-stylepop__label">Colour</div>
            <div className="rl-stylepop__swatches" role="group" aria-label="Colour">
              {RUN_COLORS.map((c, i) => (
                <button
                  type="button"
                  key={c}
                  className={"rl-swatch" + ((cur!.color ?? "none") === c ? " is-on" : "")}
                  style={{ background: RUN_COLOR_TOKEN[c] } as CSSProperties}
                  data-floating-first={i === 0 ? "" : undefined}
                  aria-label={c}
                  aria-pressed={(cur!.color ?? "none") === c}
                  onClick={() => applyRunStyle({ color: c })}
                />
              ))}
            </div>
            <div className="rl-stylepop__label">Icon</div>
            <div className="rl-stylepop__icons" role="group" aria-label="Icon">
              {RUN_ICONS.map((ic) => {
                const Glyph = RUN_ICON_CMP[ic];
                return (
                  <button
                    type="button"
                    key={ic}
                    className={"rl-iconpick" + (curIcon === ic ? " is-on" : "")}
                    aria-label={RUN_ICON_LABEL[ic]}
                    aria-pressed={curIcon === ic}
                    title={RUN_ICON_LABEL[ic]}
                    onClick={() => applyRunStyle({ icon: ic })}
                  >
                    <Glyph />
                  </button>
                );
              })}
            </div>
          </FloatingLayer>
        );
      })()}
    </div>
  );
}
