/* ===========================
   Tamil RC Bible App (Offline-first)
   - Books from ./books_order.json  (your file) :contentReference[oaicite:1]{index=1}
   - Bible text: flexible loader (tries many paths/shapes)
   - Reader: chapters + verse list + highlighter + bio search
   - Random verse: uses loaded text if available, else loads a random book
   - Songs: placeholder via ./data/songs.json
=========================== */

const $ = (id) => document.getElementById(id);

/** -------------------------
 *  SETTINGS (EDITABLE)
 *  If later you add a backend LLM API, set BIO_API_URL to your endpoint.
 *  Example: "https://your-domain.com/api/bio"
-------------------------- */
const BIO_API_URL = "";     // keep "" for local-only mode now
const SONGS_JSON_PATH = "./data/songs.json"; // optional

/** -------------------------
 *  App State
-------------------------- */
let currentFontSize = 16;

let booksOrder = null; // loaded from books_order.json
let allBooksFlat = []; // [{bookNum, name_ta, group}...]
let currentBook = null; // {bookNum, name_ta}
let currentChapter = 1;

let highlightColor = "#FDE047";
let highlightModeDesktop = false;
let highlightModeMobile = false;

// Caches
const bookTextCache = new Map();  // bookNum -> normalizedBookData
let combinedBibleCache = null;    // if you have one big JSON file, we can load it here

/** -------------------------
 *  NORMALIZED BOOK DATA FORMAT (what we convert everything into)
 *  {
 *    bookNum: number,
 *    name_ta: string,
 *    chapters: [
 *      [ {v:1, t:"..."}, {v:2, t:"..."} ],   // chapter 1
 *      [ ... ]                              // chapter 2
 *    ]
 *  }
-------------------------- */

/** -------------------------
 *  UTIL: UI Navigation
-------------------------- */
function showDesktopScreen(key) {
  document.querySelectorAll(".d-screen").forEach(s => s.classList.add("hidden"));
  const el = $(`d-${key}`);
  if (el) el.classList.remove("hidden");

  // highlight nav colors
  document.querySelectorAll("[data-dnav]").forEach(btn => {
    btn.classList.remove("text-blue-600");
    btn.classList.add("text-gray-600");
  });
  const active = document.querySelector(`[data-dnav="${key}"]`);
  if (active) {
    active.classList.add("text-blue-600");
    active.classList.remove("text-gray-600");
  }
}

function showMobileScreen(key) {
  document.querySelectorAll(".m-screen").forEach(s => s.classList.add("hidden"));
  const el = $(key);
  if (el) el.classList.remove("hidden");

  document.querySelectorAll(".mobile-tab").forEach(t => t.classList.remove("active"));
  const tab = document.querySelector(`.mobile-tab[data-mtab="${key}"]`);
  if (tab) tab.classList.add("active");
}

/** -------------------------
 *  Books Loader
-------------------------- */
async function loadBooksOrder() {
  const res = await fetch("./books_order.json");
  if (!res.ok) throw new Error("books_order.json load failed");
  booksOrder = await res.json();

  const ot = booksOrder.old_testament || [];
  const deut = booksOrder.deuterocanon || [];
  const nt = booksOrder.new_testament || [];

  allBooksFlat = [
    ...ot.map(b => ({ ...b, group: "ot" })),
    ...deut.map(b => ({ ...b, group: "ot" })),   // treat RC deuterocanon as OT group UI
    ...nt.map(b => ({ ...b, group: "nt" })),
  ];

  // counts
  const otCount = ot.length + deut.length;
  const ntCount = nt.length;

  // desktop counts
  $("d-ot-count").textContent = `${otCount} புத்தகங்கள்`;
  $("d-nt-count").textContent = `${ntCount} புத்தகங்கள்`;

  // mobile counts
  $("m-ot-count").textContent = `${otCount} புத்தகங்கள்`;
  $("m-nt-count").textContent = `${ntCount} புத்தகங்கள்`;

  renderBooks();
}

