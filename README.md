# actualplay-hub (Next.js + Prisma + Clerk + RSS + per-episode comments)

## Run locally

```bash
cp .env.example .env
npm install
npx prisma generate

npm run db:migrate
npm run db:seed
npm run dev
```

## Database options

You need a Postgres database for shows/episodes/comments. Docker is optional.

### CapRover Postgres (recommended)

- Create a one-click Postgres app in CapRover
- Copy its connection string into this app’s `DATABASE_URL`
- Deploy this repo; the container runs `npx prisma migrate deploy` on start

### Local Postgres (no Docker)

- Install Postgres for your OS
- Set `DATABASE_URL` in `.env` (example in `.env.example`)
- Run `npm run db:migrate && npm run db:seed`

### Project-local Postgres via Docker (optional)

If you do have Docker:

```bash
npm run db:up:docker
npm run db:wait:docker
```

## Deploy on CapRover

- Use this repo as the source (Dockerfile deploy).
- Add a Postgres app, set `DATABASE_URL`.
- Set Clerk env vars (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`).
- Optional: set `CRON_SECRET` to protect RSS sync endpoint.

## RSS sync

- `POST /api/shows/:id/sync`
- If `CRON_SECRET` is set, include header: `x-cron-secret: <value>`

Example:

```bash
curl -X POST "https://yourdomain/api/shows/<showId>/sync?limit=200" \
  -H "x-cron-secret: $CRON_SECRET"
```

## Create a show (admin)

- `POST /api/shows` with JSON:

```json
{ "title":"...", "slug":"...", "rssUrl":"...", "tags":["..."], "siteUrl":"..." }
```

Requires your email in `ADMIN_EMAILS` and being signed in.
