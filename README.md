# actualplay-hub (Next.js + Prisma + Clerk + RSS + per-episode comments)

Thin “hub/wiki” for actual play shows and episodes:

- Curate shows (RSS URLs + tags) and render episode lists
- Fetch episode metadata from RSS (no media caching/hosting)
- Per-episode comment threads with replies, backed by Postgres
- Clerk auth for easy cross-platform sign-in

## Run locally

```bash
cp .env.example .env
npm install
npm run dev
```

`npm run dev` will:

- Start docker-compose Postgres (on an available local port) and set `DATABASE_URL`
- Run `prisma generate`, migrations, and seed

If you don’t use Docker locally, set `DATABASE_URL` in `.env` to a real Postgres (CapRover/hosted/local install).

## Clerk auth

1. Create a Clerk application
2. In `.env` / CapRover app env, set:
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
   - `CLERK_SECRET_KEY`
   - `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/signin`
   - `NEXT_PUBLIC_CLERK_SIGN_UP_URL=/signup`
   - `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/shows`
   - `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/shows`

Pages are wired at `/signin` and `/signup`.

## Admin + approvals

- The first signed-in user becomes admin (stored in the local `User` table).
- New shows are created with `unapproved=true` until an admin approves them.
- Admins can approve shows from the show page and run RSS sync.
- You can also allow specific admins via `ADMIN_EMAILS` (comma-separated).

## CapRover Postgres

- Create a one-click Postgres app in CapRover
- Put its connection string into this app’s `DATABASE_URL`
- Deploy this repo; the container runs `npx prisma migrate deploy` on start (`Dockerfile`)

## Deploy on CapRover

- Deploy this repo (Dockerfile deploy)
- Set `DATABASE_URL` (CapRover Postgres)
- Set Clerk env vars (above)
- Optional: set `CRON_SECRET` to protect RSS sync endpoint

## RSS sync

- `POST /api/shows/:id/sync`
- If `CRON_SECRET` is set, include header: `x-cron-secret: <value>`

Example:

```bash
curl -X POST "https://yourdomain/api/shows/<showId>/sync?limit=200" \
  -H "x-cron-secret: $CRON_SECRET"
```

## Submit a show

- Use the UI on `/shows` (signed-in), or `POST /api/shows` with JSON:

```json
{ "title":"...", "slug":"...", "rssUrl":"...", "tags":["..."], "siteUrl":"..." }
```

New shows are created with `unapproved=true` until an admin approves them.

## TODO (basic live prototype)

- Deployment: CapRover app + Postgres app + Clerk env vars + `CRON_SECRET`
- RSS: add a CapRover cron/schedule to call `/api/shows/:id/sync` for approved shows
- Moderation: add “report comment” + admin review/delete; basic per-user/IP rate limits on comments and show submissions
- Content: add minimal “About” page and “Community links” page (static/markdown), plus a front-page intro
- Search: basic tag browsing UX + show sorting (recently updated, most discussed)
- SEO: `robots.txt`, sitemap, OpenGraph meta for show/episode pages
- Observability: request logging + error reporting (Sentry or similar) and a simple uptime check route
- Safety: input sanitization policy for comments + profanity/spam mitigation plan

## Code map (`src/`)

- Pages: `src/app/shows/page.tsx`, `src/app/shows/[id]/page.tsx`, `src/app/episodes/[id]/page.tsx`, `src/app/signin/page.tsx`, `src/app/signup/page.tsx`
- API routes: `src/app/api/shows/route.ts`, `src/app/api/shows/[id]/sync/route.ts`, `src/app/api/shows/[id]/approve/route.ts`, `src/app/api/episodes/[id]/comments/route.ts`, `src/app/api/comments/[id]/route.ts`
- Layout/styling: `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`
- Components: `src/components/AuthButtons.tsx`, `src/components/NewShowForm.tsx`, `src/components/Comments.tsx`
- Lib: `src/lib/prisma.ts`, `src/lib/rss.ts`, `src/lib/admin.ts`
