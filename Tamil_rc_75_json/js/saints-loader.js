// saints-loader.js
// Loads saint of the day from per-month JSON files
// File structure: saints/saints_january.json, saints_february.json, etc.

(function () {
  const MONTH_NAMES = [
    '', 'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december'
  ];

  const LITURGICAL_COLORS = {
    WHITE:  { bg: 'rgba(255,255,255,0.15)', border: '#e8d9b0', text: '#c9a84c' },
    RED:    { bg: 'rgba(180,30,30,0.15)',   border: '#b41e1e', text: '#e05555' },
    GREEN:  { bg: 'rgba(30,120,60,0.15)',   border: '#1e7840', text: '#3db87a' },
    PURPLE: { bg: 'rgba(100,30,140,0.15)',  border: '#641e8c', text: '#b06cd4' },
    BLACK:  { bg: 'rgba(30,30,30,0.3)',     border: '#555',    text: '#aaa'    },
    GOLD:   { bg: 'rgba(180,140,30,0.15)',  border: '#b48c1e', text: '#c9a84c' },
  };

  function getTodayKey() {
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return { key: `${mm}-${dd}`, month: now.getMonth() + 1 };
  }

  function getMonthFileName(monthNum) {
    return `saints/saints_${MONTH_NAMES[monthNum]}.json`;
  }

  function applyLiturgicalStyle(saint) {
    const colorKey = (saint.liturgicalColor || 'WHITE').toUpperCase();
    const colors = LITURGICAL_COLORS[colorKey] || LITURGICAL_COLORS.WHITE;

    const card = document.getElementById('saintCard');
    if (card) {
      card.style.borderLeftColor = colors.border;
      card.style.background = colors.bg;
    }

    // Apply accent color to saint name
    const nameEl = document.getElementById('saintName');
    if (nameEl) nameEl.style.color = colors.text;
  }

  function renderSaint(saint) {
    // Name
    const nameEl = document.getElementById('saintName');
    if (nameEl) nameEl.textContent = saint.nameTa || saint.nameEn || '';

    // Date
    const dateEl = document.getElementById('saintDate');
    if (dateEl) dateEl.textContent = saint.dateStrTa || '';

    // Bio
    const bioEl = document.getElementById('saintAbout');
    if (bioEl) bioEl.textContent = saint.bioTa || '';

    // Quote
    const quoteEl = document.getElementById('saintActions');
    if (quoteEl) {
      quoteEl.innerHTML = saint.quoteTa
        ? `<span style="font-style:italic;color:#ffffff">"${saint.quoteTa}"</span>`
        : '';
    }

    // Photo
    const photoEl = document.getElementById('saintPhoto');
    if (photoEl) {
      if (saint.photoUrl && saint.photoUrl.trim() !== '') {
        photoEl.src = saint.photoUrl;
        photoEl.alt = saint.nameTa || saint.nameEn || '';
        photoEl.style.display = 'block';
        photoEl.onerror = function () { this.style.display = 'none'; };
      } else {
        photoEl.style.display = 'none';
      }
    }

    // Feast type badge
    const typeEl = document.getElementById('saintFeastType');
    if (typeEl && saint.type) {
      const typeMap = {
        SOLEMNITY: 'மகா திருவிழா',
        FEAST:     'திருவிழா',
        MEMORIAL:  'நினைவு நாள',
        OPTIONAL:  'விருப்ப நினைவு நாள்'
      };
      typeEl.textContent = typeMap[saint.type] || saint.type;
      typeEl.style.display = 'inline-block';
    }

    // Apply liturgical color styling
    applyLiturgicalStyle(saint);
  }

  function renderFallback() {
    const nameEl = document.getElementById('saintName');
    if (nameEl) nameEl.textContent = 'இன்றைய புனிதர்';

    const bioEl = document.getElementById('saintAbout');
    if (bioEl) bioEl.textContent = 'இன்றைய புனிதரின் தகவல்கள் ஏற்றப்படவில்லை.';

    const dateEl = document.getElementById('saintDate');
    if (dateEl) {
      const now = new Date();
      const months = ['ஜனவரி','பிப்ரவரி','மார்ச்','ஏப்ரல்','மே','ஜூன்',
                      'ஜூலை','ஆகஸ்ட்','செப்டம்பர்','அக்டோபர்','நவம்பர்','டிசம்பர்'];
      dateEl.textContent = `${months[now.getMonth()]} ${now.getDate()}`;
    }
  }

  async function loadSaintOfDay() {
    const { key, month } = getTodayKey();
    const filePath = getMonthFileName(month);

    try {
      const response = await fetch(filePath);
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${filePath}`);

      const data = await response.json();

      if (data[key]) {
        renderSaint(data[key]);
      } else {
        console.warn(`[Saints] No entry found for key: ${key} in ${filePath}`);
        renderFallback();
      }
    } catch (err) {
      console.error('[Saints] Failed to load saint data:', err);
      renderFallback();
    }
  }

  // Run after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadSaintOfDay);
  } else {
    loadSaintOfDay();
  }
})();
