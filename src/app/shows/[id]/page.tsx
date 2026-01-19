import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import prisma from "~/lib/prisma";
import { canAdmin, ensureLocalUser } from "~/lib/admin";

export default async function ShowPage({ params }: { params: { id: string } }) {
  const { id } = params;

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

  let show: Awaited<ReturnType<typeof prisma.show.findUnique>>;
  try {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    show = await prisma.show.findUnique({
      where: { id },
      include: {
        episodes: {
          orderBy: [{ pubDate: "desc" }, { createdAt: "desc" }],
          take: 200
        }
      }
    });
  } catch {
    return <div className="card">Database not configured/reachable.</div>;
  }

  if (!show) return <div className="card">Show not found.</div>;
  if (show.unapproved && !admin) return <div className="card">Show not found.</div>;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div className="card">
        <div className="row">
          <div>
            <h2 style={{ margin: 0 }}>{show.title}</h2>
            <small>{show.slug}</small>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {show.tags.map((t) => (
              <span key={t} className="tag">
                <Link href={`/shows?tag=${encodeURIComponent(t)}`}>{t}</Link>
              </span>
            ))}
          </div>
        </div>

        {show.unapproved ? (
          <div className="card" style={{ marginTop: 12 }}>
            <div className="row">
              <small>unapproved</small>
              {admin ? (
                <form action={`/api/shows/${show.id}/approve`} method="post">
                  <button type="submit">Approve</button>
                </form>
              ) : null}
            </div>
          </div>
        ) : null}

        {show.description ? <p style={{ whiteSpace: "pre-wrap" }}>{show.description}</p> : null}

        <div style={{ display: "grid", gap: 6 }}>
          <small>
            RSS:{" "}
            <a href={show.rssUrl} target="_blank" rel="noreferrer">
              {show.rssUrl}
            </a>
          </small>
          {show.siteUrl ? (
            <small>
              Site:{" "}
              <a href={show.siteUrl} target="_blank" rel="noreferrer">
                {show.siteUrl}
              </a>
            </small>
          ) : null}
        </div>

        <hr />

        {admin ? (
          <div className="row">
            <small>Sync episodes from RSS (server-side)</small>
            <form action={`/api/shows/${show.id}/sync`} method="post" style={{ display: "flex", gap: 8 }}>
              <button type="submit">Sync now</button>
            </form>
          </div>
        ) : (
          <small>Sync is admin-only.</small>
        )}
      </div>

      <div className="card">
        <div className="row">
          <h3 style={{ margin: 0 }}>Episodes</h3>
          <small>{show.episodes.length} listed</small>
        </div>

        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          {show.episodes.map((e) => (
            <div key={e.id} className="card">
              <div className="row">
                <Link href={`/episodes/${e.id}`}>
                  <b>{e.title}</b>
                </Link>
                <small>{e.pubDate ? new Date(e.pubDate).toLocaleDateString() : ""}</small>
              </div>
              {e.description ? (
                <div style={{ marginTop: 8, opacity: 0.85 }}>
                  {e.description.slice(0, 240)}
                  {e.description.length > 240 ? "…" : ""}
                </div>
              ) : null}
            </div>
          ))}
          {show.episodes.length === 0 ? <small>No episodes yet. Hit sync.</small> : null}
        </div>
      </div>
    </div>
  );
}
