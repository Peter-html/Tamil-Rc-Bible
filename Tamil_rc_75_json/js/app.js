/* =========================================================
   CONFIG
========================================================= */
const BOOKS_ORDER_URL = "./books_order.json";
const DATA_FOLDERS = { ot: "./data/ot", nt: "./data/nt" };

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

/* =========================================================
   STATE
========================================================= */
let booksOrder = null;
let currentBook = null;
let currentChapter = 1;
const bookCache = new Map();
let fontSize = 16;
let highlightEnabled = false;
let highlightColor = "#FDE047";

/* TTS */
let ttsVerses = [];
let ttsCurrentIdx = 0;
let ttsPlaying = false;
let ttsPaused  = false;
let ttsSupported = false;
let _ttsRate = 0.85;

/* =========================================================
   DOM HELPERS
========================================================= */
const $ = id => document.getElementById(id);
const show = id => $(id)?.classList.remove("hidden");
const hide = id => $(id)?.classList.add("hidden");
const setText = (id, t) => { const e=$(id); if(e) e.textContent=t; };
function escapeHTML(s) {
  return (s||"").replace(/[&<>"']/g,m=>({'&':"&amp;",'<':"&lt;",'>':"&gt;",'"':"&quot;","'":'&#039;'}[m]));
}
const clamp = (n,a,b) => Math.max(a,Math.min(b,n));

/* =========================================================
   CROSS INTRO → APP REVEAL
========================================================= */
function startIntro() {
  const intro = $("crossIntro");
  const app   = $("app");

  // After 3.8s — fade out cross, show app
  setTimeout(() => {
    intro.classList.add("fade-out");
    setTimeout(() => {
      intro.style.display = "none";
      app.classList.add("visible");
      initScrollReveal();
    }, 1000);
  }, 3200);
}

/* =========================================================
   SCROLL REVEAL
========================================================= */
function initScrollReveal() {
  const els = document.querySelectorAll(".reveal");
  if (!els.length) return;
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => { if(e.isIntersecting) e.target.classList.add("visible"); });
  }, { threshold: 0.12 });
  els.forEach(el => obs.observe(el));
}

