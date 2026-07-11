"use client";

// ============================================================
// Camp Library — Run List controls & shared meta
//
// The presentational sub-components and shared metadata for "The Run List"
// (ActivityRunList): the inline Editable cell, summary Pill, embed player,
// materials checklist, the ledger / age / group pickers, and the details +
// materials editors — plus the icon maps, block palettes, and rail / stamp
// helpers they share with the shell. Extracted verbatim from ActivityRunList.tsx
// (structural cleanup, no behavior change).
// ============================================================
import { useEffect, useRef, type DragEvent, type FC } from "react";
import { CampIcon } from "../ui/icons";
import { RUN_CHILD_TYPES, runPillLabel, type RunBlockType, type RunChildType, type RunIcon } from "@/lib/activity/runList";
import { type ParsedEmbed } from "@/lib/activity/embed";

export const DETAIL_ANIM_MS = 170;

type IconCmp = FC<{ className?: string }>;

export const TYPE_ICON: Record<string, IconCmp> = {
  note: CampIcon.Note,
  safety: CampIcon.Shield,
  video: CampIcon.Video,
  variation: CampIcon.Variation,
  fieldnote: CampIcon.Flag,
  substep: CampIcon.SubStep,
  diagram: CampIcon.Deck,
  materials: CampIcon.Card,
  heading: CampIcon.Heading,
  playbook: CampIcon.BookOpen,
};

// The glyph each pickable RunIcon wears in its node (the icon/colour picker).
export const RUN_ICON_CMP: Record<RunIcon, IconCmp> = {
  note: CampIcon.Note,
  safety: CampIcon.Shield,
  tip: CampIcon.Variation,
  bell: CampIcon.Bell,
  star: CampIcon.Star,
  flag: CampIcon.Flag,
};
export const RUN_ICON_LABEL: Record<RunIcon, string> = {
  note: "Note",
  safety: "Safety",
  tip: "Tip",
  bell: "Reminder",
  star: "Star",
  flag: "Flag",
};

// Blocks you can append from the "Add a block" palette (top level).
export const ADD_BLOCKS: { type: RunBlockType; label: string; icon: IconCmp }[] = [
  { type: "details", label: "Specific details", icon: CampIcon.Card },
  { type: "materials", label: "Materials", icon: CampIcon.Card },
  { type: "step", label: "Step", icon: CampIcon.SubStep },
  { type: "heading", label: "Section", icon: CampIcon.Heading },
  { type: "note", label: "Note", icon: CampIcon.Note },
  { type: "safety", label: "Safety", icon: CampIcon.Shield },
  { type: "variation", label: "Variation", icon: CampIcon.Variation },
  { type: "fieldnote", label: "Field note", icon: CampIcon.Flag },
];
// Field notes live in their own dedicated log block now, so they're not offered
// as a per-step attachment (materials likewise stays a top-level block).
export const ATTACH_BLOCKS = RUN_CHILD_TYPES.filter((type) => type !== "materials" && type !== "fieldnote");

// "Jun 23 · 2:05 PM" from a local "YYYY-MM-DDTHH:mm" (or just "Jun 23" from a
// legacy date-only stamp) — parsed by hand so the chip never drifts a day across
// timezones (no Date() reparse of the stored string).
const STAMP_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function formatStamp(at: string | undefined): string {
  if (!at) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(at);
  if (!m) return at;
  const month = STAMP_MONTHS[Number(m[2]) - 1];
  if (!month) return at;
  const date = month + " " + Number(m[3]);
  if (m[4] == null) return date;
  let hour = Number(m[4]);
  const meridiem = hour < 12 ? "AM" : "PM";
  hour = hour % 12 || 12;
  return date + " · " + hour + ":" + m[5] + " " + meridiem;
}

export type RailSegment = {
  id: string;
  x: number;
  y1: number;
  y2: number;
};

export const topRailKey = (id: string) => "top:" + id;
export const childRailKey = (parentId: string, id: string) => "child:" + parentId + ":" + id;

export function dropPosition(e: DragEvent<HTMLElement>): "before" | "after" {
  const rect = e.currentTarget.getBoundingClientRect();
  return e.clientY < rect.top + rect.height / 2 ? "before" : "after";
}

