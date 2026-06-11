# Backend Notes

> Historical context: this file originally scoped the "future shared backend" while all
> app data lived in `localStorage`. That backend has since been built — per-user cloud
> persistence ships in `lib/server/userData.ts` + `app/api/user-data/*` +
> `app/api/calendar-events/*`, with the client sync layer in `lib/cloudStore.tsx`.
> This document now records the deployment contract and what was decided.

## Current State

- Vercel CLI is installed and authenticated as `contact-6270`.
- The workspace is linked to the Vercel project `camplibrary-com` under `elijah-frosts-projects`.
- Production/preview env vars are configured in Vercel for Clerk, app secrets, and Neon.
- Vercel-managed Neon is connected as `camp-library`. Verify `DATABASE_URL` points at
  the **pooled** Neon endpoint (`...-pooler...`); `lib/server/db.ts` runs with
  `prepare: false` and a small per-lambda pool, which is pooler-safe.
- Clerk is wired through `proxy.ts`, `ClerkProvider`, `/sign-in`, `/sign-up`, and
  `lib/server/auth.ts`. New accounts require an active invite code from `invite_codes`.

## Decisions Made

- **Persistence backend:** Vercel/Neon Postgres owned by the Next.js app. The
  Cloudflare Workers + D1/KV path was dropped; the `CLOUDFLARE_*` /
  `CAMP_LIBRARY_API_*` env keys remain reserved but unused.
- **Multi-user scope:** personal libraries only, one user per account. No camp/team
  sharing, no realtime. Last-write-wins per document / per event.
- **Anonymous users:** keep working entirely in `localStorage` (`camp:anon:*`); cloud
  sync is a perk of the signed-in session. No anon→account merge.
- **Schema style:** ensured in code (`CREATE TABLE IF NOT EXISTS` on first use),
  matching the invite-code store. No migration framework.

## Schema (ensured by `lib/server/userData.ts`)

- `user_documents (clerk_user_id, doc_key, doc jsonb, created_at, updated_at,
  PK (clerk_user_id, doc_key))` — one row per synced localStorage key:
  `favs`, `extra`, `ratings`, `runLists`, `playbookOverrides`, `view`,
  `availableMaterials`. Values are validated server-side by the same normalizers the
  client uses (`lib/userDataDocs.ts`).
- `calendar_events (id uuid PK, clerk_user_id, event_date date, start_min, end_min,
  title, activity_id, kind, payload jsonb, timestamps)` with an index on
  `(clerk_user_id, event_date)`. The full client event object round-trips through
  `payload`; canonical columns win on read.

## API Surface (live)

- `GET /api/health`, `GET /api/auth/status`, `GET /api/auth/session` — diagnostics.
- `/admin` — admin-only deep link into the app-shell Admin tab.
- `GET|POST /api/invite-codes`, `POST /api/invite-codes/reserve|complete|release`,
  `DELETE /api/invite-codes/[id]`, `POST /api/webhooks/clerk` — invite lifecycle.
- `GET /api/user-data` — bootstrap: all docs + all events for the session user.
- `PUT /api/user-data/docs/[key]` — upsert one document (2 MB limit).
- `POST /api/user-data/import` — one-time localStorage import; existing rows win.
- `GET /api/calendar-events?from&to` — date-range reads.
- `PUT /api/calendar-events/[id]` — idempotent upsert by client UUID (the offline
  retry story depends on replays being harmless); ownership-guarded.
- `DELETE /api/calendar-events/[id]` — idempotent delete.

All mutation/read routes for user data are gated by `requireEditorSession` and return
503 when `DATABASE_URL` is unconfigured (the client then runs in local mode).
**Any new API path must be added to the `clerkMiddleware` matcher in `proxy.ts`** —
Clerk's `auth()` throws on routes the middleware did not process.

## Environment Contract

Use `.env.example` as the source of truth for local and Vercel env setup.

Required: `AUTH_SECRET`, `DATABASE_URL`, `INVITE_CODE_SECRET`,
`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`.

Optional: `NEXT_PUBLIC_APP_URL`, `CLERK_WEBHOOK_SECRET`, `INVITE_CODE_ADMIN_TOKEN`
(plus the reserved, unused `CAMP_LIBRARY_API_*` / `CLOUDFLARE_*` keys).

Never place secrets in `NEXT_PUBLIC_*` variables. Those values are bundled for the browser.

```bash
vercel env pull .env.local --yes
npm run env:check
```

## Verification

```bash
npm run env:check
npm run typecheck
npm run test
npm run build
```

End-to-end sync check after deploy: sign in on one device, confirm the one-time
localStorage import (marker `camp:user:<id>:cloudMigrated.v1`), make a calendar edit,
and confirm it appears on a second device after reload. Offline edits queue in
`camp:user:<id>:outbox.v1` and flush on reconnect.
