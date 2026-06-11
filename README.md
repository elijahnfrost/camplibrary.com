# Camp Library

A warm, hand-drawn catalog of camp **games, crafts, songs, water games, and quiet-time
activities** — paired with a **Google-Calendar-style calendar** for planning the camp
week. Two surfaces, one loop: find an activity in the Library, put it on the Calendar,
then open its Run List and present it to the whole camp from a phone on a projector.
Built mobile-first and scaled deliberately for tablet and desktop.

Live target: **Vercel**. Authentication is backed by **Clerk** with Google sign-in,
email/password accounts, email verification, and password reset. New account creation is
gated by usage-limited invite codes stored in Postgres. Signed-in users get **cloud sync**:
calendar events and library customizations persist to Postgres and follow the account
across devices.

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **FullCalendar 6** (day/week/month time grids, drag & drop, external drag sources),
  themed onto the design system in `app/calendar.css`
- **next/font** for the three handwriting faces (Caveat, Patrick Hand, Patrick Hand SC)
- Plain CSS design system in `app/globals.css` — no UI framework, faithful to the design
- Clerk auth + Neon/Postgres: invite codes, per-user documents, calendar events

## Getting started

```bash
npm install
npm run dev        # http://localhost:3000
```

Other scripts:

```bash
npm run build              # production build (statically prerenders /)
npm run start              # serve the production build
npm run typecheck          # tsc --noEmit
npm run test               # vitest
npm run lint:design-tokens # CSS token-scale guardrail
npm run env:check          # verify required auth/invite env
```

Without env vars the app runs in local mode: full browsing, with all data in
`localStorage` and staff actions prompting sign-in.

## The two surfaces

**Calendar** (default tab) — a real calendar with Day, Week, and Month views and
Google Calendar behavior: drag an event to move it, drag its bottom edge to resize,
drag across empty slots to create, click an event for a quick-view card (Open Run
List · Edit · Delete), red now-line, 15-minute snapping, `t/d/w/m/←/→` keyboard
shortcuts. Activities drag in from a library side rail on desktop; on phones a FAB
opens a bottom-sheet library where one tap places an activity at the next free slot.

**Library** — Shelf · Deck · Catalog views over the activity catalog, with search
(titles, steps, materials), filters (type / place / ages / available kit / starred),
and an in-place add/edit sheet for custom activities.

**The Run List** — opening any activity (from either surface) shows its instruction
document: collapsible steps with attached notes, safety calls, variations, videos,
materials checklists, and editable field diagrams. It opens read-only (safe to
project); a pencil toggle enables editing — Enter splits a step, Backspace on an
empty step joins back, destructive removals get an Undo toast. **Present** runs it
as a full-screen deck: tap to advance, diagram stages build one tap at a time, the
screen stays awake.

## Auth, sync, and the backend boundary

Public visitors can browse the library and plan on-device. Staff-only actions —
saving, rating, adding custom activities, editing run lists, and changing the
calendar — are locked behind Clerk session state
([`components/AuthControls.tsx`](components/AuthControls.tsx)); API routes enforce the
same boundary with `requireEditorSession`.

Signed-in persistence is cloud-first with offline tolerance
([`lib/cloudStore.tsx`](lib/cloudStore.tsx)): state hydrates instantly from a
localStorage cache, one bootstrap `GET /api/user-data` pulls server truth, and every
write is optimistic — queued in a coalescing outbox
([`lib/cloudOutbox.ts`](lib/cloudOutbox.ts)) that flushes with retry/backoff and
survives reloads. Last write wins. On first sign-in after the cloud rollout, existing
localStorage data is imported once ([`lib/cloudMigration.ts`](lib/cloudMigration.ts));
rows already on the server win.

Postgres holds three kinds of data (schema ensured in code,
[`lib/server/userData.ts`](lib/server/userData.ts)):

| Table | Contents |
| --- | --- |
| `invite_codes` (+ reservations) | usage-limited staff invite keys |
| `user_documents` | per-user jsonb docs: favs, custom activities, ratings, run-list overrides, playbook overrides, view, available kit |
| `calendar_events` | row-per-event with a `(user, date)` index; payload jsonb keeps unknown client fields round-tripping |

API surface: `GET /api/user-data` (bootstrap), `PUT /api/user-data/docs/[key]`,
`POST /api/user-data/import`, `GET /api/calendar-events?from&to`,
`PUT|DELETE /api/calendar-events/[id]` (idempotent upserts by client UUID).
New API paths must be added to the `clerkMiddleware` matcher in
[`proxy.ts`](proxy.ts).

New accounts must enter an invite code. Generate one with:

```bash
npm run invite:create -- --label "Staff name" --email staff@example.com --max-uses 1
```

Once signed in as the admin, the app shows an Admin tab where invite codes can be
generated, reviewed, and removed without the CLI. `/admin` remains an admin-protected
deep link into the same app shell.

## Project layout

```
app/
  layout.tsx           Root layout — fonts, metadata, manifest
  page.tsx             Renders <CampApp/>
  admin/               Admin-only invite-code dashboard
  sign-in/, sign-up/   Clerk auth (invite-code gated sign-up)
  api/invite-codes/    Invite code admin/reserve/consume routes
  api/user-data/       Synced per-user documents (bootstrap, put, import)
  api/calendar-events/ Calendar event range reads + idempotent upserts
  globals.css          Design system: mobile-first + the large-screen layer
  calendar.css         FullCalendar themed onto the design tokens
components/
  CampApp.tsx          The shell: tabs, auth, overlays
  LibraryTab.tsx       Library surface (views, search, filters bar, Add)
  useActivityLibrary.ts Activity-domain state over the cloud store
  LibraryViews.tsx     Shelf · Deck · Catalog
  calendar/            CalendarShell, header, event editor/popover, library panel
  DetailSheet.tsx      Activity viewer (read-only first, pencil to edit)
  ActivityRunList.tsx  The Run List document (view + inline editor)
  PresentMode.tsx      Full-screen projector deck (wake-lock, frame builds)
  DiagramLightbox.tsx  One-frame-at-a-time field diagram viewer
  PlaybookEditor.tsx   Field diagram editor
  ActivityBookPrint.tsx Print layout for one activity book
lib/
  data.ts              Seed activities + display helpers
  calendar/            Event model, date/time math, FullCalendar adapter
  cloudStore.tsx       Synced state: cache-first reads, optimistic writes
  cloudOutbox.ts       Coalescing offline write queue
  cloudMigration.ts    One-time localStorage → cloud import
  userDataDocs.ts      Isomorphic doc validators (client + API)
  presentSlides.ts     Run List → slide deck mapping
  runList.ts           Instruction document model
  playbooks.ts         Field diagram model
  server/              Clerk session helpers, Postgres stores
  store.ts             Plain localStorage hook (anon mode + UI prefs)
public/
  icon.svg, manifest.webmanifest
```

## Responsive design

The phone layout is the source of truth. Rather than stretching it, the layout switches
at `768px` to a contained "desk" card on a textured stage: bottom tab bar → left sidebar,
the activity grid goes fluid (`auto-fill minmax`), reading-heavy views get comfortable
max-widths, and the bottom-sheet overlays become centered modal cards.

---

*The original Claude Design HTML/CSS/JS prototype that this app was built from has been
ported in full and removed from the repo; it remains in git history at the initial commit.*
