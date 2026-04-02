/* ============================================================
   server/cache.js
   
   Simple in-memory cache for API responses.
   Saves money by not calling Gemini for repeated questions.
   
   Common questions like "இயேசு யார்?" asked by 100 users
   → only 1 API call, 99 served from cache.
   
   Cache auto-expires after TTL (default 24 hours).
============================================================ */

const crypto = require("crypto");

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_CACHE_SIZE = 500; // max entries before LRU eviction

class ResponseCache {
  constructor(ttlMs = DEFAULT_TTL_MS) {
    this.ttl   = ttlMs;
    this.store = new Map(); // key → { value, timestamp, hits }
    this.stats = { hits: 0, misses: 0, evictions: 0 };
  }

  /**
   * Generate a cache key from question + context.
   * We hash it so the key is short and consistent.
   */
  makeKey(question, bookNum, chapter) {
    const raw = `${question.trim().toLowerCase()}|${bookNum || 0}|${chapter || 0}`;
    return crypto.createHash("md5").update(raw).digest("hex");
  }

  get(question, bookNum, chapter) {
    const key   = this.makeKey(question, bookNum, chapter);
    const entry = this.store.get(key);

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    // Check TTL
    if (Date.now() - entry.timestamp > this.ttl) {
      this.store.delete(key);
      this.stats.misses++;
      return null;
    }

    entry.hits++;
    entry.lastAccess = Date.now();
    this.stats.hits++;
    return entry.value;
  }

  set(question, bookNum, chapter, value) {
    // Evict oldest entries if cache is full
    if (this.store.size >= MAX_CACHE_SIZE) {
      this._evictOldest();
    }

    const key = this.makeKey(question, bookNum, chapter);
    this.store.set(key, {
      value,
      timestamp:  Date.now(),
      lastAccess: Date.now(),
      hits:       0,
    });
  }

  _evictOldest() {
    // Find the entry with the oldest lastAccess time
    let oldestKey  = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.store.entries()) {
      if (entry.lastAccess < oldestTime) {
        oldestTime = entry.lastAccess;
        oldestKey  = key;
      }
    }

    if (oldestKey) {
      this.store.delete(oldestKey);
      this.stats.evictions++;
    }
  }

  getStats() {
    const total   = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? ((this.stats.hits / total) * 100).toFixed(1) : "0.0";
    return {
      ...this.stats,
      size:    this.store.size,
      hitRate: `${hitRate}%`,
    };
  }

  clear() {
    this.store.clear();
    this.stats = { hits: 0, misses: 0, evictions: 0 };
  }
}

// Export a single shared instance
module.exports = new ResponseCache();