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
  type DragEvent,
  type FC,
  type ReactNode,
} from "react";
import type { Activity } from "@/lib/types";
import { materialNeedsForActivity, type MaterialNeed } from "@/lib/materials";
import { CampIcon } from "./icons";
import { RatingDots, Seg } from "./primitives";
import { ActivityPlaybook } from "./ActivityPlaybook";
import { PlaybookEditor } from "./PlaybookEditor";
import {
  RUN_CHILD_META,
  RUN_CHILD_TYPES,
  RUN_TOP_LABEL,
  blankDiagramChild,
  cloneRunDoc,
  detailTagsForActivity,
  runId,
  runPillLabel,
  type RunBlock,
  type RunBlockType,
  type RunChild,
  type RunChildType,
  type RunDoc,
} from "@/lib/runList";

const DETAIL_ANIM_MS = 170;

type IconCmp = FC<{ className?: string }>;

const TYPE_ICON: Record<string, IconCmp> = {
  note: CampIcon.Note,
  safety: CampIcon.Shield,
  video: CampIcon.Video,
  variation: CampIcon.Variation,
  substep: CampIcon.SubStep,
  diagram: CampIcon.Deck,
  materials: CampIcon.Card,
  heading: CampIcon.Heading,
  playbook: CampIcon.BookOpen,
};

// Blocks you can append from the "Add a block" palette (top level).
const ADD_BLOCKS: { type: RunBlockType; label: string; icon: IconCmp }[] = [
  { type: "details", label: "Specific details", icon: CampIcon.Card },
  { type: "materials", label: "Materials", icon: CampIcon.Card },
  { type: "step", label: "Step", icon: CampIcon.SubStep },
  { type: "heading", label: "Section", icon: CampIcon.Heading },
  { type: "note", label: "Note", icon: CampIcon.Note },
  { type: "safety", label: "Safety", icon: CampIcon.Shield },
  { type: "variation", label: "Variation", icon: CampIcon.Variation },
];
const ATTACH_BLOCKS = RUN_CHILD_TYPES.filter((type) => type !== "materials");

type DragItem =
  | { kind: "top"; id: string }
  | { kind: "child"; parentId: string; id: string };

type DropTarget = {
  item: DragItem;
  position: "before" | "after";
};

type DropDestination =
  | { scope: "top"; targetId: string; position: "before" | "after" }
  | { scope: "children"; parentId: string; targetChildId: string | null; position: "before" | "after" };

type RailSegment = {
  id: string;
  x: number;
  y1: number;
  y2: number;
};

const topRailKey = (id: string) => "top:" + id;
const childRailKey = (parentId: string, id: string) => "child:" + parentId + ":" + id;

function sameDragItem(a: DragItem | null, b: DragItem): boolean {
  if (!a || a.kind !== b.kind || a.id !== b.id) return false;
  return a.kind === "top" || b.kind === "top" || a.parentId === b.parentId;
}

function childFromTop(block: RunBlock): RunChild | null {
  if (block.type === "note" || block.type === "safety" || block.type === "variation") {
    return { id: block.id, type: block.type, text: block.text || "" };
  }
  if (block.type === "materials") return { id: block.id, type: "materials" };
  return null;
}

function topFromChild(child: RunChild): RunBlock | null {
  if (child.type === "note" || child.type === "safety" || child.type === "variation") {
    return { id: child.id, type: child.type, text: child.text || "", children: [] };
  }
  if (child.type === "substep") {
    return { id: child.id, type: "step", text: child.text || "", collapsed: false, children: [] };
  }
  if (child.type === "materials") return { id: child.id, type: "materials", children: [] };
  return null;
}

function isChildCapable(item: DragItem, blocks: RunBlock[]): boolean {
  if (item.kind === "child") return true;
  const block = blocks.find((b) => b.id === item.id);
  return Boolean(block && childFromTop(block));
}

function isTopCapable(item: DragItem, blocks: RunBlock[]): boolean {
  if (item.kind === "top") return true;
  const parent = blocks.find((b) => b.id === item.parentId);
  const child = parent?.children?.find((k) => k.id === item.id);
  return Boolean(child && topFromChild(child));
}

function dropPosition(e: DragEvent<HTMLElement>): "before" | "after" {
  const rect = e.currentTarget.getBoundingClientRect();
  return e.clientY < rect.top + rect.height / 2 ? "before" : "after";
}

