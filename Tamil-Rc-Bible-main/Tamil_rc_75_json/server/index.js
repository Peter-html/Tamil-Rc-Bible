require("dotenv").config();

const express    = require("express");
const cors       = require("cors");
const path       = require("path");
const fs         = require("fs");
const rateLimit  = require("express-rate-limit");

const fetchFn = (...a) => import("node-fetch").then(({ default: f }) => f(...a));

const app  = express();
const PORT = process.env.PORT || 3001;

const GEMINI_KEY   = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_URL   = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;

const ROOT      = path.join(__dirname, "..");
const DATA_PATH = path.join(ROOT, "assets", "data");

app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "2mb" }));
app.use(express.static(ROOT));

const DAILY_LIMIT = parseInt(process.env.RATE_LIMIT_PER_DAY    || "50");
const MIN_LIMIT   = parseInt(process.env.RATE_LIMIT_PER_MINUTE || "5");

app.use("/api/ask",     rateLimit({ windowMs: 60_000,        max: MIN_LIMIT,   message: { error: "TOO_FAST",   message: "சில நிமிடங்கள் காத்திருங்கள்." } }));
app.use("/api/ask",     rateLimit({ windowMs: 24 * 3600_000, max: DAILY_LIMIT, message: { error: "RATE_LIMIT", message: `இன்று ${DAILY_LIMIT} கேள்விகள் முடிந்தன.` } }));
app.use("/api/summary", rateLimit({ windowMs: 24 * 3600_000, max: DAILY_LIMIT, message: { error: "RATE_LIMIT", message: `இன்று ${DAILY_LIMIT} கேள்விகள் முடிந்தன.` } }));

/* ═══════════════════════════════════════════
   RAG ENGINE
═══════════════════════════════════════════ */
const verses    = [];
const bookNames = {};
let   indexed   = false;
let   tfVectors = [];
let   tokenizeFn;

function normalizeBook(raw) {
  const map = new Map();
  const bookName = raw.name_ta || raw.name || "";

  const add = (ch, v, t) => {
    const c = +ch, vn = +v, text = (t ?? "").toString().trim();
    if (!c || !vn || !text) return;
    if (!map.has(c)) map.set(c, []);
    map.get(c).push({ v: vn, t: text });
  };

  const roots = [raw?.BIBLE_TEXT, raw?.bible_text, raw?.text, raw?.data,
                 raw?.verses, raw?.chapters, raw?.Chapters, raw?.chapter].filter(Boolean);
  if (!roots.length) roots.push(raw);

  for (const root of roots) {
    if (Array.isArray(root) && root.length && typeof root[0] === "object" && !Array.isArray(root[0])) {
      let hit = 0;
      for (const row of root) {
        const ch = row.chapter ?? row.ch ?? row.c ?? row.Chapter;
        const v  = row.verse   ?? row.v  ?? row.vn ?? row.Verse;
        const t  = row.text    ?? row.t  ?? row.value ?? row.verseText;
        if (ch && v && t) { add(ch, v, t); hit++; }
      }
      if (hit) break;
    }
    if (root && typeof root === "object" && !Array.isArray(root)) {
      const keys = Object.keys(root).filter(k => /^\d+$/.test(k));
      if (keys.length) {
        let hit = 0;
        for (const ck of keys) {
          const cv = root[ck];
          if (Array.isArray(cv)) {
            cv.forEach((item, idx) => {
              if (typeof item === "string" && item.trim()) { add(ck, idx + 1, item); hit++; }
              else if (item && typeof item === "object") {
                const v = item.verse ?? item.v ?? (idx + 1);
                const t = item.text  ?? item.t ?? item.value;
                if (t) { add(ck, v, t); hit++; }
              }
            });
          } else if (cv && typeof cv === "object") {
            const vkeys = Object.keys(cv).filter(k => /^\d+$/.test(k));
            if (vkeys.length) { vkeys.forEach(vk => add(ck, vk, cv[vk])); hit += vkeys.length; }
          }
        }
        if (hit) break;
      }
    }
  }

  for (const list of map.values()) list.sort((a, b) => a.v - b.v);
  return { versesByChapter: map, bookName };
}

