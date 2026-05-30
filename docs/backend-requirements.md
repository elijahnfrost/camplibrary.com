# Backend Requirements

This project is currently a Next.js app with Clerk authentication and Postgres-backed
usage-limited invite codes. The existing app-data persistence boundary is `lib/store.ts`,
which keeps favorites, schedules, custom entries, ratings, and the selected view in
`localStorage`. Backend work should preserve that frontend boundary until the UI is
intentionally rewired.

## Current State

- Vercel CLI is installed and authenticated as `contact-6270`.
- The workspace is linked to the Vercel project `camplibrary-com` under `elijah-frosts-projects`.
- Production/preview env vars are configured in Vercel for Clerk, app secrets, and Neon.
- Vercel-managed Neon is connected as `camp-library`.
- Clerk is wired through `proxy.ts`, `ClerkProvider`, `/sign-in`, `/sign-up`, and
  `lib/server/auth.ts`.
- New accounts require an active invite code from `invite_codes`.

## Required Decisions

1. Vercel project name and owning team.
2. Clerk Dashboard configuration:
   - Google OAuth, email/password, email verification, and password reset are configured.
   - Optional: add `/api/webhooks/clerk` as a `user.created` webhook and set `CLERK_WEBHOOK_SECRET`.
3. App-data persistence backend:
   - Vercel/Neon Postgres for relational data owned by the Next.js app.
   - Cloudflare Workers with D1/KV for the backend path already described in the README.
4. Multi-user scope:
   - Personal libraries only.
   - Shared camp/team libraries.
   - Invite or role model for counselors/admins.

## Environment Contract

Use `.env.example` as the source of truth for local and Vercel env setup.

Required:

- `AUTH_SECRET`
- `DATABASE_URL`
- `INVITE_CODE_SECRET`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`

Optional provider and infrastructure keys:

- `NEXT_PUBLIC_APP_URL`
- `CLERK_WEBHOOK_SECRET`
- `INVITE_CODE_ADMIN_TOKEN`
- `CAMP_LIBRARY_API_URL`
- `CAMP_LIBRARY_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_D1_DATABASE_ID`
- `CLOUDFLARE_API_TOKEN`

Never place secrets in `NEXT_PUBLIC_*` variables. Those values are bundled for the browser.

## Vercel Setup

The project is already linked in this workspace. If relinking is needed:

```bash
vercel link --yes --project camplibrary-com
```

Generate and store `AUTH_SECRET` without printing the value in logs:

```bash
AUTH_SECRET="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))")"
printf "%s" "$AUTH_SECRET" | vercel env add AUTH_SECRET development preview production
unset AUTH_SECRET
vercel env pull .env.local --yes
```

After adding provider keys or backend resources in Vercel, refresh local envs:

```bash
vercel env pull .env.local --yes
npm run env:check
```

## API Surface Needed

- `GET /api/health`: readiness and deployment diagnostics. Added in this setup.
- Auth/session endpoint or middleware once the provider is selected.
- `GET /api/auth/status`: reports Clerk/invite readiness and current session.
- `GET /api/auth/session`: reports the current app session projection.
- `/admin`: admin-only deep link into the app-shell Admin tab for `contact@elijahfrost.com`.
- `GET /api/invite-codes`: lists invite codes for the signed-in admin or `INVITE_CODE_ADMIN_TOKEN`.
- `POST /api/invite-codes`: creates a usage-limited code for the signed-in admin or `INVITE_CODE_ADMIN_TOKEN`.
- `POST /api/invite-codes/reserve`: reserves a valid code for sign-up.
- `POST /api/invite-codes/complete`: consumes a reserved code after account creation.
- `POST /api/webhooks/clerk`: consumes invite codes from Clerk `user.created` events.
- Activities read API for seeded and custom activities.
- Favorites/saved items API.
- Schedule API keyed by user and camp/team scope.
- Ratings API with per-user history.
- Import/export endpoints for migrating localStorage data.
- Optional webhook endpoint for Clerk `user.created` events.

## Data Model Needed

- User identity and provider account mapping.
- Camp/team or household scope.
- Activity catalog records, including seeded vs custom records.
- Favorite/saved activity joins.
- Schedule days and slots.
- Ratings and run history.
- Optional audit metadata for shared libraries.

## Verification

Run these checks after envs are available:

```bash
npm run env:check
npm run typecheck
npm run build
```

Do not run database migrations or seed scripts until the Vercel project is linked and
the required environment variables are verified.