function renderBooks() {
  // Desktop
  const dOt = $("d-ot-books");
  const dNt = $("d-nt-books");
  dOt.innerHTML = "";
  dNt.innerHTML = "";

  // Mobile
  const mOt = $("m-ot-books");
  const mNt = $("m-nt-books");
  mOt.innerHTML = "";
  mNt.innerHTML = "";

  const otBooks = allBooksFlat.filter(b => b.group === "ot");
  const ntBooks = allBooksFlat.filter(b => b.group === "nt");

  otBooks.forEach(b => {
    dOt.appendChild(makeDesktopBookButton(b, false));
    mOt.appendChild(makeMobileBookButton(b, false));
  });

  ntBooks.forEach(b => {
    dNt.appendChild(makeDesktopBookButton(b, true));
    mNt.appendChild(makeMobileBookButton(b, true));
  });
}

function makeDesktopBookButton(book, isNT) {
  const btn = document.createElement("button");
  btn.className = "book-btn";
  btn.innerHTML = `
    <div>
      <div class="font-bold text-gray-800">${escapeHtml(book.name_ta)}</div>
      <div class="text-xs text-gray-500">Book #${book.bookNum}</div>
    </div>
    <span class="book-chip ${isNT ? "nt" : ""}">Open</span>
  `;
  btn.addEventListener("click", () => openReaderDesktop(book.bookNum));
  return btn;
}

function makeMobileBookButton(book, isNT) {
  const btn = document.createElement("button");
  btn.className = "book-btn";
  btn.innerHTML = `
    <div>
      <div class="font-bold text-gray-800 text-sm">${escapeHtml(book.name_ta)}</div>
      <div class="text-[11px] text-gray-500">Book #${book.bookNum}</div>
    </div>
    <span class="book-chip ${isNT ? "nt" : ""}">Open</span>
  `;
  btn.addEventListener("click", () => openReaderMobile(book.bookNum));
  return btn;
}

/** -------------------------
 *  Reader open (Next slide)
-------------------------- */
async function openReaderDesktop(bookNum) {
  currentBook = allBooksFlat.find(b => b.bookNum === bookNum) || { bookNum, name_ta: `Book ${bookNum}` };
  currentChapter = 1;

  // hide book lists, show reader
  $("d-reader").classList.remove("hidden");
  $("d-reader-title").textContent = currentBook.name_ta;
  $("d-reader-subtitle").textContent = `Book #${currentBook.bookNum}`;
  $("d-left-info").textContent = `${currentBook.name_ta}`;

  // scroll to reader
  $("d-reader").scrollIntoView({ behavior: "smooth", block: "start" });

  // Load data
  const data = await ensureBookLoaded(bookNum, "desktop");
  if (!data) return;

  renderChapterButtons("desktop", data);
  await setChapter("desktop", 1);
}

async function openReaderMobile(bookNum) {
  currentBook = allBooksFlat.find(b => b.bookNum === bookNum) || { bookNum, name_ta: `Book ${bookNum}` };
  currentChapter = 1;

  // next slide: hide list, show reader
  $("m-book-list").classList.add("hidden");
  $("m-reader").classList.remove("hidden");

  $("m-reader-title").textContent = currentBook.name_ta;
  $("m-reader-subtitle").textContent = `Book #${currentBook.bookNum}`;

  const data = await ensureBookLoaded(bookNum, "mobile");
  if (!data) return;

  renderChapterButtons("mobile", data);
  await setChapter("mobile", 1);
}

/** Back buttons */
function backToBooksDesktop() {
  $("d-reader").classList.add("hidden");
}
function backToBooksMobile() {
  $("m-reader").classList.add("hidden");
  $("m-book-list").classList.remove("hidden");
}