function loadDir(dirPath, testament) {
  if (!fs.existsSync(dirPath)) return 0;
  const files = fs.readdirSync(dirPath).filter(f => f.endsWith(".json"));
  let count = 0;
  for (const file of files) {
    try {
      const raw     = JSON.parse(fs.readFileSync(path.join(dirPath, file), "utf8"));
      const bookNum = parseInt(file.replace(/[^0-9]/g, "")) || 0;
      if (!bookNum) continue;
      const { versesByChapter, bookName } = normalizeBook(raw);
      const name = bookName || bookNames[bookNum] || `Book ${bookNum}`;
      bookNames[bookNum] = name;
      for (const [ch, list] of versesByChapter.entries()) {
        for (const v of list) {
          verses.push({ id: `${bookNum}:${ch}:${v.v}`, bookNum, bookName: name, chapter: ch, verse: v.v, text: v.t, testament });
          count++;
        }
      }
    } catch (e) { console.warn(`  skip ${file}: ${e.message}`); }
  }
  return count;
}

function loadBookNames() {
  const p = path.join(ROOT, "books_order.json");
  if (!fs.existsSync(p)) return;
  try {
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    const all = [...(j.old_testament||[]), ...(j.deuterocanon||[]), ...(j.new_testament||[])];
    for (const b of all) if (b.bookNum && b.name_ta) bookNames[b.bookNum] = b.name_ta;
  } catch {}
}

function buildTfIdf() {
  const tokenize = text =>
    text.toLowerCase()
      .replace(/[^\u0B80-\u0BFF\u0020a-z0-9]/g, " ")
      .split(/\s+/)
      .filter(t => t.length > 1);

  const df = new Map();
  const tokenized = verses.map(v => {
    const tokens = tokenize(v.text + " " + v.bookName);
    new Set(tokens).forEach(t => df.set(t, (df.get(t) || 0) + 1));
    return tokens;
  });

  const N = verses.length;
  tfVectors = tokenized.map(tokens => {
    const tf = new Map();
    tokens.forEach(t => tf.set(t, (tf.get(t) || 0) + 1));
    const vec = new Map();
    tf.forEach((c, term) => {
      vec.set(term, (c / tokens.length) * Math.log(N / (df.get(term) || 1)));
    });
    return vec;
  });

  tokenizeFn = tokenize;
}

