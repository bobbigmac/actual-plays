import crypto from "node:crypto";
import Parser from "rss-parser";
import prisma from "~/lib/prisma";

type RssItem = {
  guid?: string;
  id?: string;
  title?: string;
  link?: string;
  pubDate?: string;
  isoDate?: string;
  content?: string;
  contentSnippet?: string;
  enclosure?: { url?: string; type?: string; length?: string };
  itunes?: { duration?: string; image?: unknown };
};

function sha256(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function parseDurationToSeconds(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (!s) return null;

  if (/^\d+$/.test(s)) return Math.max(0, parseInt(s, 10));

  const parts = s.split(":").map((p) => p.trim());
  if (parts.some((p) => !/^\d+$/.test(p))) return null;

  const nums = parts.map((p) => parseInt(p, 10));
  if (nums.length === 2) return nums[0] * 60 + nums[1];
  if (nums.length === 3) return nums[0] * 3600 + nums[1] * 60 + nums[2];
  return null;
}

function extractItunesImageUrl(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value !== "object") return null;

  const anyVal = value as any;
  const href = anyVal?.href ?? anyVal?.$?.href;
  return typeof href === "string" ? href.trim() || null : null;
}

export async function syncShowFromRss(showId: string, limit = 250) {
  const show = await prisma.show.findUnique({ where: { id: showId } });
  if (!show) throw new Error("Show not found");

  const res = await fetch(show.rssUrl, {
    headers: { "user-agent": "actualplay-hub/0.1 (+https://example.com)" }
  });
  if (!res.ok) throw new Error(`RSS fetch failed: ${res.status} ${res.statusText}`);
  const xml = await res.text();

  const parser = new Parser<any, RssItem>({
    customFields: {
      item: [
        ["itunes:duration", "itunes:duration"],
        ["itunes:image", "itunes:image"]
      ]
    }
  });

  const feed = await parser.parseString(xml);
  const items = (feed.items as RssItem[] | undefined) ?? [];
  const slice = items.slice(0, Math.max(1, Math.min(limit, 2000)));

  let created = 0;
  let updated = 0;

  for (const item of slice) {
    const title = (item.title ?? "").trim();
    if (!title) continue;

    const guid = ((item.guid ?? item.id ?? "").trim() || null) as string | null;
    const enclosureUrl = ((item.enclosure?.url ?? "").trim() || null) as string | null;
    const episodeUrl = ((item.link ?? "").trim() || null) as string | null;

    const pub = item.isoDate ?? item.pubDate ?? null;
    const pubDate = pub ? new Date(pub) : null;
    const durationSeconds = parseDurationToSeconds((item as any)?.["itunes:duration"] ?? item.itunes?.duration);

    const identitySource =
      guid ?? enclosureUrl ?? episodeUrl ?? `${title}|${pubDate?.toISOString() ?? "no-date"}`;
    const identityHash = sha256(`${show.rssUrl}|${identitySource}`);

    const description =
      (item.contentSnippet ?? item.content ?? "").toString().trim() || null;

    const imageUrl =
      extractItunesImageUrl((item as any)?.["itunes:image"] ?? item.itunes?.image) ??
      show.imageUrl ??
      null;

    const existing = await prisma.episode.findUnique({ where: { identityHash } });

    if (!existing) {
      await prisma.episode.create({
        data: {
          showId: show.id,
          guid,
          identityHash,
          title,
          description,
          pubDate,
          durationSeconds,
          episodeUrl,
          enclosureUrl,
          imageUrl,
          rawRssJson: item as any
        }
      });
      created++;
    } else {
      await prisma.episode.update({
        where: { identityHash },
        data: {
          guid: existing.guid ?? guid,
          title,
          description,
          pubDate,
          durationSeconds,
          episodeUrl,
          enclosureUrl,
          imageUrl,
          rawRssJson: item as any
        }
      });
      updated++;
    }
  }

  return { showId: show.id, created, updated, total: slice.length };
}
