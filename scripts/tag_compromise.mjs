import nlp from "compromise";

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

function uniq(arr) {
  const seen = new Set();
  const out = [];
  for (const v of arr) {
    const key = String(v || "").trim();
    if (!key) continue;
    const k = key.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(key);
  }
  return out;
}

function cleanPerson(name) {
  const s = String(name || "").trim();
  if (!s) return null;
  if (s.length < 4) return null;
  const lowered = s.toLowerCase();
  if (
    lowered === "episode" ||
    lowered === "episodes" ||
    lowered === "trailer" ||
    lowered === "bonus" ||
    lowered === "part"
  ) {
    return null;
  }
  // Prefer "Firstname Lastname" style results.
  if (s.split(/\s+/).length < 2) return null;
  return s.replace(/\s+/g, " ");
}

function cleanTopic(t) {
  const s = String(t || "").trim().toLowerCase();
  if (!s) return null;
  if (s.length < 5) return null;
  if (s === "episode" || s === "trailer" || s === "bonus") return null;
  if (!/^[a-z0-9][a-z0-9 -]*[a-z0-9]$/.test(s)) return null;
  return s.replace(/\s+/g, " ");
}

const inputText = await readStdin();
const payload = JSON.parse(inputText || "{}");
const items = Array.isArray(payload.items) ? payload.items : [];

const out = {};
for (const item of items) {
  const id = String(item.id || "");
  const title = String(item.title || "");
  const description = String(item.description || "");

  const doc = nlp(title + "\n" + description);
  const people = uniq(doc.people().out("array").map(cleanPerson).filter(Boolean)).slice(0, 8);

  // Topics: nouns from title only (keeps noise down).
  const nouns = uniq(nlp(title).nouns().out("array").map(cleanTopic).filter(Boolean)).slice(0, 10);

  out[id] = { speakers: people, topics: nouns };
}

process.stdout.write(JSON.stringify(out));

