import Link from "next/link";
import prisma from "~/lib/prisma";

export default async function ShowPage({ params }: { params: { id: string } }) {
  const { id } = params;

  const show = await prisma.show.findUnique({
    where: { id },
    include: {
      episodes: {
        orderBy: [{ pubDate: "desc" }, { createdAt: "desc" }],
        take: 200
      }
    }
  });

  if (!show) return <div className="card">Show not found.</div>;

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

        <div className="row">
          <small>Sync episodes from RSS (server-side)</small>
          <form action={`/api/shows/${show.id}/sync`} method="post" style={{ display: "flex", gap: 8 }}>
            <button type="submit">Sync now</button>
          </form>
        </div>
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