// ----------------------------------------------------------------------------
// Inline contentEditable cell. Commits on blur; only rewrites the DOM when the
// value changes from the outside (never mid-keystroke). Escape restores the
// pre-edit value instead of committing; Enter/Backspace hooks let step rows
// split and join like a text document.
// ----------------------------------------------------------------------------
export function Editable({
  value,
  onCommit,
  placeholder,
  editable,
  tag = "div",
  className = "",
  ariaLabel,
  ariaLabelledBy,
  focusKey,
  onEnter,
  onBackspaceEmpty,
  onIndent,
  onOutdent,
  commitOnEnter,
}: {
  value: string;
  onCommit: (next: string) => void;
  placeholder?: string;
  editable: boolean;
  tag?: "div" | "span";
  className?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  /** Marks the cell focusable-by-id after structural edits (data-rl-focus). */
  focusKey?: string;
  /** Enter splits at the caret: text before stays, text after moves on. */
  onEnter?: (beforeText: string, afterText: string) => void;
  /** Backspace in an already-empty cell (e.g. remove the empty step). */
  onBackspaceEmpty?: () => void;
  /** Tab: nest this block as a detail under the step above (commits text first). */
  onIndent?: (text: string) => void;
  /** Shift+Tab: lift this detail back to a top-level block (commits text first). */
  onOutdent?: (text: string) => void;
  /** Enter commits and blurs (a field note is "done" on Enter); Shift+Enter
   *  still inserts a newline for a multi-line note. */
  commitOnEnter?: boolean;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const cancelRef = useRef(false);
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
      data-rl-focus={focusKey}
      role={editable ? "textbox" : undefined}
      aria-label={editable && label ? label : undefined}
      aria-labelledby={editable && !label ? ariaLabelledBy : undefined}
      aria-placeholder={editable && placeholder ? placeholder : undefined}
      onBlur={
        editable
          ? (e) => {
              if (cancelRef.current) {
                cancelRef.current = false;
                return;
              }
              onCommit(e.currentTarget.textContent || "");
            }
          : undefined
      }
      onKeyDown={
        editable
          ? (e) => {
              if (e.key === "Tab" && (onIndent || onOutdent)) {
                // Nest / un-nest like an outline. Commit the current text as part
                // of the move (the row remounts at its new depth) so typing isn't
                // lost, and suppress the trailing blur from re-committing stale text.
                e.preventDefault();
                const text = e.currentTarget.textContent || "";
                cancelRef.current = true;
                if (e.shiftKey) onOutdent?.(text);
                else onIndent?.(text);
                return;
              }
              if (e.key === "Enter" && !e.shiftKey && onEnter) {
                e.preventDefault();
                // Split at the caret like a text document: "before|after"
                // keeps "before" here and carries "after" into the new step.
                const el = e.currentTarget as HTMLElement;
                const full = el.textContent || "";
                let before = full;
                let after = "";
                const selection = window.getSelection();
                if (selection && selection.rangeCount && el.contains(selection.anchorNode)) {
                  const range = selection.getRangeAt(0);
                  const pre = range.cloneRange();
                  pre.selectNodeContents(el);
                  pre.setEnd(range.startContainer, range.startOffset);
                  before = pre.toString();
                  after = full.slice(before.length);
                }
                onEnter(before, after);
              } else if (e.key === "Enter" && !e.shiftKey && commitOnEnter) {
                // A field note is finished on Enter. Commit, then blur — and flag
                // the blur handler so the same text isn't committed twice.
                e.preventDefault();
                const el = e.currentTarget as HTMLElement;
                cancelRef.current = true;
                onCommit(el.textContent || "");
                el.blur();
              } else if (e.key === "Escape") {
                // Cancel this edit only — preventDefault tells the dialog
                // stack the key is claimed, so the viewer stays open.
                e.preventDefault();
                e.stopPropagation();
                cancelRef.current = true;
                e.currentTarget.textContent = value || "";
                (e.currentTarget as HTMLElement).blur();
              } else if (
                e.key === "Backspace" &&
                onBackspaceEmpty &&
                !(e.currentTarget.textContent || "").trim()
              ) {
                e.preventDefault();
                onBackspaceEmpty();
              }
            }
          : undefined
      }
    />
  );
}

export function Pill({ type, n }: { type: RunChildType; n: number }) {
  const Icon = TYPE_ICON[type];
  return (
    <span className={"rl-pill rl-pill--" + type}>
      <Icon />
      {runPillLabel(type, n)}
    </span>
  );
}

// A media detail rendered safely. Trusted-provider links (YouTube / Vimeo) play
// inline as a sandboxed 16:9 iframe whose src we build from a *validated* video
// id — never the raw user string — so an arbitrary iframe can never be injected.
// Every other link reads as a tappable preview card. `none` renders nothing.
export function RunEmbed({ parsed, title }: { parsed: ParsedEmbed; title?: string }) {
  if (parsed.kind === "youtube" || parsed.kind === "vimeo") {
    return (
      <div className="rl-embed rl-embed--player">
        <iframe
          src={parsed.embedUrl}
          title={title || (parsed.kind === "youtube" ? "YouTube video" : "Vimeo video")}
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
          sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"
          allowFullScreen
        />
      </div>
    );
  }
  if (parsed.kind === "link") {
    return (
      <a className="rl-embed rl-embed--card" href={parsed.href} target="_blank" rel="noopener noreferrer">
        <img
          className="rl-embed__icon"
          src={"https://www.google.com/s2/favicons?sz=64&domain=" + encodeURIComponent(parsed.domain)}
          alt=""
          width={32}
          height={32}
          loading="lazy"
        />
        <span className="rl-embed__meta">
          <span className="rl-embed__title">{title || parsed.domain}</span>
          <span className="rl-embed__domain">{parsed.domain}</span>
        </span>
        <span className="rl-embed__go" aria-hidden="true">
          <CampIcon.Link />
        </span>
      </a>
    );
  }
  return null;
}

