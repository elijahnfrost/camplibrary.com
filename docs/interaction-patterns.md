# Interaction patterns — the app-wide presentation contract

Every clickable element in Camp Library resolves to exactly ONE of six presentation
patterns. The test: you can predict what a click will do before clicking it.

## The six patterns

| # | Pattern | Trigger class | Mechanism | Dismiss |
|---|---------|--------------|-----------|---------|
| 1 | **Navigate** | Sidebar tabs, routes, the brand mark, profile → admin | `setTab` / Next route | — |
| 2 | **Centered modal** | Opening a RECORD (activity run sheet, event editor) or a DECISION (series scope, destructive confirm) | `Modal` (`components/Modal.tsx`) on the `useDialogFocus` stack | Escape (topmost layer only), scrim, explicit close. Dirty editors prompt before discarding. Never two stacked record-modals; a confirm may stack on anything. |
| 3 | **Anchored popover** | Picking/adjusting a VALUE or peeking at detail: every dropdown/select, date picker, weather/stop/gather/rain cards, subscribe, profile menu, color/location/meal/backup/skip pickers | `FloatingLayer` (`components/floating/FloatingLayer.tsx`), portaled to body, viewport-clamped, max-height scroll, flips up near the bottom edge | Escape (capture-phase, closes ONLY the layer), outside click/scroll, resize |
| 4 | **Context menu** | Right-click / long-press on events, slots, library rows, material rows | `ContextMenu` on `FloatingLayer` | Same as 3. Rule: a context-menu action must ALSO be reachable somewhere visible — never the sole path. |
| 5 | **Inline expansion** | Disclosure inside a flow: sidebar sections, print-rail groups, run-sheet block collapse, editor "More options", camp card editors | In-flow collapsible, chevron affordance (right = closed, down = open) | Toggle |
| 6 | **Sheet** (touch tiers) | The sub-1024px container for pattern 2/3 content | Same components; CSS docks them bottom | Swipe/scrim/Escape |

## Assignment rules

- Opening something with an identity (an activity, an event) → **2**.
- Choosing or adjusting a value → **3** anchored at the control that owns the value.
- Anything destructive or scope-ambiguous → **2** as a themed `requestConfirm` /
  `SeriesScopeDialog`. `window.confirm` is banned (lint for it in review).
- Moving between the app's three places (Library / Calendar / Print) → **1**, sidebar only.
- Power shortcuts → **4**, duplicating a visible path.
- Progressive detail within a surface → **5**, never a new window.

## Load-bearing implementation contracts

- **Escape ladder**: `FloatingLayer` handles Escape in the capture phase and
  `preventDefault()`s; `useDialogFocus` (modals) bails on `defaultPrevented` and only the
  TOPMOST stacked dialog acts. Any other document/window key handler MUST bail when
  `hasOpenDialog()` is true (see CalendarShell's selection-clear handler).
- **Z-ladder** (documented in globals.css): tabbar 24 < fab 26 < scrim 30 / overlay 31 <
  picker-sheet 60 < popover 70 < toast 80 < present 200 < lightbox 210 < floating-root 220 <
  skip-link 300. FullCalendar's native popover is overridden into tier 220.
- All popovers/menus carry `max-height` clamps and never render off-viewport; the position
  engine (`useFloatingPosition`) flips vertically near edges.

## Before / after surface count

Phase 1 audit (2026-07-03) mapped **47 distinct surfaces** (9 routes, 5 tabs, 4 library
sub-views, 9 modals, 4 popovers, 6 context menus, 5 cursor pickers, 5 misc overlays) with
549 clickables producing 8 unpredictable presentation behaviors (86 classified "other").

After the overhaul: **32 surfaces**. Cut: the Staff tab (→ profile control), the
`/draft/run-sheet` prototype route, the second print pipeline, two of three
ListManagerModal mounts' distinct shells, both diagram modal variants (one surface, two
modes), the standalone subscribe pill, dashboard filler (leaderboard/digest/feed), and all
duplicate presentation containers (9 bespoke popover/menu implementations → 1 engine;
9 native `confirm()`s → 1 themed dialog; desktop/mobile duplicate renderings unified as one
surface with tier-dependent containers). Kept per owner decision: all three Library views
(Shelf default). Every remaining clickable maps to one of the six patterns above.
