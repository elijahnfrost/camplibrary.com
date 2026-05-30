# Camp Library

A warm, hand-drawn catalog of camp **games, crafts, songs, water games, and quiet-time
activities** — with a day planner, saved shortlist, and a form for cataloging your own.
Built mobile-first and scaled deliberately for tablet and desktop.

Live target: **Vercel** (static, zero-config). The backend is intentionally **not built
yet** — it will be added later on **Cloudflare**. Today the app is fully client-side.

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **next/font** for the three handwriting faces (Caveat, Patrick Hand, Patrick Hand SC)
- Plain CSS design system in `app/globals.css` — no UI framework, faithful to the design
- Persistence via `localStorage` (see the *backend boundary* below)

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
```

## Deploying to Vercel

Push to GitHub and import the repo in Vercel. It auto-detects Next.js — no configuration
needed. The single route `/` is statically prerendered, so it serves from the edge.

## Backend boundary (Cloudflare, later)

There is **no server code** in this repo by design. Every preference — favorites,
schedules, custom entries, ratings, and the chosen view — lives in `localStorage`,
isolated behind one module: [`lib/store.ts`](lib/store.ts).

When the Cloudflare backend lands (e.g. Workers + KV/D1 for synced libraries and shared
schedules), that file is the only swap point: keep the `useLocalStorage` signature, back
it with a `fetch` to the Worker, and the rest of the app is unchanged.

## Project layout

```
app/
  layout.tsx        Root layout — fonts, metadata, manifest
  page.tsx          Renders <CampApp/>
  globals.css       Design system: mobile-first + the large-screen layer
components/
  CampApp.tsx       State + the responsive shell (sidebar / tab bar / overlays)
  LibraryViews.tsx  Shelf · Deck · Catalog
  ScheduleView.tsx  Day planner
  SavedView.tsx     Starred shortlist
  AddView.tsx       Catalog-an-entry form
  DetailSheet.tsx   Activity detail (bottom sheet → centered modal)
  ActivityPicker.tsx  Fill a schedule slot
  Modal.tsx         Responsive overlay wrapper (Esc / scrim close)
  primitives.tsx    StarButton, meters, Seg, Block, keyboard-clickable helper, …
  icons.tsx         Hand-drawn icon set
lib/
  data.ts           Seed activities + display helpers
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
