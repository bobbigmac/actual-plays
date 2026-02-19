import { cssEscape } from "./dom.js";
import { getBasePath } from "./env.js";

export function parseEpisodeId(episodeId) {
  var parts = String(episodeId || "").split(":");
  return { feedSlug: parts[0] || "", episodeKey: parts.slice(1).join(":") || "" };
}

export function readEpisodeMetaFromElement(el) {
  if (!el || !el.getAttribute) return null;
  var id = el.getAttribute("data-episode-id") || "";
  if (!id) return null;
  var parsed = parseEpisodeId(id);
  var feedSlug = el.getAttribute("data-feed-slug") || parsed.feedSlug;
  var episodeKey = el.getAttribute("data-episode-key") || parsed.episodeKey;
  var title = el.getAttribute("data-episode-title") || "";
  var date = el.getAttribute("data-episode-date") || "";
  var feedTitle = el.getAttribute("data-feed-title") || "";
  var audio = el.getAttribute("data-episode-audio") || "";
  var link = el.getAttribute("data-episode-link") || "";
  var image = el.getAttribute("data-episode-image") || "";
  var duration = Number(el.getAttribute("data-episode-duration") || 0) || 0;
  var bytes = Number(el.getAttribute("data-episode-bytes") || 0) || 0;
  return {
    id: id,
    feedSlug: feedSlug,
    episodeKey: episodeKey,
    t: title,
    d: date,
    ft: feedTitle,
    a: audio,
    l: link,
    im: image,
    du: duration,
    b: bytes,
  };
}

var episodeMetaCache = new Map();

function fetchEpisodeMeta(feedSlug, episodeKey) {
  var url = getBasePath() + encodeURIComponent(feedSlug) + "/index.html";
  return fetch(url, { cache: "no-store" })
    .then(function (r) {
      if (!r.ok) throw new Error("Failed to load " + url);
      return r.text();
    })
    .then(function (text) {
      var doc = new DOMParser().parseFromString(text, "text/html");
      var li = doc.querySelector("#e-" + cssEscape(episodeKey));
      if (!li) throw new Error("Episode not found");
      var id = feedSlug + ":" + episodeKey;
      return {
        id: id,
        feedSlug: feedSlug,
        episodeKey: episodeKey,
        t: li.getAttribute("data-episode-title") || "",
        d: li.getAttribute("data-episode-date") || "",
        ft: (doc.querySelector("h1") && doc.querySelector("h1").textContent) || feedSlug,
        a: li.getAttribute("data-episode-audio") || "",
        l: li.getAttribute("data-episode-link") || "",
        im: li.getAttribute("data-episode-image") || "",
        du: Number(li.getAttribute("data-episode-duration") || 0) || 0,
        b: Number(li.getAttribute("data-episode-bytes") || 0) || 0,
      };
    });
}

export function resolveEpisodeMeta(hint) {
  var meta = hint || {};
  if (!meta.id) return Promise.reject(new Error("Missing episode id"));
  if (meta.a) return Promise.resolve(meta);
  if (episodeMetaCache.has(meta.id)) return Promise.resolve(episodeMetaCache.get(meta.id));

  var parsed = parseEpisodeId(meta.id);
  var feedSlug = meta.feedSlug || parsed.feedSlug;
  var episodeKey = meta.episodeKey || parsed.episodeKey;
  if (!feedSlug || !episodeKey) return Promise.reject(new Error("Missing feed/key"));

  return fetchEpisodeMeta(feedSlug, episodeKey).then(function (full) {
    var merged = {
      id: meta.id,
      feedSlug: full.feedSlug,
      episodeKey: full.episodeKey,
      t: meta.t || full.t,
      d: meta.d || full.d,
      ft: meta.ft || full.ft,
      a: meta.a || full.a,
      l: meta.l || full.l,
      im: meta.im || full.im,
      du: Number(meta.du) || Number(full.du) || 0,
      b: Number(meta.b) || Number(full.b) || 0,
    };
    episodeMetaCache.set(meta.id, merged);
    return merged;
  });
}