/** -------------------------
 *  Chapter + Verse Rendering
-------------------------- */
function renderChapterButtons(mode, bookData) {
  const chaptersCount = bookData.chapters.length;

  if (mode === "desktop") {
    const wrap = $("d-chapters");
    wrap.innerHTML = "";
    for (let i = 1; i <= chaptersCount; i++) {
      const b = document.createElement("button");
      b.className = "chapter-btn";
      b.textContent = i;
      b.addEventListener("click", () => setChapter("desktop", i));
      wrap.appendChild(b);
    }
  } else {
    const wrap = $("m-chapters");
    wrap.innerHTML = "";
    for (let i = 1; i <= chaptersCount; i++) {
      const b = document.createElement("button");
      b.className = "chapter-btn text-xs";
      b.textContent = i;
      b.addEventListener("click", () => setChapter("mobile", i));
      wrap.appendChild(b);
    }
  }

  // set active UI
  setActiveChapterButton(mode, 1);
}

function setActiveChapterButton(mode, chap) {
  const selector = mode === "desktop" ? "#d-chapters .chapter-btn" : "#m-chapters .chapter-btn";
  document.querySelectorAll(selector).forEach((btn, idx) => {
    btn.classList.toggle("active", (idx + 1) === chap);
  });
}

async function setChapter(mode, chap) {
  const bookData = bookTextCache.get(currentBook.bookNum);
  if (!bookData) return;

  currentChapter = chap;
  setActiveChapterButton(mode, chap);

  const verses = bookData.chapters[chap - 1] || [];

  // Verse list (left)
  const listEl = mode === "desktop" ? $("d-verse-list") : $("m-verse-list");
  listEl.innerHTML = "";
  if (!verses.length) {
    listEl.innerHTML = `<p class="text-xs text-gray-500 text-center">இந்த அதிகாரத்தில் data இல்லை</p>`;
  } else {
    verses.forEach(v => {
      const li = document.createElement("div");
      li.className = "verse-li";
      li.innerHTML = `<span class="text-xs font-bold text-blue-600">${v.v}</span> <span class="text-xs text-gray-700">${escapeHtml(shortText(v.t, 60))}</span>`;
      li.addEventListener("click", () => scrollToVerse(mode, v.v));
      listEl.appendChild(li);
    });
  }

  // Verse container (right)
  const container = mode === "desktop" ? $("d-verse-container") : $("m-verse-container");
  container.innerHTML = "";
  if (!verses.length) {
    container.innerHTML = `<p class="text-gray-500 text-center text-base">வசனங்கள் இங்கே வெளிப்படும்</p>`;
  } else {
    verses.forEach(v => {
      const line = document.createElement("div");
      line.className = "verse-line";
      line.id = `${mode}-verse-${v.v}`;
      line.innerHTML = `<span class="verse-num">${v.v}</span><span class="verse-text">${escapeHtml(v.t)}</span>`;
      container.appendChild(line);
    });
  }

  // Header
  if (mode === "desktop") {
    $("d-verse-header").textContent = `${currentBook.name_ta} ${chap}`;
    $("d-data-status").textContent = `Loaded: Book #${bookData.bookNum} | Chapters: ${bookData.chapters.length} | Chapter: ${chap}`;
  } else {
    $("m-data-status").textContent = `Loaded: Book #${bookData.bookNum} | Chapters: ${bookData.chapters.length} | Chapter: ${chap}`;
  }
}

function scrollToVerse(mode, verseNum) {
  const el = $(`${mode}-verse-${verseNum}`);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
}

/** -------------------------
 *  Highlighter (safer than surroundContents)
-------------------------- */
function toggleHighlighter(mode) {
  if (mode === "desktop") {
    highlightModeDesktop = !highlightModeDesktop;
    $("d-highlighter-toolbar").classList.toggle("hidden", !highlightModeDesktop);
    $("d-toggle-highlighter").classList.toggle("bg-yellow-200", highlightModeDesktop);
    $("d-toggle-highlighter").classList.toggle("text-yellow-900", highlightModeDesktop);

    const container = $("d-verse-container");
    container.style.cursor = highlightModeDesktop ? "text" : "auto";
  } else {
    highlightModeMobile = !highlightModeMobile;
    $("m-highlighter-toolbar").classList.toggle("hidden", !highlightModeMobile);

    const container = $("m-verse-container");
    container.style.cursor = highlightModeMobile ? "text" : "auto";
  }
}

