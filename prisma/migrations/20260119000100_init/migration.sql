-- CreateEnum
CREATE TYPE "ShowStatus" AS ENUM ('ACTIVE', 'HIDDEN', 'ARCHIVED');

-- CreateTable
CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "clerkUserId" TEXT NOT NULL,
  "name" TEXT,
  "email" TEXT,
  "image" TEXT,
  "handle" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Show" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "rssUrl" TEXT NOT NULL,
  "siteUrl" TEXT,
  "imageUrl" TEXT,
  "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "status" "ShowStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Show_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Episode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Comment" (
  "id" TEXT NOT NULL,
  "episodeId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "parentId" TEXT,
  "body" TEXT NOT NULL,
  "editedAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_handle_key" ON "User"("handle");
CREATE UNIQUE INDEX "User_clerkUserId_key" ON "User"("clerkUserId");

CREATE UNIQUE INDEX "Show_slug_key" ON "Show"("slug");
CREATE UNIQUE INDEX "Show_rssUrl_key" ON "Show"("rssUrl");

CREATE UNIQUE INDEX "Episode_identityHash_key" ON "Episode"("identityHash");
CREATE INDEX "Episode_showId_pubDate_idx" ON "Episode"("showId", "pubDate");

CREATE INDEX "Comment_episodeId_createdAt_idx" ON "Comment"("episodeId", "createdAt");
CREATE INDEX "Comment_parentId_idx" ON "Comment"("parentId");

-- AddForeignKey
ALTER TABLE "Episode"
  ADD CONSTRAINT "Episode_showId_fkey"
  FOREIGN KEY ("showId") REFERENCES "Show"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Comment"
  ADD CONSTRAINT "Comment_episodeId_fkey"
  FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Comment"
  ADD CONSTRAINT "Comment_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Comment"
  ADD CONSTRAINT "Comment_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "Comment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
