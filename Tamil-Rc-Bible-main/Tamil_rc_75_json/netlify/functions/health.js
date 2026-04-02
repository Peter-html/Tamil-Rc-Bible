const rag = require("../../server/rag-engine");

let initialized = false;

async function ensureInit() {
  if (!initialized) {
    await rag.buildIndex();
    initialized = true;
  }
}

exports.handler = async function () {
  try {
    await ensureInit();

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        indexed: true,
        stats: rag.getStats()
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        indexed: false,
        message: err.message || "Health check failed"
      })
    };
  }
};