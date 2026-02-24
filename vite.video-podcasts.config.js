import { defineConfig } from "vite";
import http from "node:http";
import https from "node:https";
import { URL } from "node:url";

function fetchUrl(urlStr, { maxRedirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(urlStr);
    } catch {
      reject(new Error("bad url"));
      return;
    }

    const mod = url.protocol === "https:" ? https : http;
    const req = mod.request(
      url,
      {
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36",
          Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
          "Accept-Language": "en-US,en;q=0.8",
        },
      },
      (res) => {
        const status = res.statusCode || 0;
        const loc = res.headers.location;
        if (status >= 300 && status < 400 && loc && maxRedirects > 0) {
          res.resume();
          const next = new URL(loc, url).toString();
          fetchUrl(next, { maxRedirects: maxRedirects - 1 }).then(resolve, reject);
          return;
        }

        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks);
          resolve({
            status,
            headers: res.headers,
            body,
          });
        });
      }
    );

    req.on("error", reject);
    req.end();
  });
}

function feedProxyPlugin() {
  return {
    name: "video-podcasts-feed-proxy",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          if (!req.url?.startsWith("/__feed")) return next();
          const u = new URL(req.url, "http://local/");
          const target = u.searchParams.get("url") || "";
          if (!/^https?:\/\//i.test(target)) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            res.end("missing/invalid url");
            return;
          }

          const out = await fetchUrl(target);
          res.statusCode = out.status || 502;
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.setHeader("Cache-Control", "no-store");

          const ct = String(out.headers["content-type"] || "");
          res.setHeader("Content-Type", ct || "application/xml; charset=utf-8");
          res.end(out.body);
        } catch (e) {
          res.statusCode = 502;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end(String(e?.message || e || "proxy error"));
        }
      });
    },
  };
}

export default defineConfig({
  root: "video-podcasts",
  plugins: [feedProxyPlugin()],
  server: {
    port: 8010,
    strictPort: true,
    open: "/video-podcasts-hsl.html",
  },
});

