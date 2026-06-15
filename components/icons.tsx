// Camp Library — icon set. 1.5 stroke, round caps/joins, currentColor (via CSS).
// viewBox 0 0 24 24. Stroke/fill inherited from styled ancestors.
import type { FC } from "react";

type IconProps = { className?: string };

// `anim` adds a stable hook class (e.g. "cicon--book") to the <svg> so CSS can
// play a part-level hover animation when the icon sits inside an interactive
// ancestor (button / a / summary). The classed inner parts below carry the
// moving pieces (a page, a calendar leaf, dealt cards). See globals.css §icon
// hover animations. Plain icons pass no `anim` and stay static.
const svg = (children: React.ReactNode, anim?: string): FC<IconProps> => {
  const hook = anim ? "cicon cicon--" + anim : undefined;
  const Icon: FC<IconProps> = ({ className }) => (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={[hook, className].filter(Boolean).join(" ") || undefined}
    >
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
  // Four spines on a shelf; on hover they jostle and settle (a mini echo of the
  // brand mark). Each spine carries --i for the left→right stagger.
  Shelf: svg(
    <>
      <path className="cicon-spine" style={{ "--i": 0 } as React.CSSProperties} d="M5 5v13" />
      <path className="cicon-spine" style={{ "--i": 1 } as React.CSSProperties} d="M9 5v13" />
      <path className="cicon-spine" style={{ "--i": 2 } as React.CSSProperties} d="M13 6l3 12" />
      <path className="cicon-spine" style={{ "--i": 3 } as React.CSSProperties} d="M18.5 7l-1 11" />
      <path d="M3 19.5h18" />
    </>,
    "shelf"
  ),
  // Four cards; on hover they deal in one after another with a little pop.
  Deck: svg(
    <>
      <rect className="cicon-card" style={{ "--i": 0 } as React.CSSProperties} x="4" y="4" width="7" height="7" />
      <rect className="cicon-card" style={{ "--i": 1 } as React.CSSProperties} x="13" y="4" width="7" height="7" />
      <rect className="cicon-card" style={{ "--i": 2 } as React.CSSProperties} x="4" y="13" width="7" height="7" />
      <rect className="cicon-card" style={{ "--i": 3 } as React.CSSProperties} x="13" y="13" width="7" height="7" />
    </>,
    "deck"
  ),
  // Three list rows; on hover each long rule sweeps in from the bullet, top→down.
  List: svg(
    <>
      <path d="M4 6h2M4 12h2M4 18h2" />
      <path className="cicon-line" style={{ "--i": 0 } as React.CSSProperties} d="M9 6h11" />
      <path className="cicon-line" style={{ "--i": 1 } as React.CSSProperties} d="M9 12h11" />
      <path className="cicon-line" style={{ "--i": 2 } as React.CSSProperties} d="M9 18h11" />
    </>,
    "list"
  ),
  // A closed book stood on its tail (spine on the left). At rest it reads as a
  // clean covered book. On hover the front cover swings open on the spine
  // (rotateY, hinged at the left edge), and a few page lines flip in beneath —
  // "opening the book to read". Draw order matters: pages first (underneath),
  // the cover last so it sits on top and is what the eye sees opening.
  Library: svg(
    <>
      {/* Page block — sits under the cover, revealed as it swings open. */}
      <rect className="cicon-book__pages" x="6" y="4.5" width="13" height="15" rx="1.5" />
      <path className="cicon-book__line" style={{ "--i": 0 } as React.CSSProperties} d="M9.5 8.5h6" />
      <path className="cicon-book__line" style={{ "--i": 1 } as React.CSSProperties} d="M9.5 12h6" />
      <path className="cicon-book__line" style={{ "--i": 2 } as React.CSSProperties} d="M9.5 15.5h4" />
      {/* Front cover — hinged at its left edge (the spine), swings open on hover.
          The inner rule near the spine reads as a book's hinge even when shut. */}
      <g className="cicon-book__cover">
        <rect x="6" y="4.5" width="13" height="15" rx="1.5" />
        <path d="M9 4.5v15" />
      </g>
    </>,
    "book"
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
  // Wall calendar. On hover a fresh page flips down over the grid (turning to a
  // new month): the page sheet rotates down from the header on its top hinge, a
  // new set of date dots pops in beneath it, and the two binder rings hop. The
  // body frame + header rule stay put as the page turns.
  Calendar: svg(
    <>
      <rect x="4" y="5.5" width="16" height="15" />
      <path d="M4 9.5h16" />
      {/* New-month date dots — pop in as the page settles. */}
      <g className="cicon-cal__dots">
        <circle cx="8" cy="13" r="0.9" style={{ "--i": 0 } as React.CSSProperties} />
        <circle cx="12" cy="13" r="0.9" style={{ "--i": 1 } as React.CSSProperties} />
        <circle cx="16" cy="13" r="0.9" style={{ "--i": 2 } as React.CSSProperties} />
        <circle cx="8" cy="16.5" r="0.9" style={{ "--i": 3 } as React.CSSProperties} />
        <circle cx="12" cy="16.5" r="0.9" style={{ "--i": 4 } as React.CSSProperties} />
      </g>
      {/* The turning page: a full sheet hinged at the header, flips down on hover. */}
      <path className="cicon-cal__leaf" d="M4 9.5h16V20H4z" />
      <path className="cicon-cal__rings" d="M8.5 3.5v4M15.5 3.5v4" />
    </>,
    "cal"
  ),
  // Bookmark; on hover it dips down as if catching a page.
  Bookmark: svg(<path d="M6 4.5h12v15l-6-4-6 4z" />, "bookmark"),
  // Plus; on hover it spins a quarter-turn and grows — "add".
  Plus: svg(<path d="M12 5v14M5 12h14" />, "plus"),
  Filter: svg(<path d="M4 6h16l-6 7v5l-4 2v-7L4 6z" />, "filter"),
  More: svg(
    <>
      <circle cx="5.5" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="18.5" cy="12" r="1.4" />
    </>
  ),
  // Magnifier; on hover the whole lens gives a little searching nudge.
  Search: svg(
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m20 20-4.5-4.5" />
    </>,
    "search"
  ),
  Clock: svg(
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  // Two people; on hover the front one gives a friendly head-bob and the one
  // behind leans in to join — a little "the team's here" greeting.
  Users: svg(
    <>
      <circle className="cicon-users__head" cx="9" cy="8" r="3.2" />
      <path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
      <path className="cicon-users__back" d="M16 5.5a3 3 0 0 1 0 5.6M16.5 14.2c2.4.3 4 2.3 4 4.8" />
    </>,
    "users"
  ),
  // Person; on hover the head gives a friendly little nod.
  User: svg(
    <>
      <circle className="cicon-user__head" cx="12" cy="8" r="3.4" />
      <path d="M5 20c0-3.5 3.1-6 7-6s7 2.5 7 6" />
    </>,
    "user"
  ),
  Pin: svg(
    <>
      <path d="M12 21c4-4.5 6-7.8 6-11a6 6 0 1 0-12 0c0 3.2 2 6.5 6 11z" />
      <circle cx="12" cy="10" r="2.3" />
    </>
  ),
  // Wrench; on hover it gives a couple of quick tightening wiggles.
  Tool: svg(
    <path d="M14.5 6a3.5 3.5 0 0 0-4.7 4.2L4 16v4h4l5.8-5.8A3.5 3.5 0 0 0 18 9.5L15.5 12 12 8.5 14.5 6z" />,
    "tool"
  ),
  Pencil: svg(
    <>
      <path d="M4 20l1-4.2L15.4 5.4a2 2 0 0 1 2.9 0l.3.3a2 2 0 0 1 0 2.9L8.2 19l-4.2 1z" />
      <path d="M13.5 7.2l3.3 3.3" />
    </>
  ),
  Copy: svg(
    <>
      <path d="M9 9h9.5v10.5H9z" />
      <path d="M14.5 9V4.5H5.5V15H9" />
    </>
  ),
  Close: svg(<path d="M6 6l12 12M18 6 6 18" />),
  ChevronLeft: svg(<path d="M15 5l-7 7 7 7" />, "chev-left"),
  ChevronRight: svg(<path d="M9 5l7 7-7 7" />, "chev-right"),
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
  // Refresh arrow; on hover it spins a full turn — "reset".
  Reset: svg(
    <>
      <path d="M5 8v5h5" />
      <path d="M6.5 13A6.5 6.5 0 1 0 8 5.8L5 8" />
    </>,
    "reset"
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

// The brand mark: the bookshelf logo, inlined so each book is a CSS-targetable
// element. Mirrors /public/logo-mark.svg exactly (same viewBox, geometry, and
// palette) — the only addition is per-book classes so the brand button can play
// the "book falls into place" hover (see .sidenav__brand:hover .bookmark__book
// in globals.css). Books are numbered left→right; --i drives the stagger.
export const BrandMark: FC<IconProps> = ({ className }) => (
  <svg
    viewBox="90 105 330 300"
    fill="none"
    className={className}
    aria-hidden="true"
  >
    <g
      className="bookmark__books"
      stroke="#2c2824"
      strokeWidth={13}
      strokeLinejoin="round"
    >
      <rect
        className="bookmark__book bookmark__book--1"
        style={{ "--i": 0 } as React.CSSProperties}
        x={138}
        y={158}
        width={58}
        height={216}
        fill="#cda08a"
      />
      <rect
        className="bookmark__book bookmark__book--2"
        style={{ "--i": 1 } as React.CSSProperties}
        x={204}
        y={128}
        width={58}
        height={246}
        fill="#4f7a52"
      />
      <rect
        className="bookmark__book bookmark__book--3"
        style={{ "--i": 2 } as React.CSSProperties}
        x={270}
        y={178}
        width={58}
        height={196}
        fill="#aebf86"
      />
      {/* The leaning gold book — its resting tilt is what "falls into place".
          The lean lives in CSS (.bookmark__book--4) so the hover animation can
          start from exactly the rendered angle with no jump. */}
      <rect
        className="bookmark__book bookmark__book--4"
        x={334}
        y={150}
        width={52}
        height={224}
        fill="#d9b152"
      />
    </g>
    <path
      className="bookmark__shelf"
      d="M116 380 H410"
      stroke="#2c2824"
      strokeWidth={16}
      strokeLinecap="round"
    />
  </svg>
);
