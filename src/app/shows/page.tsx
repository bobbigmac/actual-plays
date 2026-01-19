import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import prisma from "~/lib/prisma";
import NewShowForm from "~/components/NewShowForm";
import { canAdmin, ensureLocalUser } from "~/lib/admin";

export default async function ShowsPage({
  searchParams
}: {
  searchParams: Promise<{ q?: string; tag?: string }>;
}) {
  const { q, tag } = await searchParams;

  const clerkConfigured = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const { userId } = clerkConfigured ? auth() : { userId: null as string | null };
  let admin = false;
  try {
    if (userId && process.env.DATABASE_URL) {
      const { localUser, envAdmin } = await ensureLocalUser();
      admin = canAdmin(localUser, envAdmin);
    }
  } catch {
    admin = false;
  }

  const where = {
    status: "ACTIVE" as const,
    ...(admin ? {} : { unapproved: false }),
    ...(tag ? { tags: { has: tag } } : {}),
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" as const } },
            { description: { contains: q, mode: "insensitive" as const } },
            { slug: { contains: q, mode: "insensitive" as const } }
          ]
        }
      : {})
  };

  let shows: Awaited<ReturnType<typeof prisma.show.findMany>>;
  try {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    shows = await prisma.show.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: 200
    });
  } catch {
    return (
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Shows</h2>
        <p style={{ opacity: 0.85, marginBottom: 0 }}>
          No database configured/reachable yet. Set <code>DATABASE_URL</code> to enable show listings and comments.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div className="card">
        <form style={{ display: "grid", gap: 10 }}>
          <div className="row">
            <h2 style={{ margin: 0 }}>Shows</h2>
            <small>{shows.length} results</small>
          </div>
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search title/desc/slug"
            autoComplete="off"
          />
          <div className="row">
            <input name="tag" defaultValue={tag ?? ""} placeholder="Tag (optional)" autoComplete="off" />
            <button type="submit">Search</button>
          </div>
        </form>
      </div>

      <NewShowForm />

      {shows.map((s) => (
        <div key={s.id} className="card">
          <div className="row">
            <div>
              <Link href={`/shows/${s.id}`}>
                <b style={{ fontSize: 18 }}>{s.title}</b>
              </Link>
              <div>
                <small>{s.slug}</small>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
              {s.tags.slice(0, 6).map((t) => (
                <span key={t} className="tag">
                  <Link href={`/shows?tag=${encodeURIComponent(t)}`}>{t}</Link>
                </span>
              ))}
            </div>
          </div>
          {admin && s.unapproved ? <small>unapproved</small> : null}
          {s.description ? (
            <div style={{ marginTop: 10, opacity: 0.9, whiteSpace: "pre-wrap" }}>{s.description}</div>
          ) : null}
          <div style={{ marginTop: 10 }}>
            <small>
              RSS:{" "}
              <a href={s.rssUrl} target="_blank" rel="noreferrer">
                {s.rssUrl}
              </a>
            </small>
          </div>
        </div>
      ))}
    </div>
  );
}