// ----------------------------------------------------------------------------
// Inline contentEditable cell. Commits on blur; only rewrites the DOM when the
// value changes from the outside (never mid-keystroke).
// ----------------------------------------------------------------------------
function Editable({
  value,
  onCommit,
  placeholder,
  editable,
  tag = "div",
  className = "",
  ariaLabel,
  ariaLabelledBy,
}: {
  value: string;
  onCommit: (next: string) => void;
  placeholder?: string;
  editable: boolean;
  tag?: "div" | "span";
  className?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
}) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (ref.current && ref.current.textContent !== value) ref.current.textContent = value || "";
  }, [value]);
  const Tag = tag as "div";
  const label = ariaLabel || placeholder;
  return (
    <Tag
      ref={ref as React.RefObject<HTMLDivElement>}
      className={"rl-ed " + className}
      contentEditable={editable}
      suppressContentEditableWarning
      data-ph={placeholder || ""}
      role={editable ? "textbox" : undefined}
      aria-label={editable && label ? label : undefined}
      aria-labelledby={editable && !label ? ariaLabelledBy : undefined}
      aria-placeholder={editable && placeholder ? placeholder : undefined}
      onBlur={editable ? (e) => onCommit(e.currentTarget.textContent || "") : undefined}
    />
  );
}

function Pill({ type, n }: { type: RunChildType; n: number }) {
  const Icon = TYPE_ICON[type];
  return (
    <span className={"rl-pill rl-pill--" + type}>
      <Icon />
      {runPillLabel(type, n)}
    </span>
  );
}

type KitSort = "Have" | "Need";

