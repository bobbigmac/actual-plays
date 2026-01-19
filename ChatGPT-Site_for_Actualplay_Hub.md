# Site for Actualplay Hub

#### You:
I want to make a site that is a thin wiki for listing actualplay podcasts and videos, as well as some community links, but crucially, I want to add a per episode comment system, where people can signup (easy signup good for cross platform) and add comments and discussion on episodes. It will be based on caprover, with as little tech as necessary to get it running. I want near-zero complexity, for a community site that has basic search/filter services for included actualplays (and related) and basic user support for comments and comment replies (we will proabbly include timestamps and a basic player, but depend on the remote rss for content, not caching any of it, just making it accessible on the front-end). Optional later features will include a basic (react native, most likely) listening app for android, and some basic 'profile' features to track listening for paid members, that is not a primary concern but should be facilitated so we can add paid features if it gets an audience. Our general idea is a hub for actual plays mostly focused on the fan/listener, and consuming existing hosts with low-complexity tech. My current server runs on CapRover and I prefer modern es6/nodejs based solutions that avoid bloated codebases and are sensibly structured and easy to update/maintain.



#### ChatGPT:
## Near-zero complexity stack (CapRover-friendly, ES6/Node)

**1 app + 1 DB (optional tiny worker):**

- **Web/app:** **Next.js** (Node runtime) — SSR for episode pages + server actions for comments
- **DB:** **Postgres**
- **ORM/migrations:** **Prisma**
- **Auth:** **Auth.js (NextAuth)** with **OAuth + email magic links**\
  Providers: Google + Discord (and Apple later). Magic link gives “works everywhere” signup.
- **Search/filter:** Postgres **full-text search** (+ optional `pg_trgm` for fuzzy)

This keeps it to two moving parts you already deploy easily on CapRover: a Node container + a Postgres container.

---

## Data model that stays “thin” (no media caching, just metadata)

You’re not caching audio/video, just storing:

- curated show entries
- episode metadata pulled from RSS
- comment threads
- optional user profile / paid flags later

**Core tables**

- `shows`
  - `id`, `title`, `description`, `tags[]`, `rss_url`, `site_url`, `status`, `created_at`
- `episodes`
  - `id`, `show_id`, `guid` (nullable), `identity_hash` (unique), `title`, `pub_date`, `duration`, `episode_url`, `enclosure_url`, `image_url`, `raw_rss_json` (optional)
- `users`
  - `id`, `handle`, `email`, `created_at`
- `accounts` / `sessions` (Auth.js tables)
- `comments`
  - `id`, `episode_id`, `user_id`, `parent_id` (nullable), `body`, `created_at`, `edited_at`, `deleted_at` (soft delete), `upvotes` (optional)

**Episode identity (important)**
RSS GUIDs are inconsistently present. Use:

- `identity_hash = sha256(show.rss_url + '|' + (guid || enclosure_url || title+pub_date))`
- Unique index on `identity_hash`
  This makes comments stable even if the feed shifts around a bit.

---

## RSS handling without turning into a platform

Pick one of these (both minimal):

### Option A: “Fetch-on-view + short TTL”

- When someone opens a show page:
  - fetch RSS
  - upsert episodes (only metadata)
  - cache the feed response in-memory for \~5–15 minutes (or Postgres table with `fetched_at`)
- Pros: no worker
- Cons: first view can be slower, and popular shows hit RSS more

### Option B: tiny worker (still low complexity)

- Separate CapRover app `rss-worker` (same repo, different command)
- Runs every N minutes via CapRover cron / scheduled restart pattern
- Fetches feeds and upserts episodes
- Pros: pages always fast, RSS load controlled
- Cons: one extra container

Either way, you still never proxy/copy media; the player points to `enclosure_url`.

---

## Comments: simplest feature set that won’t implode

MVP comment features:

- thread per episode
- replies (`parent_id`)
- edit window (e.g. 10 min)
- soft delete
- basic moderation flags (optional table `comment_reports`)

Spam control (cheap + effective):

- rate limit by user + IP (simple DB counters or Redis if you already have it)
- require email verify for magic-link accounts
- optional hCaptcha only when anonymous traffic spikes

---

## Wiki / community links without building a CMS

Keep “wiki-ish” content as **Markdown in the repo**:

- `content/shows/*.md` (curated notes, listening order, cast, systems, etc.)
- `content/pages/*.md` (community links, guides)
  Next.js renders MD → pages.

Show discovery comes from DB fields + tags; markdown is “human curated” details. No admin UI required on day one—PRs to the repo are enough.

If you want non-technical editing later, bolt on a tiny admin panel for `shows` only (still just your app + DB).

---

## Search/filter (fast enough, no extra services)

In Postgres:

- store `tsvector` for `shows.title`, `shows.description`, `tags`
- maybe `episodes.title`
- add `pg_trgm` for partial/typo search if needed

Filters:

- system (5e, PF2e, BitD, etc.)
- genre/tone
- campaign status (ongoing/completed)
- media type (podcast/video)
  All are just columns/tags.

---

## Player + timestamps (later, still simple)

- Use a basic HTML5 audio player pointing at `enclosure_url`.
- For timestamps:
  - either parse timestamp strings in comments (`01:23:45`) and render as clickable seek links
  - or add `comment_markers` table (`comment_id`, `seconds`, `label`) if you want structure

No need to host anything.

---

## Paid/profile features later (don’t paint yourself into a corner)

Add these tables later without rewrites:

- `user_profiles` (bio, avatar url, prefs)
- `listening_progress` (`user_id`, `episode_id`, `position_seconds`, `updated_at`)
- `entitlements` (`user_id`, `tier`, `stripe_customer_id`, `expires_at`)

Auth.js + Postgres makes this straightforward. The mobile app can reuse the same session/auth (OAuth token exchange or magic link) and hit the same JSON endpoints.

---

## CapRover deployment layout (minimal)

**Apps**

1. `actualplay-hub-web` (Next.js Node container)
2. `actualplay-hub-db` (one-click Postgres)
3. *(optional)* `actualplay-hub-worker` (RSS updater)

**Env**

