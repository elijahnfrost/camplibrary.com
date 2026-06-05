// Camp Library — icon set. 1.5 stroke, round caps/joins, currentColor (via CSS).
// viewBox 0 0 24 24. Stroke/fill inherited from styled ancestors.
import type { FC } from "react";

type IconProps = { className?: string };

const svg = (children: React.ReactNode): FC<IconProps> => {
  const Icon: FC<IconProps> = ({ className }) => (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      {children}
    </svg>
  );
  return Icon;
};

export const CampIcon = {
  Home: svg(
    <>
      <path d="M4 11.5 12 4l8 7.5" />
      <path d="M6.5 10.5V20h11v-9.5" />
      <path d="M10 20v-5h4v5" />
    </>
  ),
  Shelf: svg(
    <>
      <path d="M5 5v13M9 5v13M13 6l3 12M18.5 7l-1 11" />
      <path d="M3 19.5h18" />
    </>
  ),
  Deck: svg(
    <>
      <rect x="4" y="4" width="7" height="7" />
      <rect x="13" y="4" width="7" height="7" />
      <rect x="4" y="13" width="7" height="7" />
      <rect x="13" y="13" width="7" height="7" />
    </>
  ),
  List: svg(
    <>
      <path d="M4 6h2M4 12h2M4 18h2" />
      <path d="M9 6h11M9 12h11M9 18h11" />
    </>
  ),
  Library: svg(
    <>
      <path d="M12 6.5C10.5 5 8 4.7 5 5.2V18c3-.5 5.5-.2 7 1.3 1.5-1.5 4-1.8 7-1.3V5.2c-3-.5-5.5-.2-7 1.3z" />
      <path d="M12 6.5v12.8" />
    </>
  ),
  BookOpen: svg(
    <>
      <path d="M12 6.5C10.5 5 8 4.7 5 5.2V18c3-.5 5.5-.2 7 1.3 1.5-1.5 4-1.8 7-1.3V5.2c-3-.5-5.5-.2-7 1.3z" />
      <path d="M12 6.5v12.8" />
      <path d="M7.3 8.5h2.3M7.3 11.5h2.9M14.4 8.5h2.3M14 11.5h2.7" />
    </>
  ),
  Card: svg(
    <>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M7 9h10M7 12h7M7 15h5" />
    </>
  ),
  Clipboard: svg(
    <>
      <path d="M8.5 5.5H6a2 2 0 0 0-2 2V20h16V7.5a2 2 0 0 0-2-2h-2.5" />
      <path d="M9 4h6l1 3H8z" />
      <path d="M8 11h8M8 15h6" />
    </>
  ),
  Calendar: svg(
    <>
      <rect x="4" y="5.5" width="16" height="15" />
      <path d="M4 9.5h16M8.5 3.5v4M15.5 3.5v4" />
    </>
  ),
  Bookmark: svg(<path d="M6 4.5h12v15l-6-4-6 4z" />),
  Plus: svg(<path d="M12 5v14M5 12h14" />),
  Search: svg(
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m20 20-4.5-4.5" />
    </>
  ),
  Clock: svg(
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  Users: svg(
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
      <path d="M16 5.5a3 3 0 0 1 0 5.6M16.5 14.2c2.4.3 4 2.3 4 4.8" />
    </>
  ),
  User: svg(
    <>
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5 20c0-3.5 3.1-6 7-6s7 2.5 7 6" />
    </>
  ),
  Pin: svg(
    <>
      <path d="M12 21c4-4.5 6-7.8 6-11a6 6 0 1 0-12 0c0 3.2 2 6.5 6 11z" />
      <circle cx="12" cy="10" r="2.3" />
    </>
  ),
  Tool: svg(
    <path d="M14.5 6a3.5 3.5 0 0 0-4.7 4.2L4 16v4h4l5.8-5.8A3.5 3.5 0 0 0 18 9.5L15.5 12 12 8.5 14.5 6z" />
  ),
  Close: svg(<path d="M6 6l12 12M18 6 6 18" />),
  ChevronLeft: svg(<path d="M15 5l-7 7 7 7" />),
  ChevronRight: svg(<path d="M9 5l7 7-7 7" />),
  ChevronUp: svg(<path d="M5 15l7-7 7 7" />),
  ChevronDown: svg(<path d="M5 9l7 7 7-7" />),
  Trash: svg(<path d="M5 7h14M9 7V4.5h6V7M7 7l1 13h8l1-13" />),
  Check: svg(<path d="M5 12.5 10 17l9-10" />),
  Print: svg(
    <>
      <path d="M7 8V4h10v4" />
      <path d="M7 17H5a2 2 0 0 1-2-2v-4a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v4a2 2 0 0 1-2 2h-2" />
      <path d="M7 14h10v6H7z" />
      <path d="M17.5 11.5h.01" />
    </>
  ),
  Reset: svg(
    <>
      <path d="M5 8v5h5" />
      <path d="M6.5 13A6.5 6.5 0 1 0 8 5.8L5 8" />
    </>
  ),
  Grip: svg(
    <>
      <circle cx="8" cy="6" r="1" />
      <circle cx="16" cy="6" r="1" />
      <circle cx="8" cy="12" r="1" />
      <circle cx="16" cy="12" r="1" />
      <circle cx="8" cy="18" r="1" />
      <circle cx="16" cy="18" r="1" />
    </>
  ),
  // ---- Run List detail glyphs (note / safety / video / variation / sub-step) ----
  Note: svg(<path d="M5 6h14M5 11h14M5 16h9" />),
  Shield: svg(
    <>
      <path d="M12 21c4-4.5 6-7.8 6-11a6 6 0 1 0-12 0c0 3.2 2 6.5 6 11z" />
      <circle cx="12" cy="10" r="2.2" />
    </>
  ),
  Video: svg(
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M10 9.5v5l4-2.5z" />
    </>
  ),
  Variation: svg(<path d="M4 7h4l9 10h3M4 17h4l3-3.4M16 4l3 3-3 3M16 14l3 3-3 3" />),
  SubStep: svg(<path d="M7 5v7a3 3 0 0 0 3 3h8M14 11l5 4-5 4" />),
  Heading: svg(<path d="M6 5v14M16 5v14M6 12h10" />),
  CollapseAll: svg(<path d="M6 9l6-6 6 6M6 15l6 6 6-6" />),
  ExpandAll: svg(<path d="M6 15l6 6 6-6M6 9l6-6 6 6" />),
} as const;
