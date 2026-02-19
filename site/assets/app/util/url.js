export function qs(name) {
  var url = new URL(window.location.href);
  return url.searchParams.get(name);
}

export function setQs(name, value) {
  var url = new URL(window.location.href);
  if (value) url.searchParams.set(name, value);
  else url.searchParams.delete(name);
  window.history.replaceState({}, "", url.toString());
}

export function joinPath(basePath, suffix) {
  var b = String(basePath || "/");
  if (!b.startsWith("/")) b = "/" + b;
  if (!b.endsWith("/")) b = b + "/";
  var s = String(suffix || "");
  s = s.replace(/^\//, "");
  return b + s;
}

export function normalizePathname(p) {
  var out = String(p || "/");
  // Treat "/x" and "/x/" as equivalent for routing checks.
  if (out.endsWith("/index.html")) out = out.slice(0, -"/index.html".length);
  if (!out.endsWith("/")) out = out + "/";
  return out;
}