- `DATABASE_URL`
- `NEXTAUTH_URL`
- `NEXTAUTH_SECRET`
- OAuth creds for Google/Discord
- Email provider creds (Postmark/Resend/etc) for magic links

That’s it. No Kafka, no Elastic, no separate backend service, no queues unless you later want them.

---

## MVP build order that ships fast

1. **Shows + episodes pages**
   - curated shows in DB + markdown notes
   - RSS ingest (Option A or B)
2. **Auth + comments**
   - per-episode thread by `episode.identity_hash`
3. **Search + filters**
4. **Basic moderation + rate limit**
5. *(later)* listening progress + paid entitlements + mobile client

If you want, I can drop a complete repo skeleton (Next.js + Prisma schema + Auth.js config + comment endpoints + RSS upsert) that deploys directly to CapRover with a single Dockerfile.


#### You:
okay, gimme a complete repo skeleton (Next.js + Prisma schema + Auth.js config + comment endpoints + RSS upsert) that deploys directly to CapRover with a single Dockerfile. 


#### ChatGPT:
````bash
#!/usr/bin/env bash
set -euo pipefail

mkdir -p \
  src/app/api/auth/[...nextauth] \
  src/app/api/shows/[id]/sync \
  src/app/api/shows \
  src/app/api/episodes/[id]/comments \
  src/app/api/comments/[id] \
  src/app/shows/[id] \
  src/app/episodes/[id] \
  src/app/signin \
  src/components \
  src/lib \
  src/types \
  prisma/migrations/20260119000100_init

cat > package.json <<'JSON'
{
  "name": "actualplay-hub",
  "private": true,
  "version": "0.1.0",
  "type": "commonjs",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "dev": "next dev",
    "build": "prisma generate && next build",
    "start": "next start -p ${PORT:-3000} -H 0.0.0.0",
    "lint": "next lint",
    "db:generate": "prisma generate",
    "db:migrate": "prisma migrate dev",
    "db:deploy": "prisma migrate deploy",
    "db:studio": "prisma studio",
    "db:seed": "prisma db seed"
  },
  "prisma": {
    "seed": "node prisma/seed.ts"
  },
  "dependencies": {
    "@auth/prisma-adapter": "^2.10.0",
    "@prisma/client": "^7.0.0",
    "next": "^16.1.0",
    "next-auth": "beta",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "rss-parser": "^3.13.0",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/node": "^22.10.7",
    "@types/react": "^19.0.8",
    "@types/react-dom": "^19.0.3",
    "prisma": "^7.0.0",
    "typescript": "^5.7.3"
  }
}
JSON

cat > tsconfig.json <<'JSON'
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "es2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "baseUrl": ".",
    "paths": {
      "~/*": ["src/*"],
      "~auth": ["auth.ts"],
      "~auth-config": ["auth.config.ts"]
    },
    "types": ["node"]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
JSON

cat > next-env.d.ts <<'TS'
/// <reference types="next" />
/// <reference types="next/image-types/global" />

// NOTE: This file should not be edited.
TS

cat > next.config.ts <<'TS'
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prisma + other Node-y deps: keep them external to avoid bundling weirdness.
  serverExternalPackages: ["@prisma/client", "prisma"]
};

export default nextConfig;
TS

cat > .gitignore <<'TXT'
node_modules
.next
dist
.DS_Store
.env
.env.*
!.env.example
prisma/dev.db
TXT

cat > .env.example <<'ENV'
# Required
DATABASE_URL=postgresql://postgres:password@localhost:5432/actualplay?schema=public
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=change-me-super-long-random

# OAuth providers (optional but recommended)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=

# Email magic link (optional)
EMAIL_SERVER=smtp://user:pass@smtp.example.com:587
EMAIL_FROM=ActualPlay Hub <no-reply@example.com>

# Optional: protect RSS sync endpoint
CRON_SECRET=change-me

# Optional: admin gating for show creation
ADMIN_EMAILS=you@example.com,other@example.com
ENV

cat > captain-definition <<'JSON'
{
  "schemaVersion": 2,
  "dockerfilePath": "./Dockerfile"
}
JSON

cat > Dockerfile <<'DOCKER'
FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

COPY package.json ./
RUN npm install

COPY . .

RUN npm run build
RUN npm prune --omit=dev

EXPOSE 3000
CMD sh -c "npx prisma migrate deploy && npm run start"
DOCKER

cat > README.md <<'MD'
# actualplay-hub (Next.js + Prisma + Auth.js + RSS + per-episode comments)

## Run locally
```bash
cp .env.example .env
npm install
npm run db:migrate
npm run dev
````

## Deploy on CapRover

- Use this repo as the source (Dockerfile deploy).
- Add a Postgres app, set `DATABASE_URL`.
- Set `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, and OAuth creds if you want them.
- Optional: set `CRON_SECRET` to protect RSS sync endpoint.

## RSS sync

- POST `/api/shows/:id/sync`
- If `CRON_SECRET` is set, include header: `x-cron-secret: <value>`

Example:

```bash
curl -X POST "https://yourdomain/api/shows/<showId>/sync?limit=200" \
  -H "x-cron-secret: $CRON_SECRET"
```

## Create a show (admin)

- POST `/api/shows` with JSON:

```json
{ "title":"...", "slug":"...", "rssUrl":"...", "tags":["..."], "siteUrl":"..." }
```

Requires your email in `ADMIN_EMAILS` and being signed in.
MD

cat > prisma/schema.prisma <<'PRISMA'
generator client {
provider = "prisma-client-js"
}

datasource db {
provider = "postgresql"
url      = env("DATABASE\_URL")
}

enum ShowStatus {
ACTIVE
HIDDEN
ARCHIVED
}

model User {
id            String    @id @default(cuid())
name          String?
email         String?   @unique
emailVerified DateTime?
image         String?
handle        String?   @unique

accounts      Account\[]
sessions      Session\[]
comments      Comment\[]

createdAt     DateTime  @default(now())
updatedAt     DateTime  @updatedAt
}

model Account {
id                 String  @id @default(cuid())
userId             String
type               String
provider           String
providerAccountId  String

refresh\_token      String? @db.Text
access\_token       String? @db.Text
expires\_at         Int?
token\_type         String?
scope              String?
id\_token           String? @db.Text
session\_state      String?

user               User    @relation(fields: \[userId], references: \[id], onDelete: Cascade)

@@unique(\[provider, providerAccountId])
@@index(\[userId])
}

