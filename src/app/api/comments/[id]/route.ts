import { z } from "zod";
import { auth } from "@clerk/nextjs/server";
import prisma from "~/lib/prisma";
import { ensureLocalUser } from "~/lib/admin";

const EditComment = z.object({
  body: z.string().min(1).max(20000)
});

export async function PATCH(req: Request, ctx: { params: { id: string } }) {
  if (!process.env.DATABASE_URL) return Response.json({ error: "Database not configured" }, { status: 503 });
  const { userId: clerkUserId } = auth();
  if (!clerkUserId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let localUser: { id: string } | null = null;
  try {
    const ensured = await ensureLocalUser();
    localUser = ensured.localUser ? { id: ensured.localUser.id } : null;
  } catch {
    return Response.json({ error: "Database not reachable" }, { status: 503 });
  }
  if (!localUser) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = ctx.params;
  const json = await req.json().catch(() => null);
  const parsed = EditComment.safeParse(json);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  let c: Awaited<ReturnType<typeof prisma.comment.findUnique>>;
  try {
    c = await prisma.comment.findUnique({ where: { id } });
  } catch {
    return Response.json({ error: "Database not reachable" }, { status: 503 });
  }
  if (!c) return Response.json({ error: "Not found" }, { status: 404 });
  if (c.userId !== localUser.id) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (c.deletedAt) return Response.json({ error: "Deleted" }, { status: 410 });

  try {
    await prisma.comment.update({
      where: { id },
      data: { body: parsed.data.body, editedAt: new Date() }
    });
  } catch {
    return Response.json({ error: "Database not reachable" }, { status: 503 });
  }

  return Response.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: { params: { id: string } }) {
  if (!process.env.DATABASE_URL) return Response.json({ error: "Database not configured" }, { status: 503 });
  const { userId: clerkUserId } = auth();
  if (!clerkUserId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let localUser: { id: string } | null = null;
  try {
    const ensured = await ensureLocalUser();
    localUser = ensured.localUser ? { id: ensured.localUser.id } : null;
  } catch {
    return Response.json({ error: "Database not reachable" }, { status: 503 });
  }
  if (!localUser) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = ctx.params;

  let c: Awaited<ReturnType<typeof prisma.comment.findUnique>>;
  try {
    c = await prisma.comment.findUnique({ where: { id } });
  } catch {
    return Response.json({ error: "Database not reachable" }, { status: 503 });
  }
  if (!c) return Response.json({ error: "Not found" }, { status: 404 });
  if (c.userId !== localUser.id) return Response.json({ error: "Forbidden" }, { status: 403 });

  try {
    await prisma.comment.update({
      where: { id },
      data: { deletedAt: new Date(), body: "[deleted]" }
    });
  } catch {
    return Response.json({ error: "Database not reachable" }, { status: 503 });
  }

  return Response.json({ ok: true });
}
