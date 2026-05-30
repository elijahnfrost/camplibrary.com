// Camp Library — icon set. 1.5 stroke, round caps/joins, currentColor (via CSS).
// viewBox 0 0 24 24 unless noted. Stroke/fill inherited from styled ancestors.
const CampIcon = {
  Shelf: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 5v13M9 5v13M13 6l3 12M18.5 7l-1 11" />
      <path d="M3 19.5h18" />
    </svg>
  ),
  Deck: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="4" width="7" height="7" />
      <rect x="13" y="4" width="7" height="7" />
      <rect x="4" y="13" width="7" height="7" />
      <rect x="13" y="13" width="7" height="7" />
    </svg>
  ),
  List: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 6h2M4 12h2M4 18h2" />
      <path d="M9 6h11M9 12h11M9 18h11" />
    </svg>
  ),
  Library: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 6.5C10.5 5 8 4.7 5 5.2V18c3-.5 5.5-.2 7 1.3 1.5-1.5 4-1.8 7-1.3V5.2c-3-.5-5.5-.2-7 1.3z" />
      <path d="M12 6.5v12.8" />
    </svg>
  ),
  Calendar: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="5.5" width="16" height="15" />
      <path d="M4 9.5h16M8.5 3.5v4M15.5 3.5v4" />
    </svg>
  ),
  Bookmark: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 4.5h12v15l-6-4-6 4z" />
    </svg>
  ),
  Plus: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  Search: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m20 20-4.5-4.5" />
    </svg>
  ),
  Clock: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  ),
  Users: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
      <path d="M16 5.5a3 3 0 0 1 0 5.6M16.5 14.2c2.4.3 4 2.3 4 4.8" />
    </svg>
  ),
  Spark: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M13 3 5 13h6l-1 8 8-10h-6z" />
    </svg>
  ),
  Pin: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 21c4-4.5 6-7.8 6-11a6 6 0 1 0-12 0c0 3.2 2 6.5 6 11z" />
      <circle cx="12" cy="10" r="2.3" />
    </svg>
  ),
  Tool: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14.5 6a3.5 3.5 0 0 0-4.7 4.2L4 16v4h4l5.8-5.8A3.5 3.5 0 0 0 18 9.5L15.5 12 12 8.5 14.5 6z" />
    </svg>
  ),
  Close: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  ),
  ChevronLeft: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M15 5l-7 7 7 7" />
    </svg>
  ),
  ChevronRight: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 5l7 7-7 7" />
    </svg>
  ),
  Star: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.5l2.6 5.27 5.82.85-4.21 4.1.99 5.79L12 16.77l-5.2 2.73.99-5.79-4.21-4.1 5.82-.85z" />
    </svg>
  ),
  Trash: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 7h14M9 7V4.5h6V7M7 7l1 13h8l1-13" />
    </svg>
  ),
  Check: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12.5 10 17l9-10" />
    </svg>
  ),
  Sun: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8 6 18M18 6l1.8-1.8" />
    </svg>
  ),
  Moon: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 13.5A8 8 0 1 1 10.5 4 6.3 6.3 0 0 0 20 13.5z" />
    </svg>
  ),
  Shuffle: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 6h3.5l9 12H20M4 18h3.5l3-4M14 9l2.5-3H20M17 3l3 3-3 3M17 15l3 3-3 3" />
    </svg>
  ),
};
window.CampIcon = CampIcon;