model Session {
id           String   @id @default(cuid())
sessionToken String   @unique
userId       String
expires      DateTime

user         User     @relation(fields: \[userId], references: \[id], onDelete: Cascade)

@@index(\[userId])
}

model VerificationToken {
identifier String
token      String   @unique
expires    DateTime

@@unique(\[identifier, token])
}

model Show {
id          String     @id @default(cuid())
slug        String     @unique
title       String
description String?    @db.Text
rssUrl      String     @unique
siteUrl     String?
imageUrl    String?
tags        String\[]   @default(\[])
status      ShowStatus @default(ACTIVE)

episodes    Episode\[]

createdAt   DateTime   @default(now())
updatedAt   DateTime   @updatedAt
}

model Episode {
id           String    @id @default(cuid())
showId       String
show         Show      @relation(fields: \[showId], references: \[id], onDelete: Cascade)

guid         String?
identityHash String    @unique

title        String
description  String?   @db.Text
pubDate      DateTime?
durationSeconds Int?
episodeUrl   String?
enclosureUrl String?
imageUrl     String?
rawRssJson   Json?

comments     Comment\[]

createdAt    DateTime  @default(now())
updatedAt    DateTime  @updatedAt

@@index(\[showId, pubDate])
}

model Comment {
id        String    @id @default(cuid())
episodeId String
userId    String
parentId  String?

body      String    @db.Text

editedAt  DateTime?
deletedAt DateTime?

episode   Episode   @relation(fields: \[episodeId], references: \[id], onDelete: Cascade)
user      User      @relation(fields: \[userId], references: \[id], onDelete: Cascade)

parent    Comment?  @relation("CommentThread", fields: \[parentId], references: \[id], onDelete: SetNull)
replies   Comment\[] @relation("CommentThread")

createdAt DateTime  @default(now())
updatedAt DateTime  @updatedAt

@@index(\[episodeId, createdAt])
@@index(\[parentId])
}
PRISMA

cat > prisma/migrations/migration\_lock.toml <<'TOML'

# Please do not edit this file manually

# It should be added in your version-control system (e.g. Git)

provider = "postgresql"
TOML

cat > prisma/migrations/20260119000100\_init/migration.sql <<'SQL'
\-- CreateEnum
CREATE TYPE "ShowStatus" AS ENUM ('ACTIVE', 'HIDDEN', 'ARCHIVED');

\-- CreateTable
CREATE TABLE "User" (
"id" TEXT NOT NULL,
"name" TEXT,
"email" TEXT,
"emailVerified" TIMESTAMP(3),
"image" TEXT,
"handle" TEXT,
"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT\_TIMESTAMP,
"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT\_TIMESTAMP,
CONSTRAINT "User\_pkey" PRIMARY KEY ("id")
);

\-- CreateTable
CREATE TABLE "Account" (
"id" TEXT NOT NULL,
"userId" TEXT NOT NULL,
"type" TEXT NOT NULL,
"provider" TEXT NOT NULL,
"providerAccountId" TEXT NOT NULL,
"refresh\_token" TEXT,
"access\_token" TEXT,
"expires\_at" INTEGER,
"token\_type" TEXT,
"scope" TEXT,
"id\_token" TEXT,
"session\_state" TEXT,
CONSTRAINT "Account\_pkey" PRIMARY KEY ("id")
);

\-- CreateTable
CREATE TABLE "Session" (
"id" TEXT NOT NULL,
"sessionToken" TEXT NOT NULL,
"userId" TEXT NOT NULL,
"expires" TIMESTAMP(3) NOT NULL,
CONSTRAINT "Session\_pkey" PRIMARY KEY ("id")
);

\-- CreateTable
CREATE TABLE "VerificationToken" (
"identifier" TEXT NOT NULL,
"token" TEXT NOT NULL,
"expires" TIMESTAMP(3) NOT NULL
);

\-- CreateTable
CREATE TABLE "Show" (
"id" TEXT NOT NULL,
"slug" TEXT NOT NULL,
"title" TEXT NOT NULL,
"description" TEXT,
"rssUrl" TEXT NOT NULL,
"siteUrl" TEXT,
"imageUrl" TEXT,
"tags" TEXT\[] NOT NULL DEFAULT ARRAY\[]::TEXT\[],
"status" "ShowStatus" NOT NULL DEFAULT 'ACTIVE',
"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT\_TIMESTAMP,
"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT\_TIMESTAMP,
CONSTRAINT "Show\_pkey" PRIMARY KEY ("id")
);

\-- CreateTable
CREATE TABLE "Episode" (
"id" TEXT NOT NULL,
"showId" TEXT NOT NULL,
"guid" TEXT,
"identityHash" TEXT NOT NULL,
"title" TEXT NOT NULL,
"description" TEXT,
"pubDate" TIMESTAMP(3),
"durationSeconds" INTEGER,
"episodeUrl" TEXT,
"enclosureUrl" TEXT,
"imageUrl" TEXT,
"rawRssJson" JSONB,
"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT\_TIMESTAMP,
"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT\_TIMESTAMP,
CONSTRAINT "Episode\_pkey" PRIMARY KEY ("id")
);

\-- CreateTable
CREATE TABLE "Comment" (
"id" TEXT NOT NULL,
"episodeId" TEXT NOT NULL,
"userId" TEXT NOT NULL,
"parentId" TEXT,
"body" TEXT NOT NULL,
"editedAt" TIMESTAMP(3),
"deletedAt" TIMESTAMP(3),
"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT\_TIMESTAMP,
"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT\_TIMESTAMP,
CONSTRAINT "Comment\_pkey" PRIMARY KEY ("id")
);

\-- CreateIndex
CREATE UNIQUE INDEX "User\_email\_key" ON "User"("email");
CREATE UNIQUE INDEX "User\_handle\_key" ON "User"("handle");

\-- CreateIndex
CREATE UNIQUE INDEX "Account\_provider\_providerAccountId\_key" ON "Account"("provider", "providerAccountId");
CREATE INDEX "Account\_userId\_idx" ON "Account"("userId");

