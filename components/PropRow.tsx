// The "Notion lines" property row — one shared anatomy used across the app:
//   [icon] · [muted label] · [inline value / control]
// Display surfaces (event window, run sheet) left-align the value; control
// surfaces (filters, settings) pass `end` to push a control to the right edge.
// The icon is what makes each axis legible at a glance (Type vs Grades vs Where).
// Pure presentational — no state — so it composes into any client surface.

import type { CSSProperties, FC, ReactNode } from "react";
import { CampIcon } from "./icons";

type IconCmp = FC<{ className?: string }>;

export function PropRow({
  icon: Icon,
  label,
  children,
  end,
  labelWidth,
  className,
}: {
  /** The axis glyph (left). Omit for a value-only row. */
  icon?: IconCmp;
  /** The muted small-caps label. */
  label: string;
  /** The value or control. */
  children: ReactNode;
  /** Push the value/control to the right edge (toggles, settings controls). */
  end?: boolean;
  /** Override the label column width (px) when a surface needs tighter/wider. */
  labelWidth?: number;
  className?: string;
}) {
  return (
    <div
      className={["prop-row", end ? "prop-row--end" : "", className].filter(Boolean).join(" ")}
      style={labelWidth ? ({ "--prop-lblw": labelWidth + "px" } as CSSProperties) : undefined}
    >
      <span className="prop-row__ic" aria-hidden="true">{Icon ? <Icon /> : null}</span>
      <span className="prop-row__lbl">{label}</span>
      <span className="prop-row__val">{children}</span>
    </div>
  );
}

// The shared axis → glyph map. One source of truth so an axis wears the SAME
// icon wherever it appears (a property, a filter, a setting, a chip).
export const AxisIcon: Record<string, IconCmp> = {
  type: CampIcon.Tag,
  theme: CampIcon.Sparkles,
  grades: CampIcon.Users,
  ages: CampIcon.Users,
  group: CampIcon.Users,
  where: CampIcon.Sun,
  time: CampIcon.Clock,
  length: CampIcon.Clock,
  minutes: CampIcon.Clock,
  date: CampIcon.Calendar,
  kit: CampIcon.Box,
  materials: CampIcon.Box,
  energy: CampIcon.Bolt,
  prep: CampIcon.Tool,
  rating: CampIcon.Star,
  starred: CampIcon.Bookmark,
  location: CampIcon.Pin,
  place: CampIcon.Pin,
  color: CampIcon.Palette,
  colorby: CampIcon.Palette,
  repeat: CampIcon.Repeat,
  daynote: CampIcon.Note,
  fieldnotes: CampIcon.Flag,
  sort: CampIcon.Sort,
  weather: CampIcon.Sun,
  weekend: CampIcon.Calendar,
  weekstart: CampIcon.Calendar,
  days: CampIcon.Calendar,
  camps: CampIcon.Home,
  allday: CampIcon.Clock,
};
