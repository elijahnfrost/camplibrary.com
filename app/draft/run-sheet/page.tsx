"use client";

// ─────────────────────────────────────────────────────────────────────────────
// DRAFT — the modular run sheet, pared to TWO core blocks (open at /draft/run-sheet)
//
//   · Number block — an auto-numbered step.
//   · Text block   — a line of copy; give it meaning by picking an icon + colour
//                    (this is what used to be note / tip / safety).
//   (+ small utility blocks: Materials checklist, Media link, Divider.)
//
// Every node rides ONE aligned rail on the left. Any block can be a sub-block —
// press Tab to nest, Shift-Tab to lift it back — regardless of kind; a sub-block
// just reads lighter on the same rail (no indentation). Drag the ⠿ to reorder.
// ─────────────────────────────────────────────────────────────────────────────

import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./draft.module.css";
import {
  COLORS,
  COLOR_IDS,
  EXAMPLES,
  ICON_IDS,
  ICON_LABEL,
  INSERT_KINDS,
  KIND_LABEL,
  blankBlock,
  cloneSheet,
  draftId,
  type BlockColor,
  type BlockIcon,
  type BlockKind,
  type DraftBlock,
  type DraftSheet,
} from "./seed";
import {
  duplicateBlock,
  insertBlock,
  moveBlock,
  moveSection,
  normalizeSheet,
  patchBlock,
  removeBlockById,
  setDepth,
  type BlockDrop,
  type DropPos,
} from "./dnd";

// ── icons (local to the draft) ───────────────────────────────────────────────
const UI = {
  grip: <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="6" cy="4" r="1.3" /><circle cx="10" cy="4" r="1.3" /><circle cx="6" cy="8" r="1.3" /><circle cx="10" cy="8" r="1.3" /><circle cx="6" cy="12" r="1.3" /><circle cx="10" cy="12" r="1.3" /></svg>,
  plus: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" /></svg>,
  trash: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 4.5h10M6 4.5V3h4v1.5M5 4.5l.6 8h4.8l.6-8" /></svg>,
  copy: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true"><rect x="5.5" y="5.5" width="7" height="7" rx="1.5" /><path d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" /></svg>,
  indent: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 4h10M7 8h6M7 12h6M3 8l2 2-2 2" /></svg>,
  outdent: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 4h10M7 8h6M7 12h6M5 8l-2 2 2 2" /></svg>,
  swatch: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="5" /></svg>,
  link: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6.5 9.5l3-3M7 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 0 1 4.5 9l1-1" /></svg>,
  kit: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6.5h10v6H3zM5.5 6.5V4h5v2.5" /></svg>,
  rule: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M3 8h10" /></svg>,
  num: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 4.5L4.5 5.5M6 4.5v7M4.5 11.5h3M10 5.5h2v6M9.5 11.5h3" /></svg>,
  text: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 4h8M4 8h8M4 12h5" /></svg>,
};
// the glyphs a text block can wear
const ICONS: Record<BlockIcon, ReactNode> = {
  none: <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="8" cy="8" r="3" /></svg>,
  note: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 3h8v10l-2-1.5L8 13l-2-1.5L4 13z" /></svg>,
  tip: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2.5a4 4 0 0 0-2.5 7.1V11h5V9.6A4 4 0 0 0 8 2.5zM6.5 13h3" /></svg>,
  safety: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2.5l4.5 1.5v3.5c0 3-2 4.8-4.5 5.5C5.5 12.3 3.5 10.5 3.5 7.5V4z" /></svg>,
  info: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8" r="5.5" /><path d="M8 7.5v3M8 5.4v.1" /></svg>,
  star: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2.5l1.7 3.5 3.8.5-2.8 2.7.7 3.8L8 11.7 4.6 13.3l.7-3.8L2.5 6.5l3.8-.5z" /></svg>,
  flag: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 14V3M4 3.5h7l-1.5 2.5L11 8.5H4" /></svg>,
};
const KIND_ICON: Record<BlockKind, ReactNode> = {
  number: UI.num,
  text: UI.text,
  materials: UI.kit,
  media: UI.link,
  divider: UI.rule,
};

// build the inline custom property a node reads for its colour
const blk = (token: string) => ({ ["--blk"]: token } as React.CSSProperties);