\-- CreateIndex
CREATE UNIQUE INDEX "Session\_sessionToken\_key" ON "Session"("sessionToken");
CREATE INDEX "Session\_userId\_idx" ON "Session"("userId");

\-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken\_token\_key" ON "VerificationToken"("token");
CREATE UNIQUE INDEX "VerificationToken\_identifier\_token\_key" ON "VerificationToken"("identifier", "token");

\-- CreateIndex
CREATE UNIQUE INDEX "Show\_slug\_key" ON "Show"("slug");
CREATE UNIQUE INDEX "Show\_rssUrl\_key" ON "Show"("rssUrl");

\-- CreateIndex
CREATE UNIQUE INDEX "Episode\_identityHash\_key" ON "Episode"("identityHash");
CREATE INDEX "Episode\_showId\_pubDate\_idx" ON "Episode"("showId", "pubDate");

\-- CreateIndex
CREATE INDEX "Comment\_episodeId\_createdAt\_idx" ON "Comment"("episodeId", "createdAt");
CREATE INDEX "Comment\_parentId\_idx" ON "Comment"("parentId");

\-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account\_userId\_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Session" ADD CONSTRAINT "Session\_userId\_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Episode" ADD CONSTRAINT "Episode\_showId\_fkey"
FOREIGN KEY ("showId") REFERENCES "Show"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Comment" ADD CONSTRAINT "Comment\_episodeId\_fkey"
FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Comment" ADD CONSTRAINT "Comment\_userId\_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Comment" ADD CONSTRAINT "Comment\_parentId\_fkey"
FOREIGN KEY ("parentId") REFERENCES "Comment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
SQL

cat > prisma/seed.ts <<'TS'
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
const count = await prisma.show\.count();
if (count > 0) return;

await prisma.show\.create({
data: {
slug: "example-actualplay",
title: "Example Actual Play",
description: "Seeded example show. Replace me with a real RSS feed.",
rssUrl: "<https://feeds.simplecast.com/54nAGcIl>",
siteUrl: "<https://example.com>",
tags: \["ttrpg", "actualplay"]
}
});
}

main()
.then(async () => prisma.$disconnect())
.catch(async (e) => {
console.error(e);
await prisma.$disconnect();
process.exit(1);
});
TS

cat > auth.config.ts <<'TS'
import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import Discord from "next-auth/providers/discord";
import Email from "next-auth/providers/email";

const providers = \[
process.env.GOOGLE\_CLIENT\_ID && process.env.GOOGLE\_CLIENT\_SECRET
? Google({
clientId: process.env.GOOGLE\_CLIENT\_ID,
clientSecret: process.env.GOOGLE\_CLIENT\_SECRET
})
: null,
process.env.DISCORD\_CLIENT\_ID && process.env.DISCORD\_CLIENT\_SECRET
? Discord({
clientId: process.env.DISCORD\_CLIENT\_ID,
clientSecret: process.env.DISCORD\_CLIENT\_SECRET
})
: null,
process.env.EMAIL\_SERVER && process.env.EMAIL\_FROM
? Email({
server: process.env.EMAIL\_SERVER,
from: process.env.EMAIL\_FROM
})
: null
].filter(Boolean);

export default {
providers: providers as NonNullable\<NextAuthConfig\["providers"]>,
session: { strategy: "database" },
trustHost: true,
callbacks: {
async session({ session, user }) {
if (session.user) {
// @ts-expect-error augmented in src/types
session.user.id = user.id;
// @ts-expect-error augmented in src/types
session.user.handle = user.handle ?? null;
}
return session;
}
}
} satisfies NextAuthConfig;
TS

cat > auth.ts <<'TS'
import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import prisma from "\~/lib/prisma";
import authConfig from "./auth.config";

export const { handlers, auth, signIn, signOut } = NextAuth({
adapter: PrismaAdapter(prisma),
...authConfig
});
TS

cat > src/types/next-auth.d.ts <<'TS'
import "next-auth";

declare module "next-auth" {
interface Session {
user?: {
id: string;
name?: string | null;
email?: string | null;
image?: string | null;
handle?: string | null;
};
}
}
TS

cat > src/lib/prisma.ts <<'TS'
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const prisma =
globalForPrisma.prisma ??
new PrismaClient({
log:
process.env.NODE\_ENV === "production"
? \["error"]
: \["query", "info", "warn", "error"]
});

if (process.env.NODE\_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;
TS

cat > src/lib/rss.ts <<'TS'
import crypto from "node:crypto";
import Parser from "rss-parser";
import prisma from "\~/lib/prisma";

type RssItem = {
guid?: string;
id?: string;
title?: string;
link?: string;
pubDate?: string;
isoDate?: string;
content?: string;
contentSnippet?: string;
enclosure?: { url?: string; type?: string; length?: string };
itunes?: { duration?: string; image?: string };
};

function sha256(input: string) {
return crypto.createHash("sha256").update(input).digest("hex");
}

function parseDurationToSeconds(v: unknown): number | null {
if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, Math.floor(v));
if (typeof v !== "string") return null;
const s = v.trim();
if (!s) return null;

// "1234"
if (/^\d+$/.test(s)) return Math.max(0, parseInt(s, 10));

// "HH:MM:SS" or "MM:SS"
const parts = s.split(":").map((p) => p.trim());
if (parts.some((p) => !/^\d+$/.test(p))) return null;

const nums = parts.map((p) => parseInt(p, 10));
if (nums.length === 2) return nums\[0] \* 60 + nums\[1];
if (nums.length === 3) return nums\[0] \* 3600 + nums\[1] \* 60 + nums\[2];
return null;
}

