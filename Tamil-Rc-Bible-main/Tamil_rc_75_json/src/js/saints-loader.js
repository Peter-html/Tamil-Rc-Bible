/**
 * saints-loader.js
 * UI Logic for displaying the Saint of the Day.
 * Uses SaintsService for data and image resolution.
 */

(function () {
  const LITURGICAL_COLORS = {
    WHITE:  { bg: 'rgba(255,255,255,0.15)', border: '#e8d9b0', text: '#c9a84c' },
    RED:    { bg: 'rgba(180,30,30,0.15)',   border: '#b41e1e', text: '#e05555' },
    GREEN:  { bg: 'rgba(30,120,60,0.15)',   border: '#1e7840', text: '#3db87a' },
    PURPLE: { bg: 'rgba(100,30,140,0.15)',  border: '#641e8c', text: '#b06cd4' },
    BLACK:  { bg: 'rgba(30,30,30,0.3)',     border: '#555',    text: '#aaa'    },
    GOLD:   { bg: 'rgba(180,140,30,0.15)',  border: '#b48c1e', text: '#c9a84c' },
  };

  function applyLiturgicalStyle(saint) {
    const colorKey = (saint.liturgicalColor || 'WHITE').toUpperCase();
    const colors = LITURGICAL_COLORS[colorKey] || LITURGICAL_COLORS.WHITE;

    const card = document.getElementById('saintCard');
    if (card) {
      card.style.borderLeftColor = colors.border;
      card.style.background = colors.bg;
    }

    const nameEl = document.getElementById('saintName');
    if (nameEl) nameEl.style.color = colors.text;
  }

  function showPhoto(url, altText) {
    const photoEl = document.getElementById('saintPhoto');
    const fallbackEl = document.getElementById('saintPhotoFallback');
    if (!photoEl) return;

    photoEl.src = url;
    photoEl.alt = altText || '';
    photoEl.style.display = 'block';
    if (fallbackEl) fallbackEl.style.display = 'none';

    photoEl.onerror = function () {
      this.style.display = 'none';
      if (fallbackEl) fallbackEl.style.display = 'block';
    };
  }

  function showFallbackIcon() {
    const photoEl = document.getElementById('saintPhoto');
    const fallbackEl = document.getElementById('saintPhotoFallback');
    if (photoEl) photoEl.style.display = 'none';
    if (fallbackEl) fallbackEl.style.display = 'block';
  }

  async function renderSaint(saint) {
    if (!saint) { renderFallback(); return; }

    const nameEl = document.getElementById('saintName');
    if (nameEl) nameEl.textContent = saint.nameTa || saint.nameEn || '';

    const dateEl = document.getElementById('saintDate');
    if (dateEl) dateEl.textContent = saint.dateStrTa || '';

    const bioEl = document.getElementById('saintAbout');
    if (bioEl) bioEl.textContent = saint.bioTa || '';

    const quoteEl = document.getElementById('saintActions');
    if (quoteEl) {
      quoteEl.innerHTML = saint.quoteTa
        ? `<span style="font-style:italic;color:#ffffff">"${saint.quoteTa}"</span>`
        : '';
    }

    // Resolve image using service
    const imageUrl = await SaintsService.getSaintImage(saint);
    if (imageUrl) {
      showPhoto(imageUrl, saint.nameTa || saint.nameEn || '');
    } else {
      showFallbackIcon();
    }

    const typeEl = document.getElementById('saintFeastType');
    if (typeEl && saint.type) {
      const typeMap = {
        SOLEMNITY: 'மகா திருவிழா',
        FEAST:     'திருவிழா',
        MEMORIAL:  'நினைவு நாள்',
        OPTIONAL:  'விருப்ப நினைவு நாள்'
      };
      typeEl.textContent = typeMap[saint.type] || saint.type;
      typeEl.style.display = 'inline-block';
    }

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

    showFallbackIcon();
  }

  async function init() {
    try {
      const saint = await SaintsService.getSaintOfDay();
      await renderSaint(saint);
    } catch (err) {
      console.error('[Saints] Initialization failed:', err);
      renderFallback();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
