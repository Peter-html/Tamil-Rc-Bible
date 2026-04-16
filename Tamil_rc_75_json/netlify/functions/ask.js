/* ============================================================
   netlify/functions/ask.js  — v3  (no-RAG, browser-context)

   ROOT CAUSE OF "சர்வர் தயாராகவில்லை":
   The RAG TF-IDF index was being built inside the cold-start
   (3-6s), leaving no time for Gemini before Netlify's 10s kill.

   FIX:
   - RAG index is completely removed from this function.
   - The browser already has the current chapter's verses loaded.
   - We now accept those verses directly in the POST body and
     use them as context — zero cold-start cost.
   - Gemini gets a 8s hard timeout so we always return valid JSON.
============================================================ */

const { initGemini, generate } = require("../../server/llm");

/* ── Init Gemini at module load (cached between warm calls) ── */
let _ready   = false;
let _initErr = null;

const _boot = (async () => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY missing");
    initGemini(apiKey);
    _ready = true;
    console.log("[ask] Gemini ready");
  } catch (e) {
    _initErr = e.message || String(e);
    console.error("[ask] boot error:", _initErr);
  }
})();

const CORS = {
  "Content-Type":                "application/json",
  "Access-Control-Allow-Origin": "*",
};

const SYSTEM_PROMPT = `நீ ஒரு அன்பான தமிழ் கத்தோலிக்க வேதாகம ஆசிரியர். உன் பெயர் "Ask Bible".

பதில் நடை விதிகள்:
1. எப்போதும் தமிழில் மட்டும் பதில் சொல்.
2. Flowing paragraphs மட்டும் — bullet points, dashes, headers வேண்டாம்.
3. Spiritual, warm tone.
4. கீழே கொடுத்த Bible Context மட்டும் பயன்படுத்து.
5. பதில் அதிகபட்சம் 120 வார்த்தைகள் — சுருக்கமாக, தெளிவாக.

கதாபாத்திர கேள்விகள் (X யார்?, father of X, son of X):
- குடும்ப தகவல் (தந்தை, தாய், பெயர் பொருள்) முதலில் சொல்.
- 2-3 முக்கிய வாழ்க்கை நிகழ்வுகள் சுருக்கமாக.
- ஒரு வரியில் spiritual significance முடி.
- 2 paragraphs மட்டும்.

உறவு கேள்விகள் (father of X, who is son of Y):
- நேரடியாக பதில் சொல்: "X-இன் தந்தை Y ஆவார்."
- பின் Y பற்றி ஒரு சிறு paragraph.

பொது கேள்விகள்: 1-2 paragraphs, 120 வார்த்தைகளுக்குள்.`;

exports.handler = async function (event) {
  /* CORS pre-flight */
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        ...CORS,
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: CORS,
      body: JSON.stringify({ message: "Method not allowed" }),
    };
  }

  /* Wait up to 3s for Gemini init (very fast — no index build) */
  if (!_ready && !_initErr) {
    await Promise.race([_boot, new Promise(r => setTimeout(r, 3000))]);
  }

  if (_initErr) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({
        message: "Gemini தயாராகவில்லை. சில நொடிகளில் மீண்டும் முயற்சிக்கவும்.",
      }),
    };
  }

  if (!_ready) {
    return {
      statusCode: 503,
      headers: CORS,
      body: JSON.stringify({
        message: "சர்வர் தொடங்குகிறது — 5 நொடிகளில் மீண்டும் முயற்சிக்கவும்.",
      }),
    };
  }

  /* Parse body */
  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ message: "Invalid JSON" }),
    };
  }

  const {
    question  = "",
    verses    = [],   // ← sent directly from the browser (current chapter)
    bookName  = "",
    chapter   = null,
    history   = [],
    testament = null,
  } = body;

  if (!question.trim()) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ message: "கேள்வி எழுதுங்கள்." }),
    };
  }

  /* Build context from the verses the browser already has loaded.
     Filter by testament hint if the user asked for OT/NT specifically. */
  let contextVerses = verses.slice(0, 80); // cap at 80 verses to keep prompt lean

  const ragContext = contextVerses.length > 0
    ? `[${bookName} ${chapter}]\n` +
      contextVerses.map(v => `${v.v}. ${v.t}`).join("\n")
    : "வசனங்கள் இல்லை — பொது வேதாகம அறிவை பயன்படுத்து.";

  const sources = contextVerses.length > 0
    ? [`${bookName} ${chapter}`]
    : [];

  /* Gemini call with 8s timeout (safely under Netlify's 10s kill) */
  try {
    const answer = await Promise.race([
      generate(
        "qa",
        { question, ragContext, bookName, chapter },
        history.slice(-4).map(h => ({
          role: h.role,
          text: h.content || h.text || "",
        }))
      ),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("GEMINI_TIMEOUT")), 8000)
      ),
    ]);

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ answer, sources }),
    };

  } catch (err) {
    console.error("[ask] generate error:", err.message);

    let msg = "பிழை நேர்ந்தது. மீண்டும் முயற்சிக்கவும்.";
    if (err.message === "GEMINI_TIMEOUT" || err.name === "AbortError") {
      msg = "Gemini பதில் தாமதமானது — மீண்டும் முயற்சிக்கவும்.";
    } else if (err.code === "QUOTA" || (err.message || "").includes("quota")) {
      msg = "API quota தீர்ந்துவிட்டது. சில நிமிடங்கள் பிறகு முயற்சிக்கவும்.";
    }

    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ message: msg }),
    };
  }
};