export async function syncShowFromRss(showId: string, limit = 250) {
const show = await prisma.show\.findUnique({ where: { id: showId } });
if (!show) throw new Error("Show not found");

const res = await fetch(show\.rssUrl, {
headers: { "user-agent": "actualplay-hub/0.1 (+<https://example.com>)" }
});
if (!res.ok) throw new Error(`RSS fetch failed: ${res.status} ${res.statusText}`);
const xml = await res.text();

const parser = new Parser\<any, RssItem>({
customFields: {
item: \[
\["itunes:duration", "itunes:duration"],
\["itunes:image", "itunes:image"]
]
}
});

const feed = await parser.parseString(xml);
const items = (feed.items as RssItem\[] | undefined) ?? \[];
const slice = items.slice(0, Math.max(1, Math.min(limit, 2000)));

let created = 0;
let updated = 0;

for (const item of slice) {
const title = (item.title ?? "").trim();
if (!title) continue;

```
const guid = (item.guid ?? item.id ?? "").trim() || null;
const enclosureUrl = (item.enclosure?.url ?? "").trim() || null;
const episodeUrl = (item.link ?? "").trim() || null;

const pub = item.isoDate ?? item.pubDate ?? null;
const pubDate = pub ? new Date(pub) : null;
const durationSeconds = parseDurationToSeconds(item.itunes?.duration ?? null);

const identitySource =
  guid ??
  enclosureUrl ??
  episodeUrl ??
  `${title}|${pubDate?.toISOString() ?? "no-date"}`;

const identityHash = sha256(`${show.rssUrl}|${identitySource}`);

const description =
  (item.contentSnippet ?? item.content ?? "").toString().trim() || null;

const imageUrl = (item.itunes?.image ?? "").toString().trim() || show.imageUrl || null;

const existing = await prisma.episode.findUnique({ where: { identityHash } });

if (!existing) {
  await prisma.episode.create({
    data: {
      showId: show.id,
      guid,
      identityHash,
      title,
      description,
      pubDate,
      durationSeconds,
      episodeUrl,
      enclosureUrl,
      imageUrl,
      rawRssJson: item as any
    }
  });
  created++;
} else {
  await prisma.episode.update({
    where: { identityHash },
    data: {
      guid: existing.guid ?? guid,
      title,
      description,
      pubDate,
      durationSeconds,
      episodeUrl,
      enclosureUrl,
      imageUrl,
      rawRssJson: item as any
    }
  });
  updated++;
}
```

}

return { showId: show\.id, created, updated, total: slice.length };
}
TS

cat > src/app/globals.css <<'CSS'
:root { color-scheme: dark; }
html, body { padding: 0; margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; }
a { color: inherit; }
main { max-width: 1000px; margin: 0 auto; padding: 24px; }
header { display:flex; gap:12px; align-items:center; justify-content:space-between; padding: 16px 24px; border-bottom: 1px solid rgba(255,255,255,0.08); position: sticky; top: 0; background: rgba(0,0,0,0.85); backdrop-filter: blur(10px); }
nav { display:flex; gap:12px; align-items:center; }
.card { border: 1px solid rgba(255,255,255,0.10); border-radius: 14px; padding: 14px; background: rgba(255,255,255,0.03); }
.row { display:flex; gap:12px; align-items:center; justify-content:space-between; }
input, textarea { width: 100%; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); border-radius: 10px; padding: 10px; color: inherit; }
button { background: rgba(255,255,255,0.10); border: 1px solid rgba(255,255,255,0.14); border-radius: 10px; padding: 8px 12px; color: inherit; cursor:pointer; }
button:hover { background: rgba(255,255,255,0.14); }
small { opacity: 0.75; }
hr { border: 0; border-top: 1px solid rgba(255,255,255,0.10); margin: 18px 0; }
.tag { font-size: 12px; padding: 3px 8px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.14); opacity: 0.9; }
CSS

cat > src/components/Providers.tsx <<'TSX'
"use client";

import { SessionProvider } from "next-auth/react";
import type { Session } from "next-auth";

export default function Providers({
children,
session
}: {
children: React.ReactNode;
session: Session | null;
}) {
return <SessionProvider session={session}>{children}</SessionProvider>;
}
TSX

cat > src/components/AuthButtons.tsx <<'TSX'
"use client";

import { signIn, signOut, useSession } from "next-auth/react";

export default function AuthButtons() {
const { data, status } = useSession();
const user = data?.user;

if (status === "loading") return <small>…</small>;

if (!user) {
return (
\<div style={{ display: "flex", gap: 8 }}>
\<button onClick={() => signIn(undefined, { callbackUrl: "/shows" })}>Sign in</button> </div>
);
}

return (
\<div style={{ display: "flex", gap: 8, alignItems: "center" }}> <small>{user.email ?? user.name ?? "Signed in"}</small>
\<button onClick={() => signOut({ callbackUrl: "/shows" })}>Sign out</button> </div>
);
}
TSX

cat > src/components/Comments.tsx <<'TSX'
"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";

type Comment = {
id: string;
user: { id: string; name: string | null; email: string | null; handle: string | null };
parentId: string | null;
body: string;
createdAt: string;
editedAt: string | null;
deletedAt: string | null;
};

function buildTree(comments: Comment\[]) {
const byId = new Map\<string, Comment & { replies: any\[] }>();
const roots: (Comment & { replies: any\[] })\[] = \[];

for (const c of comments) byId.set(c.id, { ...c, replies: \[] });
for (const c of comments) {
const node = byId.get(c.id)!;
if (c.parentId && byId.has(c.parentId)) byId.get(c.parentId)!.replies.push(node);
else roots.push(node);
}
return roots;
}

function fmtUser(u: Comment\["user"]) {
return u.handle ?? u.name ?? u.email ?? "anon";
}

