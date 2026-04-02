/**
 * SaintsService
 * Centralized logic for loading saint of the day and managing saint images.
 * Prioritizes local images, then photoUrl, then Wikipedia API fallback.
 */
const SaintsService = (() => {
  const MONTH_NAMES = [
    '', 'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december'
  ];

  const JSON_BASE_DIR = './assets/data/saints';
  const WIKI_API = 'https://en.wikipedia.org/w/api.php';
  const CACHE_KEY_PREFIX = 'saint_img_';

  function getTodayKey() {
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return { key: `${mm}-${dd}`, month: now.getMonth() + 1 };
  }

  function normalizeNameForWiki(name) {
    if (!name) return '';
    return name
      .replace(/^(Saint|Saints|Blessed|Most Holy)\s+/i, '')
      .replace(/\s+(of|the|and|de|di)\s+/gi, ' ')
      .trim();
  }

  return {
    async fetchWikiImage(saintName) {
      if (!saintName) return '';
      const cacheKey = CACHE_KEY_PREFIX + saintName.toLowerCase().replace(/\s+/g, '_');
      try {
        const cached = sessionStorage.getItem(cacheKey);
        if (cached !== null) return cached;
      } catch (e) {}

      const searchName = normalizeNameForWiki(saintName);

      try {
        const params = new URLSearchParams({
          action: 'query',
          list: 'search',
          srsearch: searchName + ' saint',
          srlimit: '1',
          format: 'json',
          origin: '*'
        });

        const searchResp = await fetch(`${WIKI_API}?${params}`);
        const searchData = await searchResp.json();
        const results = searchData?.query?.search || [];
        if (results.length === 0) {
          try { sessionStorage.setItem(cacheKey, ''); } catch (e) {}
          return '';
        }

        const articleTitle = results[0].title;
        const imgParams = new URLSearchParams({
          action: 'query',
          titles: articleTitle,
          prop: 'pageimages',
          pithumbsize: '400',
          format: 'json',
          origin: '*',
          redirects: '1'
        });

        const imgResp = await fetch(`${WIKI_API}?${imgParams}`);
        const imgData = await imgResp.json();
        const pages = imgData?.query?.pages || {};
        let imageUrl = '';
        for (const page of Object.values(pages)) {
          const src = page?.thumbnail?.source || '';
          if (src) { imageUrl = src; break; }
        }

        try { sessionStorage.setItem(cacheKey, imageUrl); } catch (e) {}
        return imageUrl;
      } catch (err) {
        console.warn(`[SaintsService] Wiki lookup failed for "${saintName}":`, err.message);
        return '';
      }
    },

    async getSaintOfDay() {
      const { key, month } = getTodayKey();
      const filePath = `${JSON_BASE_DIR}/saints_${MONTH_NAMES[month]}.json`;
      
      try {
        const response = await fetch(filePath);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        return data[key] || null;
      } catch (err) {
        console.error('[SaintsService] Failed to load saint data:', err);
        return null;
      }
    },

    /**
     * Centralized image resolution logic.
     * Returns the best available image URL for a saint.
     */
    async getSaintImage(saint) {
      if (!saint) return '';
      
      // 1. Local Image - map legacy "saints-images/" to new "assets/images/saints/"
      let local = (saint.localImage || '').trim();
      if (local) {
        if (local.startsWith('saints-images/')) {
          local = local.replace('saints-images/', 'assets/images/saints/');
        }
        return local;
      }

      // 2. Explicit photoUrl
      const photo = (saint.photoUrl || '').trim();
      if (photo) return photo;

      // 3. Wikipedia Fallback
      const nameForSearch = saint.nameEn || '';
      if (nameForSearch) {
        return await this.fetchWikiImage(nameForSearch);
      }
      
      return '';
    }
  };
})();