/* =========================================================
   NAV — only 3 screens now (no saints)
========================================================= */
function go(screen) {
  ["home","reader","songs"].forEach(s => hide(`screen-${s}`));
  show(`screen-${screen}`);
  document.querySelectorAll("[data-screen]").forEach(b =>
    b.classList.toggle("active", b.dataset.screen === screen));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* =========================================================
   FETCH
========================================================= */
async function loadBooksOrder() {
  const r = await fetch(BOOKS_ORDER_URL, { cache:"no-store" });
  if (!r.ok) throw new Error(`books_order.json HTTP ${r.status}`);
  return r.json();
}

async function fetchFirstJSON(paths) {
  let last;
  for (const p of paths) {
    try {
      const r = await fetch(p, { cache:"no-store" });
      if (!r.ok) { last = new Error(`HTTP ${r.status}: ${p}`); continue; }
      return { json: await r.json(), path: p };
    } catch(e) { last = e; }
  }
  throw last || new Error("No JSON path worked.");
}

/* =========================================================
   NORMALIZER
========================================================= */
function normalizeBookJSON(raw) {
  const map = new Map();
  const add = (ch,v,t) => {
    const c=Number(ch), vn=Number(v), text=(t??"").toString().trim();
    if (!c||!vn||!text) return;
    if (!map.has(c)) map.set(c,[]);
    map.get(c).push({v:vn, t:text});
  };

  const roots = [raw?.BIBLE_TEXT,raw?.bible_text,raw?.text,raw?.data,
                 raw?.verses,raw?.chapters,raw?.Chapters,raw?.chapter,raw?.Chapter]
    .filter(Boolean);
  if (!roots.length) roots.push(raw);

  for (const root of roots) {
    if (Array.isArray(root)&&root.length&&typeof root[0]==="object"&&!Array.isArray(root[0])) {
      let hit=0;
      for (const row of root) {
        const ch=row.chapter??row.ch??row.c??row.Chapter;
        const v =row.verse??row.v??row.vn??row.Verse;
        const t =row.text??row.t??row.value??row.verseText??row.VerseText;
        if (ch&&v&&t) { add(ch,v,t); hit++; }
      }
      if (hit) break;
    }
    if (Array.isArray(root)&&root.length&&Array.isArray(root[0])) {
      let hit=0;
      root.forEach((arr,i) => arr.forEach((vt,j) => {
        if (typeof vt==="string"&&vt.trim()) { add(i+1,j+1,vt); hit++; }
      }));
      if (hit) break;
    }
    if (root&&typeof root==="object"&&!Array.isArray(root)) {
      const tryChapObj = obj => {
        const keys=Object.keys(obj).filter(k=>/^\d+$/.test(k));
        if (!keys.length) return 0;
        let hit=0;
        for (const ck of keys) {
          const cv=obj[ck];
          if (Array.isArray(cv)) {
            cv.forEach((item,idx) => {
              if (typeof item==="string"&&item.trim()) { add(ck,idx+1,item); hit++; }
              else if (item&&typeof item==="object") {
                if (item.type==="V"&&item.text) { add(ck,item.v??(idx+1),item.text); hit++; }
                else { const v=item.verse??item.v??(idx+1); const t=item.text??item.t??item.value; if(t){add(ck,v,t);hit++;} }
              }
            });
          } else if (cv&&typeof cv==="object") {
            const vkeys=Object.keys(cv).filter(k=>/^\d+$/.test(k));
            if (vkeys.length) { vkeys.forEach(vk=>add(ck,vk,cv[vk])); hit+=vkeys.length; }
            else if (Array.isArray(cv.verses)) {
              cv.verses.forEach((row,idx)=>{ const v=row.verse??row.v??(idx+1); const t=row.text??row.t??row.value; if(t){add(ck,v,t);hit++;} });
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

  for (const [ch,list] of map.entries()) list.sort((a,b)=>a.v-b.v);
  const chapterCount = Math.max(0, ...Array.from(map.keys()));
  return { versesByChapter: map, chapterCount };
}

async function loadBook(bookNum) {
  if (bookCache.has(bookNum)) return bookCache.get(bookNum);
  const { json, path } = await fetchFirstJSON(buildCandidatePaths(bookNum));
  const norm = normalizeBookJSON(json);
  const payload = { raw:json, ...norm, sourcePath:path };
  bookCache.set(bookNum, payload);
  return payload;
}

/* =========================================================
   SAINT OF THE DAY — mock data (replace with real API later)
========================================================= */
const SAINTS = [
  { name:"புனித பாட்ரிக்", date:"March 17 · Feast Day", about:"அயர்லாந்தின் பாதுகாவலர். அவர் கிரேக்கோ-ரோமன் கிறிஸ்தவ கலாச்சாரத்தை அயர்லாந்துக்கு கொண்டு வந்தார். அவரது விசுவாசம் மலைகளையும் சாதனைகளையும் தாண்டியது.", actions:["ஆயிரக்கணக்கான மக்களை திருமுழுக்காட்டினார்","கடத்தப்பட்டு அடிமையாக வாழ்ந்தார், பின் மீண்டார்","அயர்லாந்தில் பல தேவாலயங்கள் நிறுவினார்"] },
  { name:"புனித ஜோசப்", date:"March 19 · Feast Day", about:"இயேசுவின் வளர்ப்பு தந்தை. நம்பகமான பாதுகாவலர், கைவேலையாளர். கடவுளின் திட்டத்தில் மறைவான ஆனால் மிக முக்கியமான பாத்திரம்.", actions:["மரியாள் மற்றும் இயேசுவை பாதுகாத்தார்","எகிப்துக்கு தப்பி ஓடினார்","நம்பகமான கைவேலையாளர்"] },
  { name:"புனித தெரேசா", date:"October 1 · Feast Day", about:"சிறிய பூக்களின் புனிதர். சிறிய வழியில் கடவுளை நோக்கி நடந்தார். அன்பின் மூலம் பரலோகம் வரை செல்லும் பாதை காட்டினார்.", actions:["அன்பின் சிறிய வழியை போதித்தார்","மிஷனரிகளுக்கு பிரார்த்தித்தார்","இளமையிலேயே வீரத்துடன் இறந்தார்"] },
];

function loadSaintOfDay() {
  const today = new Date().getDay();
  const s = SAINTS[today % SAINTS.length];
  setText("saintName", s.name);
  setText("saintDate", s.date);
  setText("saintAbout", s.about);
  const actionsEl = $("saintActions");
  if (actionsEl) {
    actionsEl.innerHTML = s.actions.map(a =>
      `<span class="saint-action-pill">${escapeHTML(a)}</span>`
    ).join("");
  }
}

/* =========================================================
   BOOK LISTS
========================================================= */
function bookRowHTML({ serial, name, chapters, bookNum, testament }) {
  return `
  <div class="book-row book-row-${bookNum}">
    <div class="flex items-center justify-between gap-3">
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <span class="w-8 h-8 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center text-xs font-extrabold flex-shrink-0">${serial}</span>
          <div class="font-extrabold text-gray-800 truncate text-sm">${escapeHTML(name)}</div>
        </div>
        <div class="text-xs text-gray-400 mt-0.5 ml-10">அதிகாரங்கள்: ${chapters ?? "…"}</div>
      </div>
      <button data-open="${bookNum}" data-testament="${testament}"
              class="px-3 py-1.5 rounded-2xl bg-blue-100 text-blue-700 font-extrabold text-xs flex-shrink-0">
        Open
      </button>
    </div>
  </div>`;
}

async function renderBookLists() {
  const otBooks = [...booksOrder.old_testament, ...booksOrder.deuterocanon];
  const ntBooks = [...booksOrder.new_testament];

  $("otList").innerHTML = otBooks.map((b,i) => bookRowHTML({ serial:i+1, name:b.name_ta, chapters:"…", bookNum:b.bookNum, testament:"ot" })).join("");
  $("ntList").innerHTML = ntBooks.map((b,i) => bookRowHTML({ serial:i+1, name:b.name_ta, chapters:"…", bookNum:b.bookNum, testament:"nt" })).join("");

  document.querySelectorAll("[data-open]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const bookNum = Number(btn.dataset.open);
      const testament = btn.dataset.testament;
      const list = testament === "ot" ? otBooks : ntBooks;
      const idx = list.findIndex(x => x.bookNum === bookNum);
      const name_ta = list[idx]?.name_ta ?? `Book ${bookNum}`;
      ttsStop();
      await openReader({ bookNum, name_ta, testament, serial: idx >= 0 ? idx+1 : bookNum });
      go("reader");
    });
  });

  [...otBooks, ...ntBooks].forEach(async b => {
    try { const p = await loadBook(b.bookNum); updateChapterCountUI(b.bookNum, p.chapterCount); }
    catch { updateChapterCountUI(b.bookNum, 0); }
  });
}

function updateChapterCountUI(bookNum, count) {
  const row = document.querySelector(`.book-row-${bookNum}`);
  if (!row) return;
  const line = row.querySelector(".text-xs.text-gray-400");
  if (line) line.textContent = `அதிகாரங்கள்: ${count || 0}`;
}

/* =========================================================
   READER
========================================================= */
function clearReaderError() { hide("readerError"); setText("readerError",""); }
function showReaderError(msg) { setText("readerError","❌ "+msg); show("readerError"); }

async function openReader(book) {
  clearReaderError();
  currentBook = book; currentChapter = 1;
  try {
    const p = await loadBook(book.bookNum);
    $("debugBox").innerHTML = [
      `Book: ${book.name_ta} (#${book.bookNum})`,
      `Source: ${p.sourcePath}`,
      `Chapters: ${p.chapterCount}`,
      `Keys: ${p.raw && typeof p.raw === "object" ? Object.keys(p.raw).slice(0,12).join(", ") : "(array)"}`
    ].join("<br>");
    if (!p.chapterCount) showReaderError("Chapter data கிடைக்கவில்லை.");
    setText("bookMeta", `${book.name_ta} · ${p.chapterCount || 0} அதிகாரங்கள்`);
    renderChapters(p.chapterCount || 0);
    await renderChapter(1);
  } catch(e) { showReaderError(String(e?.message||e)); }
}

function renderChapters(count) {
  const target = $("chapters");
  if (!target) return;
  if (!count) { target.innerHTML = `<div class="text-sm text-gray-400">—</div>`; return; }
  target.innerHTML = Array.from({length:count}, (_,i) => i+1).map(c =>
    `<button class="chapter-btn ${c===1?"active":""}" data-ch="${c}">${c}</button>`
  ).join("");
  target.querySelectorAll("[data-ch]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const ch = Number(btn.dataset.ch);
      currentChapter = ch; ttsStop();
      target.querySelectorAll(".chapter-btn").forEach(x => x.classList.remove("active"));
      btn.classList.add("active");
      await renderChapter(ch);
    });
  });
}

async function renderChapter(ch) {
  clearReaderError();
  const p = await loadBook(currentBook.bookNum);
  const verses = p.versesByChapter.get(ch) || [];
  ttsVerses = verses; ttsCurrentIdx = 0;

  setText("chapterTitle", `${currentBook.name_ta} ${ch}`);
  setText("readingTitle", `${currentBook.name_ta} ${ch} அதிகாரம்`);
  setText("audioChapterLabel", `${currentBook.name_ta} அதிகாரம் ${ch}`);

  if (ttsSupported && verses.length) { show("audioPlayer"); ttsUpdateUI(); }
  else hide("audioPlayer");

  renderVerseChips(verses);

  const box = $("verseBox");
  if (box) {
    box.innerHTML = verses.length
      ? verses.map(v => `
          <p class="verse-para" id="vb-${v.v}" data-v="${v.v}">
            <span class="font-extrabold text-blue-600 mr-2 select-none">${v.v}</span><span class="verse-text">${escapeHTML(v.t)}</span>
          </p>`).join("")
      : `<div class="text-gray-400 text-center mt-10">இந்த அதிகாரத்தில் data இல்லை</div>`;
  }

  setText("audioVerseCounter", `0 / ${verses.length} வசனங்கள்`);
  updateProgressBar(0, verses.length);
  setupHighlighter();
}

function renderVerseChips(verses) {
  const c = $("verseChips");
  if (!c) return;
  if (!verses.length) { c.innerHTML = `<span class="text-xs text-gray-400">வசனங்கள் இல்லை</span>`; return; }
  // Use verse's actual .v number to avoid duplicates
  const seen = new Set();
  const chips = verses.filter(v => { if(seen.has(v.v)) return false; seen.add(v.v); return true; });
  c.innerHTML = chips.map(v =>
    `<button class="verse-chip" id="vc-${v.v}" data-v="${v.v}">${v.v}</button>`
  ).join("");
  c.querySelectorAll("[data-v]").forEach(btn => {
    btn.addEventListener("click", () => {
      const vNum = Number(btn.dataset.v);
      $(`vb-${vNum}`)?.scrollIntoView({ behavior:"smooth", block:"center" });
      if (ttsPlaying || ttsPaused) ttsJumpToVerse(vNum);
    });
  });
}

/* =========================================================
   TTS
========================================================= */
function ttsInit() {
  if (!("speechSynthesis" in window)) { ttsSupported=false; return; }
  ttsSupported = true;
  const tryVoice = () => { if(speechSynthesis.getVoices().length) ttsUpdateVoiceInfo(); };
  speechSynthesis.addEventListener("voiceschanged", tryVoice);
  tryVoice();
}

function ttsGetTamilVoice() {
  const v = speechSynthesis.getVoices();
  return v.find(x=>x.lang==="ta-IN") || v.find(x=>x.lang.startsWith("ta")) || v.find(x=>x.name.toLowerCase().includes("tamil")) || null;
}

function ttsUpdateVoiceInfo() {
  const voice = ttsGetTamilVoice();
  const el = $("audioVoiceInfo");
  if (!el) return;
  if (voice) { el.textContent=`🎙 ${voice.name}`; el.style.color="rgba(52,211,153,0.9)"; }
  else { el.textContent="⚠ Windows Settings → Speech → Add Tamil voice"; el.style.color="rgba(251,191,36,0.9)"; }
}

function ttsHighlightVerse(idx) {
  document.querySelectorAll(".verse-para").forEach(e=>e.classList.remove("tts-active"));
  document.querySelectorAll(".verse-chip").forEach(e=>e.classList.remove("tts-active-chip"));
  if (idx<0||idx>=ttsVerses.length) return;
  const v = ttsVerses[idx];
  $(`vb-${v.v}`)?.classList.add("tts-active");
  $(`vb-${v.v}`)?.scrollIntoView({behavior:"smooth",block:"center"});
  $(`vc-${v.v}`)?.classList.add("tts-active-chip");
  $(`vc-${v.v}`)?.scrollIntoView({behavior:"nearest"});
  setText("audioVerseCounter", `${idx+1} / ${ttsVerses.length} வசனங்கள்`);
  updateProgressBar(idx+1, ttsVerses.length);
}

function updateProgressBar(cur, total) {
  const f = $("audioProgressFill");
  if (f) f.style.width = total>0 ? `${Math.round((cur/total)*100)}%` : "0%";
}

function ttsSpeakVerse(idx) {
  if (idx >= ttsVerses.length) { ttsStop(); setText("audioStatusText","அதிகாரம் முடிந்தது ✓"); return; }
  ttsCurrentIdx = idx;
  ttsHighlightVerse(idx);
  const utt = new SpeechSynthesisUtterance(ttsVerses[idx].t);
  const voice = ttsGetTamilVoice();
  if (voice) utt.voice = voice;
  utt.lang="ta-IN"; utt.rate=_ttsRate; utt.pitch=1.0;
  utt.onend = () => { if(ttsPlaying) ttsSpeakVerse(idx+1); };
  utt.onerror = e => { if(e.error!=="interrupted") console.warn("TTS:",e.error); };
  speechSynthesis.speak(utt);
}

function ttsPlay() {
  if (!ttsSupported||!ttsVerses.length) return;
  if (ttsPaused) { ttsPaused=false; ttsPlaying=true; speechSynthesis.resume(); ttsSetStatusPlaying(); return; }
  speechSynthesis.cancel();
  ttsPlaying=true; ttsPaused=false;
  ttsSetStatusPlaying();
  ttsSpeakVerse(ttsCurrentIdx);
}

function ttsPause() {
  if (!ttsPlaying) return;
  ttsPlaying=false; ttsPaused=true; speechSynthesis.pause();
  hide("audioBtnPause"); show("audioBtnPlay");
  setText("audioStatusText","நிறுத்தப்பட்டது");
  const d=$("audioStatusDot"); if(d) d.className="pulse-dot paused";
}

function ttsStop() {
  ttsPlaying=false; ttsPaused=false; ttsCurrentIdx=0;
  speechSynthesis.cancel();
  document.querySelectorAll(".verse-para").forEach(e=>e.classList.remove("tts-active"));
  document.querySelectorAll(".verse-chip").forEach(e=>e.classList.remove("tts-active-chip"));
  hide("audioBtnPause"); show("audioBtnPlay");
  setText("audioStatusText","தயாராக உள்ளது");
  setText("audioVerseCounter",`0 / ${ttsVerses.length} வசனங்கள்`);
  updateProgressBar(0, ttsVerses.length);
  const d=$("audioStatusDot"); if(d) d.className="pulse-dot stopped";
}

function ttsJumpToVerse(vNum) {
  const idx = ttsVerses.findIndex(v=>v.v===vNum);
  if (idx<0) return;
  speechSynthesis.cancel(); ttsCurrentIdx=idx;
  if (ttsPlaying||ttsPaused) { ttsPlaying=true; ttsPaused=false; ttsSetStatusPlaying(); ttsSpeakVerse(idx); }
  else ttsHighlightVerse(idx);
}

function ttsPrev() {
  const idx = Math.max(0, ttsCurrentIdx-1);
  speechSynthesis.cancel(); ttsCurrentIdx=idx;
  if(ttsPlaying) ttsSpeakVerse(idx); else ttsHighlightVerse(idx);
}

function ttsNext() {
  const idx = Math.min(ttsVerses.length-1, ttsCurrentIdx+1);
  speechSynthesis.cancel(); ttsCurrentIdx=idx;
  if(ttsPlaying) ttsSpeakVerse(idx); else ttsHighlightVerse(idx);
}

function ttsSetStatusPlaying() {
  hide("audioBtnPlay"); show("audioBtnPause");
  setText("audioStatusText","வாசிக்கிறது…");
  const d=$("audioStatusDot"); if(d) d.className="pulse-dot";
}

function ttsUpdateUI() {
  if(ttsPlaying){ hide("audioBtnPlay"); show("audioBtnPause"); }
  else { show("audioBtnPlay"); hide("audioBtnPause"); }
}

/* =========================================================
   RANDOM VERSE
========================================================= */
const pickRandom = arr => arr[Math.floor(Math.random()*arr.length)];

async function setHomeRandomVerse() {
  try {
    if (currentBook) {
      const p = await loadBook(currentBook.bookNum);
      const verses = p.versesByChapter.get(currentChapter) || [];
      if (verses.length) {
        const v = pickRandom(verses);
        setText("homeVerseText", `"${v.t}"`);
        setText("homeVerseRef", `— ${currentBook.name_ta} ${currentChapter}:${v.v}`);
        return;
      }
    }
    // Fallback inspiring verse
    setText("homeVerseText", `"கர்த்தர் என் மேய்ப்பராயிருக்கிறார்; நான் தாழ்ச்சியடையேன்."`);
    setText("homeVerseRef", "— சங்கீதம் 23:1");
  } catch {
    setText("homeVerseText", `"கர்த்தர் என் மேய்ப்பராயிருக்கிறார்; நான் தாழ்ச்சியடையேன்."`);
    setText("homeVerseRef", "— சங்கீதம் 23:1");
  }
}

async function setReaderRandomVerse() {
  try {
    if (!currentBook) return;
    const p = await loadBook(currentBook.bookNum);
    const verses = p.versesByChapter.get(currentChapter) || [];
    if (verses.length) $(`vb-${pickRandom(verses).v}`)?.scrollIntoView({behavior:"smooth",block:"center"});
  } catch {}
}

/* =========================================================
   HIGHLIGHTER
========================================================= */
function applyHighlight(color) {
  const sel = window.getSelection();
  if (!sel||!sel.toString().trim()) return;
  const range = sel.getRangeAt(0);
  const box = $("verseBox");
  if (!box?.contains(range.commonAncestorContainer)) return;
  const span = document.createElement("span");
  span.style.cssText = `background:${color};padding:2px 4px;border-radius:6px;`;
  try { range.surroundContents(span); }
  catch { const txt=sel.toString(); range.deleteContents(); span.textContent=txt; range.insertNode(span); }
  sel.removeAllRanges();
}

function clearHighlights() {
  $("verseBox")?.querySelectorAll("span").forEach(s => {
    if (s?.style?.backgroundColor) {
      s.parentNode?.replaceChild(document.createTextNode(s.textContent), s);
      s.parentNode?.normalize();
    }
  });
}

function setupHighlighter() {
  const box = $("verseBox");
  if (!box) return;
  box.onmouseup = null;
  if (highlightEnabled) box.onmouseup = () => applyHighlight(highlightColor);
}

/* =========================================================
   SONGS
========================================================= */
const SONGS_DB = [
  { title:"அல்லேலூயா பாடல்", snippet:"அல்லேலூயா… கர்த்தரை ஸ்தோத்திரிக்க…" },
  { title:"கர்த்தர் நல்லவர்", snippet:"கர்த்தர் நல்லவர்… அவர் கிருபை நிலைத்திருக்கும்…" },
  { title:"நீர் என் மேய்ப்பர்", snippet:"நீர் என் மேய்ப்பர்… எனக்கு குறைவு இல்லை…" },
];

function doSongSearch() {
  const q = ($("songQ").value||"").trim().toLowerCase();
  if (!q) { $("songResults").textContent = "Type something to search."; return; }
  const hits = SONGS_DB.filter(s => s.title.toLowerCase().includes(q)||s.snippet.toLowerCase().includes(q));
  $("songResults").innerHTML = hits.length
    ? hits.map(h=>`<div class="p-3 bg-white rounded-2xl border border-gray-100 mb-2"><div class="font-extrabold text-gray-800">${escapeHTML(h.title)}</div><div class="text-sm text-gray-600 mt-1">${escapeHTML(h.snippet)}</div></div>`).join("")
    : "No results (mock).";
}

/* =========================================================
   UI WIRING
========================================================= */
function wireUI() {
  document.querySelectorAll("[data-screen]").forEach(btn =>
    btn.addEventListener("click", () => {
      if (btn.dataset.screen !== "reader") ttsStop();
      go(btn.dataset.screen);
    })
  );

  $("goReader") ?.addEventListener("click", () => go("reader"));
  $("goReader2")?.addEventListener("click", () => go("reader"));
  $("goSongs")  ?.addEventListener("click", () => go("songs"));

  $("aMinus")?.addEventListener("click", () => { fontSize=clamp(fontSize-2,12,24); document.body.style.fontSize=`${fontSize}px`; });
  $("aPlus") ?.addEventListener("click", () => { fontSize=clamp(fontSize+2,12,24); document.body.style.fontSize=`${fontSize}px`; });

  $("homeRandom")  ?.addEventListener("click", setHomeRandomVerse);
  $("readerRandom")?.addEventListener("click", setReaderRandomVerse);

  $("hlToggle")?.addEventListener("click", () => {
    highlightEnabled = !highlightEnabled;
    highlightEnabled ? show("hlColors") : hide("hlColors");
    setupHighlighter();
  });
  $("hlClear")?.addEventListener("click", clearHighlights);
  document.querySelectorAll("#hlColors button[data-color]").forEach(btn =>
    btn.addEventListener("click", () => highlightColor = btn.dataset.color));

  $("debugBtn")?.addEventListener("click", () => $("debugBox")?.classList.toggle("hidden"));

  $("songSearch")?.addEventListener("click", doSongSearch);
  $("songQ")?.addEventListener("keypress", e => { if(e.key==="Enter") doSongSearch(); });

  $("audioBtnPlay") ?.addEventListener("click", ttsPlay);
  $("audioBtnPause")?.addEventListener("click", ttsPause);
  $("audioBtnStop") ?.addEventListener("click", ttsStop);
  $("audioBtnPrev") ?.addEventListener("click", ttsPrev);
  $("audioBtnNext") ?.addEventListener("click", ttsNext);
  $("audioSpeed")   ?.addEventListener("change", e => { _ttsRate=parseFloat(e.target.value); setText("audioSpeedLabel",e.target.value+"x"); });
}

/* =========================================================
   INIT
========================================================= */
(async function init() {
  wireUI();
  ttsInit();
  loadSaintOfDay();

  try {
    booksOrder = await loadBooksOrder();
    await renderBookLists();
  } catch(e) {
    console.error(e);
  }

  await setHomeRandomVerse();

  // Start with cross intro, then show home
  startIntro();
})();
