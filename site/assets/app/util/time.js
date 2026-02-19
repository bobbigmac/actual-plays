export function fmtTime(seconds) {
  var s = Math.max(0, Math.floor(Number(seconds) || 0));
  var h = Math.floor(s / 3600);
  var m = Math.floor((s % 3600) / 60);
  var ss = s % 60;
  if (h > 0) return h + ":" + String(m).padStart(2, "0") + ":" + String(ss).padStart(2, "0");
  return m + ":" + String(ss).padStart(2, "0");
}