function applyHighlightIfEnabled(mode) {
  const enabled = mode === "desktop" ? highlightModeDesktop : highlightModeMobile;
  if (!enabled) return;

  const sel = window.getSelection();
  if (!sel || sel.toString().trim().length === 0) return;

  // Must be inside verse container
  const container = mode === "desktop" ? $("d-verse-container") : $("m-verse-container");
  const range = sel.getRangeAt(0);

  if (!container.contains(range.commonAncestorContainer)) return;

  try {
    const span = document.createElement("span");
    span.style.backgroundColor = highlightColor;
    span.style.padding = "2px 4px";
    span.style.borderRadius = "4px";

    // safer: extract contents and wrap
    const frag = range.extractContents();
    span.appendChild(frag);
    range.insertNode(span);
    sel.removeAllRanges();
  } catch (e) {
    // If selection crosses complex nodes, we fail safely
    sel.removeAllRanges();
    alert("Highlight failed. Try selecting within one verse line.");
  }
}

function clearHighlights(mode) {
  const container = mode === "desktop" ? $("d-verse-container") : $("m-verse-container");
  // remove highlight spans by replacing with text nodes
  const spans = container.querySelectorAll("span[style*='background-color']");
  spans.forEach(s => {
    const text = document.createTextNode(s.textContent);
    s.parentNode.replaceChild(text, s);
  });
}

/** Color dots */
function bindHighlighterColors() {
  document.querySelectorAll(".hl-dot").forEach(btn => {
    btn.addEventListener("click", () => {
      highlightColor = btn.dataset.color || "#FDE047";
    });
  });
}

/** -------------------------
 *  BIO SEARCH (Local now, API later)
-------------------------- */
async function bioSearch(query, mode) {
  const q = (query || "").trim();
  if (!q) return;

  const resultBox = mode === "desktop" ? $("d-bio-result") : $("m-bio-result");
  const titleEl = mode === "desktop" ? $("d-bio-title") : $("m-bio-title");
  const textEl = mode === "desktop" ? $("d-bio-text") : $("m-bio-text");
  const versesEl = mode === "desktop" ? $("d-bio-verses") : $("m-bio-verses");

  resultBox.classList.remove("hidden");
  titleEl.textContent = "Bio";
  textEl.textContent = "தேடிக்கொண்டிருக்கிறோம்...";
  versesEl.textContent = "";

  // If you add backend later:
  if (BIO_API_URL) {
    try {
      const res = await fetch(BIO_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q })
      });
      const data = await res.json();
      textEl.textContent = data.bio || "தகவல் இல்லை.";
      versesEl.textContent = data.verses ? `Verses: ${data.verses.join(", ")}` : "";
      return;
    } catch {
      // fallback to local
    }
  }

  // LOCAL MODE:
  // Put bios in ./data/bios.json like:
  // { "தாவீது": { "bio":"...", "verses":["சங் 23:1","1 சாமு 16:13"] }, ... }
  const local = await loadLocalBios();
  const hit = local[q] || local[normalizeKey(q)];
  if (hit) {
    titleEl.textContent = q;
    textEl.textContent = hit.bio || "Bio இல்லை.";
    versesEl.textContent = hit.verses?.length ? `குறிப்பு வசனங்கள்: ${hit.verses.join(", ")}` : "இந்த பெயருக்கு verse index இல்லை.";
  } else {
    titleEl.textContent = q;
    textEl.textContent = `"${q}" பற்றி தகவல் கிடைக்கவில்லை.`;
    versesEl.textContent = "Tip: data/bios.json ல add பண்ணலாம் அல்லது பின்னாடி LLM API இணைக்கலாம்.";
  }
}

