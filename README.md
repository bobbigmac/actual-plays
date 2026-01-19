# actualplay-hub (Next.js + Prisma + Clerk + RSS + per-episode comments)

## Run locally

```bash
cp .env.example .env
npm install
npm run dev
```

`npm run dev` will:

- Start docker-compose Postgres (on an available local port)
- Set `DATABASE_URL` automatically for dev
- Start Postgres via Docker if available
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
