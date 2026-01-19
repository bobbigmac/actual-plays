-- Add isAdmin to User
ALTER TABLE "User" ADD COLUMN "isAdmin" BOOLEAN NOT NULL DEFAULT false;

-- Add unapproved to Show
ALTER TABLE "Show" ADD COLUMN "unapproved" BOOLEAN NOT NULL DEFAULT true;

