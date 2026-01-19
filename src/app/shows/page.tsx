import Link from "next/link";
import prisma from "~/lib/prisma";

export default async function ShowsPage({
  searchParams
}: {
  searchParams?: { q?: string; tag?: string };
}) {
  const q = searchParams?.q;
  const tag = searchParams?.tag;

  const where = {
    status: "ACTIVE" as const,
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

  const shows = await prisma.show.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 200
  });

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

