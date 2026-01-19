import { z } from "zod";
import { auth } from "@clerk/nextjs/server";
import prisma from "~/lib/prisma";
import { canAdmin, ensureLocalUser } from "~/lib/admin";

const CreateShow = z.object({
  slug: z
    .string()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9-]+$/, "slug must be lowercase letters/numbers/dashes"),
  title: z.string().min(1).max(200),
  description: z.string().max(20000).optional(),
  rssUrl: z.string().url(),
  siteUrl: z.string().url().optional(),
  imageUrl: z.string().url().optional(),
  tags: z.array(z.string().min(1).max(40)).optional()
});

export async function GET() {
  try {
    if (!process.env.DATABASE_URL) throw new Error("Database not configured");
    const shows = await prisma.show.findMany({
      where: { status: "ACTIVE", unapproved: false },
      orderBy: { updatedAt: "desc" },
      take: 500
    });
    return Response.json({ shows });
  } catch {
    return Response.json({ shows: [] });
  }
}

export async function POST(req: Request) {
  if (!process.env.DATABASE_URL) return Response.json({ error: "Database not configured" }, { status: 503 });
  const { userId } = auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { localUser, envAdmin } = await ensureLocalUser();
  const admin = canAdmin(localUser, envAdmin);

  const json = await req.json().catch(() => null);
  const parsed = CreateShow.safeParse(json);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    const show = await prisma.show.create({
      data: {
        ...parsed.data,
        tags: parsed.data.tags ?? [],
        unapproved: true
      }
    });
    return Response.json({ show, admin }, { status: 201 });
  } catch (e: any) {
    return Response.json({ error: e?.message ?? "Create failed" }, { status: 500 });
  }
}