function ragSearch(query, topK = 20, bookNum = null, chapter = null) {
  if (!verses.length || !tokenizeFn) return [];
  const qTokens = tokenizeFn(query);
  if (!qTokens.length) return [];
  const lq = query.toLowerCase();

  const scored = tfVectors.map((vec, i) => {
    const v = verses[i];
    if (bookNum  && v.bookNum  !== bookNum)  return { i, score: -1 };
    if (chapter  && v.chapter  !== chapter)  return { i, score: -1 };
    let dot = 0;
    for (const t of qTokens) dot += (vec.get(t) || 0);
    if (v.text.toLowerCase().includes(lq))   dot *= 3;
    if (v.bookName && lq.includes(v.bookName.toLowerCase())) dot *= 2;
    return { i, score: dot };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(s => verses[s.i]);
}

function formatContext(list) {
  if (!list.length) return "பொருத்தமான வசனங்கள் கிடைக்கவில்லை.";
  const groups = new Map();
  for (const v of list) {
    const k = `${v.bookName} ${v.chapter}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(v);
  }
  return [...groups.entries()].map(([ref, vl]) =>
    `[${ref}]\n` + vl.map(v => `${v.verse}. ${v.text}`).join("\n")
  ).join("\n\n");
}

/* ═══════════════════════════════════════════
   GEMINI
═══════════════════════════════════════════ */
async function callGemini(systemText, userText, history = []) {
  if (!GEMINI_KEY) throw new Error("GEMINI_API_KEY .env-ல் இல்லை!");

  const contents = [];
  for (const h of history.slice(-6)) {
    contents.push({ role: h.role === "assistant" ? "model" : "user", parts: [{ text: h.content }] });
  }
  contents.push({ role: "user", parts: [{ text: userText }] });

  const body = {
    system_instruction: { parts: [{ text: systemText }] },
    contents,
    generationConfig: { temperature: 0.75, topK: 40, topP: 0.95, maxOutputTokens: 2048 },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT",        threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HATE_SPEECH",       threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
    ]
  };

  const res  = await fetchFn(GEMINI_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();

  if (!res.ok) {
    if (res.status === 429) throw Object.assign(new Error("Quota exceeded"), { code: "QUOTA" });
    throw new Error(`Gemini ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  }

  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
  if (!text.trim()) throw new Error("Empty response from Gemini");
  return text;
}

/* ═══════════════════════════════════════════
   SYSTEM PROMPTS
═══════════════════════════════════════════ */
const SYSTEM_BASE = `நீ ஒரு அன்பான, ஆழமான தமிழ் கத்தோலிக்க வேதாகம ஆசிரியர். உன் பெயர் "Ask Bible".

பதில் நடை விதிகள்:
1. எப்போதும் தமிழில் மட்டும் பதில் சொல்.
2. இயற்கையான flowing paragraphs மட்டுமே — bullet points, dashes, numbered lists, headers எதுவும் வேண்டாம்.
3. Spiritual, warm, storyteller tone — ஒரு அன்பான ஆசிரியர் சொல்வது போல்.
4. கீழே கொடுத்த Bible Context வசனங்களை மட்டுமே ஆதாரமாக பயன்படுத்து.

கதாபாத்திர கேள்விகள் (யார்? என்று கேட்டால்):
- அவர் யாருடைய மகன் அல்லது மகள், குடும்ப பின்னணி என்ன என்று தொடங்கு.
- அவருடைய வாழ்க்கையில் நடந்த முக்கிய நிகழ்வுகள் கதை போல் விரிவாக சொல்.
- அவருடைய role, struggles, faith journey பற்றி தெளிவாக சொல்.
- அவருடைய spiritual significance என்ன என்று முடி.
- குறைந்தது 3 முழு paragraphs எழுது.

பொது வேதாகம கேள்விகள்:
- கேள்விக்கு நேரடியாக பதில் சொல்.
- Bible context வசனங்களை இயற்கையாக quote செய்.
- 2 முதல் 3 paragraphs எழுது.`;

/* ═══════════════════════════════════════════
   ROUTES
═══════════════════════════════════════════ */
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    versesLoaded: verses.length,
    booksLoaded:  Object.keys(bookNames).length,
    indexed,
    geminiKeySet: !!GEMINI_KEY && GEMINI_KEY !== "YOUR_GEMINI_API_KEY_HERE"
  });
});

app.post("/api/ask", async (req, res) => {
  try {
    const { question, bookNum, chapter, history = [] } = req.body;
    if (!question?.trim()) return res.status(400).json({ error: "INVALID", message: "கேள்வி எழுதுங்கள்." });

    const q = question.trim().slice(0, 500);

    // Character/person questions → search whole Bible for all mentions
    const isCharacterQ = /யார்|யாரு|யாரே|who is|who was|பற்றி சொல்|பற்றி விளக்கு|பற்றி கூறு|வாழ்க்கை|வரலாறு/i.test(q);

    let found;
    if (isCharacterQ) {
      found = ragSearch(q, 35, null, null); // whole Bible
    } else {
      found = ragSearch(q, 25, bookNum ? +bookNum : null, chapter ? +chapter : null);
      if (found.length < 5) found = ragSearch(q, 25, null, null); // broaden if too few
    }

    const context = formatContext(found);
    const sources = [...new Set(found.map(v => `${v.bookName} ${v.chapter}:${v.verse}`))].slice(0, 6);
    const system  = `${SYSTEM_BASE}\n\nBible Context:\n${context}`;

    const answer = await callGemini(system, q, history);
    res.json({ answer, sources });
  } catch (e) {
    console.error("/api/ask error:", e.message);
    const msg = e.code === "QUOTA"
      ? "API quota தீர்ந்துவிட்டது. சில நிமிடங்கள் பிறகு முயற்சிக்கவும்."
      : "பிழை நேர்ந்தது. மீண்டும் முயற்சிக்கவும்.";
    res.status(500).json({ error: "SERVER_ERROR", message: msg });
  }
});

