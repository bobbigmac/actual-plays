# actualplay-hub (Next.js + Prisma + Auth.js + RSS + per-episode comments)

## Run locally

```bash
cp .env.example .env
npm install
npm run db:migrate
npm run dev
```

## Deploy on CapRover

- Use this repo as the source (Dockerfile deploy).
- Add a Postgres app, set `DATABASE_URL`.
- Set `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, and OAuth creds if you want them.
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

