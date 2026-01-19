import { auth } from "@clerk/nextjs/server";
import prisma from "~/lib/prisma";
import { syncShowFromRss } from "~/lib/rss";
import { canAdmin, ensureLocalUser } from "~/lib/admin";

export async function POST(req: Request, ctx: { params: { id: string } }) {
  if (!process.env.DATABASE_URL) return Response.json({ error: "Database not configured" }, { status: 503 });
  const { id } = ctx.params;

  const secret = process.env.CRON_SECRET?.trim();
  const got = req.headers.get("x-cron-secret")?.trim();
  const allowBySecret = !!secret && got === secret;
  if (!allowBySecret) {
    const { userId } = auth();
    if (!userId) return Response.json({ error: "Forbidden" }, { status: 403 });
    const { localUser, envAdmin } = await ensureLocalUser();
    if (!canAdmin(localUser, envAdmin)) return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Math.max(1, Math.min(2000, parseInt(limitRaw, 10) || 250)) : 250;

  try {
    const show = await prisma.show.findUnique({ where: { id } });
    if (!show) return Response.json({ error: "Show not found" }, { status: 404 });
  } catch {
    return Response.json({ error: "Database not reachable" }, { status: 503 });
  }

  try {
    const result = await syncShowFromRss(id, limit);
    return Response.json(result);
  } catch (e: any) {
    return Response.json({ error: e?.message ?? "Sync failed" }, { status: 500 });
  }
}