type MenuState =
  | { mode: "insert"; rect: DOMRect; where: { afterId: string } | { sectionId: string } }
  | { mode: "actions" | "turn" | "style"; rect: DOMRect; blockId: string };

type Over =
  | { type: "block"; id: string; pos: DropPos }
  | { type: "sechead"; id: string; pos: DropPos }
  | { type: "secstart"; sectionId: string }
  | { type: "empty"; sectionId: string }
  | null;

export default function DraftRunSheetPage() {
  const [idx, setIdx] = useState(0);
  const [sheets, setSheets] = useState<DraftSheet[]>(() => EXAMPLES.map(cloneSheet));
  const [editable, setEditable] = useState(true);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [over, setOver] = useState<Over>(null);
  const dragRef = useRef<{ kind: "block" | "section"; id: string } | null>(null);
  const [, force] = useState(0);

  const sheet = sheets[idx];
  const setSheet = (next: DraftSheet) => setSheets((prev) => prev.map((s, i) => (i === idx ? next : s)));
  const resetExample = () => setSheets((prev) => prev.map((s, i) => (i === idx ? cloneSheet(EXAMPLES[idx]) : s)));
  const blockAt = (id: string): DraftBlock | undefined =>
    sheet.sections.flatMap((s) => s.blocks).find((b) => b.id === id);

  const clearDrag = () => {
    dragRef.current = null;
    setOver(null);
    force((n) => n + 1);
  };

  // ── block drag/drop (pure reorder + cross-section; nesting is Tab, not drag) ──
  const onBlockDragStart = (e: DragEvent, id: string) => {
    dragRef.current = { kind: "block", id };
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", id); } catch { /* some browsers gate setData */ }
    const row = (e.currentTarget as HTMLElement).closest("[data-block]");
    if (row) e.dataTransfer.setDragImage(row as Element, 24, 16);
    force((n) => n + 1);
  };
  const onBlockDragOver = (e: DragEvent, id: string) => {
    const d = dragRef.current;
    if (!editable || d?.kind !== "block") return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const pos: DropPos = e.clientY < rect.top + rect.height / 2 ? "before" : "after";
    if (over?.type !== "block" || over.id !== id || over.pos !== pos) setOver({ type: "block", id, pos });
  };
  const onBlockDrop = (e: DragEvent, id: string) => {
    const d = dragRef.current;
    if (!editable || d?.kind !== "block") return;
    e.preventDefault();
    const pos = over?.type === "block" && over.id === id ? over.pos : "after";
    const drop: BlockDrop = { kind: "block", targetId: id, pos, nest: false };
    setSheet(moveBlock(sheet, d.id, drop));
    clearDrag();
  };

  // section header: reorder sections OR drop a block at the section start
  const onSecHeadDragOver = (e: DragEvent, sectionId: string) => {
    const d = dragRef.current;
    if (!editable || !d) return;
    e.preventDefault();
    if (d.kind === "section") {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const pos: DropPos = e.clientY < rect.top + rect.height / 2 ? "before" : "after";
      if (over?.type !== "sechead" || over.id !== sectionId || over.pos !== pos) setOver({ type: "sechead", id: sectionId, pos });
    } else if (over?.type !== "secstart" || over.sectionId !== sectionId) {
      setOver({ type: "secstart", sectionId });
    }
  };
  const onSecHeadDrop = (e: DragEvent, sectionId: string) => {
    const d = dragRef.current;
    if (!editable || !d) return;
    e.preventDefault();
    if (d.kind === "section") {
      const pos = over?.type === "sechead" && over.id === sectionId ? over.pos : "before";
      setSheet(moveSection(sheet, d.id, sectionId, pos));
    } else {
      setSheet(moveBlock(sheet, d.id, { kind: "section-start", sectionId }));
    }
    clearDrag();
  };
  const onEmptyDrop = (e: DragEvent, sectionId: string) => {
    const d = dragRef.current;
    if (!editable || d?.kind !== "block") return;
    e.preventDefault();
    setSheet(moveBlock(sheet, d.id, { kind: "section-empty", sectionId }));
    clearDrag();
  };

  // ── menu actions ──
  const runInsert = (kind: BlockKind) => {
    if (menu?.mode !== "insert") return;
    setSheet(insertBlock(sheet, blankBlock(kind), menu.where));
    setMenu(null);
  };
  const turnInto = (kind: BlockKind) => {
    if (menu?.mode !== "turn") return;
    const patch: Partial<DraftBlock> = { kind };
    if (kind === "text") { patch.icon = blockAt(menu.blockId)?.icon ?? "none"; patch.color = blockAt(menu.blockId)?.color ?? "none"; }
    if (kind === "materials" && !blockAt(menu.blockId)?.items) patch.items = [""];
    setSheet(patchBlock(sheet, menu.blockId, patch));
    setMenu(null);
  };

  // commit a contentEditable; pressing Tab on a block's body nests it (Shift-Tab lifts)
  const editProps = (commit: (v: string) => void, ariaLabel: string, blockId?: string) =>
    editable
      ? {
          contentEditable: true,
          suppressContentEditableWarning: true,
          spellCheck: false,
          role: "textbox" as const,
          "aria-label": ariaLabel,
          onBlur: (e: React.FocusEvent<HTMLElement>) => commit(e.currentTarget.textContent ?? ""),
          onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.currentTarget as HTMLElement).blur();
            } else if (e.key === "Tab" && blockId) {
              // commit the text AND change depth in one update so typing isn't lost
              e.preventDefault();
              const text = e.currentTarget.textContent ?? "";
              setSheet(normalizeSheet(patchBlock(sheet, blockId, { text, depth: e.shiftKey ? 0 : 1 })));
            }
          },
        }
      : {};

  let stepNo = 0;

  return (
    <div className={styles.lab}>
      <div className={styles.banner}>
        <span>◆ Draft prototype</span>
        <span>·</span>
        <span>The run sheet, pared to <b>Number + Text</b> blocks — for review, not shipped.</span>
      </div>

      <header className={styles.head}>
        <h1 className={styles.title}>Run sheet — block lab</h1>
        <p className={styles.subtitle}>
          Two core blocks: a <b>Number</b> step and a <b>Text</b> line you give an icon + colour. Every node rides one
          aligned rail; press <b>Tab</b> to make any block a lighter sub-block (Shift-Tab to lift it). Drag the ⠿ to reorder.
        </p>
        <div className={styles.controls}>
          <div className={styles.tabs} role="tablist" aria-label="Example activity">
            {sheets.map((s, i) => (
              <button
                key={s.id}
                role="tab"
                aria-selected={i === idx}
                className={i === idx ? `${styles.tab} ${styles.tabOn}` : styles.tab}
                onClick={() => { setIdx(i); setMenu(null); clearDrag(); }}
              >
                {s.name}
              </button>
            ))}
          </div>
          <button
            className={editable ? `${styles.toggle} ${styles.toggleOn}` : styles.toggle}
            onClick={() => setEditable((v) => !v)}
            aria-pressed={editable}
          >
            {editable ? "Edit mode" : "View mode"}
          </button>
          <span className={styles.spacer} />
          {editable && <button className={styles.reset} onClick={resetExample}>Reset example</button>}
        </div>
      </header>

      <div className={styles.sheet}>
        <div className={styles.crest}>
          <h2 className={styles.crestName}>{sheet.name}</h2>
          <p className={styles.crestMeta}>{sheet.meta}</p>
        </div>

        {sheet.sections.map((section) => {
          const collapsed = !!section.collapsed;
          const headOver =
            (over?.type === "sechead" && over.id === section.id) ||
            (over?.type === "secstart" && over.sectionId === section.id);
          return (
            <section key={section.id} className={styles.section}>
              <div
                className={headOver ? `${styles.secHead} ${styles.secHeadOver}` : styles.secHead}
                onDragOver={(e) => onSecHeadDragOver(e, section.id)}
                onDrop={(e) => onSecHeadDrop(e, section.id)}
              >
                <button
                  className={collapsed ? `${styles.secChevron} ${styles.secChevronCollapsed}` : styles.secChevron}
                  onClick={() => setSheet({ ...sheet, sections: sheet.sections.map((s) => s.id === section.id ? { ...s, collapsed: !s.collapsed } : s) })}
                  aria-label={collapsed ? "Expand section" : "Collapse section"}
                  aria-expanded={!collapsed}
                >
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg>
                </button>
                <span className={styles.secTitle} {...editProps((v) => setSheet({ ...sheet, sections: sheet.sections.map((s) => s.id === section.id ? { ...s, title: v } : s) }), "Section title")}>
                  {section.title}
                </span>
                <span className={styles.secCount}>{section.blocks.length}</span>
                {editable && (
                  <span className={styles.secTools}>
                    <button className={styles.gbtn} onClick={(e) => setMenu({ mode: "insert", rect: e.currentTarget.getBoundingClientRect(), where: { sectionId: section.id } })} aria-label="Add block to section">{UI.plus}</button>
                    <span className={`${styles.gbtn} ${styles.secGrip}`} draggable onDragStart={(e) => { dragRef.current = { kind: "section", id: section.id }; e.dataTransfer.effectAllowed = "move"; force((n) => n + 1); }} onDragEnd={clearDrag} title="Drag to reorder section" aria-hidden="true">{UI.grip}</span>
                    <button className={styles.gbtn} onClick={() => setSheet({ ...sheet, sections: sheet.sections.filter((s) => s.id !== section.id) })} aria-label="Delete section">{UI.trash}</button>
                  </span>
                )}
              </div>

              {!collapsed && (
                <div className={styles.blocks}>
                  {section.blocks.length === 0 && editable && (
                    <div
                      className={over?.type === "empty" && over.sectionId === section.id ? `${styles.empty} ${styles.emptyOver}` : styles.empty}
                      onDragOver={(e) => { if (dragRef.current?.kind === "block") { e.preventDefault(); setOver({ type: "empty", sectionId: section.id }); } }}
                      onDrop={(e) => onEmptyDrop(e, section.id)}
                      onClick={(e) => setMenu({ mode: "insert", rect: (e.currentTarget as HTMLElement).getBoundingClientRect(), where: { sectionId: section.id } })}
                    >
                      Empty section — drop a block here, or click to add one.
                    </div>
                  )}
                  {section.blocks.map((b) => {
                    const isNum = b.kind === "number" && (b.depth ?? 0) === 0;
                    if (isNum) stepNo += 1;
                    const subNum = b.kind === "number" && (b.depth ?? 0) === 1;
                    if (subNum) stepNo += 1;
                    const dragging = dragRef.current?.kind === "block" && dragRef.current.id === b.id;
                    const showOver = over?.type === "block" && over.id === b.id && !dragging;

                    if (b.kind === "divider") {
                      return (
                        <div key={b.id} data-block className={dragging ? `${styles.block} ${styles.dragging}` : styles.block} onDragOver={(e) => onBlockDragOver(e, b.id)} onDrop={(e) => onBlockDrop(e, b.id)}>
                          {editable && renderGutter(b.id)}
                          {showOver && dropLine(over)}
                          <div className={styles.divider} />
                        </div>
                      );
                    }

                    return (
                      <div
                        key={b.id}
                        data-block
                        className={[styles.block, b.depth ? styles.nested : "", dragging ? styles.dragging : ""].filter(Boolean).join(" ")}
                        onDragOver={(e) => onBlockDragOver(e, b.id)}
                        onDrop={(e) => onBlockDrop(e, b.id)}
                      >
                        {editable && renderGutter(b.id)}
                        {showOver && dropLine(over)}
                        {renderNode(b, b.kind === "number" ? stepNo : 0)}
                        <div className={styles.main}>
                          {renderMeta(b)}
                          {b.kind === "materials" ? (
                            renderMaterials(b)
                          ) : b.kind === "media" && !editable ? (
                            <a className={styles.mediaChip} href={b.url} target="_blank" rel="noreferrer">{UI.link}{b.text || b.url}</a>
                          ) : (
                            <div
                              className={[styles.text, editable && !(b.text || "").trim() ? styles.textEmpty : ""].filter(Boolean).join(" ")}
                              data-ph={b.kind === "number" ? "Describe the step…" : "Write a line…"}
                              {...editProps((v) => setSheet(patchBlock(sheet, b.id, { text: v })), KIND_LABEL[b.kind], b.id)}
                            >
                              {b.text}
                            </div>
                          )}
                          {b.kind === "media" && editable && (
                            <div className={`${styles.text} ${(b.url || "").trim() ? "" : styles.textEmpty}`} data-ph="Paste a link…" {...editProps((v) => setSheet(patchBlock(sheet, b.id, { url: v })), "Media link")}>{b.url}</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {menu && (
        <FloatMenu rect={menu.rect} onClose={() => setMenu(null)}>
          {menu.mode === "insert" && (
            <>
              <div className={styles.menuLabel}>Add block</div>
              {INSERT_KINDS.map((k) => (
                <button key={k} className={styles.menuItem} onClick={() => runInsert(k)}>{KIND_ICON[k]}{KIND_LABEL[k]}</button>
              ))}
            </>
          )}
          {menu.mode === "actions" && (() => {
            const b = blockAt(menu.blockId);
            const sub = !!b?.depth;
            return (
              <>
                {b?.kind === "text" && (
                  <button className={styles.menuItem} onClick={() => setMenu({ ...menu, mode: "style" })}>{UI.swatch}Icon &amp; colour…</button>
                )}
                <button className={styles.menuItem} onClick={() => setMenu({ ...menu, mode: "turn" })}>{UI.text}Turn into…</button>
                <button className={styles.menuItem} onClick={() => { setSheet(setDepth(sheet, menu.blockId, sub ? 0 : 1)); setMenu(null); }}>{sub ? UI.outdent : UI.indent}{sub ? "Lift to spine" : "Make sub-block"}</button>
                <button className={styles.menuItem} onClick={() => { setSheet(duplicateBlock(sheet, menu.blockId, draftId("b"))); setMenu(null); }}>{UI.copy}Duplicate</button>
                <div className={styles.menuDiv} />
                <button className={`${styles.menuItem} ${styles.menuDanger}`} onClick={() => { setSheet(removeBlockById(sheet, menu.blockId)); setMenu(null); }}>{UI.trash}Delete</button>
              </>
            );
          })()}
          {menu.mode === "turn" && (
            <>
              <div className={styles.menuLabel}>Turn into</div>
              {INSERT_KINDS.map((k) => {
                const on = blockAt(menu.blockId)?.kind === k;
                return <button key={k} className={on ? `${styles.menuItem} ${styles.menuOn}` : styles.menuItem} onClick={() => turnInto(k)}>{KIND_ICON[k]}{KIND_LABEL[k]}</button>;
              })}
            </>
          )}
          {menu.mode === "style" && (() => {
            const b = blockAt(menu.blockId);
            return (
              <>
                <div className={styles.menuLabel}>Colour</div>
                <div className={styles.swatchRow}>
                  {COLOR_IDS.map((c) => (
                    <button
                      key={c}
                      className={b?.color === c ? `${styles.swatch} ${styles.swatchOn}` : styles.swatch}
                      style={{ background: COLORS[c].token }}
                      title={COLORS[c].label}
                      aria-label={COLORS[c].label}
                      onClick={() => setSheet(patchBlock(sheet, menu.blockId, { color: c }))}
                    />
                  ))}
                </div>
                <div className={styles.menuLabel}>Icon</div>
                <div className={styles.iconGrid}>
                  {ICON_IDS.map((ic) => (
                    <button
                      key={ic}
                      className={(b?.icon ?? "none") === ic ? `${styles.iconBtn} ${styles.iconBtnOn}` : styles.iconBtn}
                      title={ICON_LABEL[ic]}
                      aria-label={ICON_LABEL[ic]}
                      onClick={() => setSheet(patchBlock(sheet, menu.blockId, { icon: ic }))}
                    >
                      {ICONS[ic]}
                    </button>
                  ))}
                </div>
              </>
            );
          })()}
        </FloatMenu>
      )}
    </div>
  );

  // ── render helpers (closures over state) ──
  function renderGutter(id: string) {
    return (
      <span className={styles.gutter}>
        <button className={styles.gbtn} onClick={(e) => setMenu({ mode: "insert", rect: e.currentTarget.getBoundingClientRect(), where: { afterId: id } })} aria-label="Insert block below">{UI.plus}</button>
        <span className={`${styles.gbtn} ${styles.ghandle}`} draggable onDragStart={(e) => onBlockDragStart(e, id)} onDragEnd={clearDrag} onClick={(e) => setMenu({ mode: "actions", rect: e.currentTarget.getBoundingClientRect(), blockId: id })} role="button" tabIndex={0} aria-label="Block options / drag to move">{UI.grip}</span>
      </span>
    );
  }

  function renderNode(b: DraftBlock, n: number) {
    if (b.kind === "number") return <span className={`${styles.node} ${styles.nodeNum}`} aria-hidden="true">{n}</span>;
    if (b.kind === "materials") return <span className={styles.node} style={blk("var(--wood-soft)")} aria-hidden="true">{UI.kit}</span>;
    if (b.kind === "media") return <span className={styles.node} style={blk("var(--dusk)")} aria-hidden="true">{UI.link}</span>;
    // text: a dot the user can recolour / re-icon by clicking it
    const token = COLORS[b.color ?? "none"].token;
    const icon = b.icon ?? "none";
    const inner = icon === "none" ? <span className={styles.dotInner} /> : ICONS[icon];
    const cls = icon === "none" ? `${styles.node} ${styles.nodeDot}` : styles.node;
    return editable ? (
      <button type="button" className={cls} style={blk(token)} aria-label="Set icon & colour" onClick={(e) => setMenu({ mode: "style", rect: e.currentTarget.getBoundingClientRect(), blockId: b.id })}>{inner}</button>
    ) : (
      <span className={cls} style={blk(token)} aria-hidden="true">{inner}</span>
    );
  }

  function renderMeta(b: DraftBlock) {
    if (b.kind === "number") {
      if (!editable && !b.time) return null;
      return (
        <div className={styles.metaRow}>
          <span className={(b.time || "").trim() ? styles.timeChip : `${styles.timeChip} ${styles.timeChipEmpty}`} {...editProps((v) => setSheet(patchBlock(sheet, b.id, { time: v })), "Step cue")}>{b.time || (editable ? "cue" : "")}</span>
        </div>
      );
    }
    const label = b.kind === "text" ? (b.icon && b.icon !== "none" ? ICON_LABEL[b.icon] : null) : KIND_LABEL[b.kind];
    if (!label) return null;
    return <div className={styles.metaRow}><span className={styles.typeChip}>{label}</span></div>;
  }

  function renderMaterials(b: DraftBlock) {
    const items = b.items ?? [];
    if (!editable) {
      return <ul className={styles.matList}>{items.filter((x) => x.trim()).map((x, i) => <li key={i} className={styles.matItem}>{x}</li>)}</ul>;
    }
    const setItems = (next: string[]) => setSheet(patchBlock(sheet, b.id, { items: next }));
    return (
      <ul className={styles.matList}>
        {items.map((x, i) => (
          <li key={i} className={styles.matItem}>
            <span className={`${styles.text} ${x.trim() ? "" : styles.textEmpty}`} data-ph="Material…" {...editProps((v) => { const next = [...items]; next[i] = v; setItems(next.filter((t, j) => t.trim() || j === next.length)); }, "Material")}>{x}</span>
          </li>
        ))}
        <li className={`${styles.matItem} ${styles.matAdd}`}><button className={styles.reset} onClick={() => setItems([...items, ""])}>+ material</button></li>
      </ul>
    );
  }

  function dropLine(o: Exclude<Over, null>) {
    if (o.type !== "block") return null;
    return <span className={`${styles.dropline} ${o.pos === "before" ? styles.dropBefore : styles.dropAfter}`} aria-hidden="true" />;
  }
}

// A portaled floating menu: a transparent scrim catches the outside click,
// Escape closes it. Positioned just below its trigger, clamped to the viewport.
function FloatMenu({ rect, onClose, children }: { rect: DOMRect; onClose: () => void; children: ReactNode }) {
  if (typeof document === "undefined") return null;
  const width = 220;
  const vw = typeof window === "undefined" ? 1024 : window.innerWidth;
  const left = Math.max(8, Math.min(rect.left, vw - width - 8));
  const top = rect.bottom + 6;
  return createPortal(
    <>
      <button className={styles.scrim} aria-label="Close menu" onClick={onClose} />
      <div className={styles.menu} role="menu" style={{ left, top }} onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } }}>
        {children}
      </div>
    </>,
    document.body
  );
}
