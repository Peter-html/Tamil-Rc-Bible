/* ============================================================
   server/llm.js
   
   Handles all communication with Google Gemini API.
   Takes RAG-retrieved verses and generates Tamil responses.
============================================================ */

const { GoogleGenerativeAI } = require("@google/generative-ai");

let genAI  = null;
let model  = null;

function initGemini(apiKey) {
  if (!apiKey || apiKey === "YOUR_GEMINI_API_KEY_HERE") {
    throw new Error("GEMINI_API_KEY is not set in .env file");
  }
  genAI = new GoogleGenerativeAI(apiKey);
  model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    generationConfig: {
      temperature:     0.7,
      topP:            0.9,
      maxOutputTokens: 1024,
    },
  });
  console.log("[LLM] Gemini initialized with model: gemini-2.0-flash");
}

/* ── SYSTEM PROMPT ── */
const SYSTEM_PROMPT = `நீ "Ask Bible" என்ற தமிழ் வேதாகம AI உதவியாளர். 
நீ ஒரு அன்பான, அறிவுள்ள தமிழ் கத்தோலிக்க வேதாகம ஆசிரியர் போல பேசுகிறாய்.

உன்னுடைய கட்டாய விதிகள்:
1. எப்போதும் தமிழில் மட்டுமே பதில் சொல்.
2. பதில் இயற்கையான paragraph வடிவில் இருக்கட்டும் — bullet points, numbers, headers வேண்டாம்.
3. கீழே கொடுக்கப்பட்ட Bible வசனங்களை மட்டுமே ஆதாரமாக பயன்படுத்து.
4. வசனங்களில் இல்லாத விஷயங்களை கற்பனையாக சொல்லாதே.
5. பதில் warm, spiritual, மனதில் பதிவதாக இருக்கட்டும்.
6. வசனங்களை quote செய்யும்போது புத்தகம் மற்றும் அதிகாரம்:வசனம் எண்ணை குறிப்பிடு.
7. பதில் 200-300 வார்த்தைகளுக்குள் இருக்கட்டும்.`;

/* ── PROMPT BUILDERS ── */

function buildChapterSummaryPrompt(bookName, chapter, ragContext) {
  return `${SYSTEM_PROMPT}

தொடர்புடைய வேதாகம வசனங்கள்:
${ragContext}

கேள்வி: ${bookName} ${chapter}-ஆம் அதிகாரத்தின் ஆழமான summary சொல். முக்கிய நிகழ்வுகள், key message, spiritual meaning எல்லாம் சேர்த்து, ஒரு கதை சொல்வது போல் explain செய்.`;
}

function buildQAPrompt(question, ragContext, currentBook, currentChapter) {
  const contextHint = currentBook
    ? `(பயனர் இப்போது ${currentBook} ${currentChapter}-ஐ வாசிக்கிறார்)`
    : "";

  return `${SYSTEM_PROMPT}

தொடர்புடைய வேதாகம வசனங்கள்:
${ragContext}

${contextHint}

கேள்வி: ${question}`;
}

function buildCharacterPrompt(characterName, ragContext) {
  return `${SYSTEM_PROMPT}

தொடர்புடைய வேதாகம வசனங்கள்:
${ragContext}

கேள்வி: ${characterName} பற்றி ஒரு கதை சொல்வது போல் விளக்கு. அவர் யார், குடும்பம், வாழ்க்கையில் முக்கியமான நிகழ்வுகள், விசுவாசம் எல்லாம் சேர்த்து இயற்கையாக சொல்.`;
}

/* ── MAIN GENERATION FUNCTION ── */

/**
 * Generate a response using Gemini with RAG context.
 * 
 * @param {string} type        - "summary" | "qa" | "character"
 * @param {object} params      - { question, ragContext, bookName, chapter, characterName }
 * @param {Array}  history     - Previous conversation turns [{role, text}]
 * @returns {string}           - Generated Tamil response
 */
async function generate(type, params, history = []) {
  if (!model) throw new Error("Gemini not initialized. Call initGemini() first.");

  let prompt;

  switch (type) {
    case "summary":
      prompt = buildChapterSummaryPrompt(params.bookName, params.chapter, params.ragContext);
      break;
    case "character":
      prompt = buildCharacterPrompt(params.characterName, params.ragContext);
      break;
    case "qa":
    default:
      prompt = buildQAPrompt(params.question, params.ragContext, params.bookName, params.chapter);
      break;
  }

  // Build conversation history for multi-turn chat
  const chatHistory = history.map(h => ({
    role:  h.role === "user" ? "user" : "model",
    parts: [{ text: h.text }],
  }));

  try {
    if (chatHistory.length > 0) {
      // Multi-turn: use chat session
      const chat = model.startChat({ history: chatHistory });
      const result = await chat.sendMessage(prompt);
      return result.response.text();
    } else {
      // Single turn
      const result = await model.generateContent(prompt);
      return result.response.text();
    }
  } catch (err) {
    // Handle Gemini-specific errors with helpful messages
    if (err.message?.includes("API_KEY_INVALID")) {
      throw new Error("Invalid Gemini API key. Check your .env file.");
    }
    if (err.message?.includes("QUOTA_EXCEEDED") || err.message?.includes("429")) {
      throw new Error("Daily API limit reached. Try again tomorrow or upgrade your Gemini plan.");
    }
    if (err.message?.includes("SAFETY")) {
      throw new Error("Content filtered by safety system.");
    }
    throw err;
  }
}

module.exports = { initGemini, generate };