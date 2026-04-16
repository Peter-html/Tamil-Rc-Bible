/* ============================================================
   netlify/functions/summary.js  — v3  (browser-context)

   Like ask.js v3: the browser sends the chapter verses directly.
   No RAG index build — zero cold-start cost.
============================================================ */

const { initGemini, generate } = require("../../server/llm");

let _ready   = false;
let _initErr = null;

const _boot = (async () => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY missing");
    initGemini(apiKey);
    _ready = true;
    console.log("[summary] Gemini ready");
  } catch (e) {
    _initErr = e.message || String(e);
    console.error("[summary] boot error:", _initErr);
  }
})();

const CORS = {
  "Content-Type":                "application/json",
  "Access-Control-Allow-Origin": "*",
};

exports.handler = async function (event) {
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

  if (!_ready && !_initErr) {
    await Promise.race([_boot, new Promise(r => setTimeout(r, 3000))]);
  }

  if (_initErr) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ message: "சர்வர் தயாராகவில்லை. மீண்டும் முயற்சிக்கவும்." }),
    };
  }

  if (!_ready) {
    return {
      statusCode: 503,
      headers: CORS,
      body: JSON.stringify({ message: "சர்வர் தொடங்குகிறது — 5 நொடிகளில் மீண்டும் முயற்சிக்கவும்." }),
    };
  }

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

  const { bookName = "", chapter = null, verses = [] } = body;

  if (!chapter) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ message: "chapter is required" }),
    };
  }

  if (!verses.length) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ message: "வசனங்கள் இல்லை." }),
    };
  }

  /* Build context from the browser-sent verses */
  const ragContext = `[${bookName} ${chapter}]\n` +
    verses.map(v => `${v.v}. ${v.t}`).join("\n");

  try {
    const summary = await Promise.race([
      generate("summary", { bookName, chapter: Number(chapter), ragContext }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("GEMINI_TIMEOUT")), 8000)
      ),
    ]);

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ summary }),
    };

  } catch (err) {
    console.error("[summary] generate error:", err.message);

    let msg = "பிழை நேர்ந்தது. மீண்டும் முயற்சிக்கவும்.";
    if (err.message === "GEMINI_TIMEOUT") {
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