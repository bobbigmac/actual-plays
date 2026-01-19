import { z } from "zod";
import { auth } from "~auth";
import prisma from "~/lib/prisma";

const EditComment = z.object({
  body: z.string().min(1).max(20000)
});

export async function PATCH(req: Request, ctx: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  // @ts-expect-error augmented in src/types/next-auth.d.ts
  const userId = session.user.id as string;

  const { id } = ctx.params;
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

export async function DELETE(_req: Request, ctx: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  // @ts-expect-error augmented in src/types/next-auth.d.ts
  const userId = session.user.id as string;

  const { id } = ctx.params;

  const c = await prisma.comment.findUnique({ where: { id } });
  if (!c) return Response.json({ error: "Not found" }, { status: 404 });
  if (c.userId !== userId) return Response.json({ error: "Forbidden" }, { status: 403 });

  await prisma.comment.update({
    where: { id },
    data: { deletedAt: new Date(), body: "[deleted]" }
  });

  return Response.json({ ok: true });
}