let localBiosCache = null;
async function loadLocalBios() {
  if (localBiosCache) return localBiosCache;
  try {
    const res = await fetch("./data/bios.json");
    if (!res.ok) throw new Error();
    localBiosCache = await res.json();
    return localBiosCache;
  } catch {
    localBiosCache = {
      "தாவீது": { bio: "தாவீது இஸ்ரவேலின் ராஜா; சங்கீதங்களை எழுதியவர் என்று பல இடங்களில் குறிப்பிடப்படுகிறார்.", verses: ["சங்கீதம் 23:1", "1 சாமுவேல் 16:13"] },
      "மோசே": { bio: "மோசே எகிப்திலிருந்து இஸ்ரவேலை விடுவிக்க இறைவனால் தேர்ந்தெடுக்கப்பட்ட தலைவர்.", verses: ["விடுதலைப் பயணம் 3:10", "விடுதலைப் பயணம் 14:21"] },
      "பவுல்": { bio: "திருத்தூதர் பவுல் புதிய ஏற்பாட்டில் பல கடிதங்களை எழுதியவர்.", verses: ["திருத்தூதர் பணிகள் 9:15", "உரோமையர் 1:1"] }
    };
    return localBiosCache;
  }
}

/** -------------------------
 *  SONG SEARCH (Placeholder)
-------------------------- */
let songsCache = null;
async function loadSongs() {
  if (songsCache) return songsCache;
  try {
    const res = await fetch(SONGS_JSON_PATH);
    if (!res.ok) throw new Error();
    songsCache = await res.json();
    return songsCache;
  } catch {
    songsCache = [
      { title: "Sample Song 1", lyrics: "அருளால் நிறைந்த பாடல்...", tags: ["worship"] },
      { title: "Sample Song 2", lyrics: "கர்த்தரைப் புகழ்வோம்...", tags: ["praise"] }
    ];
    return songsCache;
  }
}

async function renderSongResults(targetId, query) {
  const wrap = $(targetId);
  const statusId = targetId === "d-song-results" ? "d-song-status" : "m-song-status";
  $(statusId).textContent = "Searching...";

  const q = (query || "").trim().toLowerCase();
  const songs = await loadSongs();

  const results = !q
    ? songs.slice(0, 10)
    : songs.filter(s =>
        (s.title || "").toLowerCase().includes(q) ||
        (s.lyrics || "").toLowerCase().includes(q) ||
        (s.tags || []).join(" ").toLowerCase().includes(q)
      );

  wrap.innerHTML = "";
  if (!results.length) {
    wrap.innerHTML = `<div class="text-sm text-gray-600">No songs found.</div>`;
    $(statusId).textContent = "0 results";
    return;
  }

  results.slice(0, 20).forEach(s => {
    const card = document.createElement("div");
    card.className = "bg-gray-50 border border-gray-200 rounded-2xl p-4";
    card.innerHTML = `
      <div class="font-bold text-gray-800">${escapeHtml(s.title || "Untitled")}</div>
      <div class="text-xs text-gray-500 mt-1">${escapeHtml((s.tags || []).join(", "))}</div>
      <div class="text-sm text-gray-700 mt-3 whitespace-pre-line">${escapeHtml(shortText(s.lyrics || "", 400))}</div>
    `;
    wrap.appendChild(card);
  });

  $(statusId).textContent = `${results.length} results`;
}

/** -------------------------
 *  RANDOM VERSE
-------------------------- */
async function setRandomVerseDesktop() {
  const outText = $("verse-text");
  const outRef = $("verse-reference");
  const status = $("random-verse-status");

  status.textContent = "Loading random verse...";
  const pick = await pickRandomVerse();
  if (!pick) {
    status.textContent = "Random verse failed (data missing). Check JSON path.";
    outText.textContent = "—";
    outRef.textContent = "—";
    return;
  }

  outText.textContent = `"${pick.text}"`;
  outRef.textContent = `— ${pick.ref}`;
  status.textContent = "";
}

