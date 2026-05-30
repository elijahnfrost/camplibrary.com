# Backend Requirements

This project is currently a static Next.js app. The existing persistence boundary is
`lib/store.ts`, which keeps favorites, schedules, custom entries, ratings, and the
selected view in `localStorage`. Backend work should preserve that frontend boundary
until the UI is intentionally rewired.

## Current State

- Vercel CLI is installed and authenticated as `contact-6270`.
- The workspace is not linked to a Vercel project.
- The authenticated Vercel team is `elijah-frosts-projects`.
- No Vercel projects currently exist under that team.
- No `.env.local`, `.env.example`, middleware, database schema, or auth provider was present before this setup.

## Required Decisions

1. Vercel project name and owning team.
2. Auth provider:
   - Clerk is the lowest-friction Vercel option when UI auth is allowed.
   - Auth.js is a good fit if auth should remain provider-portable.
   - A Cloudflare-native session service is viable if the backend must live entirely behind Workers.
3. Persistence backend:
   - Vercel/Neon Postgres for relational data owned by the Next.js app.
   - Cloudflare Workers with D1/KV for the backend path already described in the README.
4. Multi-user scope:
   - Personal libraries only.
   - Shared camp/team libraries.
   - Invite or role model for counselors/admins.

## Environment Contract

Use `.env.example` as the source of truth for local and Vercel env setup.

Required before server-side auth/session signing:

- `AUTH_SECRET`

Optional provider and infrastructure keys:

- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `CLERK_WEBHOOK_SECRET`
- `DATABASE_URL`
- `CAMP_LIBRARY_API_URL`
- `CAMP_LIBRARY_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_D1_DATABASE_ID`
- `CLOUDFLARE_API_TOKEN`

Never place secrets in `NEXT_PUBLIC_*` variables. Those values are bundled for the browser.

## Vercel Setup

Create or import the project in Vercel, then link this workspace:

```bash
vercel link --yes --scope elijah-frosts-projects --project <project-name>
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
- Activities read API for seeded and custom activities.
- Favorites/saved items API.
- Schedule API keyed by user and camp/team scope.
- Ratings API with per-user history.
- Import/export endpoints for migrating localStorage data.
- Webhook endpoint if Clerk or another auth provider is selected.

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