app.post("/api/summary", async (req, res) => {
  try {
    const { bookNum, bookName, chapter } = req.body;
    if (!bookNum || !chapter) return res.status(400).json({ error: "INVALID" });

    const chVerses = verses.filter(v => v.bookNum === +bookNum && v.chapter === +chapter);
    if (!chVerses.length) return res.status(404).json({ error: "NOT_FOUND", message: "வசனங்கள் இல்லை." });

    const ctx = chVerses.map(v => `${v.verse}. ${v.text}`).join("\n");

    const prompt = `${bookName || ""} ${chapter}-ஆம் அதிகாரத்தின் முழுமையான summary மூன்று paragraphs-ஆக எழுது.

முதல் paragraph: இந்த அதிகாரத்தில் நடந்த அனைத்து முக்கிய நிகழ்வுகளையும் கதை சொல்வது போல் விரிவாக விவரி. யார் யார் இருந்தார்கள், என்ன நடந்தது, எங்கே நடந்தது என்று தெளிவாக சொல்.

இரண்டாவது paragraph: இந்த அதிகாரத்தின் central message என்ன, முக்கியமான கருத்துக்கள் என்ன என்று explain செய். இந்த அதிகாரம் யாரைப் பற்றியது, என்ன நோக்கத்திற்காக எழுதப்பட்டது என்று சொல்.

மூன்றாவது paragraph: இந்த அதிகாரத்தின் spiritual meaning என்ன, இன்றைய நம் வாழ்க்கையில் இதன் தொடர்பு என்ன என்று சொல். இது நமக்கு என்ன கற்பிக்கிறது என்று அன்போடு முடி.

மூன்று paragraphs-உம் flowing Tamil-ல் இருக்கட்டும். bullet points, headers, dashes வேண்டவே வேண்டாம்.`;

    const system = `நீ ஒரு அன்பான தமிழ் கத்தோலிக்க வேதாகம ஆசிரியர். உன் பெயர் Ask Bible.
கீழே கொடுத்த வசனங்களை மட்டுமே ஆதாரமாக பயன்படுத்தி flowing Tamil paragraphs-ல் பதில் சொல். bullet points வேண்டாம்.

வசனங்கள்:
${ctx}`;

    const summary = await callGemini(system, prompt);
    res.json({ summary, versesCount: chVerses.length });
  } catch (e) {
    console.error("/api/summary error:", e.message);
    res.status(500).json({ error: "SERVER_ERROR", message: "பிழை நேர்ந்தது." });
  }
});

app.get("/api/search", (req, res) => {
  const { q, bookNum, chapter, limit = 10 } = req.query;
  if (!q || q.length < 2) return res.json({ results: [] });
  const results = ragSearch(q, +limit, bookNum ? +bookNum : null, chapter ? +chapter : null);
  res.json({ results: results.map(v => ({ ref: `${v.bookName} ${v.chapter}:${v.verse}`, text: v.text.slice(0, 120), bookNum: v.bookNum, chapter: v.chapter, verse: v.verse })) });
});

app.get("*", (req, res) => {
  const html = path.join(ROOT, "index.html");
  if (fs.existsSync(html)) res.sendFile(html);
  else res.send("Ask Bible server is running.");
});

/* ═══════════════════════════════════════════
   START
═══════════════════════════════════════════ */
async function start() {
  console.log("\n╔══════════════════════════════════╗");
  console.log("║   Ask Bible RAG Server           ║");
  console.log("╚══════════════════════════════════╝\n");

  if (!GEMINI_KEY || GEMINI_KEY === "YOUR_GEMINI_API_KEY_HERE") {
    console.warn("⚠  GEMINI_API_KEY not set in .env");
  } else {
    console.log("✅ Gemini API key found");
  }

  console.log("📖 Loading Bible data from:", DATA_PATH);
  loadBookNames();
  const ot = loadDir(path.join(DATA_PATH, "ot"), "OT");
  const nt = loadDir(path.join(DATA_PATH, "nt"), "NT");
  console.log(`   OT: ${ot.toLocaleString()} verses`);
  console.log(`   NT: ${nt.toLocaleString()} verses`);
  console.log(`   Total: ${verses.length.toLocaleString()} in ${Object.keys(bookNames).length} books`);

  if (verses.length > 0) {
    console.log("🔍 Building search index...");
    buildTfIdf();
    indexed = true;
    console.log("✅ Index ready");
  } else {
    console.warn("⚠  No verses loaded — check data/ folder");
  }

  app.listen(PORT, () => {
    console.log(`\n🚀 http://localhost:${PORT}`);
    console.log(`   ${DAILY_LIMIT} questions/user/day · ${MIN_LIMIT}/min\n`);
  });
}

start().catch(err => { console.error("❌ Startup failed:", err.message); process.exit(1); });