async function setRandomVerseMobile() {
  const outText = $("m-verse-text");
  const outRef = $("m-verse-ref");
  const status = $("m-random-verse-status");

  status.textContent = "Loading...";
  const pick = await pickRandomVerse();
  if (!pick) {
    status.textContent = "Random verse failed. JSON path சரிபார்க்கவும்.";
    outText.textContent = "—";
    outRef.textContent = "—";
    return;
  }

  outText.textContent = `"${pick.text}"`;
  outRef.textContent = `— ${pick.ref}`;
  status.textContent = "";
}

async function pickRandomVerse() {
  // If we already loaded some book data, use it
  const cachedBooks = Array.from(bookTextCache.values());
  if (cachedBooks.length) {
    const b = cachedBooks[Math.floor(Math.random() * cachedBooks.length)];
    return randomVerseFromBook(b);
  }

  // Otherwise load a random book from list
  if (!allBooksFlat.length) return null;
  const randomBook = allBooksFlat[Math.floor(Math.random() * allBooksFlat.length)];
  const data = await ensureBookLoaded(randomBook.bookNum, "desktop", true);
  if (!data) return null;
  return randomVerseFromBook(data);
}

function randomVerseFromBook(bookData) {
  const chapIndex = Math.floor(Math.random() * bookData.chapters.length);
  const chap = bookData.chapters[chapIndex] || [];
  if (!chap.length) return null;

  const verse = chap[Math.floor(Math.random() * chap.length)];
  const name = bookData.name_ta || `Book ${bookData.bookNum}`;
  return {
    text: verse.t,
    ref: `${name} ${chapIndex + 1}:${verse.v}`
  };
}

/** -------------------------
 *  DATA LOADING (Fix for "No data showing")
 *  We try multiple file paths + multiple JSON shapes
-------------------------- */
async function ensureBookLoaded(bookNum, mode, silent = false) {
  if (bookTextCache.has(bookNum)) return bookTextCache.get(bookNum);

  const statusEl = mode === "desktop" ? $("d-data-status") : $("m-data-status");
  if (!silent) statusEl.textContent = `Loading data for Book #${bookNum}...`;

  // 1) try combined bible file if you have (optional)
  // If you later place: ./data/tamil_rc_75.json (big file), uncomment:
  // const combined = await tryLoadCombinedBible();
  // if (combined) { ... }

  // 2) try per-book JSON files in common paths
  const candidatePaths = [
    `./data/ot/${bookNum}.json`,
    `./data/nt/${bookNum}.json`,
    `./data/${bookNum}.json`,
    `./data/book_${bookNum}.json`,
    `./data/book${bookNum}.json`,
    `./data/books/${bookNum}.json`,
    `./data/books/book_${bookNum}.json`,
  ];

  let raw = null;
  let usedPath = null;

  for (const p of candidatePaths) {
    try {
      const res = await fetch(p);
      if (!res.ok) continue;
      raw = await res.json();
      usedPath = p;
      break;
    } catch {
      // continue
    }
  }

  if (!raw) {
    if (!silent) {
      statusEl.textContent =
        `❌ Data load failed for Book #${bookNum}. Tried: ${candidatePaths.join(" | ")}.
Fix: data folder path/name mismatch.`;
    }
    return null;
  }

  const normalized = normalizeBookJson(raw, bookNum);
  normalized.name_ta = currentBook?.name_ta || normalized.name_ta || `Book ${bookNum}`;
  bookTextCache.set(bookNum, normalized);

  if (!silent) statusEl.textContent = `✅ Loaded Book #${bookNum} from ${usedPath} | chapters: ${normalized.chapters.length}`;
  return normalized;
}

