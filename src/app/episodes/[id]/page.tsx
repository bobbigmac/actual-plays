import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import Comments from "~/components/Comments";
import prisma from "~/lib/prisma";

function fmtTime(seconds: number | null) {
  if (!seconds || seconds <= 0) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export default async function EpisodePage({ params }: { params: { id: string } }) {
  const { id } = params;

  let episode: Awaited<ReturnType<typeof prisma.episode.findUnique>>;
  try {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    episode = await prisma.episode.findUnique({
      where: { id },
      include: { show: true }
    });
  } catch {
    return <div className="card">Database not configured/reachable.</div>;
  }

  if (!episode) return <div className="card">Episode not found.</div>;

  const clerkConfigured = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const { userId } = clerkConfigured ? auth() : { userId: null as string | null };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div className="card">
        <small>
          <Link href={`/shows/${episode.showId}`}>← {episode.show.title}</Link>
        </small>

        <h2 style={{ marginTop: 10 }}>{episode.title}</h2>

        <div className="row">
          <small>
            {episode.pubDate ? new Date(episode.pubDate).toLocaleString() : ""}
            {episode.durationSeconds ? ` · ${fmtTime(episode.durationSeconds)}` : ""}
          </small>
          <small>{userId ? "Signed in" : "Not signed in"}</small>
        </div>

        {episode.enclosureUrl ? (
          <div style={{ marginTop: 12 }}>
            <audio controls preload="none" style={{ width: "100%" }}>
              <source src={episode.enclosureUrl} />
            </audio>
            <small style={{ display: "block", marginTop: 8 }}>
              Media:{" "}
              <a href={episode.enclosureUrl} target="_blank" rel="noreferrer">
                {episode.enclosureUrl}
              </a>
            </small>
          </div>
        ) : (
          <small style={{ display: "block", marginTop: 12 }}>No enclosure URL found in RSS.</small>
        )}

        {episode.description ? (
          <div style={{ marginTop: 14, whiteSpace: "pre-wrap", opacity: 0.9 }}>{episode.description}</div>
        ) : null}
      </div>

      <Comments episodeId={episode.id} />
    </div>
  );
}
