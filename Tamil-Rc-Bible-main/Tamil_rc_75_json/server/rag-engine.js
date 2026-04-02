/* ============================================================
   server/rag-engine.js
   
   The RAG (Retrieval Augmented Generation) engine.
   
   HOW IT WORKS:
   1. Loads all your Tamil Bible JSON files from /data/ot and /data/nt
   2. Builds a searchable index of every verse in memory
   3. When a user asks a question, finds the most relevant verses
      using keyword matching + Tamil character normalization
   4. Returns the top N verses to the LLM as context
   
   NO EXTERNAL VECTOR DB NEEDED — works with your existing JSON files.
============================================================ */

const fs   = require("fs");
const path = require("path");

/* ── CONFIG ── */
const DATA_DIR    = path.join(__dirname, "../data");
const OT_DIR      = path.join(DATA_DIR, "ot");
const NT_DIR      = path.join(DATA_DIR, "nt");
const BOOKS_FILE  = path.join(__dirname, "../books_order.json");
const TOP_K       = 12;   // how many verses to return per query

/* ── IN-MEMORY INDEX ── */
// Structure: [{ bookNum, bookName, testament, chapter, verse, text, tokens }]
let verseIndex = [];
let booksMap   = new Map(); // bookNum → { name_ta, name_en, testament }
let indexBuilt = false;

/* ============================================================
   NORMALIZATION & TOKENIZATION
============================================================ */

/**
 * Normalize Tamil text for matching:
 * - lowercase
 * - remove punctuation
 * - normalize common Tamil spelling variations
 */
