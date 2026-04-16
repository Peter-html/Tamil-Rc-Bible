/* ============================================================
   netlify/functions/health.js  — v3
   No RAG dependency. Just checks that Gemini can be initialised.
   Returns in < 1s even on cold start.
============================================================ */

const { initGemini } = require("../../server/llm");

let _ready   = false;
let _initErr = null;

const _boot = (async () => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY missing");
    initGemini(apiKey);
    _ready = true;
  } catch (e) {
    _initErr = e.message || String(e);
  }
})();

const CORS = {
  "Content-Type":                "application/json",
  "Access-Control-Allow-Origin": "*",
};

exports.handler = async function () {
  if (!_ready && !_initErr) {
    await Promise.race([_boot, new Promise(r => setTimeout(r, 2000))]);
  }

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({
      ok:      _ready,
      indexed: true,   // kept for backward compat with checkHealth() in browser
      error:   _initErr || null,
    }),
  };
};