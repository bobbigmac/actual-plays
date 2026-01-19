import { z } from "zod";
import { auth, currentUser } from "@clerk/nextjs/server";
import prisma from "~/lib/prisma";

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

function isAdmin(email: string | null | undefined) {
  const raw = process.env.ADMIN_EMAILS ?? "";
  const allowed = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return !!email && allowed.includes(email.toLowerCase());
}

export async function GET() {
  const shows = await prisma.show.findMany({
    where: { status: "ACTIVE" },
    orderBy: { updatedAt: "desc" },
    take: 500
  });
  return Response.json({ shows });
}

export async function POST(req: Request) {
  const { userId } = auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? null;
  if (!isAdmin(email)) return Response.json({ error: "Forbidden" }, { status: 403 });

  const json = await req.json().catch(() => null);
  const parsed = CreateShow.safeParse(json);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    const show = await prisma.show.create({
      data: {
        ...parsed.data,
        tags: parsed.data.tags ?? []
      }
    });
    return Response.json({ show }, { status: 201 });
  } catch (e: any) {
    return Response.json({ error: e?.message ?? "Create failed" }, { status: 500 });
  }
}
