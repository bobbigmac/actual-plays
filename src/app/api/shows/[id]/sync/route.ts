import { auth } from "~auth";
import prisma from "~/lib/prisma";
import { syncShowFromRss } from "~/lib/rss";

function isAdmin(email: string | null | undefined) {
  const raw = process.env.ADMIN_EMAILS ?? "";
  const allowed = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return !!email && allowed.includes(email.toLowerCase());
}

export async function POST(req: Request, ctx: { params: { id: string } }) {
  const { id } = ctx.params;

  const secret = process.env.CRON_SECRET?.trim();
  if (secret) {
    const got = req.headers.get("x-cron-secret")?.trim();
    if (got !== secret) {
      const session = await auth();
      const email = session?.user?.email ?? null;
      if (!isAdmin(email)) return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const url = new URL(req.url);
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Math.max(1, Math.min(2000, parseInt(limitRaw, 10) || 250)) : 250;

  const show = await prisma.show.findUnique({ where: { id } });
  if (!show) return Response.json({ error: "Show not found" }, { status: 404 });

  try {
    const result = await syncShowFromRss(id, limit);
    return Response.json(result);
  } catch (e: any) {
    return Response.json({ error: e?.message ?? "Sync failed" }, { status: 500 });
  }
}

