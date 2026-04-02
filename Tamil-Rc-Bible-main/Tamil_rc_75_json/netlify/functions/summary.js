const { initGemini, generate } = require("../../server/llm");
const rag = require("../../server/rag-engine");

let initialized = false;

async function ensureInit() {
  if (!initialized) {
    initGemini(process.env.GEMINI_API_KEY);
    await rag.buildIndex();
    initialized = true;
  }
}

exports.handler = async function (event) {
  try {
    await ensureInit();

    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Method not allowed" })
      };
    }

    const body = JSON.parse(event.body || "{}");
    const { bookNum, bookName, chapter } = body;

    if (!bookNum || !chapter) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "bookNum and chapter are required" })
      };
    }

    const verses = rag.getChapterVerses(bookNum, chapter);
    const ragContext = rag.formatContext(verses);

    const summary = await generate("summary", {
      bookName,
      chapter,
      ragContext
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ summary })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: err.message || "Server error"
      })
    };
  }
};