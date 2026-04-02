/**
 * BibleService
 * Handles loading of books, chapter data, and randomization.
 */
const BibleService = (() => {
  const BOOKS_ORDER_URL = "./assets/data/books_order.json";
  const DATA_FOLDERS = { ot: "./assets/data/ot", nt: "./assets/data/nt" };
  const bookCache = new Map();

  function detectTestament(n) { return n >= 49 ? "nt" : "ot"; }

  function buildCandidatePaths(bookNum) {
    const base = detectTestament(bookNum) === "ot" ? DATA_FOLDERS.ot : DATA_FOLDERS.nt;
    return [
      `${base}/${bookNum}.json`,
      `${base}/${String(bookNum).padStart(2,"0")}.json`,
      `${base}/book_${bookNum}.json`,
      `${base}/book${bookNum}.json`,
    ];
  }

  async function fetchFirstJSON(paths) {
    let last;
    for (const p of paths) {
      try {
        const r = await fetch(p, { cache: "no-store" });
        if (!r.ok) { last = new Error(`HTTP ${r.status}: ${p}`); continue; }
        return { json: await r.json(), path: p };
      } catch (e) { last = e; }
    }
    throw last || new Error("No Bible JSON path worked.");
  }

  function normalizeBookJSON(raw) {
    const map = new Map();
    const add = (ch, v, t) => {
      const c = Number(ch), vn = Number(v), text = (t ?? "").toString().trim();
      if (!c || !vn || !text) return;
      if (!map.has(c)) map.set(c, []);
      map.get(c).push({ v: vn, t: text });
    };

    const roots = [raw?.BIBLE_TEXT, raw?.bible_text, raw?.text, raw?.data,
                   raw?.verses, raw?.chapters, raw?.Chapters, raw?.chapter, raw?.Chapter]
      .filter(Boolean);
    if (!roots.length) roots.push(raw);

    for (const root of roots) {
      if (Array.isArray(root) && root.length && typeof root[0] === "object" && !Array.isArray(root[0])) {
        let hit = 0;
        for (const row of root) {
          const ch = row.chapter ?? row.ch ?? row.c ?? row.Chapter;
          const v = row.verse ?? row.v ?? row.vn ?? row.Verse;
          const t = row.text ?? row.t ?? row.value ?? row.verseText ?? row.VerseText;
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
        const tryChapObj = obj => {
          const keys = Object.keys(obj).filter(k => /^\d+$/.test(k));
          if (!keys.length) return 0;
          let hit = 0;
          for (const ck of keys) {
            const cv = obj[ck];
            if (Array.isArray(cv)) {
              cv.forEach((item, idx) => {
                if (typeof item === "string" && item.trim()) { add(ck, idx + 1, item); hit++; }
                else if (item && typeof item === "object") {
                  if (item.type === "V" && item.text) { add(ck, item.v ?? (idx + 1), item.text); hit++; }
                  else { const v = item.verse ?? item.v ?? (idx + 1); const t = item.text ?? item.t ?? item.value; if (t) { add(ck, v, t); hit++; } }
                }
              });
            } else if (cv && typeof cv === "object") {
              const vkeys = Object.keys(cv).filter(k => /^\d+$/.test(k));
              if (vkeys.length) { vkeys.forEach(vk => add(ck, vk, cv[vk])); hit += vkeys.length; }
              else if (Array.isArray(cv.verses)) {
                cv.verses.forEach((row, idx) => { const v = row.verse ?? row.v ?? (idx + 1); const t = row.text ?? row.t ?? row.value; if (t) { add(ck, v, t); hit++; } });
              }
            }
          }
          return hit;
        };
        let hit = tryChapObj(root);
        if (!hit && root.chapters) hit = tryChapObj(root.chapters);
        if (hit) break;
      }
    }

    for (const [ch, list] of map.entries()) list.sort((a, b) => a.v - b.v);
    const chapterCount = Math.max(0, ...Array.from(map.keys()));
    return { versesByChapter: map, chapterCount };
  }

  return {
    async loadBooksOrder() {
      const r = await fetch(BOOKS_ORDER_URL, { cache: "no-store" });
      if (!r.ok) throw new Error(`books_order.json HTTP ${r.status}`);
      return r.json();
    },

    async loadBook(bookNum) {
      if (bookCache.has(bookNum)) return bookCache.get(bookNum);
      const { json, path } = await fetchFirstJSON(buildCandidatePaths(bookNum));
      const norm = normalizeBookJSON(json);
      const payload = { raw: json, ...norm, sourcePath: path };
      bookCache.set(bookNum, payload);
      return payload;
    },

    async getRandomVerse(booksOrder) {
      const allBooks = [...booksOrder.old_testament, ...booksOrder.deuterocanon, ...booksOrder.new_testament];
      const randBook = allBooks[Math.floor(Math.random() * allBooks.length)];
      const p = await this.loadBook(randBook.bookNum);
      
      if (p && p.chapterCount) {
        const randCh = Math.floor(Math.random() * p.chapterCount) + 1;
        const verses = p.versesByChapter.get(randCh) || [];
        if (verses.length) {
          const v = verses[Math.floor(Math.random() * verses.length)];
          return {
            text: v.t,
            ref: `${randBook.name_ta} ${randCh}:${v.v}`
          };
        }
      }
      return { text: "கர்த்தர் என் மேய்ப்பராயிருக்கிறார்; நான் தாழ்ச்சியடையேன்.", ref: "சங்கீதம் 23:1" };
    }
  };
})();