/**
 * Tries to normalize many possible JSON shapes into:
 * { bookNum, name_ta, chapters: [ [ {v,t}, ...], ... ] }
 */
function normalizeBookJson(raw, bookNum) {
  // Already normalized?
  if (raw && Array.isArray(raw.chapters)) {
    return {
      bookNum: raw.bookNum ?? bookNum,
      name_ta: raw.name_ta ?? raw.name ?? "",
      chapters: raw.chapters.map((ch, idx) => normalizeChapter(ch, idx + 1))
    };
  }

  // Shape A: { "1": { "1": "text", "2":"text" }, "2": {...} }  (chapters as keys)
  if (raw && typeof raw === "object" && hasChapterKeys(raw)) {
    const chapterNums = Object.keys(raw).map(Number).filter(n => !Number.isNaN(n)).sort((a,b)=>a-b);
    const chapters = chapterNums.map(cn => normalizeChapter(raw[String(cn)], cn));
    return { bookNum, name_ta: raw.name_ta || raw.name || "", chapters };
  }

  // Shape B: array of verses with chapter field: [{chapter:1,verse:1,text:""}, ...]
  if (Array.isArray(raw) && raw.length && (raw[0].chapter || raw[0].Chapter)) {
    const byChap = new Map();
    raw.forEach(r => {
      const c = Number(r.chapter ?? r.Chapter);
      const v = Number(r.verse ?? r.Verse);
      const t = String(r.text ?? r.t ?? r.verseText ?? "");
      if (!byChap.has(c)) byChap.set(c, []);
      byChap.get(c).push({ v, t });
    });
    const chNums = Array.from(byChap.keys()).sort((a,b)=>a-b);
    const chapters = chNums.map(c => byChap.get(c).sort((a,b)=>a.v-b.v));
    return { bookNum, name_ta: "", chapters };
  }

  // Shape C: { chapters: { "1":[...], "2":[...] } }
  if (raw && raw.chapters && typeof raw.chapters === "object" && !Array.isArray(raw.chapters)) {
    const chNums = Object.keys(raw.chapters).map(Number).filter(n => !Number.isNaN(n)).sort((a,b)=>a-b);
    const chapters = chNums.map(c => normalizeChapter(raw.chapters[String(c)], c));
    return { bookNum, name_ta: raw.name_ta || raw.name || "", chapters };
  }

  // Fallback: try to interpret raw as a single chapter array
  if (Array.isArray(raw)) {
    return { bookNum, name_ta: "", chapters: [ normalizeChapter(raw, 1) ] };
  }

  // Last fallback: empty
  return { bookNum, name_ta: "", chapters: [] };
}

function hasChapterKeys(obj) {
  // if keys contain many numeric strings like "1","2","3"
  const keys = Object.keys(obj);
  const numeric = keys.filter(k => String(Number(k)) === k);
  return numeric.length >= 2;
}

function normalizeChapter(ch, chapNum) {
  // If array: could be ["text1","text2"] or [{v:1,t:""}] etc.
  if (Array.isArray(ch)) {
    if (ch.length && typeof ch[0] === "string") {
      return ch.map((t, i) => ({ v: i + 1, t: String(t) }));
    }
    if (ch.length && typeof ch[0] === "object") {
      return ch.map((x, i) => ({
        v: Number(x.v ?? x.verse ?? x.Verse ?? (i + 1)),
        t: String(x.t ?? x.text ?? x.verseText ?? "")
      })).sort((a,b)=>a.v-b.v);
    }
    return [];
  }

  // If object mapping: { "1":"text", "2":"text" }
  if (ch && typeof ch === "object") {
    const vNums = Object.keys(ch).map(Number).filter(n => !Number.isNaN(n)).sort((a,b)=>a-b);
    return vNums.map(v => ({ v, t: String(ch[String(v)] ?? "") }));
  }

  return [];
}

