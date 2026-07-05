# Architecture — module map

The one-screen index of where things live. Read this first. Narrative sections
(surfaces, state/sync, auth boundary) are expanded in the Phase 6 pass; this file
already carries the authoritative folder taxonomy.

## The app in one breath

A Next.js (App Router) app with three surfaces — **calendar**, **library**, and
**print** — plus a shared **sidebar rail**. Signed-in users sync to Neon cloud
storage with an offline outbox; anonymous users persist to localStorage. Auth is
Clerk (middleware in `proxy.ts`). The app entry is `components/CampApp.tsx`.

## `app/` — routes, middleware, styles

- Route tree under `app/**` (pages, layouts, `api/**/route.ts`). `app/layout.tsx`
  is the root layout and the single place stylesheets are imported (in cascade
  order — see below).
- `proxy.ts` (repo root) is the Clerk middleware (matcher-gated).

## `components/` — grouped by domain

| Folder | Holds |
| --- | --- |
| `CampApp.tsx` (root) | the app entry — stable, obvious location |
| `activity/` | the activity + run-sheet + playbook surface: ActivityRunList, RunSheetBody/View, ActivityPlaybook, PlaybookEditor, Diagram\*, DetailSheet, ActivityCell, ActivityBookPrint, RunShareButton |
| `library/` | the library surface: LibraryTab, LibraryViews, Filters, ThemeField, shelfLayout |
| `materials/` | KitModal, MaterialsTab, StockDot |
| `camps/` | CampEditorPopup, CampsRail |
| `auth/` | Clerk wiring + auth UI: ClerkAuthProvider, AuthControls/Complete/Unavailable, ProfileControl, StaffSignIn, InviteSignUp, SsoCallback, AdminInviteCodes |
| `calendar/` | the calendar surface (FullCalendar shell, QuickAdd, weather, etc.) |
| `print/` | the print surface (Paged.js document + controls) |
| `floating/` | the portaled floating-controls engine (Select, DatePopover, ContextMenu, ColorField, FloatingLayer) |
| `ui/` | shared primitives: Modal, ConfirmDialog, Disclosure, FocusSheet, PropRow, TabBoundary, ListManagerModal, icons, primitives, ageUnit |
| `hooks/` | shared React hooks: useActivityLibrary, useCamps, useDeviceShape, useDialogFocus |

## `lib/` — grouped by domain

| Folder | Holds |
| --- | --- |
| `activity/` | activityCatalog, activityFilters, activityForm, activityValidation, alternates, embed, playbooks, playbookEditorKeyboard, runList, runListResolve |
| `cloud/` | the storage + sync layer: store (localStorage), cloudStore, cloudOutbox, cloudMigration, storageScope, userDataDocs |
| `content/` | the data layer: data, themes, locations, camps, color |
| `materials/` | materialCatalog, materials, kitStock |
| `calendar/` | calendar domain logic (recurrence, time, views, weather placement, …) |
| `print/` | print domain logic (options, timeline) |
| `server/` | server-only helpers (inviteCodes, userData, calendarFeeds) |
| `seed/` | built-in library seed generation |
| root | cross-cutting: `auth.ts` (Clerk usability + roles), `types.ts` (shared types), `weather.ts` (Open-Meteo fetch) |

`tools/camp-mcp/` is a **separate** headless MCP tool (own `package.json` +
`tsconfig`) that reaches into the main `lib/` via the `@/` alias; it is not part
of the Next build but its tests run in the suite.

## CSS — layers in cascade order

Imported by `app/layout.tsx` in this exact order (order **is** the cascade):

```
tokens → base → shell → components → responsive → animations →
run-sheet → motion → floating → print → calendar → sidebar
```

`sidebar.css` loads last by design (its selection + popup rules intentionally
win). Add a rule to the file that owns its surface; never stack a later override
to counteract an earlier rule — change the base rule instead. Every color / space
/ radius / shadow / size is a token, enforced by `npm run lint:design-tokens`.
The `npm run lint:css-hygiene` gate blocks new `!important` and new duplicate
selectors.

## Detectors & gates (dev-only)

`npm run` — `typecheck`, `test`, `build`, `lint:design-tokens`, `lint:css-hygiene`;
report-only: `report:deadcode` (knip), `report:deps` (depcheck), `report:exports`
(ts-prune), `report:css`. See `docs/cleanup-notes.md` for the cleanup effort's
running notes.
