export function fmtBytes(bytes) {
  var n = Number(bytes);
  if (!isFinite(n) || n <= 0) return "?MB";

  var units = ["B", "KB", "MB", "GB", "TB"];
  var u = 0;
  while (n >= 1024 && u < units.length - 1) {
    n = n / 1024;
    u++;
  }

  var digits = 0;
  if (u >= 2) {
    if (n < 10) digits = 2;
    else if (n < 100) digits = 1;
    else digits = 0;
  }

  var s = digits ? n.toFixed(digits) : String(Math.round(n));
  return s + " " + units[u];
}