/** -------------------------
 *  Helpers
-------------------------- */
function escapeHtml(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function shortText(s, n) {
  const t = String(s || "");
  if (t.length <= n) return t;
  return t.slice(0, n - 1) + "…";
}

function normalizeKey(s) {
  return String(s || "").trim();
}

/** -------------------------
 *  Bind Events
-------------------------- */
function bindEvents() {
  // Desktop nav
  document.querySelectorAll("[data-dnav]").forEach(btn => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.dnav;
      showDesktopScreen(key);
      if (key === "read") {
        // just show book lists; reader is hidden until book click
        $("d-reader").classList.add("hidden");
      }
    });
  });

  // Mobile tabs
  document.querySelectorAll(".mobile-tab").forEach(tab => {
    tab.addEventListener("click", () => showMobileScreen(tab.dataset.mtab));
  });

  // Back buttons
  $("d-back-books").addEventListener("click", backToBooksDesktop);
  $("m-back-books").addEventListener("click", backToBooksMobile);

  // Font size
  $("font-decrease").addEventListener("click", () => {
    if (currentFontSize > 12) {
      currentFontSize -= 2;
      document.body.style.fontSize = currentFontSize + "px";
    }
  });
  $("font-increase").addEventListener("click", () => {
    if (currentFontSize < 24) {
      currentFontSize += 2;
      document.body.style.fontSize = currentFontSize + "px";
    }
  });

  // Highlighter toggles
  $("d-toggle-highlighter").addEventListener("click", () => toggleHighlighter("desktop"));
  $("m-toggle-highlighter").addEventListener("click", () => toggleHighlighter("mobile"));

  // Highlighter apply on mouseup
  $("d-verse-container").addEventListener("mouseup", () => applyHighlightIfEnabled("desktop"));
  $("m-verse-container").addEventListener("mouseup", () => applyHighlightIfEnabled("mobile"));

  // Clear highlights
  $("d-clear-highlights").addEventListener("click", () => clearHighlights("desktop"));
  $("m-clear-highlights").addEventListener("click", () => clearHighlights("mobile"));

  bindHighlighterColors();

  // Bio search
  $("d-bio-search").addEventListener("click", () => bioSearch($("d-bio-q").value, "desktop"));
  $("d-bio-q").addEventListener("keypress", (e) => { if (e.key === "Enter") bioSearch($("d-bio-q").value, "desktop"); });

  $("m-bio-search").addEventListener("click", () => bioSearch($("m-bio-q").value, "mobile"));
  $("m-bio-q").addEventListener("keypress", (e) => { if (e.key === "Enter") bioSearch($("m-bio-q").value, "mobile"); });

  // Random verse
  $("random-verse-btn").addEventListener("click", setRandomVerseDesktop);
  $("m-random-verse-btn").addEventListener("click", setRandomVerseMobile);

  // Songs
  $("d-song-search").addEventListener("click", () => renderSongResults("d-song-results", $("d-song-q").value));
  $("m-song-search").addEventListener("click", () => renderSongResults("m-song-results", $("m-song-q").value));
  $("d-song-stt").addEventListener("click", () => alert("STT placeholder: Web Speech API later."));
  $("m-song-stt").addEventListener("click", () => alert("STT placeholder: Web Speech API later."));
}

/** -------------------------
 *  INIT
-------------------------- */
async function init() {
  bindEvents();

  // Default screens
  showDesktopScreen("home");
  showMobileScreen("m-home");

  // Load books
  try {
    await loadBooksOrder();
  } catch (e) {
    console.error(e);
    $("d-ot-count").textContent = "books_order.json error";
    $("m-ot-count").textContent = "books_order.json error";
  }

  // Set initial random verse
  setRandomVerseDesktop();
  setRandomVerseMobile();

  // Render empty songs
  renderSongResults("d-song-results", "");
  renderSongResults("m-song-results", "");
}

init();