export default function Comments({ episodeId }: { episodeId: string }) {
const { data } = useSession();
const \[items, setItems] = useState\<Comment\[]>(\[]);
const \[loading, setLoading] = useState(true);
const \[err, setErr] = useState\<string | null>(null);

const \[body, setBody] = useState("");
const \[replyTo, setReplyTo] = useState\<string | null>(null);

const tree = useMemo(() => buildTree(items), \[items]);

async function load() {
setLoading(true);
setErr(null);
try {
const res = await fetch(`/api/episodes/${episodeId}/comments`, { cache: "no-store" });
const json = await res.json();
if (!res.ok) throw new Error(json?.error ?? "Failed to load comments");
setItems(json.comments);
} catch (e: any) {
setErr(e?.message ?? "Error");
} finally {
setLoading(false);
}
}

useEffect(() => {
void load();
// eslint-disable-next-line react-hooks/exhaustive-deps
}, \[episodeId]);

async function submit() {
setErr(null);
try {
const res = await fetch(`/api/episodes/${episodeId}/comments`, {
method: "POST",
headers: { "content-type": "application/json" },
body: JSON.stringify({ body, parentId: replyTo })
});
const json = await res.json();
if (res.status === 401) throw new Error("Sign in to comment");
if (!res.ok) throw new Error(json?.error ?? "Failed to post");
setBody("");
setReplyTo(null);
await load();
} catch (e: any) {
setErr(e?.message ?? "Error");
}
}

async function softDelete(id: string) {
setErr(null);
try {
const res = await fetch(`/api/comments/${id}`, { method: "DELETE" });
const json = await res.json();
if (!res.ok) throw new Error(json?.error ?? "Failed to delete");
await load();
} catch (e: any) {
setErr(e?.message ?? "Error");
}
}

async function edit(id: string, nextBody: string) {
setErr(null);
try {
const res = await fetch(`/api/comments/${id}`, {
method: "PATCH",
headers: { "content-type": "application/json" },
body: JSON.stringify({ body: nextBody })
});
const json = await res.json();
if (!res.ok) throw new Error(json?.error ?? "Failed to edit");
await load();
} catch (e: any) {
setErr(e?.message ?? "Error");
}
}

function Node({ c, depth }: { c: any; depth: number }) {
const mine = data?.user && (data.user as any).id === c.user.id;
const canEdit = mine && !c.deletedAt;

```
return (
  <div style={{ marginLeft: depth * 14, marginTop: 10 }}>
    <div className="card">
      <div className="row">
        <small>
          <b>{fmtUser(c.user)}</b> · {new Date(c.createdAt).toLocaleString()}
          {c.editedAt ? " · edited" : ""}
        </small>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={() => setReplyTo(c.id)}>Reply</button>
          {mine ? <button onClick={() => softDelete(c.id)}>Delete</button> : null}
          {canEdit ? (
            <button
              onClick={() => {
                const next = prompt("Edit comment:", c.body);
                if (next !== null) void edit(c.id, next);
              }}
            >
              Edit
            </button>
          ) : null}
        </div>
      </div>

      <div style={{ marginTop: 8, whiteSpace: "pre-wrap", opacity: c.deletedAt ? 0.6 : 1 }}>
        {c.deletedAt ? "[deleted]" : c.body}
      </div>
    </div>

    {c.replies?.length ? (
      <div style={{ marginTop: 8 }}>
        {c.replies.map((r: any) => (
          <Node key={r.id} c={r} depth={depth + 1} />
        ))}
      </div>
    ) : null}
  </div>
);
```

}

return (
\<section style={{ marginTop: 22 }}> <div className="row">
\<h3 style={{ margin: 0 }}>Comments</h3> <small>{items.length} total</small> </div>

```
  {err ? (
    <div className="card" style={{ marginTop: 12 }}>
      <b>Error:</b> {err}
    </div>
  ) : null}

  <div className="card" style={{ marginTop: 12 }}>
    <div className="row">
      <small>
        {replyTo ? (
          <>
            Replying · <button onClick={() => setReplyTo(null)}>Cancel</button>
          </>
        ) : (
          "New comment"
        )}
      </small>
      <small>{data?.user ? "Signed in" : "Not signed in"}</small>
    </div>
    <div style={{ marginTop: 10 }}>
      <textarea
        rows={4}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Say something useful…"
      />
      <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
        <button disabled={!body.trim()} onClick={() => void submit()}>
          Post
        </button>
        <button onClick={() => void load()}>Refresh</button>
      </div>
    </div>
  </div>

  <div style={{ marginTop: 14 }}>
    {loading ? <small>Loading…</small> : null}
    {!loading && tree.length === 0 ? <small>No comments yet.</small> : null}
    {!loading && tree.length ? (
      <div style={{ marginTop: 8 }}>
        {tree.map((c: any) => (
          <Node key={c.id} c={c} depth={0} />
        ))}
      </div>
    ) : null}
  </div>
</section>
```

);
}
TSX

cat > src/app/layout.tsx <<'TSX'
import "./globals.css";
import Link from "next/link";
import Providers from "~~/components/Providers";
import AuthButtons from "~~/components/AuthButtons";
import { auth } from "\~auth";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
const session = await auth();

return ( <html lang="en"> <body> <Providers session={session}> <header> <nav> <Link href="/shows"> <b>ActualPlay Hub</b> </Link> <Link href="/shows">Shows</Link> </nav> <AuthButtons /> </header> <main>{children}</main> </Providers> </body> </html>
);
}
TSX

cat > src/app/page.tsx <<'TSX'
import { redirect } from "next/navigation";

export default async function Home() {
redirect("/shows");
}
TSX

cat > src/app/shows/page.tsx <<'TSX'
import Link from "next/link";
import prisma from "\~/lib/prisma";

export default async function ShowsPage({
searchParams
}: {
searchParams: Promise<{ q?: string; tag?: string }>;
}) {
const { q, tag } = await searchParams;

const where = {
status: "ACTIVE" as const,
...(tag ? { tags: { has: tag } } : {}),
...(q
? {
OR: \[
{ title: { contains: q, mode: "insensitive" as const } },
{ description: { contains: q, mode: "insensitive" as const } },
{ slug: { contains: q, mode: "insensitive" as const } }
]
}
: {})
};

const shows = await prisma.show\.findMany({
where,
orderBy: { updatedAt: "desc" },
take: 200
});

return (
\<div style={{ display: "grid", gap: 14 }}> <div className="card">
\<form style={{ display: "grid", gap: 10 }}> <div className="row">
\<h2 style={{ margin: 0 }}>Shows</h2> <small>{shows.length} results</small> </div>
\<input
name="q"
defaultValue={q ?? ""}
placeholder="Search title/desc/slug"
autoComplete="off"
/> <div className="row">
\<input
name="tag"
defaultValue={tag ?? ""}
placeholder="Tag (optional)"
autoComplete="off"
/> <button type="submit">Search</button> </div> </form> </div>

```
  {shows.map((s) => (
    <div key={s.id} className="card">
      <div className="row">
        <div>
          <Link href={`/shows/${s.id}`}>
            <b style={{ fontSize: 18 }}>{s.title}</b>
          </Link>
          <div>
            <small>{s.slug}</small>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {s.tags.slice(0, 6).map((t) => (
            <span key={t} className="tag">
              <Link href={`/shows?tag=${encodeURIComponent(t)}`}>{t}</Link>
            </span>
          ))}
        </div>
      </div>
      {s.description ? (
        <div style={{ marginTop: 10, opacity: 0.9, whiteSpace: "pre-wrap" }}>{s.description}</div>
      ) : null}
      <div style={{ marginTop: 10 }}>
        <small>
          RSS: <a href={s.rssUrl}>{s.rssUrl}</a>
        </small>
      </div>
    </div>
  ))}
</div>
```

);
}
TSX

