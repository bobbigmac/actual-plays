import { auth } from "@clerk/nextjs/server";
import prisma from "~/lib/prisma";
import { canAdmin, ensureLocalUser } from "~/lib/admin";

export async function POST(_req: Request, ctx: { params: { id: string } }) {
  if (!process.env.DATABASE_URL) return Response.json({ error: "Database not configured" }, { status: 503 });
  const { userId } = auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { localUser, envAdmin } = await ensureLocalUser();
  if (!canAdmin(localUser, envAdmin)) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { id } = ctx.params;
  try {
    await prisma.show.update({
      where: { id },
      data: { unapproved: false }
    });
    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json({ error: e?.message ?? "Approve failed" }, { status: 500 });
  }
}

