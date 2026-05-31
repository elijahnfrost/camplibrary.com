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
  PanelSmall: svg(
    <>
      <rect x="4" y="5" width="16" height="14" rx="1.5" />
      <path d="M15.5 5v14" />
    </>
  ),
  PanelMedium: svg(
    <>
      <rect x="4" y="5" width="16" height="14" rx="1.5" />
      <path d="M12 5v14" />
    </>
  ),
  PanelLarge: svg(
    <>
      <rect x="4" y="5" width="16" height="14" rx="1.5" />
      <path d="M8.5 5v14" />
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
  Lock: svg(
    <>
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M8 10V7.5a4 4 0 0 1 8 0V10" />
      <path d="M12 14v2.5" />
    </>
  ),
  Spark: svg(<path d="M13 3 5 13h6l-1 8 8-10h-6z" />),
  Pin: svg(
    <>
      <path d="M12 21c4-4.5 6-7.8 6-11a6 6 0 1 0-12 0c0 3.2 2 6.5 6 11z" />
      <circle cx="12" cy="10" r="2.3" />
    </>
  ),
  Tool: svg(
    <path d="M14.5 6a3.5 3.5 0 0 0-4.7 4.2L4 16v4h4l5.8-5.8A3.5 3.5 0 0 0 18 9.5L15.5 12 12 8.5 14.5 6z" />
  ),
  Pencil: svg(
    <>
      <path d="M4 20l1-4.2L15.4 5.4a2 2 0 0 1 2.9 0l.3.3a2 2 0 0 1 0 2.9L8.2 19l-4.2 1z" />
      <path d="M13.5 7.2l3.3 3.3" />
    </>
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
  Sun: svg(
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8 6 18M18 6l1.8-1.8" />
    </>
  ),
  Moon: svg(<path d="M20 13.5A8 8 0 1 1 10.5 4 6.3 6.3 0 0 0 20 13.5z" />),
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
  Shuffle: svg(
    <path d="M4 6h3.5l9 12H20M4 18h3.5l3-4M14 9l2.5-3H20M17 3l3 3-3 3M17 15l3 3-3 3" />
  ),
} as const;

export type CampIconName = keyof typeof CampIcon;