// The activity's materials as a working checklist (the same Have/Need "kit" the
// library filter reads). Attaches under a step as a materials detail.
function MaterialChecklist({
  needs,
  availableMaterials,
  onToggleMaterial,
}: {
  needs: MaterialNeed[];
  availableMaterials: string[];
  onToggleMaterial: (id: string) => void;
}) {
  const [lead, setLead] = useState<KitSort>("Have");
  const haveSet = new Set(availableMaterials);
  const have = needs.filter((n) => haveSet.has(n.id));
  const need = needs.filter((n) => !haveSet.has(n.id));
  const ordered = lead === "Have" ? [...have, ...need] : [...need, ...have];
  const leadCount = lead === "Have" ? have.length : need.length;
  const showControls = needs.length >= 2;

  return (
    <div className="matkit">
      {showControls && (
        <div className="matkit__bar">
          <span className="matkit__status">
            Have {have.length} · Need {need.length}
          </span>
          <Seg
            options={["Have", "Need"] as const}
            value={lead}
            onChange={setLead}
            ariaLabel="Sort materials by what you have or still need"
          />
        </div>
      )}
      <div className="matkit__list">
        {ordered.map((n, i) => {
          const has = haveSet.has(n.id);
          const divide = showControls && i === leadCount && i > 0 && i < ordered.length;
          return (
            <Fragment key={n.id}>
              {divide && <span className="matkit__div" role="separator" aria-hidden="true" />}
              <button
                type="button"
                className={"matkit__item" + (has ? " is-have" : "")}
                onClick={() => onToggleMaterial(n.id)}
                aria-pressed={has}
                aria-label={(has ? "Have" : "Still need") + ": " + n.label}
              >
                <span className="matkit__check" aria-hidden="true">
                  {has && <CampIcon.Check />}
                </span>
                <span className="matkit__name">{n.label}</span>
              </button>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

export function ActivityRunList({
  doc,
  editable,
  onChange,
  activity,
  availableMaterials,
  onToggleMaterial,
  onSetRating,
  detailsEditor,
  materialsEditor,
}: {
  doc: RunDoc;
  editable: boolean;
  onChange?: (next: RunDoc) => void;
  activity: Activity;
  availableMaterials: string[];
  onToggleMaterial: (id: string) => void;
  onSetRating?: (value: number) => void;
  detailsEditor?: ReactNode;
  materialsEditor?: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [closing, setClosing] = useState<Record<string, boolean>>({});
  const [openKid, setOpenKid] = useState<string | null>(null);
  const [openTop, setOpenTop] = useState(false);
  const [diagramEditing, setDiagramEditing] = useState<string | null>(null);
  const [dragItem, setDragItem] = useState<DragItem | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [railSegments, setRailSegments] = useState<RailSegment[]>([]);

  const dragRef = useRef<DragItem | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const railNodes = useRef<Map<string, HTMLElement>>(new Map());
  const closeTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const diagramRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const timers = closeTimers.current;
    return () => Object.values(timers).forEach((t) => clearTimeout(t));
  }, []);

  // A diagram edits in place like text: click the field to start, click anywhere
  // outside it to finish. No edit/done buttons.
  useEffect(() => {
    if (!diagramEditing) return;
    const onDown = (e: MouseEvent) => {
      if (diagramRef.current && !diagramRef.current.contains(e.target as Node)) {
        setDiagramEditing(null);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [diagramEditing]);

  const materialNeeds = useMemo(() => materialNeedsForActivity(activity), [activity]);
  const detailTags = useMemo(() => detailTagsForActivity(activity), [activity]);

  const commit = (next: RunDoc) => onChange?.(next);

  // ---- block + child edits (controlled: derive next doc, push up) -----------
  const patchTop = (id: string, patch: Partial<RunBlock>) =>
    commit({ blocks: doc.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)) });

  const patchKid = (pid: string, kid: string, patch: Partial<RunChild>) =>
    commit({
      blocks: doc.blocks.map((b) =>
        b.id === pid
          ? { ...b, children: (b.children || []).map((c) => (c.id === kid ? { ...c, ...patch } : c)) }
          : b
      ),
    });

  const rmTop = (id: string) => commit({ blocks: doc.blocks.filter((b) => b.id !== id) });

  // Reorder a top-level block by one slot. Touch/keyboard-friendly counterpart to
  // the HTML5 drag handles (which never fire on touch devices).
  const moveTopBy = (id: string, dir: -1 | 1) => {
    const idx = doc.blocks.findIndex((b) => b.id === id);
    const swap = idx + dir;
    if (idx < 0 || swap < 0 || swap >= doc.blocks.length) return;
    const blocks = [...doc.blocks];
    [blocks[idx], blocks[swap]] = [blocks[swap], blocks[idx]];
    commit({ blocks });
  };

  const rmKid = (pid: string, kid: string) => {
    if (diagramEditing === kid) setDiagramEditing(null);
    commit({
      blocks: doc.blocks.map((b) =>
        b.id === pid ? { ...b, children: (b.children || []).filter((c) => c.id !== kid) } : b
      ),
    });
  };

  const addKid = (pid: string, type: RunChildType) => {
    let kid: RunChild;
    if (type === "video") kid = { id: runId("k"), type, title: "Untitled clip", url: "" };
    else if (type === "diagram") kid = blankDiagramChild(activity.id, activity.title);
    else if (type === "materials") kid = { id: runId("k"), type };
    else kid = { id: runId("k"), type, text: "" };
    commit({
      blocks: doc.blocks.map((b) =>
        b.id === pid ? { ...b, children: [...(b.children || []), kid] } : b
      ),
    });
    openStep(pid);
    setOpenKid(null);
    if (type === "diagram") setDiagramEditing(kid.id);
  };

  const addTop = (type: RunBlockType) => {
    let blk: RunBlock;
    if (type === "step") blk = { id: runId("b"), type, text: "", collapsed: false, children: [] };
    else if (type === "heading") blk = { id: runId("b"), type, text: "New section", children: [] };
    else if (type === "materials") blk = { id: runId("b"), type, children: [] };
    else if (type === "details") blk = { id: runId("b"), type, children: [] };
    else blk = { id: runId("b"), type, text: "", children: [] };
    commit({ blocks: [...doc.blocks, blk] });
    setOpenTop(false);
  };

  const resolveDrop = (source: DragItem, target: DropTarget): DropDestination | null => {
    if (sameDragItem(source, target.item)) return null;

    if (target.item.kind === "child") {
      if (!isChildCapable(source, doc.blocks)) return null;
      return {
        scope: "children",
        parentId: target.item.parentId,
        targetChildId: target.item.id,
        position: target.position,
      };
    }

    const targetBlock = doc.blocks.find((b) => b.id === target.item.id);
    if (!targetBlock) return null;

    if (
      target.position === "after" &&
      targetBlock.type === "step" &&
      !isCollapsed(targetBlock) &&
      !closing[targetBlock.id] &&
      isChildCapable(source, doc.blocks)
    ) {
      return { scope: "children", parentId: targetBlock.id, targetChildId: null, position: "before" };
    }

    if (!isTopCapable(source, doc.blocks)) return null;
    return { scope: "top", targetId: targetBlock.id, position: target.position };
  };

  const moveTo = (target: DropTarget) => {
    const source = dragRef.current;
    const destination = source ? resolveDrop(source, target) : null;
    if (!source || !destination) {
      finishDrag();
      return;
    }

    let movingTop: RunBlock | null = null;
    let movingChild: RunChild | null = null;
    let blocks: RunBlock[] = doc.blocks.map((b) => ({ ...b, children: [...(b.children || [])] }));

    if (source.kind === "top") {
      const sourceIndex = blocks.findIndex((b) => b.id === source.id);
      if (sourceIndex < 0) {
        finishDrag();
        return;
      }
      [movingTop] = blocks.splice(sourceIndex, 1);
    } else {
      blocks = blocks.map((b) => {
        if (b.id !== source.parentId) return b;
        const childIndex = (b.children || []).findIndex((k) => k.id === source.id);
        if (childIndex < 0) return b;
        const nextChildren = [...(b.children || [])];
        [movingChild] = nextChildren.splice(childIndex, 1);
        return { ...b, children: nextChildren };
      });
      if (!movingChild) {
        finishDrag();
        return;
      }
    }

    if (destination.scope === "top") {
      const block = movingTop || (movingChild ? topFromChild(movingChild) : null);
      const targetIndex = blocks.findIndex((b) => b.id === destination.targetId);
      if (!block || targetIndex < 0) {
        finishDrag();
        return;
      }
      blocks.splice(destination.position === "before" ? targetIndex : targetIndex + 1, 0, block);
    } else {
      const child = movingChild || (movingTop ? childFromTop(movingTop) : null);
      if (!child) {
        finishDrag();
        return;
      }
      let inserted = false;
      blocks = blocks.map((b) => {
        if (b.id !== destination.parentId) return b;
        const children = [...(b.children || [])];
        const targetIndex =
          destination.targetChildId == null ? -1 : children.findIndex((k) => k.id === destination.targetChildId);
        const insertAt =
          destination.targetChildId == null
            ? 0
            : destination.position === "before"
              ? targetIndex
              : targetIndex + 1;
        if (insertAt < 0) return b;
        children.splice(insertAt, 0, child);
        inserted = true;
        return { ...b, children };
      });
      if (!inserted) {
        finishDrag();
        return;
      }
      openStep(destination.parentId);
    }

    commit({ blocks });
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
  const isCollapsed = (b: RunBlock) => b.type === "step" && (collapsed[b.id] ?? Boolean(b.collapsed));

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
      if (target.closest("button, input, textarea, select, a, .matkit, .pbe")) {
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
  });

  const dropBind = (item: DragItem) => ({
    onDragOver: (e: DragEvent<HTMLElement>) => {
      const source = dragRef.current;
      if (!editable || source == null) return;
      const target = { item, position: dropPosition(e) };
      if (!resolveDrop(source, target)) return;
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
    if (icon === "type") return <CampIcon.Card />;
    return null;
  };

  // ---- a single attached detail row (a sibling on the same rail) ------------
  const renderChild = (stepId: string, k: RunChild, closingNow: boolean): ReactNode => {
    const Icon = TYPE_ICON[k.type];
    const label = RUN_CHILD_META[k.type].label;
    const removeBtn = editable ? (
      <div className="rl-rowtools">
        <button type="button" className="rl-iconbtn" onClick={() => rmKid(stepId, k.id)} aria-label="Remove detail">
          <CampIcon.Trash />
        </button>
      </div>
    ) : null;
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
        <span
          ref={railNodeRef(childRailKey(stepId, k.id))}
          className={"rl-node rl-node--type rl-node--" + k.type}
          contentEditable={false}
        >
          <Icon />
        </span>
        <div className="rl-block__main">
          <div className={"rl-row rl-row--detail rl-row--" + k.type}>
            <div className="rl-body">
              <div className="rl-time">{label}</div>
              {body}
            </div>
            {removeBtn}
          </div>
        </div>
      </li>
    );

    if (k.type === "diagram") {
      if (!k.diagram) return shell(null);
      // Edits in place like text: tap the field to edit, click away to finish.
      if (editable && diagramEditing === k.id) {
        return shell(
          <div className="rl-diagram rl-diagram--editing" ref={diagramRef}>
            <PlaybookEditor value={k.diagram} onChange={(next) => patchKid(stepId, k.id, { diagram: next })} />
          </div>
        );
      }
      return shell(
        editable ? (
          <button
            type="button"
            className="rl-diagram rl-diagram--open"
            onClick={() => setDiagramEditing(k.id)}
            aria-label="Edit field diagram"
          >
            <ActivityPlaybook playbook={k.diagram} compact />
          </button>
        ) : (
          <div className="rl-diagram">
            <ActivityPlaybook playbook={k.diagram} compact />
          </div>
        )
      );
    }

    if (k.type === "materials") {
      return shell(
        materialNeeds.length === 0 ? (
          <span className="stamp">None needed</span>
        ) : (
          <MaterialChecklist
            needs={materialNeeds}
            availableMaterials={availableMaterials}
            onToggleMaterial={onToggleMaterial}
          />
        )
      );
    }

    if (k.type === "video") {
      return shell(
        <div className="rl-vid">
          <span className="rl-vid__thumb" contentEditable={false}>
            <span className="rl-vid__tag">Video</span>
          </span>
          <div className="rl-vid__fields">
            <Editable
              className="rl-text"
              value={k.title || ""}
              editable={editable}
              placeholder="Caption"
              ariaLabel="Video detail caption"
              onCommit={(v) => patchKid(stepId, k.id, { title: v })}
            />
            <Editable
              className="rl-vid__url"
              tag="span"
              value={k.url || ""}
              editable={editable}
              placeholder="youtu.be/…"
              ariaLabel="Video detail URL"
              onCommit={(v) => patchKid(stepId, k.id, { url: v })}
            />
          </div>
        </div>
      );
    }

    return shell(
      <Editable
        className="rl-text"
        value={k.text || ""}
        editable={editable}
        placeholder={RUN_CHILD_META[k.type].placeholder}
        ariaLabel={label + " detail text"}
        onCommit={(v) => patchKid(stepId, k.id, { text: v })}
      />
    );
  };

  let stepNo = 0;

  return (
    <div className={"rl" + (editable ? "" : " is-readonly")}>
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
          {doc.blocks.map((b) => {
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
                        {detailsEditor ? (
                          <div className="rl-detailform">{detailsEditor}</div>
                        ) : (
                          <>
                            <div className="rl-detailtags">
                              {detailTags.filter((tag) => tag.id !== "rating" || !onSetRating).map((tag) => (
                                <span className="rl-detailtag" key={tag.id}>
                                  {detailIcon(tag.icon)}
                                  {tag.label}
                                </span>
                              ))}
                            </div>
                            {onSetRating && (
                              <div className="rl-detailrating">
                                <RatingDots value={activity.rating || 0} onChange={onSetRating} />
                              </div>
                            )}
                          </>
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
                        {materialsEditor ? (
                          <div className="rl-materialform">{materialsEditor}</div>
                        ) : (
                          materialNeeds.length === 0 ? (
                            <span className="stamp">None needed</span>
                          ) : (
                            <MaterialChecklist
                              needs={materialNeeds}
                              availableMaterials={availableMaterials}
                              onToggleMaterial={onToggleMaterial}
                            />
                          )
                        )}
                      </div>
                      {handles(b.id)}
                    </div>
                  </div>
                </li>
              );
            }

            // ---- TOP-LEVEL NOTE / SAFETY / VARIATION ----
            if (b.type !== "step") {
              const Icon = TYPE_ICON[b.type] || CampIcon.Note;
              const label = RUN_TOP_LABEL[b.type as "note" | "safety" | "variation"] || "Note";
              return (
                <li
                  key={b.id}
                  {...dragBind({ kind: "top", id: b.id })}
                  {...dropBind({ kind: "top", id: b.id })}
                  className={"rl-block rl-block--" + b.type + itemStateClass({ kind: "top", id: b.id })}
                >
                  <span
                    ref={railNodeRef(topRailKey(b.id))}
                    className={"rl-node rl-node--type rl-node--" + b.type}
                    contentEditable={false}
                  >
                    <Icon />
                  </span>
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
                          onCommit={(v) => patchTop(b.id, { text: v })}
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
                          onCommit={(v) => patchTop(b.id, { text: v })}
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
                    <div className="rl-block__main">
                      <div className="rl-palette rl-palette--flat">
                        {ATTACH_BLOCKS.map((t) => {
                          const Icon = TYPE_ICON[t];
                          return (
                            <button type="button" key={t} className="rl-ptype" onClick={() => addKid(b.id, t)}>
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
          })}
        </ul>

        {editable && (
          <div className="rl-addwrap">
            <div className="rl-addmain">
              {openTop ? (
                <div className="rl-palette rl-palette--top">
                  {ADD_BLOCKS.map(({ type, label, icon: Icon }) => (
                    <button type="button" key={type} className="rl-ptype" onClick={() => addTop(type)}>
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
    </div>
  );
}

export { cloneRunDoc };