function normalizeTamil(text) {
  if (!text) return "";
  return text
    .toLowerCase()
    .replace(/[.,;:!?'"()[\]{}—–-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Tokenize Tamil text into meaningful word units.
 * Tamil words are space-separated so simple split works well.
 * Also extract character n-grams for partial matching.
 */
function tokenize(text) {
  const normalized = normalizeTamil(text);
  const words = normalized.split(" ").filter(w => w.length > 1);
  
  // Add 2-gram and 3-gram character sequences for fuzzy matching
  const ngrams = new Set();
  for (const word of words) {
    if (word.length >= 2) {
      for (let i = 0; i <= word.length - 2; i++) ngrams.add(word.slice(i, i + 2));
    }
    if (word.length >= 3) {
      for (let i = 0; i <= word.length - 3; i++) ngrams.add(word.slice(i, i + 3));
    }
  }
  
  return { words, ngrams: Array.from(ngrams) };
}

/* ============================================================
   JSON NORMALIZER
   (Same logic as your existing app.js normalizer)
============================================================ */
function normalizeBookJSON(raw) {
  const map = new Map();
  
  const add = (ch, v, t) => {
    const c = Number(ch), vn = Number(v), text = (t ?? "").toString().trim();
    if (!c || !vn || !text) return;
    if (!map.has(c)) map.set(c, []);
    map.get(c).push({ v: vn, t: text });
  };

  const roots = [
    raw?.BIBLE_TEXT, raw?.bible_text, raw?.text, raw?.data,
    raw?.verses, raw?.chapters, raw?.Chapters, raw?.chapter, raw?.Chapter
  ].filter(Boolean);
  if (!roots.length) roots.push(raw);

  for (const root of roots) {
    if (Array.isArray(root) && root.length && typeof root[0] === "object" && !Array.isArray(root[0])) {
      let hit = 0;
      for (const row of root) {
        const ch = row.chapter ?? row.ch ?? row.c ?? row.Chapter;
        const v  = row.verse   ?? row.v  ?? row.vn ?? row.Verse;
        const t  = row.text    ?? row.t  ?? row.value ?? row.verseText ?? row.VerseText;
        if (ch && v && t) { add(ch, v, t); hit++; }
      }
      if (hit) break;
    }

    if (Array.isArray(root) && root.length && Array.isArray(root[0])) {
      let hit = 0;
      root.forEach((arr, i) => arr.forEach((vt, j) => {
        if (typeof vt === "string" && vt.trim()) { add(i + 1, j + 1, vt); hit++; }
      }));
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

  for (const [, list] of map.entries()) list.sort((a, b) => a.v - b.v);
  return map;
}

/* ============================================================
   INDEX BUILDER
============================================================ */
function loadJSONSafe(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function tryPaths(bookNum, testament) {
  const dir  = testament === "nt" ? NT_DIR : OT_DIR;
  const pads = [
    path.join(dir, `${bookNum}.json`),
    path.join(dir, `${String(bookNum).padStart(2, "0")}.json`),
    path.join(dir, `book_${bookNum}.json`),
    path.join(dir, `book${bookNum}.json`),
  ];
  for (const p of pads) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function buildIndex() {
  if (indexBuilt) return;
  console.log("[RAG] Building verse index from Bible JSON files...");

  // Load books_order.json
  const booksOrder = loadJSONSafe(BOOKS_FILE);
  if (!booksOrder) {
    console.error("[RAG] ERROR: books_order.json not found at", BOOKS_FILE);
    return;
  }

  const allBooks = [
    ...(booksOrder.old_testament || []).map(b => ({ ...b, testament: "ot" })),
    ...(booksOrder.deuterocanon  || []).map(b => ({ ...b, testament: "ot" })),
    ...(booksOrder.new_testament || []).map(b => ({ ...b, testament: "nt" })),
  ];

  let totalVerses = 0;

  for (const book of allBooks) {
    booksMap.set(book.bookNum, {
      name_ta:   book.name_ta,
      name_en:   book.name_en || book.name_ta,
      testament: book.testament,
    });

    const filePath = tryPaths(book.bookNum, book.testament);
    if (!filePath) {
      console.warn(`[RAG] No file found for book ${book.bookNum} (${book.name_ta})`);
      continue;
    }

    const raw  = loadJSONSafe(filePath);
    if (!raw) continue;

    const versesByChapter = normalizeBookJSON(raw);

    for (const [chapter, verses] of versesByChapter.entries()) {
      for (const { v, t } of verses) {
        const { words, ngrams } = tokenize(t);
        verseIndex.push({
          bookNum:   book.bookNum,
          bookName:  book.name_ta,
          testament: book.testament,
          chapter,
          verse:     v,
          text:      t,
          words,
          ngrams,
        });
        totalVerses++;
      }
    }
  }

  indexBuilt = true;
  console.log(`[RAG] Index built: ${totalVerses} verses across ${allBooks.length} books`);
}

/* ============================================================
   SCORING — BM25-inspired keyword scoring
============================================================ */

/**
 * Score a verse against a query.
 * Returns a relevance score (higher = more relevant).
 */
function scoreVerse(verse, queryWords, queryNgrams) {
  let score = 0;

  for (const qw of queryWords) {
    // Exact word match → high score
    if (verse.words.includes(qw)) {
      score += 3;
      // Bonus if the query word appears multiple times in the verse
      const count = verse.words.filter(w => w === qw).length;
      score += (count - 1) * 1.5;
    }
    // Partial word match (verse word starts with query word)
    else if (verse.words.some(w => w.startsWith(qw) || qw.startsWith(w))) {
      score += 1.5;
    }
  }

  // N-gram matching for partial Tamil morphological forms
  for (const qng of queryNgrams) {
    if (verse.ngrams.includes(qng)) score += 0.3;
  }

  return score;
}

/* ============================================================
   BOOK NAME RESOLVER
   Maps book name queries to book numbers
   e.g. "ஆதியாகமம்" → bookNum 1
============================================================ */
function findBookByName(query) {
  const q = normalizeTamil(query);
  for (const [bookNum, info] of booksMap.entries()) {
    if (normalizeTamil(info.name_ta).includes(q) || q.includes(normalizeTamil(info.name_ta).slice(0, 4))) {
      return bookNum;
    }
  }
  return null;
}

/* ============================================================
   MAIN SEARCH FUNCTION
============================================================ */

/**
 * Search the Bible index for verses relevant to a query.
 * 
 * @param {string} query         - User's question in Tamil/English
 * @param {object} context       - Current reader context { bookNum, chapter, verses }
 * @param {number} topK          - Number of top verses to return
 * @returns {Array}              - Array of relevant verse objects with metadata
 */
function search(query, context = {}, topK = TOP_K) {
  if (!indexBuilt || verseIndex.length === 0) {
    console.warn("[RAG] Index not built yet");
    return [];
  }

  const { words: queryWords, ngrams: queryNgrams } = tokenize(query);

  // Score every verse
  const scored = verseIndex.map(verse => ({
    ...verse,
    score: scoreVerse(verse, queryWords, queryNgrams),
  }));

  // BOOST: Give extra weight to verses from current book/chapter
  if (context.bookNum) {
    for (const v of scored) {
      if (v.bookNum === context.bookNum) {
        v.score += 1.0;
        if (v.chapter === context.chapter) v.score += 2.0;
      }
    }
  }

  // Filter out zero-score verses, sort descending
  const relevant = scored
    .filter(v => v.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  // If almost nothing found, fall back to current chapter verses
  if (relevant.length < 3 && context.bookNum && context.chapter) {
    const chapterVerses = verseIndex
      .filter(v => v.bookNum === context.bookNum && v.chapter === context.chapter)
      .slice(0, topK);
    return chapterVerses;
  }

  return relevant;
}

/**
 * Get all verses from a specific book and chapter.
 * Used for chapter summary requests.
 */
function getChapterVerses(bookNum, chapter) {
  return verseIndex.filter(v => v.bookNum === bookNum && v.chapter === chapter);
}

/**
 * Format retrieved verses into a clean context string for the LLM.
 */
function formatContext(verses) {
  if (!verses.length) return "தொடர்புடைய வசனங்கள் கிடைக்கவில்லை.";

  // Group by book+chapter for cleaner formatting
  const grouped = new Map();
  for (const v of verses) {
    const key = `${v.bookName} ${v.chapter}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(v);
  }

  const parts = [];
  for (const [ref, vList] of grouped.entries()) {
    const verseLines = vList
      .sort((a, b) => a.verse - b.verse)
      .map(v => `  ${v.verse}. ${v.text}`)
      .join("\n");
    parts.push(`[${ref}]\n${verseLines}`);
  }

  return parts.join("\n\n");
}

/**
 * Get stats about the current index.
 */
function getStats() {
  return {
    totalVerses: verseIndex.length,
    totalBooks:  booksMap.size,
    indexBuilt,
  };
}

module.exports = {
  buildIndex,
  search,
  getChapterVerses,
  formatContext,
  getStats,
  findBookByName,
  booksMap,
};