cat > src/app/shows/\[id]/page.tsx <<'TSX'
import Link from "next/link";
import prisma from "\~/lib/prisma";

export default async function ShowPage({ params }: { params: Promise<{ id: string }> }) {
const { id } = await params;

const show = await prisma.show\.findUnique({
where: { id },
include: {
episodes: {
orderBy: \[{ pubDate: "desc" }, { createdAt: "desc" }],
take: 200
}
}
});

if (!show) return <div className="card">Show not found.</div>;

return (
\<div style={{ display: "grid", gap: 14 }}> <div className="card"> <div className="row"> <div>
\<h2 style={{ margin: 0 }}>{show\.title}</h2> <small>{show\.slug}</small> </div>
\<div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
{show\.tags.map((t) => ( <span key={t} className="tag">
\<Link href={`/shows?tag=${encodeURIComponent(t)}`}>{t}</Link> </span>
))} </div> </div>

```
    {show.description ? <p style={{ whiteSpace: "pre-wrap" }}>{show.description}</p> : null}

    <div style={{ display: "grid", gap: 6 }}>
      <small>
        RSS: <a href={show.rssUrl}>{show.rssUrl}</a>
      </small>
      {show.siteUrl ? (
        <small>
          Site: <a href={show.siteUrl}>{show.siteUrl}</a>
        </small>
      ) : null}
    </div>

    <hr />

    <div className="row">
      <small>Sync episodes from RSS (server-side)</small>
      <form
        action={`/api/shows/${show.id}/sync`}
        method="post"
        style={{ display: "flex", gap: 8 }}
      >
        <button type="submit">Sync now</button>
      </form>
    </div>
  </div>

  <div className="card">
    <div className="row">
      <h3 style={{ margin: 0 }}>Episodes</h3>
      <small>{show.episodes.length} listed</small>
    </div>

    <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
      {show.episodes.map((e) => (
        <div key={e.id} className="card">
          <div className="row">
            <Link href={`/episodes/${e.id}`}>
              <b>{e.title}</b>
            </Link>
            <small>{e.pubDate ? new Date(e.pubDate).toLocaleDateString() : ""}</small>
          </div>
          {e.description ? (
            <div style={{ marginTop: 8, opacity: 0.85 }}>
              {e.description.slice(0, 240)}
              {e.description.length > 240 ? "…" : ""}
            </div>
          ) : null}
        </div>
      ))}
      {show.episodes.length === 0 ? <small>No episodes yet. Hit sync.</small> : null}
    </div>
  </div>
</div>
```

);
}
TSX

cat > src/app/episodes/\[id]/page.tsx <<'TSX'
import Link from "next/link";
import prisma from "~~/lib/prisma";
import Comments from "~~/components/Comments";
import { auth } from "\~auth";

