# Camp Library

A warm, hand-drawn catalog of camp **games, crafts, songs, water games, and quiet-time
activities** — with a day planner, saved shortlist, and a form for cataloging your own.
Built mobile-first and scaled deliberately for tablet and desktop.

Live target: **Vercel**. Authentication is backed by **Clerk** with Google sign-in,
email/password accounts, email verification, and password reset. New account creation is
gated by usage-limited invite codes stored in Postgres.

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **next/font** for the three handwriting faces (Caveat, Patrick Hand, Patrick Hand SC)
- Plain CSS design system in `app/globals.css` — no UI framework, faithful to the design
- Clerk auth + Postgres-backed usage-limited invite codes
- App content persistence still uses `localStorage` pending the shared backend

## Getting started

```bash
npm install
npm run dev        # http://localhost:3000
```

Other scripts:

```bash
npm run build      # production build (statically prerenders /)
npm run start      # serve the production build
npm run typecheck  # tsc --noEmit
npm run env:check  # verify required auth/invite env
```

## Deploying to Vercel

Push to GitHub and import the repo in Vercel. It auto-detects Next.js — no configuration
needed. Configure the env vars in `.env.example`, then enable Google, email/password,
email verification, and password reset in the Clerk Dashboard.

## Auth and backend boundary

Public visitors can browse the library and schedule. Staff-only actions — saving,
rating, adding custom activities, and changing the schedule — are locked behind Clerk
session state in [`components/AuthControls.tsx`](components/AuthControls.tsx).

New accounts must enter an invite code. Generate one with:

```bash
npm run invite:create -- --label "Staff name" --email staff@example.com --max-uses 1
```

Once signed in as `contact@elijahfrost.com`, the app shows an Admin tab where invite
codes can be generated, reviewed, and removed without using the CLI. `/admin` remains
an admin-protected deep link into the same app shell.

The code is shown once, stored hashed, reserved during sign-up, and consumed after the
Clerk account is created. Usage count is tracked in Postgres, and a key is deactivated
once it reaches its max-use limit. Google sign-up and email/password sign-up both use
the same code gate.

Every app preference — favorites, schedules, custom entries, ratings, and the chosen view
— still lives in `localStorage`, isolated behind [`lib/store.ts`](lib/store.ts). When the
shared backend lands, protect mutation routes with `requireEditorSession`, then replace
the `useLocalStorage` implementation with API-backed persistence.

## Project layout

```
app/
  layout.tsx        Root layout — fonts, metadata, manifest
  page.tsx          Renders <CampApp/>
  admin/            Admin-only invite-code dashboard
  sign-in/          Clerk sign-in, password reset, Google login
  sign-up/          Invite-code gated account creation
  api/invite-codes/ Usage-limited invite code admin/reserve/consume routes
  globals.css       Design system: mobile-first + the large-screen layer
components/
  CampApp.tsx       State + the responsive shell (sidebar / tab bar / overlays)
  LibraryViews.tsx  Shelf · Deck · Catalog
  ScheduleOverview.tsx  Run Sheet week preview
  CalendarView.tsx  Planner calendar (drag/resize events, add-event composer)
  SavedView.tsx     Starred shortlist
  AddView.tsx       Catalog-an-entry form
  DetailSheet.tsx   Activity detail (bottom sheet → centered modal)
  Modal.tsx         Responsive overlay wrapper (Esc / scrim close)
  primitives.tsx    StarButton, meters, Seg, Block, keyboard-clickable helper, …
  icons.tsx         Hand-drawn icon set
lib/
  auth.ts           Shared auth/session types for UI and future server enforcement
  data.ts           Seed activities + display helpers
  scheduleTime.ts   Camp-clock ↔ minutes helpers for the planner calendar
  server/auth.ts    Clerk-backed server session helpers
  server/inviteCodes.ts  Postgres invite-code store
  store.ts          localStorage persistence (the Cloudflare swap point)
  types.ts          Domain types
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
