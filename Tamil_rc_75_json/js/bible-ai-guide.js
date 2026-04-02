const BibleAI = (() => {

  const SERVER_URL = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:3001"
    : "";

  let _book    = "";
  let _chapter = 1;
  let _bookNum = null;
  let _verses  = [];
  let _history = [];
  let _open    = false;

  /* ═══ STYLES ═══════════════════════════════════════════ */
  function injectStyles() {
    if (document.getElementById("bai-styles")) return;
    const s = document.createElement("style");
    s.id = "bai-styles";
    s.textContent = `
      #bai-fab {
        position: fixed; bottom: 24px; right: 24px;
        width: 62px; height: 62px; border-radius: 50%;
        background: linear-gradient(135deg, #C9A84C, #E8C97A);
        border: none; cursor: pointer; z-index: 9000;
        display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
        box-shadow: 0 8px 28px rgba(201,168,76,0.5);
        transition: transform 0.2s, box-shadow 0.2s, opacity 0.3s;
      }
      #bai-fab:hover { transform: scale(1.1); box-shadow: 0 12px 36px rgba(201,168,76,0.65); }
      #bai-fab.bai-open { opacity: 0; pointer-events: none; transform: scale(0.8); }
      #bai-fab-icon  { font-size: 22px; line-height: 1; }
      #bai-fab-label { font-size: 7px; letter-spacing: 0.08em; font-family: 'Cinzel', serif; color: #0d1b2a; font-weight: 800; }

      #bai-panel {
        position: fixed; bottom: 0; right: 0;
        width: 430px; max-width: 100vw;
        height: 600px; max-height: 92vh;
        background: linear-gradient(160deg, #0e1d2e 0%, #09131e 100%);
        border: 1px solid rgba(201,168,76,0.2);
        border-bottom: none; border-right: none;
        border-radius: 22px 0 0 0;
        display: flex; flex-direction: column;
        z-index: 8999;
        box-shadow: -6px -6px 40px rgba(0,0,0,0.55);
        transform: translateY(105%);
        transition: transform 0.4s cubic-bezier(0.22, 1, 0.36, 1);
        font-family: 'Noto Sans Tamil', serif;
      }
      #bai-panel.bai-open { transform: translateY(0); }

      #bai-header {
        padding: 13px 16px 10px;
        border-bottom: 1px solid rgba(201,168,76,0.1);
        display: flex; align-items: center; gap: 10px; flex-shrink: 0;
      }
      .bai-logo {
        width: 30px; height: 30px; border-radius: 8px;
        background: rgba(201,168,76,0.14);
        display: flex; align-items: center; justify-content: center; flex-shrink: 0;
      }
      #bai-title { font-family: 'Cinzel', serif; font-size: 0.88rem; font-weight: 700; color: #E8C97A; letter-spacing: 0.05em; }
      #bai-context { font-size: 0.62rem; color: rgba(201,168,76,0.4); font-family: 'Cinzel', serif; letter-spacing: 0.05em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      #bai-status-dot { width: 7px; height: 7px; border-radius: 50%; background: #10B981; flex-shrink: 0; box-shadow: 0 0 6px rgba(16,185,129,0.6); transition: background 0.3s; }
      #bai-status-dot.offline { background: #64748B; box-shadow: none; }
      #bai-status-dot.loading { background: #F59E0B; animation: baiPulse 1s ease-in-out infinite; }
      @keyframes baiPulse { 0%,100%{ opacity:1; } 50%{ opacity:0.3; } }
      #bai-btn-clear { background: none; border: none; color: rgba(255,255,255,0.2); font-size: 0.6rem; font-family: 'Cinzel', serif; cursor: pointer; padding: 2px 6px; letter-spacing: 0.05em; transition: color 0.15s; }
      #bai-btn-clear:hover { color: rgba(255,255,255,0.5); }
      #bai-btn-close { width: 28px; height: 28px; border-radius: 50%; background: rgba(255,255,255,0.07); border: none; color: rgba(255,255,255,0.45); cursor: pointer; font-size: 13px; display: flex; align-items: center; justify-content: center; transition: background 0.15s; flex-shrink: 0; }
      #bai-btn-close:hover { background: rgba(255,255,255,0.15); color: white; }

      #bai-pills { padding: 7px 12px; display: flex; gap: 5px; flex-wrap: wrap; border-bottom: 1px solid rgba(255,255,255,0.04); flex-shrink: 0; }
      .bai-pill { background: rgba(201,168,76,0.08); border: 1px solid rgba(201,168,76,0.2); color: rgba(201,168,76,0.8); border-radius: 999px; padding: 4px 10px; font-size: 0.67rem; font-family: 'Cinzel', serif; cursor: pointer; letter-spacing: 0.03em; transition: all 0.15s; white-space: nowrap; }
      .bai-pill:hover { background: rgba(201,168,76,0.18); color: #E8C97A; transform: translateY(-1px); }

      #bai-msgs { flex: 1; overflow-y: auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; scroll-behavior: smooth; }
      #bai-msgs::-webkit-scrollbar { width: 3px; }
      #bai-msgs::-webkit-scrollbar-thumb { background: rgba(201,168,76,0.15); border-radius: 999px; }

      .bai-msg { max-width: 90%; font-size: 0.875rem; line-height: 1.85; animation: baiIn 0.28s ease both; }
      @keyframes baiIn { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:none; } }

      .bai-msg-user { align-self: flex-end; background: rgba(37,99,235,0.22); border: 1px solid rgba(37,99,235,0.28); color: rgba(255,255,255,0.9); border-radius: 16px 16px 3px 16px; padding: 9px 13px; }
      .bai-msg-ai { align-self: flex-start; background: rgba(255,255,255,0.035); border: 1px solid rgba(201,168,76,0.1); color: rgba(255,255,255,0.85); border-radius: 3px 16px 16px 16px; padding: 11px 14px; }
      .bai-msg-label { display: block; font-family: 'Cinzel', serif; font-size: 0.58rem; letter-spacing: 0.1em; color: rgba(201,168,76,0.45); margin-bottom: 6px; }
      .bai-msg-sources { margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(201,168,76,0.1); font-size: 0.68rem; color: rgba(201,168,76,0.5); font-family: 'Cinzel', serif; letter-spacing: 0.04em; }
      .bai-msg-error { align-self: flex-start; background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.2); color: rgba(255,200,200,0.85); border-radius: 3px 16px 16px 16px; padding: 10px 13px; font-size: 0.82rem; }

      #bai-typing { align-self: flex-start; display: none; background: rgba(255,255,255,0.03); border: 1px solid rgba(201,168,76,0.08); border-radius: 3px 16px 16px 16px; padding: 12px 16px; gap: 5px; align-items: center; }
      #bai-typing.visible { display: flex; }
      .bai-dot { width: 6px; height: 6px; border-radius: 50%; background: rgba(201,168,76,0.5); animation: baiDot 1.2s ease-in-out infinite; }
      .bai-dot:nth-child(2) { animation-delay: 0.2s; }
      .bai-dot:nth-child(3) { animation-delay: 0.4s; }
      @keyframes baiDot { 0%,60%,100%{ transform:scale(1); opacity:0.4; } 30%{ transform:scale(1.5); opacity:1; } }

      #bai-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 24px; }
      #bai-empty-icon { font-size: 3rem; opacity: 0.08; margin-bottom: 12px; }
      #bai-empty-text { color: rgba(255,255,255,0.28); font-size: 0.8rem; line-height: 1.8; }
      #bai-empty-hint { margin-top: 12px; color: rgba(201,168,76,0.3); font-size: 0.7rem; font-family:'Cinzel',serif; letter-spacing:0.06em; }

      #bai-input-bar { padding: 10px 12px; border-top: 1px solid rgba(255,255,255,0.05); display: flex; gap: 8px; align-items: flex-end; flex-shrink: 0; }
      #bai-input { flex: 1; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 13px; padding: 10px 13px; color: white; font-size: 0.84rem; font-family: 'Noto Sans Tamil', serif; resize: none; min-height: 40px; max-height: 110px; line-height: 1.5; outline: none; transition: border-color 0.15s; }
      #bai-input::placeholder { color: rgba(255,255,255,0.22); }
      #bai-input:focus { border-color: rgba(201,168,76,0.38); }
      #bai-btn-send { width: 40px; height: 40px; border-radius: 11px; flex-shrink: 0; background: #C9A84C; border: none; color: #0d1b2a; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background 0.15s, transform 0.1s; }
      #bai-btn-send:hover  { background: #E8C97A; }
      #bai-btn-send:active { transform: scale(0.88); }
      #bai-btn-send:disabled { opacity: 0.35; cursor: not-allowed; transform: none; }

      @media (max-width: 480px) {
        #bai-panel { width: 100%; border-radius: 18px 18px 0 0; height: 68vh; border-left: none; }
      }
    `;
    document.head.appendChild(s);
  }

  /* ═══ BUILD HTML ════════════════════════════════════════ */
  function buildHTML() {
    const fab = document.createElement("button");
    fab.id = "bai-fab";
    fab.setAttribute("aria-label", "Ask Bible AI");
    fab.innerHTML = `<span id="bai-fab-icon">✦</span><span id="bai-fab-label">ASK BIBLE</span>`;

    const panel = document.createElement("div");
    panel.id = "bai-panel";
    panel.innerHTML = `
      <div id="bai-header">
        <div class="bai-logo">
          <svg viewBox="0 0 30 38" width="15" fill="none">
            <rect x="11" y="0" width="8" height="38" rx="4" fill="#C9A84C"/>
            <rect x="0" y="9" width="30" height="8" rx="4" fill="#C9A84C"/>
          </svg>
        </div>
        <div style="flex:1;min-width:0;">
          <div id="bai-title">Ask Bible</div>
          <div id="bai-context">புத்தகம் திற → context தெரியும்</div>
        </div>
        <div id="bai-status-dot" class="offline"></div>
        <button id="bai-btn-clear">Reset</button>
        <button id="bai-btn-close">✕</button>
      </div>
      <div id="bai-pills">
        <button class="bai-pill" data-action="summary">📖 அதிகார சுருக்கம்</button>
        <button class="bai-pill" data-prompt="இந்த அதிகாரத்தின் spiritual message என்ன?">🕊 Message</button>
        <button class="bai-pill" data-prompt="இந்த அதிகாரத்தில் முக்கியமான கதாபாத்திரங்கள் யார்?">👤 Characters</button>
        <button class="bai-pill" data-prompt="இந்த வேதாகம பகுதி இன்றைய வாழ்க்கையோடு எப்படி தொடர்புடையது?">💡 Today</button>
      </div>
      <div id="bai-msgs">
        <div id="bai-empty">
          <div id="bai-empty-icon">✝</div>
          <div id="bai-empty-text">ஒரு புத்தகம் திறந்து வாசிக்கத் தொடங்குங்கள்.<br>கேள்விகள் கேளுங்கள் — வசனங்களை தேடி பதில் சொல்வேன்.</div>
          <div id="bai-empty-hint">POWERED BY RAG · GROUNDED IN SCRIPTURE</div>
        </div>
        <div id="bai-typing">
          <div class="bai-dot"></div><div class="bai-dot"></div><div class="bai-dot"></div>
        </div>
      </div>
      <div id="bai-input-bar">
        <textarea id="bai-input" rows="1" placeholder="கேள்வி கேளுங்கள்… (தாவீது யார்? / இந்த அதிகாரம் பற்றி சொல்)"></textarea>
        <button id="bai-btn-send">
          <svg viewBox="0 0 24 24" width="16" fill="currentColor"><path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z"/></svg>
        </button>
      </div>
    `;
    document.body.appendChild(fab);
    document.body.appendChild(panel);
  }

  /* ═══ HELPERS ═══════════════════════════════════════════ */
  const $id = id => document.getElementById(id);

  function setStatus(state) {
    const d = $id("bai-status-dot");
    if (d) d.className = state;
  }

  function hideEmpty() {
    const e = $id("bai-empty");
    if (e) e.style.display = "none";
  }

  function showTyping() {
    const t = $id("bai-typing");
    if (t) { t.classList.add("visible"); scrollBottom(); }
  }

  function hideTyping() {
    const t = $id("bai-typing");
    if (t) t.classList.remove("visible");
  }

  function scrollBottom() {
    const m = $id("bai-msgs");
    if (m) setTimeout(() => m.scrollTop = m.scrollHeight, 50);
  }

  function esc(s) {
    return (s||"").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
  }

  function appendUser(text) {
    hideEmpty();
    const d = document.createElement("div");
    d.className = "bai-msg bai-msg-user";
    d.textContent = text;
    $id("bai-msgs").insertBefore(d, $id("bai-typing"));
    scrollBottom();
  }

  function appendAI(text, sources = [], label = "ASK BIBLE") {
    hideEmpty();
    const d = document.createElement("div");
    d.className = "bai-msg bai-msg-ai";
    const src = sources.length
      ? `<div class="bai-msg-sources">✦ ${sources.map(s => esc(s)).join("  ·  ")}</div>`
      : "";
    d.innerHTML = `<span class="bai-msg-label">${esc(label)}</span>${esc(text)}${src}`;
    $id("bai-msgs").insertBefore(d, $id("bai-typing"));
    scrollBottom();
  }

  function appendError(text) {
    hideEmpty();
    const d = document.createElement("div");
    d.className = "bai-msg bai-msg-error";
    d.innerHTML = `<span class="bai-msg-label">ERROR</span>${esc(text)}`;
    $id("bai-msgs").insertBefore(d, $id("bai-typing"));
    scrollBottom();
  }

  /* ═══ API CALLS ═════════════════════════════════════════ */
  async function callAsk(question) {
    const res = await fetch(`${SERVER_URL}/api/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, bookNum: _bookNum, chapter: _chapter, history: _history.slice(-6) })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || `Server error ${res.status}`);
    return data;
  }

  async function callSummary() {
    const res = await fetch(`${SERVER_URL}/api/summary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookNum: _bookNum, bookName: _book, chapter: _chapter })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || `Server error ${res.status}`);
    return data;
  }

  async function checkHealth() {
    try {
      const res  = await fetch(`${SERVER_URL}/api/health`, { signal: AbortSignal.timeout(4000) });
      const data = await res.json();
      setStatus(data.ready || data.indexed ? "online" : "loading");
    } catch { setStatus("offline"); }
  }

  /* ═══ SEND FLOW ═════════════════════════════════════════ */
  let _busy = false;

  async function sendQuestion(question, isSummary = false) {
    if (_busy) return;
    _busy = true;

    const sendBtn = $id("bai-btn-send");
    const input   = $id("bai-input");
    if (sendBtn) sendBtn.disabled = true;
    if (input)   input.disabled  = true;
    setStatus("loading");

    try {
      if (isSummary) {
        if (!_bookNum) { appendError("முதலில் ஒரு புத்தகம் திறக்கவும்."); return; }
        // Show user bubble with chapter being summarized
        const label = _book ? `${_book} அதிகாரம் ${_chapter} — சுருக்கம் சொல்` : "இந்த அதிகாரத்தின் சுருக்கம் சொல்";
        appendUser(label);
        showTyping();
        const { summary } = await callSummary();
        hideTyping();
        appendAI(summary, [], "✦ CHAPTER SUMMARY");
      } else {
        if (!question.trim()) { _busy = false; return; }
        appendUser(question);
        showTyping();
        const { answer, sources } = await callAsk(question);
        hideTyping();
        appendAI(answer, sources || []);
        _history.push({ role: "user",      content: question });
        _history.push({ role: "assistant", content: answer   });
        if (_history.length > 20) _history = _history.slice(-20);
      }
      setStatus("online");
    } catch (err) {
      hideTyping();
      setStatus("offline");
      if (err.message.includes("Failed to fetch") || err.message.includes("NetworkError")) {
        appendError("சர்வருடன் இணைக்க முடியவில்லை. Terminal-ல் 'node server/index.js' ஓடுகிறதா பாருங்கள்.");
      } else if (err.message.includes("RATE_LIMIT") || err.message.includes("முடிந்தன")) {
        appendError("இன்றைய கேள்விகள் தீர்ந்துவிட்டன. நாளை மீண்டும் வாருங்கள் 🙏");
      } else {
        appendError(err.message || "பிழை நேர்ந்தது. மீண்டும் முயற்சிக்கவும்.");
      }
    } finally {
      _busy = false;
      if (sendBtn) sendBtn.disabled = false;
      if (input)   { input.disabled = false; input.focus(); }
    }
  }

  /* ═══ PANEL TOGGLE ══════════════════════════════════════ */
  function openPanel() {
    _open = true;
    $id("bai-panel")?.classList.add("bai-open");
    $id("bai-fab")?.classList.add("bai-open");
    $id("bai-input")?.focus();
    checkHealth();
  }

  function closePanel() {
    _open = false;
    $id("bai-panel")?.classList.remove("bai-open");
    $id("bai-fab")?.classList.remove("bai-open");
  }

  function resetMessages(hint) {
    const m = $id("bai-msgs");
    if (!m) return;
    m.innerHTML = `
      <div id="bai-empty">
        <div id="bai-empty-icon" style="font-size:3rem;opacity:0.08;margin-bottom:12px;">✝</div>
        <div id="bai-empty-text" style="color:rgba(255,255,255,0.28);font-size:0.8rem;line-height:1.8;">${esc(hint) || "கேள்விகள் கேளுங்கள்."}</div>
        <div id="bai-empty-hint" style="margin-top:12px;color:rgba(201,168,76,0.3);font-size:0.7rem;font-family:Cinzel,serif;letter-spacing:0.06em;">POWERED BY RAG · GROUNDED IN SCRIPTURE</div>
      </div>
      <div id="bai-typing" style="align-self:flex-start;display:none;background:rgba(255,255,255,0.03);border:1px solid rgba(201,168,76,0.08);border-radius:3px 16px 16px 16px;padding:12px 16px;gap:5px;align-items:center;">
        <div class="bai-dot"></div><div class="bai-dot"></div><div class="bai-dot"></div>
      </div>`;
  }

  /* ═══ WIRE EVENTS ═══════════════════════════════════════ */
  function wireEvents() {
    $id("bai-fab")?.addEventListener("click", openPanel);
    $id("bai-btn-close")?.addEventListener("click", closePanel);

    $id("bai-btn-clear")?.addEventListener("click", () => {
      _history = [];
      resetMessages("உரையாடல் reset ஆனது. மீண்டும் கேளுங்கள்.");
    });

    document.querySelectorAll(".bai-pill").forEach(pill => {
      pill.addEventListener("click", () => {
        openPanel();
        if (pill.dataset.action === "summary") {
          sendQuestion("", true);
        } else if (pill.dataset.prompt) {
          sendQuestion(pill.dataset.prompt);
        }
      });
    });

    $id("bai-btn-send")?.addEventListener("click", () => {
      const input = $id("bai-input");
      const val = (input?.value || "").trim();
      if (!val || _busy) return;
      input.value = "";
      input.style.height = "auto";
      sendQuestion(val);
    });

    $id("bai-input")?.addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $id("bai-btn-send")?.click(); }
    });

    $id("bai-input")?.addEventListener("input", function() {
      this.style.height = "auto";
      this.style.height = Math.min(this.scrollHeight, 110) + "px";
    });
  }

  /* ═══ PUBLIC API ════════════════════════════════════════ */
  return {
    init() {
      injectStyles();
      buildHTML();
      wireEvents();
      setTimeout(checkHealth, 1500);
    },

    // Call from app.js renderChapter() — panel stays closed, context updates silently
    onChapterOpen(bookName, chapterNum, verses, bookNum = null) {
      _book    = bookName;
      _chapter = chapterNum;
      _verses  = verses || [];
      _bookNum = bookNum || null;
      _history = [];

      const ctx = $id("bai-context");
      if (ctx) ctx.textContent = `${bookName} · அதிகாரம் ${chapterNum} · ${_verses.length} வசனங்கள்`;

      if (_open) resetMessages(`${bookName} ${chapterNum} திறக்கப்பட்டது. கேள்விகள் கேளுங்கள்.`);
    },

    open:  openPanel,
    close: closePanel,
    ask:   q => { openPanel(); sendQuestion(q); },
  };
})();

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => BibleAI.init());
} else {
  BibleAI.init();
}