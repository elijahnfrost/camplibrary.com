"use client";

// The ONE disclosure skeleton for every rail zone and popup group: a flat
// chevron row (no boxed card), a small-caps label, and a meaningful summary at
// rest on the right, with the whole row as the hit target. The chevron sits at
// the LEFT and is visible at rest (the primary path is never hover-only), and
// it flips INSTANTLY on toggle (an eased rotate reads as lag; only color eases).
//
// Supports both uncontrolled (defaultOpen) and controlled (open/onToggle) use —
// the event window's "More options" must auto-open from the draft's contents,
// so it owns its state; the rail zones don't care and stay uncontrolled.

import { useState, type ReactNode } from "react";
import { CampIcon } from "@/components/ui/icons";

export function Disclosure({
  title,
  summary,
  defaultOpen = false,
  open: openProp,
  onToggle,
  className,
  children,
}: {
  title: string;
  /** The at-rest state echo ("2 set", "15m", "off") — kept visible open OR
   *  closed so the row always answers "what's in here" without a click. */
  summary?: ReactNode;
  defaultOpen?: boolean;
  /** Controlled mode — pass BOTH open and onToggle, or neither. */
  open?: boolean;
  onToggle?: () => void;
  className?: string;
  children: ReactNode;
}) {
  const [openState, setOpenState] = useState(defaultOpen);
  const open = openProp ?? openState;
  const toggle = onToggle ?? (() => setOpenState((o) => !o));
  return (
    <div className={["lc-disc", open ? "is-open" : "", className ?? ""].filter(Boolean).join(" ")}>
      <button type="button" className="lc-disc__head" aria-expanded={open} onClick={toggle}>
        <CampIcon.ChevronRight className="lc-disc__chev" />
        <span className="lc-label">{title}</span>
        {summary != null && summary !== "" && <span className="lc-disc__sum">{summary}</span>}
      </button>
      {open && <div className="lc-disc__body">{children}</div>}
    </div>
  );
}