function fmtTime(seconds: number | null) {
if (!seconds || seconds <= 0) return "";
const h = Math.floor(seconds / 3600);
const m = Math.floor((seconds % 3600) / 60);
const s = seconds % 60;
const pad = (n: number) => String(n).padStart(2, "0");
return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export default async function EpisodePage({ params }: { params: Promise<{ id: string }> }) {
const { id } = await params;

const episode = await prisma.episode.findUnique({
where: { id },
include: { show: true }
});

if (!episode) return <div className="card">Episode not found.</div>;

const session = await auth();

return (
\<div style={{ display: "grid", gap: 14 }}> <div className="card"> <small>
\<Link href={`/shows/${episode.showId}`}>← {episode.show\.title}</Link> </small>

```
    <h2 style={{ marginTop: 10 }}>{episode.title}</h2>

    <div className="row">
      <small>
        {episode.pubDate ? new Date(episode.pubDate).toLocaleString() : ""}
        {episode.durationSeconds ? ` · ${fmtTime(episode.durationSeconds)}` : ""}
      </small>
      <small>{session?.user ? "Signed in" : "Not signed in"}</small>
    </div>

    {episode.enclosureUrl ? (
      <div style={{ marginTop: 12 }}>
        <audio controls preload="none" style={{ width: "100%" }}>
          <source src={episode.enclosureUrl} />
        </audio>
        <small style={{ display: "block", marginTop: 8 }}>
          Media: <a href={episode.enclosureUrl}>{episode.enclosureUrl}</a>
        </small>
      </div>
    ) : (
      <small style={{ display: "block", marginTop: 12 }}>No enclosure URL found in RSS.</small>
    )}

    {episode.description ? (
      <div style={{ marginTop: 14, whiteSpace: "pre-wrap", opacity: 0.9 }}>
        {episode.description}
      </div>
    ) : null}
  </div>

  <Comments episodeId={episode.id} />
</div>
```

);
}
TSX

cat > src/app/signin/page.tsx <<'TSX'
"use client";

import { signIn } from "next-auth/react";

export default function SignInPage() {
return (
\<div className="card" style={{ maxWidth: 520 }}>
\<h2 style={{ marginTop: 0 }}>Sign in</h2>
\<p style={{ opacity: 0.85 }}>
Use OAuth (best) or email magic link (if configured). </p>

```
  <div style={{ display: "grid", gap: 10 }}>
    <button onClick={() => signIn("google", { callbackUrl: "/shows" })}>Continue with Google</button>
    <button onClick={() => signIn("discord", { callbackUrl: "/shows" })}>Continue with Discord</button>
    <button onClick={() => signIn("email", { callbackUrl: "/shows" })}>Continue with Email</button>
  </div>
</div>
```

);
}
TSX

cat > src/app/api/auth/\[...nextauth]/route.ts <<'TS'
import { handlers } from "\~auth";

export const { GET, POST } = handlers;
TS

cat > src/app/api/shows/route.ts <<'TS'
import { auth } from "~~auth";
import prisma from "~~/lib/prisma";
import { z } from "zod";

const CreateShow = z.object({
slug: z.string().min(2).max(80).regex(/^\[a-z0-9-]+$/),
title: z.string().min(1).max(200),
description: z.string().max(20000).optional(),
rssUrl: z.string().url(),
siteUrl: z.string().url().optional(),
imageUrl: z.string().url().optional(),
tags: z.array(z.string().min(1).max(40)).default(\[])
});

function isAdmin(email: string | null | undefined) {
const raw = process.env.ADMIN\_EMAILS ?? "";
const allowed = raw
.split(",")
.map((s) => s.trim().toLowerCase())
.filter(Boolean);
return !!email && allowed.includes(email.toLowerCase());
}

export async function GET() {
const shows = await prisma.show\.findMany({
where: { status: "ACTIVE" },
orderBy: { updatedAt: "desc" },
take: 500
});
return Response.json({ shows });
}

export async function POST(req: Request) {
const session = await auth();
const email = session?.user?.email ?? null;
if (!isAdmin(email)) return Response.json({ error: "Forbidden" }, { status: 403 });

const json = await req.json().catch(() => null);
const parsed = CreateShow\.safeParse(json);
if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

const show = await prisma.show\.create({ data: parsed.data });
return Response.json({ show }, { status: 201 });
}
TS

cat > src/app/api/shows/\[id]/sync/route.ts <<'TS'
import { syncShowFromRss } from "\~/lib/rss";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
const { id } = await ctx.params;

const secret = process.env.CRON\_SECRET?.trim();
if (secret) {
const got = req.headers.get("x-cron-secret")?.trim();
if (got !== secret) return Response.json({ error: "Forbidden" }, { status: 403 });
}

const url = new URL(req.url);
const limitRaw = url.searchParams.get("limit");
const limit = limitRaw ? Math.max(1, Math.min(2000, parseInt(limitRaw, 10) || 250)) : 250;

try {
const result = await syncShowFromRss(id, limit);
return Response.json(result);
} catch (e: any) {
return Response.json({ error: e?.message ?? "Sync failed" }, { status: 500 });
}
}
TS

cat > src/app/api/episodes/\[id]/comments/route.ts <<'TS'
import { auth } from "~~auth";
import prisma from "~~/lib/prisma";
import { z } from "zod";

const CreateComment = z.object({
body: z.string().min(1).max(20000),
parentId: z.string().cuid().nullable().optional()
});

export async function GET(\_req: Request, ctx: { params: Promise<{ id: string }> }) {
const { id: episodeId } = await ctx.params;

const comments = await prisma.comment.findMany({
where: { episodeId },
orderBy: { createdAt: "asc" },
include: { user: { select: { id: true, name: true, email: true, handle: true } } }
});

return Response.json({
comments: comments.map((c) => ({
id: c.id,
parentId: c.parentId,
body: c.body,
createdAt: c.createdAt.toISOString(),
editedAt: c.editedAt ? c.editedAt.toISOString() : null,
deletedAt: c.deletedAt ? c.deletedAt.toISOString() : null,
user: c.user
}))
});
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
const session = await auth();
if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });

const { id: episodeId } = await ctx.params;

const json = await req.json().catch(() => null);
const parsed = CreateComment.safeParse(json);
if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

const episode = await prisma.episode.findUnique({ where: { id: episodeId } });
if (!episode) return Response.json({ error: "Episode not found" }, { status: 404 });

// @ts-expect-error augmented in src/types
const userId = session.user.id as string;

if (parsed.data.parentId) {
const parent = await prisma.comment.findUnique({ where: { id: parsed.data.parentId } });
if (!parent || parent.episodeId !== episodeId) {
return Response.json({ error: "Invalid parentId" }, { status: 400 });
}
}

const comment = await prisma.comment.create({
data: {
episodeId,
userId,
parentId: parsed.data.parentId ?? null,
body: parsed.data.body
}
});

return Response.json({ commentId: comment.id }, { status: 201 });
}
TS

cat > src/app/api/comments/\[id]/route.ts <<'TS'
import { auth } from "~~auth";
import prisma from "~~/lib/prisma";
import { z } from "zod";

const EditComment = z.object({
body: z.string().min(1).max(20000)
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
const session = await auth();
if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
// @ts-expect-error augmented
const userId = session.user.id as string;

const { id } = await ctx.params;
const json = await req.json().catch(() => null);
const parsed = EditComment.safeParse(json);
if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

const c = await prisma.comment.findUnique({ where: { id } });
if (!c) return Response.json({ error: "Not found" }, { status: 404 });
if (c.userId !== userId) return Response.json({ error: "Forbidden" }, { status: 403 });
if (c.deletedAt) return Response.json({ error: "Deleted" }, { status: 410 });

await prisma.comment.update({
where: { id },
data: { body: parsed.data.body, editedAt: new Date() }
});

return Response.json({ ok: true });
}

export async function DELETE(\_req: Request, ctx: { params: Promise<{ id: string }> }) {
const session = await auth();
if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
// @ts-expect-error augmented
const userId = session.user.id as string;

const { id } = await ctx.params;

const c = await prisma.comment.findUnique({ where: { id } });
if (!c) return Response.json({ error: "Not found" }, { status: 404 });
if (c.userId !== userId) return Response.json({ error: "Forbidden" }, { status: 403 });

await prisma.comment.update({
where: { id },
data: { deletedAt: new Date(), body: "\[deleted]" }
});

return Response.json({ ok: true });
}
TS

echo "Repo skeleton created."
echo "Next steps:"
echo "  cp .env.example .env"
echo "  npm install"
echo "  npm run db:migrate"
echo "  npm run dev"

```
```
