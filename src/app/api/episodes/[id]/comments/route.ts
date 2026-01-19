import { z } from "zod";
import { auth, currentUser } from "@clerk/nextjs/server";
import prisma from "~/lib/prisma";

const CreateComment = z.object({
  body: z.string().min(1).max(20000),
  parentId: z.string().cuid().nullable().optional()
});

export async function GET(_req: Request, ctx: { params: { id: string } }) {
  const { id: episodeId } = ctx.params;

  const comments = await prisma.comment.findMany({
    where: { episodeId },
    orderBy: { createdAt: "asc" },
    include: { user: { select: { id: true, clerkUserId: true, name: true, email: true, handle: true } } }
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

export async function POST(req: Request, ctx: { params: { id: string } }) {
  const { userId: clerkUserId } = auth();
  if (!clerkUserId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id: episodeId } = ctx.params;

  const json = await req.json().catch(() => null);
  const parsed = CreateComment.safeParse(json);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const episode = await prisma.episode.findUnique({ where: { id: episodeId } });
  if (!episode) return Response.json({ error: "Episode not found" }, { status: 404 });

  const clerkUser = await currentUser();
  const email = clerkUser?.primaryEmailAddress?.emailAddress ?? null;
  const name =
    clerkUser?.fullName ??
    [clerkUser?.firstName, clerkUser?.lastName].filter(Boolean).join(" ") ||
    null;
  const image = clerkUser?.imageUrl ?? null;

  const localUser = await prisma.user.upsert({
    where: { clerkUserId },
    create: { clerkUserId, email, name, image },
    update: { email, name, image }
  });

  if (parsed.data.parentId) {
    const parent = await prisma.comment.findUnique({ where: { id: parsed.data.parentId } });
    if (!parent || parent.episodeId !== episodeId) {
      return Response.json({ error: "Invalid parentId" }, { status: 400 });
    }
  }

  const comment = await prisma.comment.create({
    data: {
      episodeId,
      userId: localUser.id,
      parentId: parsed.data.parentId ?? null,
      body: parsed.data.body
    }
  });

  return Response.json({ commentId: comment.id }, { status: 201 });
}
