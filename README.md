# actualplay-hub (Next.js + Prisma + Clerk + RSS + per-episode comments)

## Run locally

```bash
cp .env.example .env
npm install
npx prisma generate

# Project-local Postgres (requires Docker)
npm run db:up
npm run db:wait

# Ensure `.env` contains:
# DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/actualplay?schema=public

npm run db:migrate
npm run db:seed
npm run dev
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
